/* Limpeza do vocabulário de procedimentos NHSN das cirurgias.

   O problema (constatado em 09/09/2026): ao importar o relatório do centro cirúrgico, o
   assistente pergunta o que fazer com cada termo novo. Escolhendo "novo" para tudo, duas
   coisas entraram no vocabulário: (a) a MESMA categoria escrita de outro jeito
   ("Laparotomia Exploradora" × "Laparotomia exploradora" × "LAPAROTOMIA EXPLORADORA") e
   (b) o nome BRUTO do procedimento do Tasy ("Gastrectomia Total Com Linfadenectomia Por
   Videolaparoscopia") no lugar da categoria NHSN. O efeito é a estatística de ISC por
   tipo de cirurgia partida em várias linhas.

   Este script trata só o que é inequívoco: variações de caixa/acento e erros de digitação
   evidentes. O mapeamento dos nomes brutos para a categoria certa é decisão clínica —
   sai listado ao final, para a CCIH definir. Não há cirurgias duplicadas de verdade
   (nenhum grupo com mesmo paciente + data + procedimento).

   Simulação por padrão; --aplicar grava com backup. PASTA_CCIH ensaia numa cópia. */

const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
global.XLSX = XLSX;
const { normalizarTexto } = require(path.join(raiz, 'js', 'leitura.js'));
global.normalizarTexto = normalizarTexto;
const { ESQUEMAS } = require(path.join(raiz, 'js', 'esquemas.js'));

const PASTA = process.env.PASTA_CCIH || '/home/rogerio/Documentos/Dados CCIH HNSC';
const APLICAR = process.argv.includes('--aplicar');

/* Erros de digitação e plurais — os dois lados são a mesma categoria, sem dúvida.
   As variações de caixa/acento não precisam entrar aqui: são detectadas sozinhas. */
const CORRECOES = {
  'Bipopsia': 'Biópsia',
  'Biópsias': 'Biópsia',
  'Outrfas cirurgias ginecológicas': 'Outras cirurgias ginecológicas',
  'Cirurgia otorrinolangológica': 'Cirurgia otorrinolaringológica',
  'Cirurgias otorrinolaringológicas': 'Cirurgia otorrinolaringológica',
  'Videoartroscopia': 'Artroscopia',
  'Drenagem torácica': 'Drenagem de tórax'
};

/* Entre grafias equivalentes, qual sobrevive: a mais usada; empate desempata pela que
   tem acentuação correta e caixa de frase (não TODA MAIÚSCULA nem Todas Iniciais). */
function melhorGrafia(variantes, contagem) {
  const nota = s => {
    let n = 0;
    if (s === s.toUpperCase() && s.length > 4) n -= 3;          /* TUDO MAIÚSCULO */
    const palavras = s.split(/\s+/).filter(p => p.length > 3);
    const iniciais = palavras.filter(p => p[0] === p[0].toUpperCase()).length;
    if (palavras.length > 1 && iniciais === palavras.length) n -= 2; /* Toda Palavra Maiúscula */
    if (/[áàâãéêíóôõúç]/i.test(s)) n += 1;                       /* acentuação presente */
    return n;
  };
  return variantes.slice().sort((a, b) =>
    (contagem.get(b) - contagem.get(a)) || (nota(b) - nota(a)) || a.localeCompare(b, 'pt-BR'))[0];
}

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

