/* Miniapps gravados pelo aplicativo na pasta de publicação (pedido de 03/10/2026): a pasta
   é espelhada com o Drive da CCIH e um TABLET ANDROID dedicado abre os arquivos pelo Chrome
   — sem site, sem URL pública. Vale para higiene das mãos, decisão de ATB e a visita à UTI
   na versão sem lista; a visita COM a lista cifrada e a avaliação de antimicrobianos já
   são gravadas na mesma pasta pelas suas telas. As páginas-base vêm de js/miniapps-modelos.js
   (gerado por scripts/montar-miniapps.js dos mesmos fontes); aqui entram só os vocabulários
   desta instalação. Usável no navegador e em Node. */

const MINIAPPS_PARA_PASTA = [
  { arquivo: 'visita-uti.html', titulo: 'Visita à UTI (sem lista — para outros aparelhos)' },
  { arquivo: 'higiene-maos.html', titulo: 'Higiene das mãos' },
  { arquivo: 'decisao-atb.html', titulo: 'Decisão de ATB empírica' }
];

/* Setores e antibióticos do hospital (config.vocabulario) no lugar das listas genéricas —
   mesma substituição que scripts/montar-miniapps.js faz a partir do config.xlsx. Lista
   vazia mantém a genérica. */
function injetarVocabularios(html, vocabulario) {
  const v = vocabulario || {};
  const paraArray = itens => itens.map(i => JSON.stringify(i)).join(', ');
  let saida = String(html);
  if (v.setores && v.setores.length) {
    saida = saida.replace(/const SETORES = \[[^\]]*\];/, () => `const SETORES = [${paraArray(v.setores)}];`);
  }
  if (v.antibioticos && v.antibioticos.length && /const ATBS = \[/.test(saida)) {
    saida = saida.replace(/const ATBS = \[[\s\S]*?\];/, () => `const ATBS = [${paraArray(v.antibioticos)}];`);
  }
  return saida;
}

function montarMiniappParaPasta(arquivo, vocabulario) {
  if (typeof MINIAPPS_MODELOS !== 'object' || !MINIAPPS_MODELOS[arquivo]) {
    throw new Error(`modelo de ${arquivo} não carregado — rode node scripts/montar-miniapps.js`);
  }
  return injetarVocabularios(MINIAPPS_MODELOS[arquivo], vocabulario);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MINIAPPS_PARA_PASTA, injetarVocabularios, montarMiniappParaPasta };
}
