/* Normalização do vocabulário de microrganismos: unifica as variantes de grafia do MESMO
   organismo — sobretudo "Gênero", "Gênero spp." e "Gênero spp", que viram um só "Gênero spp"
   (decidido em 21/09/2026). Espelha o limpar-setores.js: reescreve o nome em todos os lugares
   (VOCAB_APLICACAO.microrganismos), registra alias para a próxima importação já normalizar, e
   faz backup. Roda em simulação; grava só com --aplicar.

   NÃO mexe em identificações parciais (Coco Gram positivo, BGN-NF, Levedura) nem nos nomes
   de resultado (Negativo, Ausência de coliformes…): esses seguem regra de episódio (preliminar
   seguido de cultura válida = descarta; swab de vigilância MDR = colonização que conta para
   isolamento) e serão tratados na triagem, não aqui. */

const fs = require('fs');
const path = require('path');
const os = require('os');
const raiz = path.join(__dirname, '..');
const XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
global.XLSX = XLSX;
const { normalizarTexto } = require(path.join(raiz, 'js', 'leitura.js'));
global.normalizarTexto = normalizarTexto;
const { ESQUEMAS, VOCAB_APLICACAO } = require(path.join(raiz, 'js', 'esquemas.js'));

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');

/* de → para. Só variantes inequívocas do MESMO organismo (gênero puro / spp. → spp). */
const UNIFICACOES = {
  'Enterobacter': 'Enterobacter spp',
  'Enterobacter spp.': 'Enterobacter spp',
  'Enterococcus spp.': 'Enterococcus spp',
  'Candida spp.': 'Candida spp',
  'Proteus': 'Proteus spp',
  'Proteus spp.': 'Proteus spp',
  'Pseudomonas': 'Pseudomonas spp',
  'Acinetobacter': 'Acinetobacter spp',
  'Streptococcus': 'Streptococcus spp',
  'Chryseobacterium': 'Chryseobacterium spp'
};

const cache = {};
function ler(nome) {
  if (!cache[nome]) {
    const wb = XLSX.read(fs.readFileSync(path.join(PASTA, ESQUEMAS[nome].arquivo)), { type: 'buffer' });
    const banco = {};
    wb.SheetNames.forEach(aba => { banco[aba] = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '', raw: false }); });
    cache[nome] = banco;
  }
  return cache[nome];
}

/* Grava preservando abas e colunas extras (idem limpar-setores.js). */
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
  fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
  const backup = path.join(PASTA, 'backups', esquema.arquivo.replace('.xlsx', '.backup-antes-limpeza-microrganismos.xlsx'));
  if (!fs.existsSync(backup)) fs.copyFileSync(destino, backup);
  fs.writeFileSync(destino, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

/* ---- levantamento ---- */
const uso = new Map();
for (const [banco, aba, campo] of VOCAB_APLICACAO.microrganismos) {
  for (const linha of (ler(banco)[aba] || [])) {
    const v = String(linha[campo] || '').trim();
    if (v) uso.set(v, (uso.get(v) || 0) + 1);
  }
}
const config = ler('config');
const vocab = (config.microrganismos || []).map(l => String(l.Nome || '').trim()).filter(Boolean);
console.log(`vocabulário: ${vocab.length} · em uso: ${uso.size} nomes distintos\n== unificações spp ==`);

let reescritas = 0;
const aplicadas = [];
for (const [de, para] of Object.entries(UNIFICACOES)) {
  const q = uso.get(de) || 0;
  if (!q && !vocab.includes(de)) { console.log(`   (ignorado, não existe: "${de}")`); continue; }
  console.log(`   "${de}" (${q}) → "${para}" (${uso.get(para) || 0})`);
  aplicadas.push([de, para]);
  reescritas += q;
}

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

const bancosTocados = new Set();
for (const [banco, aba, campo] of VOCAB_APLICACAO.microrganismos) {
  let mudou = false;
  for (const linha of (ler(banco)[aba] || [])) {
    const novo = UNIFICACOES[String(linha[campo] || '').trim()];
    if (novo && novo !== linha[campo]) { linha[campo] = novo; mudou = true; }
  }
  if (mudou) bancosTocados.add(banco);
}
const remover = new Set(aplicadas.map(([de]) => de));
config.microrganismos = (config.microrganismos || []).filter(l => !remover.has(String(l.Nome || '').trim()));
for (const [, para] of aplicadas) {
  if (!config.microrganismos.some(l => String(l.Nome || '').trim() === para)) config.microrganismos.push({ Nome: para });
}
config.aliases = config.aliases || [];
for (const [de, para] of aplicadas) {
  if (!config.aliases.some(a => a.Campo === 'microrganismos' && normalizarTexto(a.De) === normalizarTexto(de))) {
    config.aliases.push({ Campo: 'microrganismos', De: de, Para: para });
  }
}
bancosTocados.add('config');
for (const nome of bancosTocados) gravar(nome, ler(nome));

console.log(`\ngravado: ${reescritas} linhas reescritas em ${bancosTocados.size} arquivo(s)`);
console.log(`vocabulário: ${vocab.length} → ${config.microrganismos.length}`);
console.log(`aliases: ${aplicadas.length} · backups em backups/*.backup-antes-limpeza-microrganismos.xlsx`);
