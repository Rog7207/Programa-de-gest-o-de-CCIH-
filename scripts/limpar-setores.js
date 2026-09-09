/* Limpeza do vocabulário de setores: tira o que nunca teve registro (números de leito,
   nome do hospital, fragmentos) e concilia os nomes que são o MESMO setor escrito de
   formas diferentes — inclusive os rótulos internos do Tasy ("H UNID 04 ... (HNSC)")
   contra os nomes limpos do aplicativo.

   Roda em simulação por padrão; grava só com --aplicar (com backup). Cada unificação
   reescreve o setor em TODOS os lugares onde ele aparece (VOCAB_APLICACAO.setores) e
   deixa um alias registrado, para a próxima importação já normalizar sozinha.

   Os quatro rótulos do Tasy que não tinham nome limpo equivalente ganharam um, definido
   por ele em 09/09/2026: Centro Obstétrico, Oncologia, Unidade de Espera Cirúrgica e
   Unidade de Espera de Leitos Clínicos. As esperas cirúrgica/obstétrica que já existiam
   (Sala de Preparo, Pós-Operatória, Centro Obstétrico) ficam como estão — já identificam
   bem o lugar. Único caso ainda sem destino: "HNSC (não especificado)", 1 registro. */

const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
global.XLSX = XLSX;
const { normalizarTexto } = require(path.join(raiz, 'js', 'leitura.js'));
global.normalizarTexto = normalizarTexto;
const { ESQUEMAS, VOCAB_APLICACAO } = require(path.join(raiz, 'js', 'esquemas.js'));

/* PASTA_CCIH permite ensaiar numa cópia antes de tocar no banco de verdade. */
const PASTA = process.env.PASTA_CCIH || '/home/rogerio/Documentos/Dados CCIH HNSC';
const APLICAR = process.argv.includes('--aplicar');

/* de → para. Só pares em que os dois lados são inequivocamente o mesmo setor. */
const UNIFICACOES = {
  'Unidade 19 - Sao Vicente de Paula -': 'Unidade 19 - Sao Vicente de Paula',
  'Unidade 08 - Santa Terezinha -': 'Unidade 08 - Santa Terezinha',
  'Recuperação Pós-Anestésica Obstétrica': 'Recuperação Pós Anestésica Obstétrica',
  'H RECUPERACAO POS ANESTESICA OBSTETRICA': 'Recuperação Pós Anestésica Obstétrica',
  'H UNID 01 ALOJ CONJUNTO (HNSC)': 'Unidade 01 - Alojamento Conjunto',
  'H UNID 04 PEDIAT. MENINO JESUS (HNSC)': 'Unidade 04 - Pediatria Menino Jesus',
  'H UNID 07 CORACAO DE JESUS (HNSC)': 'Unidade 07 - Coraçao de Jesus',
  'H UNID ESPERA CENT OBSTETRICO (HNSC)': 'Unidade de Espera Centro Obstetrico',
  'H HEMO CARDIACA DIAG E CIRURG (HNSC)': 'Hemodinâmica Cardíaca',
  'H UNID DE ESPERA DE PREPARO (HNSC)': 'Unidade de Espera Sala de Preparo',
  /* Digitado à mão no miniapp de higiene antes de existir a lista de setores; ele
     confirmou em 09/09/2026 que a UTI adulto é o próprio CTI. */
  'Uti': 'CTI - Dr. Joaquim David Ferreira Lima',
  /* Rótulos do Tasy que passam a ter nome limpo (os destinos nascem no vocabulário). */
  'H CENTRO OBSTETRICO (HNSC)': 'Centro Obstétrico',
  'H UNID 22 ONCOLOGIA (HNSC)': 'Oncologia',
  'H ESPERA DE CIRURGIA (HNSC)': 'Unidade de Espera Cirúrgica',
  'H UNIDADE DE ESPERA DE LEITO - (HNSC)': 'Unidade de Espera de Leitos Clínicos'
};

/* Entradas do vocabulário que não são setor nenhum. Só saem se não tiverem NENHUM
   registro no banco — a conferência é feita abaixo, não na confiança desta lista. */
const LIXO_ESPERADO = [/^-?\s*\d{3}-\d$/, /^HOSPITAL NOSSA SENHORA DA CONCEICAO$/i, /^Ped$/];

const cache = {};
function ler(nome) {
  if (!cache[nome]) {
    const arquivo = path.join(PASTA, ESQUEMAS[nome].arquivo);
    const wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
    const banco = {};
    wb.SheetNames.forEach(aba => {
      banco[aba] = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '', raw: false });
    });
    cache[nome] = banco;
  }
  return cache[nome];
}

/* Grava preservando ABAS e COLUNAS extras — o banco tem colunas que nasceram de
   importações e não estão no esquema; perdê-las seria estragar dado alheio. */
