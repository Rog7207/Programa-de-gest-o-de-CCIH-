/* Reclassificação retroativa das cirurgias pelo classificador de categoria (NHSN / própria /
   especialidade) de importacao.js — decidido com a CCIH do HNSC em 22/09/2026.

   O banco antigo tem ProcedimentoNHSN preenchido pelo de-para manual nome-a-nome (120 nomes,
   inclusive erros como "implante de cateter de longa permanência" → "Apendicectomia"). Aqui:
   1. cirurgias.xlsx: ProcedimentoNHSN = categoria do classificador sobre o texto CRU
      (Procedimento). O que ele não decide vira "Sem classificação"; o que não é cirurgia
      (bloqueio, biópsia, drenagem, cateter…) fica com ProcedimentoNHSN vazio — a linha NÃO é
      apagada (pode ter vigilância/ISC anotada), só deixa de contar como categoria cirúrgica.
   2. config.xlsx, aba procedimentos_nhsn: reescrita com a lista canônica (código NHSN + tempo
      de corte padrão, preservando o corte que a instituição já tinha ajustado).
   3. config.xlsx, aba aliases (Campo procedimentos_nhsn): o destino (Para) passa a ser a
      categoria do classificador; não-cirurgia → marcador __NAO_CIRURGIA__; sem decisão →
      "Sem classificação". Assim um alias antigo nunca mais "repovoa" um nome aposentado.

   Roda em simulação por padrão; grava só com --aplicar (backup de cada arquivo antes).
   PASTA_CCIH escolhe a pasta de dados. */

const fs = require('fs');
const path = require('path');
const os = require('os');
const raiz = path.join(__dirname, '..');
const XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
global.XLSX = XLSX;
const { normalizarTexto } = require(path.join(raiz, 'js', 'leitura.js'));
global.normalizarTexto = normalizarTexto;
const esquemas = require(path.join(raiz, 'js', 'esquemas.js'));
global.TIPOS_RELATORIO = esquemas.TIPOS_RELATORIO;
const { ESQUEMAS, VOCABULARIO_INICIAL } = esquemas;
const imp = require(path.join(raiz, 'js', 'importacao.js'));

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');

function ler(nome) {
  const wb = XLSX.read(fs.readFileSync(path.join(PASTA, ESQUEMAS[nome].arquivo)), { type: 'buffer' });
  const banco = {};
  wb.SheetNames.forEach(aba => { banco[aba] = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '', raw: false }); });
  return banco;
}

/* Grava preservando abas e colunas extras (mesmo cuidado do limpar-setores). */
function gravar(nome, banco) {
  const esquema = ESQUEMAS[nome];
  const wb = XLSX.utils.book_new();
  const abas = [...new Set([...Object.keys(esquema.abas), ...Object.keys(banco)])];
  for (const aba of abas) {
    const linhas = banco[aba] || [];
    const doEsquema = esquema.abas[aba] || [];
    const extras = [];
    for (const linha of linhas) for (const chave of Object.keys(linha)) {
      if (!doEsquema.includes(chave) && !extras.includes(chave)) extras.push(chave);
    }
    const colunas = [...doEsquema, ...extras];
    const limpas = linhas.map(o => { const s = {}; colunas.forEach(c => { s[c] = o[c] == null ? '' : String(o[c]); }); return s; });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(limpas, { header: colunas }), aba);
  }
  const destino = path.join(PASTA, esquema.arquivo);
  const backup = path.join(PASTA, 'backups', esquema.arquivo.replace('.xlsx', '.backup-antes-reclassificar-cirurgias.xlsx'));
  fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
  if (!fs.existsSync(backup)) fs.copyFileSync(destino, backup);
  fs.writeFileSync(destino, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

console.log(`Pasta: ${PASTA}${APLICAR ? '' : '   (SIMULAÇÃO — use --aplicar para gravar)'}\n`);

/* ---- 1. cirurgias ---- */
const bancoCir = ler('cirurgias');
const cirurgias = bancoCir.cirurgias || [];
const contagem = {};
let mudadas = 0, naoCirurgicas = 0, semClassificacao = 0;
const de_para = {};
for (const c of cirurgias) {
  const r = imp.classificarProcedimentoNHSN(c.Procedimento);
  let novo;
  if (!r.cirurgia) { novo = ''; naoCirurgicas++; }
  else { novo = r.categoria; if (novo === imp.CATEGORIA_SEM_CLASSIFICACAO) semClassificacao++; }
  const atual = String(c.ProcedimentoNHSN || '').trim();
  if (atual !== novo) {
    mudadas++;
    const chave = `${atual || '(vazio)'} → ${novo || '(não cirúrgico)'}`;
    de_para[chave] = (de_para[chave] || 0) + 1;
    c.ProcedimentoNHSN = novo;
  }
  if (novo) contagem[novo] = (contagem[novo] || 0) + 1;
}
console.log(`Cirurgias: ${cirurgias.length} linhas; ${mudadas} mudam de categoria; ` +
  `${naoCirurgicas} não cirúrgicas (ficam sem categoria); ${semClassificacao} sem classificação.`);
console.log(`Categorias em uso depois: ${Object.keys(contagem).length}`);
console.log('\nMaiores mudanças (de → para: linhas):');
Object.entries(de_para).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));

