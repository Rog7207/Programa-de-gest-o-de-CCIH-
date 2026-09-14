/* Reclassifica como NEGATIVA as culturas cujo microrganismo é "na" (ou variante de ausência
   — "nao", "-", "negativo"…). Faltava a opção de negativa no relatório de origem e digitaram
   "na", que o app lia como bactéria e contava como positiva no perfil.

   Diferente da triagem comum (scripts/triar-culturas.js), este script TAMBÉM sobrescreve
   linhas já 'avaliada': aqueles rótulos ("Presente na admissão", "IRAS"…) vieram colados
   pela importação, não de revisão manual — e não há como haver infecção com cultura sem
   germe identificado. Por isso é um script à parte, explícito.

   Guarda o valor original em Observacao (se a coluna existir) e esvazia o "na" do
   microrganismo. Simulação por padrão; --aplicar grava com backup. PASTA_CCIH aponta para
   outra pasta de dados (ex.: banco da Unimed). */

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
const arquivo = path.join(PASTA, ESQUEMAS.culturas.arquivo);

const wbEntrada = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
const banco = {};
wbEntrada.SheetNames.forEach(n => { banco[n] = XLSX.utils.sheet_to_json(wbEntrada.Sheets[n], { defval: '' }); });

console.log(`pasta: ${PASTA}`);
console.log(`culturas no banco: ${banco.culturas.length}\n`);

/* RESULTADO_NEGATIVO é interno de importacao.js; aqui basta a regra: microrganismo ausente
   (germeDaCultura devolve '') mas o campo NÃO estava vazio (tinha "na" e afins). */
const de = {}, para = {};
const conta = (m, k) => { m[k] = (m[k] || 0) + 1; };
let alteradas = 0;

for (const c of banco.culturas) {
  const bruto = String(c.Microrganismo || '').trim();
  if (!bruto) continue;                          /* já vazio: a triagem normal cuida */
  if (imp.germeDaCultura(bruto)) continue;        /* germe de verdade: não tocar */
  if (String(c.Resultado || '').trim() && !/^negativ|semcrescimento/.test(normalizarTexto(c.Resultado))) continue;
  conta(de, (c.StatusRevisao || '?') + ' × ' + (c.AvaliacaoCCIH || '(vazio)'));
  if (ESQUEMAS.culturas.abas.culturas.includes('Observacao') && bruto) {
    c.Observacao = (String(c.Observacao || '').trim() ? c.Observacao + ' | ' : '') + 'microrganismo original: ' + bruto;
  }
  c.Microrganismo = '';
  c.AvaliacaoCCIH = 'Negativa';
  c.StatusRevisao = 'triagem';
  conta(para, 'Negativa');
  alteradas++;
}

console.log('ANTES (status × classificação das que serão reclassificadas):');
Object.entries(de).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('  ' + String(n).padStart(4) + '  ' + k));
console.log(`\nreclassificadas como Negativa: ${alteradas}`);
console.log(`entram no painel depois (possível infecção): ${banco.culturas.filter(imp.culturaDoPainel).length}`);

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const backup = path.join(PASTA, 'backups', 'culturas.backup-antes-marcar-negativas.xlsx');
if (!fs.existsSync(backup)) fs.copyFileSync(arquivo, backup);

const wb = XLSX.utils.book_new();
for (const [aba, colunas] of Object.entries(ESQUEMAS.culturas.abas)) {
  const linhas = (banco[aba] || []).map(o => {
    const limpo = {};
    colunas.forEach(col => { limpo[col] = o[col] === undefined ? '' : o[col]; });
    return limpo;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
}
fs.writeFileSync(arquivo, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log(`\ngravado. Backup em ${backup}`);
