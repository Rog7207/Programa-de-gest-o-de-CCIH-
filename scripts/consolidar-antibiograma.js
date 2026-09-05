/* Consolida o antibiograma dos germes do protocolo de ATB empírico num recorte fechado
   (padrão: jun/2024–jun/2026), para embutir no miniapp de decisão — que roda no celular
   sem acesso ao banco. Sai SÓ agregado: por germe, n de isolados e, por antibiótico,
   n testados e %R. Nenhum prontuário, nome ou data individual.

   Uso:  node scripts/consolidar-antibiograma.js [--de 2024-06-01] [--ate 2026-06-30]
   Lê a pasta de dados de miniapps/fonte/config-local.json (PASTA_DADOS) e grava
   miniapps/fonte/antibiograma-consolidado.json (gitignorado — é desta instalação).
   Depois: node scripts/montar-miniapps.js */

const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
global.XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(raiz, 'js', 'esquemas.js'));
const leitura = require(path.join(raiz, 'js', 'leitura.js'));
const alertas = require(path.join(raiz, 'js', 'alertas.js'));
const rel = require(path.join(raiz, 'js', 'relatorios.js'));
global.normalizarTexto = leitura.normalizarTexto;
global.inferirMecanismo = alertas.inferirMecanismo;
global.GENEROS_GRAM_NEGATIVOS = alertas.GENEROS_GRAM_NEGATIVOS;
global.indiceSensibilidade = rel.indiceSensibilidade;
global.mecanismoDaCultura = rel.mecanismoDaCultura;
const prot = require(path.join(raiz, 'js', 'protocolo-atb.js'));

const arg = (nome, padrao) => {
  const i = process.argv.indexOf('--' + nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};
const DE = arg('de', '2024-06-01');
const ATE = arg('ate', '2026-06-30');
if (!/^\d{4}-\d{2}-\d{2}$/.test(DE) || !/^\d{4}-\d{2}-\d{2}$/.test(ATE) || DE > ATE) {
  console.error('Datas inválidas: --de AAAA-MM-DD --ate AAAA-MM-DD (de ≤ ate).');
  process.exit(1);
}

const pastaFonte = path.join(raiz, 'miniapps', 'fonte');
let configLocal = {};
try { configLocal = JSON.parse(fs.readFileSync(path.join(pastaFonte, 'config-local.json'), 'utf-8')); } catch (e) { /* sem config */ }
const PASTA = arg('pasta', configLocal.PASTA_DADOS);
if (!PASTA) { console.error('Informe a pasta de dados: --pasta /caminho ou PASTA_DADOS no config-local.json.'); process.exit(1); }

const arquivo = path.join(PASTA, esquemas.ESQUEMAS.culturas.arquivo);
const wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
const bancos = { culturas: {
  culturas: XLSX.utils.sheet_to_json(wb.Sheets.culturas, { defval: '' }),
  sensibilidade: XLSX.utils.sheet_to_json(wb.Sheets.sensibilidade || {}, { defval: '' }) } };

/* Todos os germes citados pelo protocolo, uma vez só. */
const germes = [...new Set(prot.PROTOCOLO_ATB.sindromes.flatMap(s => s.germes))];
const consolidado = prot.antibiogramaConsolidado(bancos, germes, DE, ATE);

const mesAno = d => d.slice(5, 7) + '/' + d.slice(0, 4);
const saida = {
  periodo: consolidado.periodo,
  periodoTexto: `entre ${mesAno(DE)} e ${mesAno(ATE)}`,
  geradoEm: new Date().toISOString().slice(0, 10),
  fonte: 'culturas do hospital (culturas.xlsx), só agregados',
  germes: consolidado.germes
};
fs.writeFileSync(path.join(pastaFonte, 'antibiograma-consolidado.json'), JSON.stringify(saida, null, 1));

/* A aba sensibilidade não cobre todo o histórico: mostrar em que meses há antibiograma
   transcrito, para a janela escolhida não prometer o que o banco não tem. */
const comSens = new Set(bancos.culturas.sensibilidade.map(s => s.ID_Cultura));
const porMes = new Map();
for (const c of bancos.culturas.culturas) {
  if (!comSens.has(c.ID_Cultura)) continue;
  const m = String(c.DataColeta).slice(0, 7);
  porMes.set(m, (porMes.get(m) || 0) + 1);
}
const meses = [...porMes.entries()].sort();
console.log(`Antibiograma consolidado ${saida.periodoTexto} — ${bancos.culturas.culturas.length} culturas no banco`);
console.log('culturas com antibiograma transcrito, por mês: '
  + (meses.map(([m, n]) => `${m}=${n}`).join('  ') || 'nenhuma') + '\n');
for (const g of consolidado.germes) {
  const comN = g.linhas.filter(l => l.testados >= 20);
  console.log(`${g.germe}: ${g.culturas} isolados, ${g.linhas.length} antibióticos testados (${comN.length} com n≥20)`);
  for (const l of comN.slice(0, 8)) console.log(`   ${l.pctR >= 30 ? '!' : ' '} ${String(l.pctR).padStart(3)}%R  n=${String(l.testados).padStart(4)}  ${l.rotulo}`);
}
console.log('\ngravado: miniapps/fonte/antibiograma-consolidado.json');
