/* Corrige o agente (Microrganismo) dos casos de IRAS pelo da cultura vinculada mais
   provável (melhorCulturaDaIRAS: gênero que bate > material do sítio > data > antibiograma).

   Regras, na ordem:
   1. caso SEM agente e cultura vinculada com germe → preenche;
   2. agente GENÉRICO do mesmo gênero ("Klebsiella spp") e cultura com espécie → especifica;
   3. gênero DIVERGE de todas as culturas vinculadas → substitui pelo agente da cultura.
   Mesmo gênero com espécies diferentes NÃO é tocado (ambíguo — respeita a notificação).

   Toda correção deixa rastro permanente e reversível, porque a cultura ligada pode ser a
   ERRADA: AgenteOriginal guarda o valor primitivo (nunca sobrescrito), ID_CulturaAgente
   aponta a cultura usada, e Observacoes ganha uma linha datada. O perfil microbiológico
   lista os casos corrigidos (seção 4e) para conferência da CCIH.

   Simulação por padrão; --aplicar grava com backup; --desfazer reverte TODAS as correções
   (AgenteOriginal de volta ao Microrganismo). PASTA_CCIH aponta para outra pasta de dados. */

const fs = require('fs');
const path = require('path');
const os = require('os');

global.XLSX = require(path.join(__dirname, '..', 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(__dirname, '..', 'js', 'esquemas.js'));
const leitura = require(path.join(__dirname, '..', 'js', 'leitura.js'));
global.normalizarTexto = leitura.normalizarTexto;
global.CLASSES_TRIAGEM = esquemas.CLASSES_TRIAGEM;
const imp = require(path.join(__dirname, '..', 'js', 'importacao.js'));
global.normalizarProntuario = imp.normalizarProntuario;
global.germeDaCultura = imp.germeDaCultura;
const alertas = require(path.join(__dirname, '..', 'js', 'alertas.js'));
global.GENEROS_GRAM_NEGATIVOS = alertas.GENEROS_GRAM_NEGATIVOS;
global.inferirMecanismo = alertas.inferirMecanismo;
const rel = require(path.join(__dirname, '..', 'js', 'relatorios.js'));

const genero = s => global.normalizarTexto(String(s || '').trim().split(/\s+/)[0]);
const ehGenerico = s => {
  const partes = String(s || '').trim().split(/\s+/);
  return partes.length === 1 || /^spp?\.?$/i.test(partes[1] || '');
};
/* Resultado de cultura sem identificação de verdade ("Bacilo Gram negativo (não
   identificado)", "Cocos Gram positivos", "Levedura") — nunca substitui agente nomeado. */
const ehInespecifico = s => {
  const n = global.normalizarTexto(s);
  return n.includes('naoidentificado') || /^(bacilo|coco|gram|levedura|fungo)/.test(n);
};

/* Decide a correção a partir do agente atual e do proposto (agenteProvavel da melhor
   cultura). Devolve { regra } ou null quando não há o que corrigir. Pura, testável. */
function decidirCorrecao(atual, proposto) {
  atual = String(atual || '').trim();
  proposto = String(proposto || '').trim();
  /* sentinelas de unificação de vocabulário ("não é cultura") valem como sem agente */
  if (/^__.*__$/.test(atual)) atual = '';
  if (!proposto) return null;
  if (!atual) return { regra: 'sem agente → preenchido' };
  if (global.normalizarTexto(atual) === global.normalizarTexto(proposto)) return null;
  const partes = proposto.split(' + ');
  if (partes.map(genero).includes(genero(atual))) {
    /* mesmo gênero: só especifica quando o caso está genérico ("Klebsiella spp") E a
       cultura traz espécie de verdade — genérico → genérico é ruído */
    const doGenero = partes.filter(p => genero(p) === genero(atual));
    return ehGenerico(atual) && doGenero.some(p => !ehGenerico(p))
      ? { regra: 'genérico → espécie da cultura' } : null;
  }
  /* divergência: não rebaixa agente nomeado para cultura sem identificação */
  if (partes.every(ehInespecifico)) return null;
  return { regra: 'divergência → agente da cultura' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { decidirCorrecao };
}
if (require.main === module) main();

function main() {

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const DESFAZER = process.argv.includes('--desfazer');
const ESQUEMAS = esquemas.ESQUEMAS;
const HOJE = new Date().toISOString().slice(0, 10);

const lerBancoXlsx = arquivo => {
  const wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
  const banco = {};
  wb.SheetNames.forEach(n => { banco[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }); });
  return banco;
};
const arquivoIras = path.join(PASTA, ESQUEMAS.iras.arquivo);
const bancoIras = lerBancoXlsx(arquivoIras);
const bancoCult = lerBancoXlsx(path.join(PASTA, ESQUEMAS.culturas.arquivo));

console.log(`pasta: ${PASTA}`);
console.log(`casos de IRAS: ${(bancoIras.casos || []).length} · culturas: ${(bancoCult.culturas || []).length}\n`);

const anexarObs = (caso, linha) => {
  caso.Observacoes = (String(caso.Observacoes || '').trim() ? caso.Observacoes + '\n' : '') + linha;
};
let alteradas = 0;
const porRegra = {};

if (DESFAZER) {
  for (const caso of (bancoIras.casos || [])) {
    if (!String(caso.ID_CulturaAgente || '').trim()) continue;
    const original = String(caso.AgenteOriginal || '').trim();
    console.log(`  ${caso.Prontuario}  ${String(caso.DataInfeccao).slice(0, 10)}  ${caso.Topografia}: `
      + `"${caso.Microrganismo}" → "${original}"`);
    caso.Microrganismo = original === '(sem agente)' ? '' : original;
    anexarObs(caso, `Correção de agente desfeita em ${HOJE} (voltou de: ${caso.ID_CulturaAgente})`);
    caso.AgenteOriginal = '';
    caso.ID_CulturaAgente = '';
    alteradas++;
  }
  console.log(`\ncorreções desfeitas: ${alteradas}`);
} else {
  const indice = rel.indiceCulturasPorProntuario(bancoCult.culturas || []);
  const sens = rel.indiceSensibilidade({ culturas: { sensibilidade: bancoCult.sensibilidade || [] } });
  for (const caso of (bancoIras.casos || [])) {
    const melhor = rel.melhorCulturaDaIRAS(caso, indice, rel.JANELA_IRAS_CULTURA, sens);
    if (!melhor) continue;
    const atual = String(caso.Microrganismo || '').trim();
    const decisao = decidirCorrecao(atual, melhor.agenteProvavel);
    if (!decisao) continue;
    porRegra[decisao.regra] = (porRegra[decisao.regra] || 0) + 1;
    console.log(`  ${String(caso.Prontuario).padEnd(10)} ${String(caso.DataInfeccao).slice(0, 10)}  `
      + `${String(caso.Topografia).padEnd(28).slice(0, 28)} "${atual || '(sem agente)'}" → `
      + `"${melhor.agenteProvavel}"  [${decisao.regra}; cultura ${melhor.cultura.ID_Cultura}]`);
    if (!String(caso.AgenteOriginal || '').trim()) caso.AgenteOriginal = atual || '(sem agente)';
    caso.ID_CulturaAgente = melhor.cultura.ID_Cultura;
    anexarObs(caso, `Agente corrigido pela cultura ${melhor.cultura.ID_Cultura} em ${HOJE} (era: ${atual || '(sem agente)'})`);
    caso.Microrganismo = melhor.agenteProvavel;
    alteradas++;
  }
  console.log(`\ncorrigidos: ${alteradas}`);
  Object.entries(porRegra).sort((a, b) => b[1] - a[1]).forEach(([k, n]) =>
    console.log('  ' + String(n).padStart(4) + '  ' + k));
}

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const backup = path.join(PASTA, 'backups',
  DESFAZER ? 'iras.backup-antes-desfazer-agentes.xlsx' : 'iras.backup-antes-corrigir-agentes.xlsx');
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

}