/* ---- 2. vocabulário procedimentos_nhsn ---- */
const config = ler('config');
const antigos = config.procedimentos_nhsn || [];
const cortePadrao = {};
for (const p of VOCABULARIO_INICIAL.procedimentos_nhsn) cortePadrao[p.Codigo] = p.TempoCorteHoras;
const corteAjustado = {};
for (const p of antigos) {
  const h = String(p.TempoCorteHoras || '').trim();
  if (p.Codigo && h && h !== String(cortePadrao[p.Codigo] || '')) corteAjustado[p.Codigo] = h;
}
const novoVocab = imp.categoriasDeProcedimento().map(c => ({
  Nome: c.Nome, Codigo: c.Codigo,
  TempoCorteHoras: (c.Codigo && (corteAjustado[c.Codigo] || cortePadrao[c.Codigo])) || ''
}));
/* Nome que sobrou em uso no banco e não é categoria (só acontece se alguém editou à mão). */
const nomesVocab = new Set(novoVocab.map(v => normalizarTexto(v.Nome)));
for (const nome of Object.keys(contagem)) {
  if (!nomesVocab.has(normalizarTexto(nome))) { novoVocab.push({ Nome: nome, Codigo: '', TempoCorteHoras: '' }); nomesVocab.add(normalizarTexto(nome)); }
}
const aposentados = antigos.filter(p => !nomesVocab.has(normalizarTexto(p.Nome))).map(p => p.Nome);
console.log(`\nVocabulário: ${antigos.length} → ${novoVocab.length} entradas; ${aposentados.length} nomes aposentados` +
  (Object.keys(corteAjustado).length ? `; cortes ajustados pela instituição preservados: ${Object.keys(corteAjustado).join(', ')}` : ''));
if (aposentados.length) console.log('  ' + aposentados.join(' | '));

/* ---- 3. aliases ---- */
const aliases = config.aliases || [];
let aliasesMudados = 0, aliasesRemovidos = 0;
const vistos = new Set();
const novosAliases = [];
for (const a of aliases) {
  if (a.Campo !== 'procedimentos_nhsn') { novosAliases.push(a); continue; }
  const chave = normalizarTexto(a.De);
  if (!chave || vistos.has(chave)) { aliasesRemovidos++; continue; }
  vistos.add(chave);
  const r = imp.classificarProcedimentoNHSN(a.De);
  const para = !r.cirurgia ? imp.NAO_CIRURGIA : r.categoria;
  if (para !== a.Para) { aliasesMudados++; a.Para = para; }
  novosAliases.push(a);
}
console.log(`Aliases de procedimento: ${aliases.filter(a => a.Campo === 'procedimentos_nhsn').length}; ${aliasesMudados} redirecionados; ${aliasesRemovidos} repetidos/vazios removidos.`);

if (!APLICAR) { console.log('\nNada gravado (simulação).'); process.exit(0); }

bancoCir.cirurgias = cirurgias;
gravar('cirurgias', bancoCir);
config.procedimentos_nhsn = novoVocab;
config.aliases = novosAliases;
gravar('config', config);
console.log('\nGravado: cirurgias.xlsx e config.xlsx (backups em backups/).');
console.log('No aplicativo: recarregar (Ctrl+Shift+R) e reabrir a pasta antes de mexer em Configurações.');
