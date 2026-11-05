/* Funde os casos de IRAS duplicados (mesmo paciente — pela identidade do cadastro —, mesmo
   sítio e datas até 14 dias entre si), inclusive os já validados. É o mesmo "Fundir
   duplicatas" da aba Infecções, para rodar em lote: fica o caso mais forte (digitado > confirmado
   > descartado > em investigação), com a topografia mais profunda/grave, campos vazios
   completados e o rastro nas observações; cirurgias e culturas que apontavam para os
   removidos passam a apontar para o mantido (05/11/2026).

   Uso:  PASTA_CCIH="/caminho/Dados CCIH" node scripts/fundir-iras-duplicadas.js            (simulação)
         PASTA_CCIH="/caminho/Dados CCIH" node scripts/fundir-iras-duplicadas.js --aplicar  (grava, com backup) */

const fs = require('fs');
const path = require('path');
const os = require('os');
const raiz = path.join(__dirname, '..');
global.XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(raiz, 'js', 'esquemas.js'));
global.TIPOS_RELATORIO = esquemas.TIPOS_RELATORIO;
global.CLASSES_TRIAGEM = esquemas.CLASSES_TRIAGEM;
global.CLASSIFICACOES_CULTURA = esquemas.CLASSIFICACOES_CULTURA;
global.SINONIMOS_CLASSIFICACAO = esquemas.SINONIMOS_CLASSIFICACAO;
const leitura = require(path.join(raiz, 'js', 'leitura.js'));
global.normalizarTexto = leitura.normalizarTexto;
const imp = require(path.join(raiz, 'js', 'importacao.js'));
global.normalizarProntuario = imp.normalizarProntuario;

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const ler = f => { const wb = XLSX.read(fs.readFileSync(path.join(PASTA, f)), { type: 'buffer' }); const o = {}; wb.SheetNames.forEach(n => { o[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }); }); return o; };
const gravar = (nome, dados) => {
  const esquema = esquemas.ESQUEMAS[nome];
  const wb = XLSX.utils.book_new();
  for (const [aba, colunas] of Object.entries(esquema.abas)) {
    const linhas = (dados[aba] || []).map(o => { const limpo = {}; colunas.forEach(c => { limpo[c] = o[c] === undefined ? '' : o[c]; }); return limpo; });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
  }
  /* abas fora do esquema (ex.: extras) são preservadas */
  for (const aba of Object.keys(dados)) if (!esquema.abas[aba]) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados[aba]), aba);
  fs.writeFileSync(path.join(PASTA, esquema.arquivo), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }));
};

const iras = ler('iras.xlsx'), cirurgias = ler('cirurgias.xlsx'), culturas = ler('culturas.xlsx'), pacientes = ler('pacientes.xlsx');
const identidadeDe = imp.identidadePorNome(pacientes.pacientes || []);
const antes = iras.casos.length;
const resultado = imp.deduplicarCasosIras(iras.casos, undefined, identidadeDe);
console.log(`casos: ${antes} | grupos duplicados: ${resultado.grupos.length} | casos removidos: ${resultado.remover.size}`);
for (const g of resultado.grupos.slice(0, 15)) {
  console.log('  --', g.map(k => `${k.ID_IRAS} ${String(k.DataInfeccao).slice(0, 10)} "${String(k.Topografia).slice(0, 28)}" ${k.StatusInvestigacao}`).join(' | '));
}
let cirRe = 0, culRe = 0;
for (const c of cirurgias.cirurgias || []) { const novo = resultado.remover.get(c.ID_IRAS); if (novo) { c.ID_IRAS = novo; cirRe++; } }
for (const c of culturas.culturas || []) { const novo = resultado.remover.get(c.ID_IRAS); if (novo) { c.ID_IRAS = novo; culRe++; } }
console.log(`cirurgias reapontadas: ${cirRe} | culturas reapontadas: ${culRe}`);
if (!APLICAR) { console.log('\nSIMULAÇÃO — nada gravado. Rode com --aplicar para gravar (com backup).'); process.exit(0); }
if (!resultado.remover.size) { console.log('Nada a fundir.'); process.exit(0); }
fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
for (const f of ['iras.xlsx', 'cirurgias.xlsx', 'culturas.xlsx']) fs.copyFileSync(path.join(PASTA, f), path.join(PASTA, 'backups', f.replace('.xlsx', `.backup-antes-fundir-iras-${carimbo}.xlsx`)));
iras.casos = resultado.casos;
gravar('iras', iras);
if (cirRe) gravar('cirurgias', cirurgias);
if (culRe) gravar('culturas', culturas);
console.log('\nGravado. Backups em backups/.');
