/* Marca como "não é surto" as suspeitas cujo período terminou até uma data de corte, para
   que o histórico pare de disputar espaço no painel com o que está acontecendo agora.
   Nada é apagado: as suspeitas continuam listadas na aba Surtos, com situação "descartado".

   Uso:  node scripts/descartar-surtos-antigos.js [AAAA-MM-DD]            (simulação)
         node scripts/descartar-surtos-antigos.js [AAAA-MM-DD] --aplicar  (grava)  */

const fs = require('fs');
const path = require('path');
const os = require('os');

global.XLSX = require(path.join(__dirname, '..', 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(__dirname, '..', 'js', 'esquemas.js'));
const leitura = require(path.join(__dirname, '..', 'js', 'leitura.js'));
global.TIPOS_RELATORIO = esquemas.TIPOS_RELATORIO;
global.CLASSIFICACOES_CULTURA = esquemas.CLASSIFICACOES_CULTURA;
global.SINONIMOS_CLASSIFICACAO = esquemas.SINONIMOS_CLASSIFICACAO;
global.normalizarTexto = leitura.normalizarTexto;
const imp = require(path.join(__dirname, '..', 'js', 'importacao.js'));
global.normalizarProntuario = imp.normalizarProntuario;
const alertas = require(path.join(__dirname, '..', 'js', 'alertas.js'));

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const CORTE = (process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a))) || '2026-04-30';
const USUARIO = 'Rogério';
const ESQUEMAS = esquemas.ESQUEMAS;

const ler = arquivo => {
  const wb = XLSX.read(fs.readFileSync(path.join(PASTA, arquivo)), { type: 'buffer' });
  const dados = {};
  wb.SheetNames.forEach(n => { dados[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }); });
  return dados;
};

const culturas = ler(ESQUEMAS.culturas.arquivo).culturas;
const arquivoSurtos = path.join(PASTA, ESQUEMAS.surtos.arquivo);
const banco = fs.existsSync(arquivoSurtos)
  ? ler(ESQUEMAS.surtos.arquivo)
  : { investigacoes: [], documentos: [], pacientes_surto: [] };
banco.investigacoes = banco.investigacoes || [];

const suspeitas = alertas.detectarSurtos(culturas);
const antigas = suspeitas.filter(s => String(s.Fim) <= CORTE);
console.log(`suspeitas detectadas: ${suspeitas.length}`);
console.log(`com período terminando até ${CORTE}: ${antigas.length}`);
console.log(`permanecem ativas no painel: ${suspeitas.length - antigas.length}`);
console.log(`investigações já registradas: ${banco.investigacoes.length}`);

const agora = new Date().toISOString().slice(0, 16).replace('T', ' ');
const hoje = agora.slice(0, 10);
let criadas = 0, jaTinham = 0;
for (const s of antigas) {
  const existente = banco.investigacoes.find(i => alertas.mesmaSuspeita(s, i));
  if (existente) {
    /* Investigação já aberta não é sobrescrita: a decisão de quem investigou vale mais. */
    jaTinham++;
    continue;
  }
  banco.investigacoes.push({
    ID_Surto: imp.proximoID(banco.investigacoes, 'ID_Surto', 'SUR')(),
    Setor: s.Setor, Microrganismo: s.Microrganismo,
    DataInicio: s.Inicio, DataFim: s.Fim, PacientesEnvolvidos: String(s.Pacientes),
    Situacao: 'descartado', Hipotese: '', FonteProvavel: '', MedidasAdotadas: '',
    Conclusao: `Descartado em revisão do histórico: suspeitas encerradas até ${CORTE} não permanecem no painel.`,
    Responsavel: USUARIO, DataAbertura: hoje, DataEncerramento: hoje,
    CriadoPor: USUARIO, CriadoEm: agora, AtualizadoPor: USUARIO, AtualizadoEm: agora
  });
  criadas++;
}
console.log(`\nmarcadas como "não é surto": ${criadas}`);
if (jaTinham) console.log(`já tinham investigação registrada (preservadas): ${jaTinham}`);

const porAno = {};
antigas.forEach(s => { const a = String(s.Fim).slice(0, 4); porAno[a] = (porAno[a] || 0) + 1; });
console.log('por ano de término:', JSON.stringify(porAno));

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
if (fs.existsSync(arquivoSurtos)) {
  const backup = path.join(PASTA, 'backups', 'surtos.backup-antes-descarte.xlsx');
  if (!fs.existsSync(backup)) fs.copyFileSync(arquivoSurtos, backup);
}
const wb = XLSX.utils.book_new();
for (const [aba, colunas] of Object.entries(ESQUEMAS.surtos.abas)) {
  const linhas = (banco[aba] || []).map(o => {
    const limpo = {};
    colunas.forEach(c => { limpo[c] = o[c] == null ? '' : String(o[c]); });
    return limpo;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
}
fs.writeFileSync(arquivoSurtos, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log(`\ngravado: ${ESQUEMAS.surtos.arquivo} (${banco.investigacoes.length} investigações)`);
