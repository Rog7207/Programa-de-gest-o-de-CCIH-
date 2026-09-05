/* Monta os miniapps finais embutindo o SheetJS — cada um vira um único arquivo HTML
   que funciona offline no celular. */
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const lib = fs.readFileSync(path.join(raiz, 'lib', 'xlsx.full.min.js'), 'utf-8');
const pastaFonte = path.join(raiz, 'miniapps', 'fonte');

/* Valores desta instalação (e-mail da CCIH, segredo do Apps Script) vivem em
   fonte/config-local.json — que NÃO vai para o repositório público. Os fontes trazem
   placeholders; o montador injeta os valores reais na hora de montar. */
let configLocal = {};
try { configLocal = JSON.parse(fs.readFileSync(path.join(pastaFonte, 'config-local.json'), 'utf-8')); }
catch (e) { console.log('(sem config-local.json — miniapps saem com os placeholders)'); }

/* Setores e antibióticos do PRÓPRIO hospital, lidos do config.xlsx da pasta de dados
   (chave PASTA_DADOS no config-local.json). Assim o que o miniapp oferece é exatamente o
   que os relatórios reconhecem — sem "Uti" digitado à mão que não casa com nada. */
let setoresHospital = [], atbsHospital = [];
if (configLocal.PASTA_DADOS) {
  try {
    const XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
    const wb = XLSX.read(fs.readFileSync(path.join(configLocal.PASTA_DADOS, 'config.xlsx')), { type: 'buffer' });
    const lista = aba => XLSX.utils.sheet_to_json(wb.Sheets[aba] || {}, { defval: '' })
      .map(l => l.Nome).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    setoresHospital = lista('setores');
    atbsHospital = lista('antibioticos');
    console.log(`vocabulários do hospital: ${setoresHospital.length} setores, ${atbsHospital.length} antibióticos`);
  } catch (e) { console.log('(não li o config.xlsx da pasta de dados: ' + e.message + ')'); }
}
const paraArray = itens => itens.map(i => JSON.stringify(i)).join(', ');

/* O miniapp de decisão de ATB leva o motor do protocolo (o MESMO js/protocolo-atb.js do
   aplicativo, sem cópia divergente). O antibiograma consolidado do hospital (gerado por
   scripts/consolidar-antibiograma.js) só entra com --com-antibiograma: a versão inicial
   é o protocolo puro, por decisão da CCIH — o banco ainda não tem painel S/I/R suficiente
   para o recorte longo. */
const protocoloATB = fs.readFileSync(path.join(raiz, 'js', 'protocolo-atb.js'), 'utf-8');
let antibiogramaJSON = null;
if (process.argv.includes('--com-antibiograma')) {
  try { antibiogramaJSON = fs.readFileSync(path.join(pastaFonte, 'antibiograma-consolidado.json'), 'utf-8'); }
  catch (e) { console.log('(sem antibiograma-consolidado.json — rode node scripts/consolidar-antibiograma.js antes)'); }
} else console.log('decisao-atb: protocolo puro (use --com-antibiograma para embutir o antibiograma local)');

for (const nome of fs.readdirSync(pastaFonte).filter(n => n.endsWith('.html'))) {
  let fonte = fs.readFileSync(path.join(pastaFonte, nome), 'utf-8');
  for (const [chave, valor] of Object.entries(configLocal)) {
    if (chave === 'PASTA_DADOS') continue;
    fonte = fonte.replace(new RegExp(`const ${chave} = '[^']*';`), `const ${chave} = '${valor}';`);
  }
  if (setoresHospital.length) {
    fonte = fonte.replace(/const SETORES = \[[^\]]*\];/, `const SETORES = [${paraArray(setoresHospital)}];`);
  }
  if (atbsHospital.length && /const ATBS = \[/.test(fonte)) {
    /* A lista do hospital substitui a genérica; o "Outro (digitar)" continua existindo
       para o antibiótico não padronizado. */
    fonte = fonte.replace(/const ATBS = \[[\s\S]*?\];/, `const ATBS = [${paraArray(atbsHospital)}];`);
  }
  let montado = fonte.includes('<!--SHEETJS-->')
    ? fonte.replace('<!--SHEETJS-->', () => '<script>' + lib + '</script>')
    : fonte;
  if (montado.includes('<!--PROTOCOLO-ATB-->')) {
    montado = montado.replace('<!--PROTOCOLO-ATB-->', () => '<script>' + protocoloATB + '</script>');
  }
  if (montado.includes('<!--ANTIBIOGRAMA-->')) {
    montado = montado.replace('<!--ANTIBIOGRAMA-->', () => antibiogramaJSON
      ? '<script>const ANTIBIOGRAMA_CONSOLIDADO = ' + antibiogramaJSON + ';</script>' : '');
  }
  fs.writeFileSync(path.join(raiz, 'miniapps', nome), montado);
  console.log('montado: miniapps/' + nome, `(${Math.round(montado.length / 1024)} KB)`);
}
