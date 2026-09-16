/* Preenche o Setor das ISC que ficaram sem ele (padrão da CCIH: infecção de sítio
   cirúrgico é atribuída ao Centro Cirúrgico ou ao Centro Obstétrico, conforme o
   procedimento).

   Origem: uma planilha de IRAS importada em 10/09/2026 não trazia a coluna de setor
   (17 ISC), e os fluxos da vigilância pós-alta gravavam Setor vazio — o código foi
   corrigido; este script conserta o que já entrou. A cirurgia correspondente é buscada
   pelo prontuário com data até 90 dias antes da infecção; procedimento obstétrico →
   Centro Obstétrico, senão → Centro Cirúrgico (também quando não há cirurgia no banco:
   ISC é cirúrgica por definição).

   Simulação por padrão; --aplicar grava com backup. PASTA_CCIH aponta para outra pasta. */

const fs = require('fs');
const path = require('path');
const os = require('os');

global.XLSX = require(path.join(__dirname, '..', 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(__dirname, '..', 'js', 'esquemas.js'));
const leitura = require(path.join(__dirname, '..', 'js', 'leitura.js'));
global.normalizarTexto = leitura.normalizarTexto;
global.CLASSES_TRIAGEM = esquemas.CLASSES_TRIAGEM;
const imp = require(path.join(__dirname, '..', 'js', 'importacao.js'));

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const ESQUEMAS = esquemas.ESQUEMAS;
const N = imp.normalizarProntuario;

const lerBancoXlsx = arquivo => {
  const wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
  const banco = {};
  wb.SheetNames.forEach(n => { banco[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }); });
  return banco;
};
const arquivoIras = path.join(PASTA, ESQUEMAS.iras.arquivo);
const bancoIras = lerBancoXlsx(arquivoIras);
let cirurgias = [];
try { cirurgias = lerBancoXlsx(path.join(PASTA, ESQUEMAS.cirurgias.arquivo)).cirurgias || []; } catch (e) {}

const porProntuario = new Map();
for (const c of cirurgias) {
  const k = N(c.Prontuario);
  if (!k) continue;
  if (!porProntuario.has(k)) porProntuario.set(k, []);
  porProntuario.get(k).push(c);
}
const dif = (a, b) => Math.round((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 864e5);

let preenchidas = 0;
for (const k of (bancoIras.casos || [])) {
  if (!/isc|sitiocirurgico/.test(normalizarTexto(k.Topografia))) continue;
  if (String(k.Setor || '').trim()) continue;
  const candidatas = (porProntuario.get(N(k.Prontuario)) || []).filter(c => {
    const d = dif(c.DataCirurgia, k.DataInfeccao);
    return isFinite(d) && d >= 0 && d <= 90;
  }).sort((a, b) => String(b.DataCirurgia).localeCompare(String(a.DataCirurgia)));
  const setor = imp.setorPadraoISC(candidatas.length ? candidatas[0].Procedimento : '');
  console.log(`  ${k.ID_IRAS}  ${String(k.DataInfeccao).slice(0, 10)}  ${String(k.Topografia).slice(0, 30).padEnd(30)} → ${setor}`
    + (candidatas.length ? `  (cirurgia: ${String(candidatas[0].Procedimento).slice(0, 40)})` : '  (sem cirurgia no banco — padrão CC)'));
  k.Setor = setor;
  preenchidas++;
}
console.log(`\npasta: ${PASTA}`);
console.log(`ISC com setor preenchido: ${preenchidas}`);

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const backup = path.join(PASTA, 'backups', 'iras.backup-antes-setor-isc.xlsx');
if (!fs.existsSync(backup)) fs.copyFileSync(arquivoIras, backup);

const wb = XLSX.utils.book_new();
for (const [aba, colunas] of Object.entries(ESQUEMAS.iras.abas)) {
  const linhas = (bancoIras[aba] || []).map(o => {
    const limpo = {};
    colunas.forEach(col => { limpo[col] = o[col] === undefined ? '' : o[col]; });
    return limpo;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
}
fs.writeFileSync(arquivoIras, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log(`\ngravado. Backup em ${backup}`);
