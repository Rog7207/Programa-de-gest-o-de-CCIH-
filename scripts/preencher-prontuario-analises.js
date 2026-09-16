/* Preenche o Prontuario das prescrições importadas do relatório "análise de antibióticos"
   do Tasy que ficaram só com o Atendimento.

   Origem: na primeira importação (15/09/2026), montarLinhaImportada só copiava os campos
   declarados do tipo — o prontuário resolvido pelo atendimento era usado na deduplicação,
   mas se perdia na gravação. O código foi corrigido; este script conserta o que já entrou:
   para cada prescrição COM atendimento e SEM prontuário, busca a internação daquele
   atendimento e copia o prontuário dela. Quem não tem internação conhecida (RN,
   ambulatório) fica como está — resolve quando o censo sem filtro for importado, rodando
   este script de novo.

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
const arquivoAtb = path.join(PASTA, ESQUEMAS.antibioticos.arquivo);
const bancoAtb = lerBancoXlsx(arquivoAtb);
const bancoPac = lerBancoXlsx(path.join(PASTA, ESQUEMAS.pacientes.arquivo));

const pronDoAt = new Map();
for (const i of (bancoPac.internacoes || [])) {
  const a = N(i.Atendimento), p = N(i.Prontuario);
  if (a && p) pronDoAt.set(a, p);
}

let preenchidos = 0, semInternacao = 0;
for (const p of (bancoAtb.prescricoes || [])) {
  if (String(p.Prontuario || '').trim() || !String(p.Atendimento || '').trim()) continue;
  const alvo = pronDoAt.get(N(p.Atendimento));
  if (alvo) { p.Prontuario = alvo; preenchidos++; }
  else semInternacao++;
}

console.log(`pasta: ${PASTA}`);
console.log(`prescrições: ${(bancoAtb.prescricoes || []).length}`);
console.log(`prontuários preenchidos pelo atendimento: ${preenchidos}`);
console.log(`sem internação conhecida (RN/ambulatório — ficam para o próximo censo): ${semInternacao}`);

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const backup = path.join(PASTA, 'backups', 'antibioticos.backup-antes-preencher-prontuario.xlsx');
if (!fs.existsSync(backup)) fs.copyFileSync(arquivoAtb, backup);

const wb = XLSX.utils.book_new();
for (const [aba, colunas] of Object.entries(ESQUEMAS.antibioticos.abas)) {
  const linhas = (bancoAtb[aba] || []).map(o => {
    const limpo = {};
    colunas.forEach(col => { limpo[col] = o[col] === undefined ? '' : o[col]; });
    return limpo;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
}
fs.writeFileSync(arquivoAtb, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log(`\ngravado. Backup em ${backup}`);