function gravar(nome, banco) {
  const esquema = ESQUEMAS[nome];
  const wb = XLSX.utils.book_new();
  const abas = [...new Set([...Object.keys(esquema.abas), ...Object.keys(banco)])];
  for (const aba of abas) {
    const linhas = banco[aba] || [];
    const doEsquema = esquema.abas[aba] || [];
    const extras = [];
    for (const linha of linhas) {
      for (const chave of Object.keys(linha)) {
        if (!doEsquema.includes(chave) && !extras.includes(chave)) extras.push(chave);
      }
    }
    const colunas = [...doEsquema, ...extras];
    const limpas = linhas.map(o => {
      const saida = {};
      colunas.forEach(c => { saida[c] = o[c] == null ? '' : String(o[c]); });
      return saida;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(limpas, { header: colunas }), aba);
  }
  const destino = path.join(PASTA, esquema.arquivo);
  const backup = path.join(PASTA, 'backups', esquema.arquivo.replace('.xlsx', '.backup-antes-limpeza-setores.xlsx'));
  fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
  if (!fs.existsSync(backup)) fs.copyFileSync(destino, backup);
  fs.writeFileSync(destino, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

/* ---- levantamento ---- */
const usoPorSetor = new Map();
for (const [banco, aba, campo] of VOCAB_APLICACAO.setores) {
  for (const linha of (ler(banco)[aba] || [])) {
    const valor = String(linha[campo] || '').trim();
    if (valor) usoPorSetor.set(valor, (usoPorSetor.get(valor) || 0) + 1);
  }
}
const config = ler('config');
const vocabulario = (config.setores || []).map(l => String(l.Nome || '').trim()).filter(Boolean);

console.log(`vocabulário: ${vocabulario.length} setores · em uso nos dados: ${usoPorSetor.size} valores distintos\n`);

/* ---- 1. unificações ---- */
console.log('== conciliações ==');
let linhasReescritas = 0;
const aplicadas = [];
for (const [de, para] of Object.entries(UNIFICACOES)) {
  const quantas = usoPorSetor.get(de) || 0;
  const destino = usoPorSetor.get(para) || 0;
  if (!quantas && !vocabulario.includes(de)) {
    console.log(`   (ignorado, não existe mais: "${de}")`);
    continue;
  }
  console.log(`   "${de}" (${quantas}) → "${para}" (${destino})`);
  aplicadas.push([de, para]);
  linhasReescritas += quantas;
}

/* ---- 2. entradas mortas ---- */
const alvosUnificados = new Set(aplicadas.map(([de]) => de));
const semRegistro = vocabulario.filter(s => !usoPorSetor.has(s) && !alvosUnificados.has(s));
console.log(`\n== a remover do vocabulário (zero registros): ${semRegistro.length} ==`);
for (const s of semRegistro) {
  const esperado = LIXO_ESPERADO.some(r => r.test(s));
  console.log(`   ${esperado ? '·' : '⚠'} ${JSON.stringify(s)}${esperado ? '' : '  (não parece leito/lixo — confira)'}`);
}

/* ---- 3. o que fica de fora, e por quê ---- */
console.log('\n== deixados como estão (decisão humana) ==');
for (const [setor, n] of [...usoPorSetor.entries()].sort((a, b) => b[1] - a[1])) {
  if (UNIFICACOES[setor]) continue;
  if (!/^(H |Uti$|HNSC)/.test(setor)) continue;
  console.log(`   ${String(n).padStart(5)} ${JSON.stringify(setor)}`);
}

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

/* ---- aplicação ---- */
const bancosTocados = new Set();
for (const [banco, aba, campo] of VOCAB_APLICACAO.setores) {
  const linhas = ler(banco)[aba] || [];
  let mudou = false;
  for (const linha of linhas) {
    const valor = String(linha[campo] || '').trim();
    const novo = UNIFICACOES[valor];
    if (novo && novo !== valor) { linha[campo] = novo; mudou = true; }
  }
  if (mudou) bancosTocados.add(banco);
}

/* vocabulário: tira as origens unificadas e as entradas mortas; garante os destinos */
const remover = new Set([...alvosUnificados, ...semRegistro]);
config.setores = (config.setores || []).filter(l => !remover.has(String(l.Nome || '').trim()));
for (const [, para] of aplicadas) {
  if (!config.setores.some(l => String(l.Nome || '').trim() === para)) config.setores.push({ Nome: para });
}
/* aliases: a próxima importação já normaliza sozinha */
config.aliases = config.aliases || [];
for (const [de, para] of aplicadas) {
  const existe = config.aliases.some(a => a.Campo === 'setores'
    && normalizarTexto(a.De) === normalizarTexto(de));
  if (!existe) config.aliases.push({ Campo: 'setores', De: de, Para: para });
}
bancosTocados.add('config');

for (const nome of bancosTocados) gravar(nome, ler(nome));

console.log(`\ngravado: ${linhasReescritas} linhas reescritas em ${bancosTocados.size} arquivo(s)`);
console.log(`vocabulário: ${vocabulario.length} → ${config.setores.length} setores`);
console.log(`aliases registrados: ${aplicadas.length} (importações futuras já normalizam)`);
console.log('backups em backups/*.backup-antes-limpeza-setores.xlsx');
