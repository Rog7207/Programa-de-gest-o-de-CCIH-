/* Reabre na vigilância pós-alta as cirurgias de notificação à Anvisa (cesariana, prótese de
   quadril/joelho/mama, derivação ventricular interna, revascularização do miocárdio) que foram
   DISPENSADAS na triagem — decisão da CCIH de 05/11/2026: todas devem ser vigiadas. Volta para
   "sob vigilância" com rastro no próprio registro (HistoricoEdicao).

   Uso:  PASTA_CCIH="/caminho/Dados CCIH" node scripts/reabrir-cirurgias-anvisa.js            (simulação)
         PASTA_CCIH="/caminho/Dados CCIH" node scripts/reabrir-cirurgias-anvisa.js --aplicar  (grava, com backup) */

const fs = require('fs');
const path = require('path');
const os = require('os');
const raiz = path.join(__dirname, '..');
global.XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(raiz, 'js', 'esquemas.js'));
global.TIPOS_RELATORIO = esquemas.TIPOS_RELATORIO;
global.CLASSES_TRIAGEM = esquemas.CLASSES_TRIAGEM;
global.CLASSIFICACOES_CULTURA = esquemas.CLASSIFICACOES_CULTURA;
global.SINONIMOS_CLASSIFICACAO = esquemas.SINONIMOS_CLASSIFICACAO;
const leitura = require(path.join(raiz, 'js', 'leitura.js'));
global.normalizarTexto = leitura.normalizarTexto;
const imp = require(path.join(raiz, 'js', 'importacao.js'));

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const QUEM = process.env.USUARIO_CCIH || 'script reabrir-cirurgias-anvisa';
const arquivo = path.join(PASTA, 'cirurgias.xlsx');
if (!fs.existsSync(arquivo)) { console.error('cirurgias.xlsx não encontrado em ' + PASTA); process.exit(2); }

const wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
const banco = {};
wb.SheetNames.forEach(n => { banco[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }); });
const quando = new Date().toISOString().slice(0, 16).replace('T', ' ');
const alvo = banco.cirurgias.filter(c => String(c.StatusVigilancia || '') === 'dispensada' && imp.procedimentoAnvisa(c).codigo);
const porProc = {};
let reabertas = 0;
for (const c of alvo) {
  const r = imp.editarRegistro(banco.cirurgias, { ID_Cirurgia: c.ID_Cirurgia }, { StatusVigilancia: 'sob vigilância' },
    { quem: QUEM, quando, nota: 'procedimento de notificação à Anvisa não pode ser dispensado — reaberto' });
  if (r.alteracoes.length) { reabertas++; const k = imp.procedimentoAnvisa(c).rotulo; porProc[k] = (porProc[k] || 0) + 1; }
}
console.log(`cirurgias: ${banco.cirurgias.length} | dispensadas de notificação Anvisa reabertas: ${reabertas}`, porProc);
if (!APLICAR) { console.log('\nSIMULAÇÃO — nada gravado. Rode com --aplicar para gravar (com backup).'); process.exit(0); }
fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
fs.copyFileSync(arquivo, path.join(PASTA, 'backups', `cirurgias.backup-antes-reabrir-anvisa-${carimbo}.xlsx`));
const saida = XLSX.utils.book_new();
for (const [aba, colunas] of Object.entries(esquemas.ESQUEMAS.cirurgias.abas)) {
  const linhas = (banco[aba] || []).map(o => { const limpo = {}; colunas.forEach(c => { limpo[c] = o[c] === undefined ? '' : o[c]; }); return limpo; });
  XLSX.utils.book_append_sheet(saida, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
}
fs.writeFileSync(arquivo, XLSX.write(saida, { type: 'buffer', bookType: 'xlsx', compression: true }));
console.log('\nGravado. Backup em backups/.');
