/* Cirurgias que ficaram com ISC = "S" depois que o caso de IRAS ligado a elas foi DESCARTADO
   (18/11/2026). Havia casos da pós-alta com duas cirurgias apontando para o mesmo caso, e o
   descarte só limpava a primeira: a outra seguia "em investigação" com ISC, e os relatórios
   que contam pela marca da cirurgia (ISC, ANVISA, benchmarks) contavam uma infecção descartada.
   Limpa ISC/TipoISC e volta a vigilância para "sem infecção", com rastro em HistoricoEdicao.

   Uso:  PASTA_CCIH="/caminho/Dados CCIH" node scripts/corrigir-isc-descartadas.js            (simulação)
         PASTA_CCIH="/caminho/Dados CCIH" node scripts/corrigir-isc-descartadas.js --aplicar  (grava, com backup) */

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
const QUEM = process.env.USUARIO_CCIH || 'script corrigir-isc-descartadas';
const ler = f => { const wb = XLSX.read(fs.readFileSync(path.join(PASTA, f)), { type: 'buffer' }); const o = {}; wb.SheetNames.forEach(n => { o[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }); }); return { wb, o }; };

const iras = ler('iras.xlsx').o, { wb, o: banco } = ler('cirurgias.xlsx');
const descartados = new Set((iras.casos || []).filter(k => String(k.StatusInvestigacao) === 'descartado').map(k => String(k.ID_IRAS)));
const quando = new Date().toISOString().slice(0, 16).replace('T', ' ');
const porMes = {};
let corrigidas = 0;
for (const c of banco.cirurgias.filter(c => c.ISC === 'S' && descartados.has(String(c.ID_IRAS || '')))) {
  const mudancas = { ISC: '', TipoISC: '' };
  if (normalizarTexto(c.StatusVigilancia) === 'eminvestigacao' || /infeccaoconfirmada/.test(normalizarTexto(c.StatusVigilancia))) mudancas.StatusVigilancia = 'sem infecção';
  const r = imp.editarRegistro(banco.cirurgias, { ID_Cirurgia: c.ID_Cirurgia }, mudancas, { quem: QUEM, quando, nota: `caso ${c.ID_IRAS} foi descartado — a marca de ISC tinha ficado na cirurgia` });
  if (r.alteracoes.length) { corrigidas++; const m = String(c.DataCirurgia).slice(0, 7); porMes[m] = (porMes[m] || 0) + 1; }
}
console.log(`cirurgias com ISC de caso descartado: ${corrigidas}`, porMes);
if (!APLICAR) { console.log('\nSIMULAÇÃO — nada gravado. Rode com --aplicar para gravar (com backup).'); process.exit(0); }
if (!corrigidas) { console.log('Nada a corrigir.'); process.exit(0); }
const arquivo = path.join(PASTA, 'cirurgias.xlsx');
fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
fs.copyFileSync(arquivo, path.join(PASTA, 'backups', `cirurgias.backup-antes-isc-descartadas-${carimbo}.xlsx`));
const saida = XLSX.utils.book_new();
for (const [aba, colunas] of Object.entries(esquemas.ESQUEMAS.cirurgias.abas)) {
  const linhas = (banco[aba] || []).map(o => { const limpo = {}; colunas.forEach(k => { limpo[k] = o[k] === undefined ? '' : o[k]; }); return limpo; });
  XLSX.utils.book_append_sheet(saida, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
}
for (const aba of wb.SheetNames) if (!esquemas.ESQUEMAS.cirurgias.abas[aba]) XLSX.utils.book_append_sheet(saida, XLSX.utils.json_to_sheet(banco[aba]), aba);
fs.writeFileSync(arquivo, XLSX.write(saida, { type: 'buffer', bookType: 'xlsx', compression: true }));
console.log('\nGravado. Backup em backups/.');
