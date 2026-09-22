/* Limpeza do vocabulário de antibióticos (decidido com a CCIH do HNSC em 22/09/2026):
   1. tira os fragmentos de apresentação da farmácia que nunca tiveram uso ("2ML", "COMP REV",
      "SAUDE)"…) — só se tiverem ZERO registros, conferido aqui;
   2. unifica nomes de apresentação em uso no nome do fármaco (UNIFICACOES), reescrevendo em
      todos os lugares (VOCAB_APLICACAO.antibioticos) e deixando alias;
   3. apaga as prescrições irrecuperáveis (nome cortado: "CLORIDRATO DE", "FOSFATO DE") e as
      de fármacos que a CCIH decidiu NÃO acompanhar (albendazol, pirimetamina, zidovudina,
      sulfadiazina) — os nomes ganham alias para o marcador __NAO_ANTIMICROBIANO__, que a
      importação passa a descartar sozinha; aciclovir e oseltamivir ficam;
   4. sanea aliases: destino que virou outro nome segue a unificação; "AMPICILINA 2G +" é a
      primeira linha de "AMPICILINA 2G + SULBACTAM 1G FA", não ampicilina pura.

   Roda em simulação por padrão; grava só com --aplicar (backup por arquivo). PASTA_CCIH
   escolhe a pasta de dados. */

const fs = require('fs');
const path = require('path');
const os = require('os');
const raiz = path.join(__dirname, '..');
const XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
global.XLSX = XLSX;
const { normalizarTexto } = require(path.join(raiz, 'js', 'leitura.js'));
global.normalizarTexto = normalizarTexto;
const { ESQUEMAS, VOCAB_APLICACAO } = require(path.join(raiz, 'js', 'esquemas.js'));
const NAO_ANTIMICROBIANO = '__NAO_ANTIMICROBIANO__';

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');

const UNIFICACOES = {
  'Amoxicilina-Ácido Clavulânico': 'Amoxicilina-clavulanato',
  'Amoxicilina + Ácido Clavulânico': 'Amoxicilina-clavulanato',
  'Norfloxacilina': 'Norfloxacino',
  'Cefepime': 'Cefepima',
  'Polimixina': 'Polimixina B',
  'Linezolide': 'Linezolida',
  'Benzilpenicilina POTASSICA 5.000.000UI FA': 'Penicilina',
  'Cloridratro de Tetraciclina': 'Tetraciclina',
  'BACITRACINA 250UI/G + NEOMICINA 5MG/G POM 50G': 'Bacitracina + Neomicina (tópico)',
  'BACITRACINA 250UI/G + NEOMICINA 5MG/G POM': 'Bacitracina + Neomicina (tópico)',
  'BACITRACINA 250UI/G +': 'Bacitracina + Neomicina (tópico)',
  'NEOMICINA 5MG/G POM 50G': 'Bacitracina + Neomicina (tópico)',
  'MUPIROCINA 20MG/G POM 15G': 'Mupirocina (tópico)',
  'RifAM 150MG+ISON 75MG+PIRAZ 400MG+ETAMB 275MGCOMP(MIN SAUDE)': 'Rifampicina + Isoniazida + Pirazinamida + Etambutol (RHZE)',
  'RifAM 150MG+ISON 75MG+PIRAZ 400MG+ETAMB 275MGCOMP(MIN': 'Rifampicina + Isoniazida + Pirazinamida + Etambutol (RHZE)',
  'RifAM 150MG+ISON 75MG+PIRAZ 400MG+ETAMB': 'Rifampicina + Isoniazida + Pirazinamida + Etambutol (RHZE)',
  'RifAM 150MG+ISON 75MG+PIRAZ': 'Rifampicina + Isoniazida + Pirazinamida + Etambutol (RHZE)',
  'FOSFATO DE OSELTAMIVIR 30MG CAPS (MIN DA SAUDE)': 'Oseltamivir',
  'AMPICILINA 2G +': 'Ampicilina + Sulbactam'
};
/* Fármacos fora do acompanhamento da CCIH (+ apresentações deles) e nomes cortados. */
const EXCLUIR = ['Albendazol', 'Pirimetamina', 'Zidovudina', 'ZIDOVUDINA 10MG/ML XPE 240ML (MIN DA SAUDE)', 'Sulfadiazina',
  'CLORIDRATO DE', 'FOSFATO DE'];
/* Lixo esperado no vocabulário — só sai se não tiver NENHUM registro. */
const LIXO = /^(\d|FA$|COMP REV$|SOL INJ|SODICA|SAUDE\)$)/i;

