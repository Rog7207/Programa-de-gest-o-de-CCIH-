/* Reconstrói culturas.xlsx a partir do relatório original arquivado, usando o mesmo
   pipeline do app (mapeamento → aliases → validação → deduplicação → gravação).

   Existe porque a primeira importação perdeu três coisas: o antibiograma (a coluna do
   laudo não foi reconhecida), a classificação que a CCIH já tinha feito, e ~9 mil exames
   que a chave natural antiga fundia por serem do mesmo paciente/dia/material.

   Uso:  node scripts/reconstruir-culturas.js            (simulação, não grava nada)
         node scripts/reconstruir-culturas.js --aplicar  (grava, com backup antes)  */

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
global.normalizarProntuario = imp.normalizarProntuario;

const PASTA = '/home/rogerio/Documentos/Dados CCIH HNSC';
const FONTE = path.join(PASTA, 'importados', '2026-08', '2026-08-24-04-16-45_BASE UNIFICADA INFECCOES HNSC.xlsx');
const ABA_FONTE = 'Base Unificada';
const APLICAR = process.argv.includes('--aplicar');

/* A biblioteca aqui é a compilação para navegador: não lê nem grava arquivo sozinha. */
const ler = arquivo => XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
const gravarWorkbook = (wb, arquivo) =>
  fs.writeFileSync(arquivo, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
const abaComo = (wb, nome) => XLSX.utils.sheet_to_json(wb.Sheets[nome], { defval: '' });

/* ---- config: vocabulários e sinônimos já revisados pelo usuário ---- */
const wbConfig = ler(path.join(PASTA, 'config.xlsx'));
const vocabulario = {};
Object.keys(esquemas.VOCABULARIO_INICIAL).forEach(v => {
  vocabulario[v] = (wbConfig.Sheets[v] ? abaComo(wbConfig, v) : []).map(l => l.Nome).filter(Boolean);
});
const aliases = abaComo(wbConfig, 'aliases');
console.log(`config: ${aliases.length} sinônimos, ${vocabulario.materiais.length} materiais, ${vocabulario.microrganismos.length} microrganismos`);

/* Unificação das grafias de bactéria, do mesmo jeito que já foi feito com os materiais.
   Uma regra por grupo basta: a comparação ignora caixa, acento, hífen e ponto final,
   então "Escherichia Coli", "escherichia coli." e "Escherichia coli" caem na mesma chave. */
const UNIFICAR_MICRORGANISMOS = [
  ['Escherichia Coli', 'Escherichia coli'],
  ['Candida Krusei', 'Candida krusei'],                                   // e "Candida krusei.", "Cândida krusei."
  ['Candida albicans.', 'Candida albicans'],                              // e "Cândida albicans."
  ['Staphylococcus aureus.', 'Staphylococcus aureus'],
  ['coco Gram positivo', 'Coco Gram positivo'],                           // e "Coco Gram Positivo"
  ['Staphylococcus coagulase negativo', 'Staphylococcus coagulase-negativo']
];
let novasRegras = 0;
for (const [de, para] of UNIFICAR_MICRORGANISMOS) {
  const chave = normalizarTexto(de);
  const existente = aliases.find(a => a.Campo === 'microrganismos' && normalizarTexto(a.De) === chave);
  if (existente) existente.Para = para;
  else { aliases.push({ Campo: 'microrganismos', De: de, Para: para }); novasRegras++; }
}
console.log(`unificação de bactérias: ${novasRegras} regras novas de grafia`);

/* ---- relatório de origem ---- */
const wbFonte = ler(FONTE);
const grade = XLSX.utils.sheet_to_json(wbFonte.Sheets[ABA_FONTE], { header: 1, defval: '', raw: true });
const cabecalhos = grade[0].map(String);
const linhasDados = grade.slice(1);
console.log(`fonte: ${linhasDados.length} linhas, ${cabecalhos.length} colunas`);

const mapeamento = imp.sugerirMapeamento(cabecalhos, linhasDados, 'culturas');
console.log('\nmapeamento detectado:');
mapeamento.filter(m => m.destino).forEach(m => console.log(`  ${m.cabecalho}  →  ${m.destino}`));
const semDestino = mapeamento.filter(m => !m.destino).map(m => m.cabecalho);
console.log('  (ignoradas: ' + semDestino.join(', ') + ')');

/* Confere que as colunas que importam foram reconhecidas — se o relatório mudar de
   formato, é melhor parar aqui do que gravar um banco pela metade. */
const exigidas = {
  'ID Cultura': 'IDOrigem', 'Atendimento': 'Prontuario', 'Paciente': 'NomePaciente',
  'Data Coleta': 'DataColeta', 'Data Resultado': 'DataResultado', 'Setor': 'Setor',
  'Material': 'Material', 'Sítio (agrupado)': 'Sitio', 'Resultado': 'Resultado',
  'Microrganismo': 'Microrganismo', 'Classificação': 'AvaliacaoCCIH',
  'Mecanismo Resistência (CCIH)': 'MecanismoResistencia',
  'Resistência (antibiograma Lab)': '@antibiograma_texto'
};
let erros = 0;
for (const [coluna, destino] of Object.entries(exigidas)) {
  const m = mapeamento.find(x => x.cabecalho === coluna);
  if (!m) { console.log(`  ERRO: coluna "${coluna}" não existe no relatório`); erros++; }
  else if (m.destino !== destino) { console.log(`  ERRO: "${coluna}" foi para ${m.destino || '(ignorada)'}, esperado ${destino}`); erros++; }
}
if (erros) { console.log('\nAbortado: mapeamento diferente do esperado.'); process.exit(1); }

/* ---- normalização + validação ---- */
const { registros, problemas } = imp.normalizarLinhas(grade, 0, mapeamento, 'culturas', aliases);
console.log(`\nnormalizadas: ${registros.length} linhas | ${problemas.length} problemas de leitura`);
const porMotivo = {};
problemas.forEach(p => { porMotivo[p.campo + ': ' + p.motivo] = (porMotivo[p.campo + ': ' + p.motivo] || 0) + 1; });
Object.entries(porMotivo).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([m, n]) => console.log(`  ${n} × ${m}`));

