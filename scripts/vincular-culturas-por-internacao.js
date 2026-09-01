/* Resolve os registros provisórios do laboratório pela internação que cobre a data da coleta.

   Por que a data e não o nome: o cadastro é indexado pelo número de ATENDIMENTO, e cada
   internação da mesma pessoa gera um número novo. Casar só por nome é ambíguo (856 casos);
   quem desempata é a internação que estava aberta no dia em que o material foi colhido.

   Depois de reapontar, deduplica: a cultura que veio pelo PDF passa a coincidir com a que
   já existia pela base do hospital. Fica a linha da base (tem o ID do laboratório e a
   classificação da CCIH) e o antibiograma da linha do PDF é levado para ela.

   Uso:  node scripts/vincular-culturas-por-internacao.js            (simulação)
         node scripts/vincular-culturas-por-internacao.js --aplicar  (grava, com backup)  */

const fs = require('fs');
const path = require('path');

global.XLSX = require(path.join(__dirname, '..', 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(__dirname, '..', 'js', 'esquemas.js'));
const leitura = require(path.join(__dirname, '..', 'js', 'leitura.js'));
global.TIPOS_RELATORIO = esquemas.TIPOS_RELATORIO;
global.CLASSIFICACOES_CULTURA = esquemas.CLASSIFICACOES_CULTURA;
global.SINONIMOS_CLASSIFICACAO = esquemas.SINONIMOS_CLASSIFICACAO;
global.normalizarTexto = leitura.normalizarTexto;
const imp = require(path.join(__dirname, '..', 'js', 'importacao.js'));

const PASTA = '/home/rogerio/Documentos/Dados CCIH HNSC';
const APLICAR = process.argv.includes('--aplicar');
const ESQUEMAS = esquemas.ESQUEMAS;
const nP = imp.normalizarProntuario;

const ler = arquivo => {
  const wb = XLSX.read(fs.readFileSync(path.join(PASTA, arquivo)), { type: 'buffer' });
  const dados = {};
  wb.SheetNames.forEach(n => { dados[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }); });
  return dados;
};
const gravar = (nomeEsquema, dados) => {
  const wb = XLSX.utils.book_new();
  for (const [aba, colunas] of Object.entries(ESQUEMAS[nomeEsquema].abas)) {
    const linhas = (dados[aba] || []).map(o => {
      const limpo = {};
      colunas.forEach(c => { limpo[c] = o[c] == null ? '' : String(o[c]); });
      return limpo;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
  }
  fs.writeFileSync(path.join(PASTA, ESQUEMAS[nomeEsquema].arquivo), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
};

const bancos = {};
for (const nome of Object.keys(ESQUEMAS)) {
  if (nome === 'config') continue;
  if (fs.existsSync(path.join(PASTA, ESQUEMAS[nome].arquivo))) bancos[nome] = ler(ESQUEMAS[nome].arquivo);
}
const pacientes = bancos.pacientes.pacientes;
const internacoes = bancos.pacientes.internacoes;
const culturas = bancos.culturas.culturas;

const indice = imp.indicePorNome(pacientes, internacoes);
const nomeDoPseudo = new Map();
pacientes.filter(p => imp.ehPseudoProntuario(p.Prontuario))
  .forEach(p => nomeDoPseudo.set(nP(p.Prontuario), p.Nome));

console.log(`internações no banco: ${internacoes.length} (até ${internacoes.map(i => String(i.DataInternacao).slice(0, 10)).filter(d => /^\d{4}/.test(d)).sort().slice(-1)[0]})`);
console.log(`registros provisórios do laboratório: ${nomeDoPseudo.size}`);

/* ---- 1. reaponta cada exame para a internação que cobre a coleta ---- */
const motivos = {};
const paraOndeFoi = new Map();
let reapontadas = 0;
for (const c of culturas) {
  const chave = nP(c.Prontuario);
  if (!nomeDoPseudo.has(chave)) continue;
  const r = imp.resolverPorNomeEData(nomeDoPseudo.get(chave), c.DataColeta, indice);
  motivos[r.motivo] = (motivos[r.motivo] || 0) + 1;
  if (r.prontuario) {
    paraOndeFoi.set(c.ID_Cultura, { de: chave, para: r.prontuario });
    c.Prontuario = r.prontuario;
    reapontadas++;
  }
}
console.log(`\n=== vínculo pela internação ===`);
console.log(`culturas reapontadas para o número da internação: ${reapontadas}`);
Object.entries(motivos).sort((a, b) => b[1] - a[1])
  .forEach(([m, n]) => console.log(`   ${String(n).padStart(5)} | ${m}`));

/* pseudo-registros que ficaram sem nenhuma cultura passam a ser dispensáveis */
const aindaUsados = new Set(culturas.map(c => nP(c.Prontuario)));
for (const [nomeEsquema, dados] of Object.entries(bancos)) {
  for (const [aba, colunas] of Object.entries(ESQUEMAS[nomeEsquema].abas)) {
    /* O próprio cadastro não conta como uso: senão todo pseudo-registro se manteria vivo
       apenas por existir. Culturas também não — são as que acabaram de ser reapontadas. */
    if (!colunas.includes('Prontuario')) continue;
    if (nomeEsquema === 'culturas' && aba === 'culturas') continue;
    if (nomeEsquema === 'pacientes' && aba === 'pacientes') continue;
    (dados[aba] || []).forEach(l => aindaUsados.add(nP(l.Prontuario)));
  }
}
const pseudoOrfaos = [...nomeDoPseudo.keys()].filter(p => !aindaUsados.has(p));
console.log(`pseudo-registros que ficaram sem nenhum dado: ${pseudoOrfaos.length}`);

/* ---- 2. dedup: a cultura do PDF agora coincide com a da base ---- */
const sensibilidade = bancos.culturas.sensibilidade || [];
const sensPorCultura = new Map();
sensibilidade.forEach(s => {
  if (!sensPorCultura.has(s.ID_Cultura)) sensPorCultura.set(s.ID_Cultura, []);
  sensPorCultura.get(s.ID_Cultura).push(s);
});
const antibiograma = id => sensPorCultura.get(id) || [];
const painelCompleto = id => antibiograma(id).some(s => s.Resultado === 'S');
const daBase = c => !!String(c.IDOrigem || '').trim();

const grupos = new Map();
for (const c of culturas) {
  const chave = [nP(c.Prontuario), String(c.DataColeta).slice(0, 10),
    normalizarTexto(c.Material), normalizarTexto(c.Microrganismo), normalizarTexto(c.Resultado)].join('|');
  if (!grupos.has(chave)) grupos.set(chave, []);
  grupos.get(chave).push(c);
}

const remover = new Set();
let antibiogramasSalvos = 0, mecanismos = 0, classificacoes = 0;
const exemplos = [];
for (const grupo of grupos.values()) {
  if (grupo.length < 2) continue;
  const base = grupo.filter(daBase);
  const doPDF = grupo.filter(c => !daBase(c));
  /* Só funde o que veio das DUAS fontes. Repetições dentro da própria base são exames
     distintos (par de hemoculturas, swabs de sítios diferentes) e não se tocam. */
  if (!base.length || !doPDF.length) continue;
  const pares = Math.min(base.length, doPDF.length);
  for (let i = 0; i < pares; i++) {
    const fica = base[i], sai = doPDF[i];
    if (antibiograma(sai.ID_Cultura).length
      && (!antibiograma(fica.ID_Cultura).length || (painelCompleto(sai.ID_Cultura) && !painelCompleto(fica.ID_Cultura)))) {
      antibiograma(fica.ID_Cultura).forEach(s => { s._remover = true; });
      antibiograma(sai.ID_Cultura).forEach(s => { s.ID_Cultura = fica.ID_Cultura; });
      sensPorCultura.set(fica.ID_Cultura, antibiograma(sai.ID_Cultura));
      if (sai.Antibiograma) fica.Antibiograma = sai.Antibiograma;
      antibiogramasSalvos++;
    } else {
      antibiograma(sai.ID_Cultura).forEach(s => { s._remover = true; });
    }
    if (!String(fica.MecanismoResistencia || '').trim() && String(sai.MecanismoResistencia || '').trim()) {
      fica.MecanismoResistencia = sai.MecanismoResistencia; mecanismos++;
    }
    if (!String(fica.AvaliacaoCCIH || '').trim() && String(sai.AvaliacaoCCIH || '').trim()) {
      fica.AvaliacaoCCIH = sai.AvaliacaoCCIH; fica.StatusRevisao = sai.StatusRevisao; classificacoes++;
    }
    if (!String(fica.Antibiograma || '').trim() && sai.Antibiograma) fica.Antibiograma = sai.Antibiograma;
    remover.add(sai.ID_Cultura);
    if (exemplos.length < 5) {
      exemplos.push(`${fica.Prontuario} · ${fica.DataColeta} · ${fica.Material} · ${fica.Microrganismo || '(negativa)'}`
        + ` — fica ${fica.ID_Cultura}, sai ${sai.ID_Cultura}`);
    }
  }
}
console.log(`\n=== deduplicação depois do vínculo ===`);
console.log(`culturas duplicadas entre PDF e base: ${remover.size}`);
console.log(`antibiogramas preservados na linha que fica: ${antibiogramasSalvos}`);
console.log(`mecanismos aproveitados: ${mecanismos} | classificações aproveitadas: ${classificacoes}`);
exemplos.forEach(e => console.log('   ' + e));

if (bancos.isolamentos) {
  const paraAlvo = new Map();
  for (const grupo of grupos.values()) {
    const base = grupo.filter(daBase), doPDF = grupo.filter(c => !daBase(c));
    if (!base.length || !doPDF.length) continue;
    for (let i = 0; i < Math.min(base.length, doPDF.length); i++) paraAlvo.set(doPDF[i].ID_Cultura, base[i].ID_Cultura);
  }
  let n = 0;
  for (const d of bancos.isolamentos.decisoes || []) {
    if (paraAlvo.has(d.ID_Cultura)) { d.ID_Cultura = paraAlvo.get(d.ID_Cultura); n++; }
  }
  if (n) console.log(`decisões de isolamento reapontadas: ${n}`);
}

bancos.culturas.culturas = culturas.filter(c => !remover.has(c.ID_Cultura));
bancos.culturas.sensibilidade = sensibilidade.filter(s => !s._remover && !remover.has(s.ID_Cultura));
bancos.culturas.sensibilidade.forEach(s => { delete s._remover; });
const semDados = new Set(pseudoOrfaos);
bancos.pacientes.pacientes = pacientes.filter(p => !semDados.has(nP(p.Prontuario)));

const pseudoRestantes = bancos.pacientes.pacientes.filter(p => imp.ehPseudoProntuario(p.Prontuario)).length;
console.log(`\n=== resultado ===`);
console.log(`culturas: ${culturas.length} → ${bancos.culturas.culturas.length}`);
console.log(`linhas de antibiograma: ${sensibilidade.length} → ${bancos.culturas.sensibilidade.length}`);
console.log(`culturas com painel completo: ${bancos.culturas.culturas.filter(c => painelCompleto(c.ID_Cultura)).length}`);
console.log(`pacientes: ${pacientes.length} → ${bancos.pacientes.pacientes.length}`);
console.log(`registros provisórios restantes: ${pseudoRestantes}`);

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}
fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
for (const nomeEsquema of Object.keys(bancos)) {
  const arquivo = ESQUEMAS[nomeEsquema].arquivo;
  const backup = path.join(PASTA, 'backups', arquivo.replace('.xlsx', '.backup-antes-vinculo.xlsx'));
  if (!fs.existsSync(backup)) fs.copyFileSync(path.join(PASTA, arquivo), backup);
  gravar(nomeEsquema, bancos[nomeEsquema]);
}
console.log('\ngravado (backups em backups/*.backup-antes-vinculo.xlsx)');