const cache = {};
function ler(nome) {
  if (!cache[nome]) {
    const arquivo = path.join(PASTA, ESQUEMAS[nome].arquivo);
    if (!fs.existsSync(arquivo)) return (cache[nome] = {});
    const wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
    const banco = {};
    wb.SheetNames.forEach(aba => { banco[aba] = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '', raw: false }); });
    cache[nome] = banco;
  }
  return cache[nome];
}
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
  const backup = path.join(PASTA, 'backups', esquema.arquivo.replace('.xlsx', '.backup-antes-limpeza-antibioticos.xlsx'));
  fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
  if (!fs.existsSync(backup)) fs.copyFileSync(destino, backup);
  fs.writeFileSync(destino, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

console.log(`Pasta: ${PASTA}${APLICAR ? '' : '   (SIMULAÇÃO — use --aplicar para gravar)'}\n`);

/* ---- uso por termo ---- */
const uso = new Map();
for (const [banco, aba, campo] of VOCAB_APLICACAO.antibioticos) {
  for (const linha of (ler(banco)[aba] || [])) {
    const v = String(linha[campo] || '').trim();
    if (v) uso.set(v, (uso.get(v) || 0) + 1);
  }
}
const config = ler('config');
const vocab = (config.antibioticos || []).map(l => String(l.Nome || '').trim()).filter(Boolean);
const n = t => normalizarTexto(t);
const excluirN = new Set(EXCLUIR.map(n));

/* 1. lixo sem uso */
const lixo = vocab.filter(t => LIXO.test(t) && !(uso.get(t) > 0) && !UNIFICACOES[t]);
console.log(`1. Fragmentos sem uso a remover do vocabulário (${lixo.length}): ${lixo.join(' | ')}`);
const lixoComUso = vocab.filter(t => LIXO.test(t) && uso.get(t) > 0 && !UNIFICACOES[t] && !excluirN.has(n(t)));
if (lixoComUso.length) console.log(`   ⚠ parecem lixo mas TÊM uso (não mexo): ${lixoComUso.map(t => `${t} (${uso.get(t)})`).join(' | ')}`);

/* 2. unificações */
console.log('\n2. Unificações (de → para: registros):');
let linhasUnificadas = 0;
for (const [de, para] of Object.entries(UNIFICACOES)) {
  const q = uso.get(de) || 0;
  if (q || vocab.some(t => n(t) === n(de))) console.log(`   ${String(q).padStart(5)}  ${de} → ${para}`);
  linhasUnificadas += q;
}

/* 3. exclusões */
console.log('\n3. Prescrições/registros a apagar (fármaco fora do acompanhamento ou nome cortado):');
let linhasExcluidas = 0;
for (const t of EXCLUIR) { const q = uso.get(t) || 0; linhasExcluidas += q; console.log(`   ${String(q).padStart(5)}  ${t}`); }

/* 4. aliases */
const aliases = config.aliases || [];
let aliasesRedirecionados = 0, aliasesRemovidos = 0;
const novosAliases = [];
const vistos = new Set();
for (const a of aliases) {
  if (a.Campo !== 'antibioticos') { novosAliases.push(a); continue; }
  const chave = n(a.De);
  if (!chave || vistos.has(chave)) { aliasesRemovidos++; continue; }
  let para = a.Para;
  if (UNIFICACOES[a.De]) para = UNIFICACOES[a.De];
  else if (UNIFICACOES[para]) para = UNIFICACOES[para];
  if (excluirN.has(n(a.De)) || excluirN.has(n(para))) para = NAO_ANTIMICROBIANO;
  if (lixo.some(t => n(t) === n(para))) { aliasesRemovidos++; continue; }
  if (para !== a.Para) aliasesRedirecionados++;
  vistos.add(chave);
  novosAliases.push({ ...a, Para: para });
}
for (const [de, para] of Object.entries(UNIFICACOES)) {
  if (!vistos.has(n(de))) { vistos.add(n(de)); novosAliases.push({ Campo: 'antibioticos', De: de, Para: para }); }
}
for (const de of EXCLUIR) {
  if (!vistos.has(n(de))) { vistos.add(n(de)); novosAliases.push({ Campo: 'antibioticos', De: de, Para: NAO_ANTIMICROBIANO }); }
}
console.log(`\n4. Aliases de antibiótico: ${aliases.filter(a => a.Campo === 'antibioticos').length} → ${novosAliases.filter(a => a.Campo === 'antibioticos').length} (${aliasesRedirecionados} redirecionados, ${aliasesRemovidos} removidos).`);

/* vocabulário final */
const removerVocab = new Set([...lixo.map(n), ...Object.keys(UNIFICACOES).map(n), ...EXCLUIR.map(n)]);
const vocabFinal = vocab.filter(t => !removerVocab.has(n(t)));
for (const para of new Set(Object.values(UNIFICACOES))) {
  if (!vocabFinal.some(t => n(t) === n(para))) vocabFinal.push(para);
}
console.log(`\nVocabulário: ${vocab.length} → ${vocabFinal.length} termos.`);

if (!APLICAR) { console.log('\nNada gravado (simulação).'); process.exit(0); }

/* ---- aplicar nos dados ---- */
const tocados = new Set();
for (const [banco, aba, campo] of VOCAB_APLICACAO.antibioticos) {
  const b = ler(banco);
  if (!b[aba]) continue;
  const antes = b[aba].length;
  b[aba] = b[aba].filter(l => !excluirN.has(n(l[campo])));
  let mudou = b[aba].length !== antes;
  for (const l of b[aba]) {
    const novo = UNIFICACOES[String(l[campo] || '').trim()];
    if (novo) { l[campo] = novo; mudou = true; }
  }
  if (mudou) tocados.add(banco);
}
for (const nome of tocados) gravar(nome, ler(nome));
config.antibioticos = vocabFinal.map(Nome => ({ Nome }));
config.aliases = novosAliases;
/* A lista da rotina (antibióticos avaliados) acompanha: nome unificado segue o novo, o que
   foi removido sai — senão a marcação da tela ficaria apontando para termo que não existe. */
const canonico = new Map(vocabFinal.map(t => [n(t), t]));
const avaliados = [];
for (const l of (config.atb_avaliados || [])) {
  const bruto = UNIFICACOES[String(l.Nome || '').trim()] || String(l.Nome || '').trim();
  const nome = canonico.get(n(bruto));                    /* grafia do vocabulário ("Piperacilina tazobactam") */
  if (nome && !avaliados.some(a => n(a.Nome) === n(nome))) avaliados.push({ ...l, Nome: nome });
}
config.atb_avaliados = avaliados;
gravar('config', config);
console.log(`\nGravado: ${[...tocados].map(t => ESQUEMAS[t].arquivo).join(', ')}, config.xlsx (backups em backups/).`);
console.log('No aplicativo: recarregar (Ctrl+Shift+R), reabrir a pasta e conferir a rotina de antibióticos avaliados.');