const { erros: errosValidacao, termosNovos } = imp.validar(registros, 'culturas', vocabulario);
console.log(`\nerros de validação: ${errosValidacao.length}`);
errosValidacao.slice(0, 5).forEach(e => console.log(`  linha ${e.linha}: ${e.campo} — ${e.motivo}`));
Object.entries(termosNovos).forEach(([vocab, termos]) => {
  console.log(`  termos novos em ${vocab} (${termos.length}): ${termos.slice(0, 12).join(' · ')}${termos.length > 12 ? ' …' : ''}`);
});

/* ---- deduplicação pelo ID do laboratório ---- */
const validos = registros.filter(r => !errosValidacao.some(e => e.linha === r._linha));
const dedup = imp.deduplicar(validos, [], 'culturas');
console.log(`\ndedup: ${dedup.novos.length} exames distintos, ${dedup.duplicadosInternos.length} repetidos dentro do arquivo`);

/* ---- montagem das linhas do banco ---- */
const agora = new Date().toISOString().slice(0, 16).replace('T', ' ');
const gerarID = imp.proximoID([], 'ID_Cultura', 'CUL');
const culturas = [], sensibilidade = [];
for (const registro of dedup.novos) {
  const id = gerarID();
  culturas.push(imp.montarLinhaImportada(registro, 'culturas', id, 'Rogério', agora, {}));
  for (const item of registro._antibiograma || []) {
    sensibilidade.push({ ID_Cultura: id, Antibiotico: item.Antibiotico, Resultado: item.Resultado });
  }
}

