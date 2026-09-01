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

for (const nome of fs.readdirSync(pastaFonte).filter(n => n.endsWith('.html'))) {
  let fonte = fs.readFileSync(path.join(pastaFonte, nome), 'utf-8');
  for (const [chave, valor] of Object.entries(configLocal)) {
    fonte = fonte.replace(new RegExp(`const ${chave} = '[^']*';`), `const ${chave} = '${valor}';`);
  }
  const montado = fonte.includes('<!--SHEETJS-->')
    ? fonte.replace('<!--SHEETJS-->', () => '<script>' + lib + '</script>')
    : fonte;
  fs.writeFileSync(path.join(raiz, 'miniapps', nome), montado);
  console.log('montado: miniapps/' + nome, `(${Math.round(montado.length / 1024)} KB)`);
}
