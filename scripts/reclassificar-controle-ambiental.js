/* Retroativo: culturas com resultado de COLIFORME que ficaram pendentes (material genérico
   "Outros", fora do regex de água/leite) passam a ser "Controle ambiental/alimentar" — a
   mesma classe que a triagem agora atribui na importação. É controle de vigilância alimentar/
   ambiental, não infecção: sai do painel, dos relatórios de infecção e dos surtos/MDR.

   Só mexe no que ainda está PENDENTE — o que gente já avaliou fica como está. Usa a própria
   preClassificarCultura, então material de leite/água ganha a classe específica.

   Simulação por padrão; grava só com --aplicar (backup antes). */

const fs = require('fs');
const path = require('path');
const os = require('os');
const raiz = path.join(__dirname, '..');
const XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
global.XLSX = XLSX;
const { normalizarTexto } = require(path.join(raiz, 'js', 'leitura.js'));
global.normalizarTexto = normalizarTexto;
const { ESQUEMAS } = require(path.join(raiz, 'js', 'esquemas.js'));
const imp = require(path.join(raiz, 'js', 'importacao.js'));

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');

const arquivo = path.join(PASTA, ESQUEMAS.culturas.arquivo);
const wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
const banco = {};
wb.SheetNames.forEach(aba => { banco[aba] = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '', raw: false }); });
const culturas = banco.culturas || [];

const ehColiforme = c => /coliforme/.test(normalizarTexto(c.Microrganismo));
const pendente = c => normalizarTexto(c.StatusRevisao) === 'pendente';

const alvo = culturas.filter(c => ehColiforme(c) && pendente(c));
console.log(`culturas de coliforme pendentes a reclassificar: ${alvo.length}`);
const porClasse = new Map();
for (const c of alvo) {
  const cl = imp.preClassificarCultura(c) || '(sem classe — confira)';
  porClasse.set(cl, (porClasse.get(cl) || 0) + 1);
}
console.log('classe que receberão (via preClassificarCultura):');
[...porClasse.entries()].forEach(([cl, n]) => console.log(`   ${String(n).padStart(4)}  ${cl}`));

/* Quantas de coliforme NÃO serão tocadas (já avaliadas ou já em triagem), para transparência. */
const jaClassificadas = culturas.filter(c => ehColiforme(c) && !pendente(c)).length;
console.log(`coliforme já classificadas (intocadas): ${jaClassificadas}`);

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

let mudadas = 0;
for (const c of alvo) {
  const cl = imp.preClassificarCultura(c);
  if (!cl) continue;
  c.AvaliacaoCCIH = cl;
  c.StatusRevisao = 'triagem';
  mudadas++;
}

/* Grava preservando abas e colunas extras. */
const outWb = XLSX.utils.book_new();
const abas = [...new Set([...Object.keys(ESQUEMAS.culturas.abas), ...Object.keys(banco)])];
for (const aba of abas) {
  const linhas = banco[aba] || [];
  const doEsquema = ESQUEMAS.culturas.abas[aba] || [];
  const extras = [];
  for (const l of linhas) for (const k of Object.keys(l)) if (!doEsquema.includes(k) && !extras.includes(k)) extras.push(k);
  const colunas = [...doEsquema, ...extras];
  const limpas = linhas.map(o => { const s = {}; colunas.forEach(k => { s[k] = o[k] == null ? '' : String(o[k]); }); return s; });
  XLSX.utils.book_append_sheet(outWb, XLSX.utils.json_to_sheet(limpas, { header: colunas }), aba);
}
fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const backup = path.join(PASTA, 'backups', 'culturas.backup-antes-controle-ambiental.xlsx');
if (!fs.existsSync(backup)) fs.copyFileSync(arquivo, backup);
fs.writeFileSync(arquivo, XLSX.write(outWb, { type: 'buffer', bookType: 'xlsx' }));
console.log(`\ngravado: ${mudadas} cultura(s) reclassificada(s). backup em backups/culturas.backup-antes-controle-ambiental.xlsx`);