const conta = (lista, campo) => {
  const m = {};
  lista.forEach(l => { const v = String(l[campo] || '').trim(); if (v) m[v] = (m[v] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};
console.log(`\n=== banco reconstruído ===`);
console.log(`culturas: ${culturas.length} (antes: 27.461)`);
console.log(`positivas: ${culturas.filter(c => c.Microrganismo).length}`);
console.log(`linhas de antibiograma: ${sensibilidade.length} em ${new Set(sensibilidade.map(s => s.ID_Cultura)).size} culturas`);
console.log(`campo Antibiograma preenchido: ${culturas.filter(c => c.Antibiograma).length}`);
console.log('\nStatusRevisao:', JSON.stringify(Object.fromEntries(conta(culturas, 'StatusRevisao'))));
console.log('AvaliacaoCCIH:', JSON.stringify(Object.fromEntries(conta(culturas, 'AvaliacaoCCIH'))));
console.log(`\nmicrorganismos distintos: ${conta(culturas, 'Microrganismo').length}`);
conta(culturas, 'Microrganismo').forEach(([m, n]) => console.log(`  ${String(n).padStart(4)} | ${m}`));
console.log('\nmecanismos de resistência:');
conta(culturas, 'MecanismoResistencia').forEach(([m, n]) => console.log(`  ${String(n).padStart(4)} | ${m}`));
console.log('\nsítios:');
conta(culturas, 'Sitio').forEach(([m, n]) => console.log(`  ${String(n).padStart(5)} | ${m}`));

console.log('\nantibióticos encontrados no antibiograma:');
conta(sensibilidade, 'Antibiotico').forEach(([a, n]) => console.log(`  ${n} × ${a}`));

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

/* ---- gravação, com backup ---- */
const backup = path.join(PASTA, 'culturas.backup-antes-reconstrucao.xlsx');
if (!fs.existsSync(backup)) fs.copyFileSync(path.join(PASTA, 'culturas.xlsx'), backup);
const wbNovo = XLSX.utils.book_new();
for (const [aba, colunas] of Object.entries(esquemas.ESQUEMAS.culturas.abas)) {
  const dados = (aba === 'culturas' ? culturas : sensibilidade).map(o => {
    const limpo = {};
    colunas.forEach(c => { limpo[c] = o[c] == null ? '' : String(o[c]); });
    return limpo;
  });
  XLSX.utils.book_append_sheet(wbNovo, XLSX.utils.json_to_sheet(dados, { header: colunas }), aba);
}
gravarWorkbook(wbNovo, path.join(PASTA, 'culturas.xlsx'));
console.log(`\ngravado: culturas.xlsx (backup em ${path.basename(backup)})`);

/* Termos novos entram no vocabulário, como o assistente faria. */
let mudouConfig = novasRegras > 0;
for (const [vocab, termos] of Object.entries(termosNovos)) {
  if (!termos.length || !wbConfig.Sheets[vocab]) continue;
  const atual = abaComo(wbConfig, vocab);
  termos.forEach(t => atual.push({ Nome: t }));
  wbConfig.Sheets[vocab] = XLSX.utils.json_to_sheet(atual, { header: ['Nome'] });
  mudouConfig = true;
  console.log(`vocabulário ${vocab}: +${termos.length} termos`);
}

/* Tira do vocabulário as grafias que a unificação aposentou: não estão mais em nenhuma
   cultura e existe um sinônimo mandando essa escrita para outra. Termos de fábrica ficam. */
{
  /* Linha descartada guarda o texto original que veio no lugar do germe ("Levedura",
     "Positivo (++)"): é registro do que o laboratório escreveu, não nome de bactéria,
     e não deve entrar no vocabulário. */
  const usados = new Set(culturas.filter(c => c.StatusRevisao !== 'descartada')
    .map(c => normalizarTexto(c.Microrganismo)).filter(Boolean));
  const oficiais = new Set((esquemas.VOCABULARIO_INICIAL.microrganismos || [])
    .map(x => normalizarTexto(typeof x === 'string' ? x : x.Nome)));
  const redirecionados = new Map(aliases.filter(a => a.Campo === 'microrganismos')
    .map(a => [normalizarTexto(a.De), a.Para]));
  const antes = abaComo(wbConfig, 'microrganismos');
  const depois = antes.filter(l => {
    const n = normalizarTexto(l.Nome);
    if (usados.has(n) || oficiais.has(n)) return true;
    const porAlias = redirecionados.has(n) && normalizarTexto(redirecionados.get(n)) !== n
      ? redirecionados.get(n) : null;
    const porMecanismo = imp.separarMecanismoDoNome(l.Nome);
    const destino = porAlias || (porMecanismo && porMecanismo.nome);
    if (destino) console.log(`  vocabulário: "${l.Nome}" aposentado → "${destino}"`);
    return !destino;
  });
  /* Toda bactéria presente no banco precisa estar no vocabulário. */
  const nomesVocab = new Set(depois.map(l => normalizarTexto(l.Nome)));
  const faltando = [...new Set(culturas.filter(c => c.StatusRevisao !== 'descartada')
    .map(c => c.Microrganismo).filter(Boolean))]
    .filter(m => !nomesVocab.has(normalizarTexto(m)));
  faltando.forEach(m => { depois.push({ Nome: m }); console.log(`  vocabulário: "${m}" acrescentado`); });
  if (depois.length !== antes.length || faltando.length) {
    wbConfig.Sheets.microrganismos = XLSX.utils.json_to_sheet(depois, { header: ['Nome'] });
    mudouConfig = true;
    console.log(`vocabulário microrganismos: ${antes.length} → ${depois.length}`);
  }
}

if (mudouConfig) {
  wbConfig.Sheets.aliases = XLSX.utils.json_to_sheet(aliases, { header: ['Campo', 'De', 'Para'] });
  const backupConfig = path.join(PASTA, 'config.backup-antes-reconstrucao.xlsx');
  if (!fs.existsSync(backupConfig)) fs.copyFileSync(path.join(PASTA, 'config.xlsx'), backupConfig);
  gravarWorkbook(wbConfig, path.join(PASTA, 'config.xlsx'));
  console.log('gravado: config.xlsx');
}