/* Preserva abas e colunas extras — o banco tem colunas nascidas de importações. */
function gravar(nome, banco) {
  const esquema = ESQUEMAS[nome];
  const wb = XLSX.utils.book_new();
  for (const aba of [...new Set([...Object.keys(esquema.abas), ...Object.keys(banco)])]) {
    const linhas = banco[aba] || [];
    const doEsquema = esquema.abas[aba] || [];
    const extras = [];
    linhas.forEach(l => Object.keys(l).forEach(k => {
      if (!doEsquema.includes(k) && !extras.includes(k)) extras.push(k);
    }));
    const colunas = [...doEsquema, ...extras];
    const limpas = linhas.map(o => {
      const saida = {};
      colunas.forEach(c => { saida[c] = o[c] == null ? '' : String(o[c]); });
      return saida;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(limpas, { header: colunas }), aba);
  }
  const destino = path.join(PASTA, esquema.arquivo);
  const backup = path.join(PASTA, 'backups', esquema.arquivo.replace('.xlsx', '.backup-antes-limpeza-procedimentos.xlsx'));
  fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
  if (!fs.existsSync(backup)) fs.copyFileSync(destino, backup);
  fs.writeFileSync(destino, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

/* ---- levantamento ---- */
const cirurgias = ler('cirurgias').cirurgias || [];
const config = ler('config');
const contagem = new Map();
cirurgias.forEach(c => {
  const t = String(c.ProcedimentoNHSN || '').trim();
  if (t) contagem.set(t, (contagem.get(t) || 0) + 1);
});
const vocabulario = (config.procedimentos_nhsn || []).map(l => String(l.Nome || '').trim()).filter(Boolean);
console.log(`vocabulário: ${vocabulario.length} procedimentos · em uso: ${contagem.size} · cirurgias: ${cirurgias.length}\n`);

/* 1. variações de caixa/acento: agrupa pelo normalizado */
const porNormalizado = new Map();
for (const termo of new Set([...contagem.keys(), ...vocabulario])) {
  const chave = normalizarTexto(termo);
  if (!porNormalizado.has(chave)) porNormalizado.set(chave, []);
  porNormalizado.get(chave).push(termo);
}
const unificacoes = {};
for (const variantes of porNormalizado.values()) {
  if (variantes.length < 2) continue;
  const vencedora = melhorGrafia(variantes, new Map(variantes.map(v => [v, contagem.get(v) || 0])));
  variantes.filter(v => v !== vencedora).forEach(v => { unificacoes[v] = vencedora; });
}
/* 2. erros de digitação declarados */
for (const [de, para] of Object.entries(CORRECOES)) {
  if (contagem.has(de) || vocabulario.includes(de)) unificacoes[de] = para;
}

console.log('== conciliações (caixa/acento + erros de digitação) ==');
const pares = Object.entries(unificacoes).sort((a, b) => (contagem.get(b[0]) || 0) - (contagem.get(a[0]) || 0));
let linhasReescritas = 0;
for (const [de, para] of pares) {
  const n = contagem.get(de) || 0;
  linhasReescritas += n;
  console.log(`   "${de}" (${n}) → "${para}" (${contagem.get(para) || 0})`);
}

const semUso = vocabulario.filter(v => !contagem.has(v) && !unificacoes[v]);
console.log(`\n== no vocabulário sem nenhuma cirurgia: ${semUso.length} ==`);
semUso.forEach(s => console.log('   ·', JSON.stringify(s)));

/* 3. nomes brutos do Tasy — decisão clínica, só listados */
const TITULO_BRUTO = s => {
  const palavras = s.split(/\s+/).filter(p => p.length > 3);
  const iniciais = palavras.filter(p => p[0] === p[0].toUpperCase()).length;
  return (palavras.length >= 3 && iniciais === palavras.length) || (s === s.toUpperCase() && s.length > 8);
};
const brutos = [...contagem.entries()]
  .filter(([s]) => !unificacoes[s] && TITULO_BRUTO(s))
  .sort((a, b) => b[1] - a[1]);
console.log(`\n== nomes brutos do Tasy usados como categoria (DECISÃO CLÍNICA — não tocados): ${brutos.length} ==`);
brutos.forEach(([s, n]) => console.log(`   ${String(n).padStart(4)} ${s}`));
console.log(`   → ${brutos.reduce((s, x) => s + x[1], 0)} cirurgias esperando destino`);

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

/* ---- aplicação ---- */
let mudou = 0;
for (const c of cirurgias) {
  const valor = String(c.ProcedimentoNHSN || '').trim();
  const novo = unificacoes[valor];
  if (novo && novo !== valor) { c.ProcedimentoNHSN = novo; mudou++; }
}
const remover = new Set([...Object.keys(unificacoes), ...semUso]);
config.procedimentos_nhsn = (config.procedimentos_nhsn || [])
  .filter(l => !remover.has(String(l.Nome || '').trim()));
for (const para of new Set(Object.values(unificacoes))) {
  if (!config.procedimentos_nhsn.some(l => String(l.Nome || '').trim() === para)) {
    config.procedimentos_nhsn.push({ Nome: para, Codigo: '', TempoCorteHoras: '' });
  }
}
config.aliases = config.aliases || [];
for (const [de, para] of Object.entries(unificacoes)) {
  const existe = config.aliases.some(a => a.Campo === 'procedimentos_nhsn'
    && normalizarTexto(a.De) === normalizarTexto(de));
  if (!existe) config.aliases.push({ Campo: 'procedimentos_nhsn', De: de, Para: para });
}
gravar('cirurgias', ler('cirurgias'));
gravar('config', config);
console.log(`\ngravado: ${mudou} cirurgias reescritas`);
console.log(`vocabulário: ${vocabulario.length} → ${config.procedimentos_nhsn.length} procedimentos`);
console.log(`aliases registrados: ${Object.keys(unificacoes).length}`);
console.log('backups em backups/*.backup-antes-limpeza-procedimentos.xlsx');
