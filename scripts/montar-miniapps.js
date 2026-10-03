/* Monta os miniapps finais embutindo o SheetJS — cada um vira um único arquivo HTML
   que funciona offline no celular. */
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const lib = fs.readFileSync(path.join(raiz, 'lib', 'xlsx.full.min.js'), 'utf-8');
const libQR = fs.readFileSync(path.join(raiz, 'lib', 'qrcode.min.js'), 'utf-8');
const catalogoMiniapps = fs.readFileSync(path.join(raiz, 'js', 'miniapps-catalogo.js'), 'utf-8');
const pastaFonte = path.join(raiz, 'miniapps', 'fonte');

/* Valores desta instalação (e-mail da CCIH, segredo do Apps Script) vivem em
   fonte/config-local.json — que NÃO vai para o repositório público. Os fontes trazem
   placeholders; o montador injeta os valores reais na hora de montar. */
let configLocal = {};
try { configLocal = JSON.parse(fs.readFileSync(path.join(pastaFonte, 'config-local.json'), 'utf-8')); }
catch (e) { console.log('(sem config-local.json — miniapps saem com os placeholders)'); }

/* --publico: build para ser SERVIDO por https, e não baixado. Existe porque no iPhone o
   arquivo baixado não roda — nem no Chrome (que no iOS é o Safari por dentro), nem na
   pré-visualização do app Arquivos. Página hospedada é a única forma de o miniapp
   funcionar no iPhone.

   Aqui o segredo de envio NÃO entra: uma página pública com ENVIO_SEGREDO dentro entrega a
   chave a quem abrir o código-fonte. Sem ele o miniapp cai sozinho no outro caminho que já
   existe — baixar o CSV e anexar num e-mail —, que é justamente o fluxo combinado com os
   assistentes. O e-mail da CCIH também fica de fora: quem publicar preenche depois, para
   não deixar endereço institucional num repositório público. */
const publico = process.argv.includes('--publico');
if (publico) {
  for (const chave of ['ENVIO_URL', 'ENVIO_SEGREDO', 'EMAIL_DESTINO']) delete configLocal[chave];
  console.log('modo --publico: sem ENVIO_URL, sem ENVIO_SEGREDO e sem e-mail — envio pelo CSV + e-mail manual');
}

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

/* Página pronta SEM nada desta instalação: bibliotecas e o motor do protocolo embutidos,
   mas placeholders de e-mail/segredo e vocabulários genéricos. É o que vira "modelo" para
   o aplicativo (abaixo) e a base sobre a qual os valores locais são aplicados. */
function montarBase(fonte) {
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
  /* Página de QR codes (apps.html): leva a biblioteca de QR e o MESMO catálogo que o
     aplicativo usa no cartão de Distribuição — miniapp novo aparece nos dois lugares sem
     edição manual. */
  if (montado.includes('<!--QRCODE-LIB-->')) {
    montado = montado.replace('<!--QRCODE-LIB-->', () => '<script>' + libQR + '</script>');
  }
  if (montado.includes('<!--CATALOGO-->')) {
    montado = montado.replace('<!--CATALOGO-->', () => '<script>' + catalogoMiniapps + '</script>');
  }
  if (montado.includes('<!--DATA-->')) {
    montado = montado.replace('<!--DATA-->', new Date().toISOString().slice(0, 10).split('-').reverse().join('/'));
  }
  return montado;
}

/* Valores desta instalação por cima da base: e-mail/segredo do config-local e os
   vocabulários do hospital. */
function aplicarInstalacao(base) {
  let fonte = base;
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
  return fonte;
}

/* Os miniapps também são GRAVADOS PELO APLICATIVO na pasta de publicação (espelhada com o
   Drive, de onde o tablet da CCIH os abre) — e o da visita à UTI ganha a lista cifrada dos
   leitos. Para o aplicativo não carregar cópia divergente, as páginas-base viram constantes
   em js/miniapps-modelos.js, geradas aqui a cada montagem a partir dos MESMOS fontes. Vão
   sem valores da instalação: o aplicativo injeta setores e antibióticos do próprio
   config.xlsx na hora de gravar (apps.html, a página de QR, fica de fora: não é miniapp). */
/* Decisão de ATB: um miniapp por protocolo (03/10/2026) — mesma página, só troca o id do
   protocolo. Públicos diferentes recebem links diferentes. */
const PROTOCOLOS_DECISAO = [
  ['decisao-atb.html', 'emergencia-adulto'],
  ['decisao-atb-uti.html', 'uti-nosocomial'],
  ['decisao-atb-gestante.html', 'gestante'],
  ['decisao-atb-pediatria.html', 'pediatria']
];
const modelos = {};
const saidas = [];
for (const nome of fs.readdirSync(pastaFonte).filter(n => n.endsWith('.html'))) {
  const fonte = fs.readFileSync(path.join(pastaFonte, nome), 'utf-8');
  const variantes = nome === 'decisao-atb.html'
    ? PROTOCOLOS_DECISAO.map(([arquivo, id]) => [arquivo, fonte.replace(/const PROTOCOLO_ID = '[^']*';/, `const PROTOCOLO_ID = '${id}';`)])
    : [[nome, fonte]];
  for (const [arquivo, texto] of variantes) {
    const base = montarBase(texto);
    if (arquivo !== 'apps.html') modelos[arquivo] = base;
    saidas.push([arquivo, aplicarInstalacao(base)]);
  }
}
{
  const texto = '/* GERADO por scripts/montar-miniapps.js a partir de miniapps/fonte/*.html — não editar à mão.\n'
    + '   Páginas-base dos miniapps (bibliotecas e protocolo embutidos, sem valores da instalação) que o\n'
    + '   aplicativo grava na pasta de publicação (js/miniapps-pasta.js) e, no caso da visita à UTI,\n'
    + '   preenche com a lista cifrada dos leitos (js/visita-uti-cifrada.js). */\n'
    + 'const MINIAPPS_MODELOS = ' + JSON.stringify(modelos, null, 0) + ';\n'
    + "const VISITA_UTI_MODELO = MINIAPPS_MODELOS['visita-uti.html'];\n"
    + "if (typeof module !== 'undefined' && module.exports) module.exports = { MINIAPPS_MODELOS, VISITA_UTI_MODELO };\n";
  fs.writeFileSync(path.join(raiz, 'js', 'miniapps-modelos.js'), texto);
  console.log('gerado: js/miniapps-modelos.js', `(${Math.round(texto.length / 1024)} KB: ${Object.keys(modelos).join(', ')})`);
}
const destino = publico ? path.join(raiz, 'miniapps', 'publico') : path.join(raiz, 'miniapps');
fs.mkdirSync(destino, { recursive: true });
for (const [nome, montado] of saidas) {
  fs.writeFileSync(path.join(destino, nome), montado);
  console.log('montado: ' + path.relative(raiz, path.join(destino, nome)), `(${Math.round(montado.length / 1024)} KB)`);
}
