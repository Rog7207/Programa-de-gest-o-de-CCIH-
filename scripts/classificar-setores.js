/* Classifica cada setor do HNSC por TIPO e grava numa aba própria do config.xlsx
   (`setores_tipo`: colunas Setor, Tipo). O app preserva abas que não conhece, então a
   classificação sobrevive aos saves até a tela de tipos existir. É a base para: excluir da
   vigilância os tipos que não internam, e exigir tipo + validação de gestor em setor novo.

   Tipos (taxonomia definida por ele em 21/09/2026):
   - Internação          leitos assistenciais
   - Porta de entrada     emergência/PA/sala vermelha e esperas de PA/emergência — ficam
                          FORA da investigação de surtos (culturas de quem não internou
                          caem aqui e o volume viraria pseudo-surto)
   - Espera/recuperação   esperas de pacientes que vão internar (obstétrica, preparo, pós-op…)
   - Cirúrgico/obstétrico centros cirúrgico e obstétrico
   - Ambulatório          atendimento sem internação (atende paciente/funcionário)
   - Apoio                diagnóstico ou preparo de materiais/exames (lab, hemoterapia…)
   - Administrativo       não atende paciente (faturamento, direção…)
   - Não especificado     genérico

   Roda em simulação; grava só com --aplicar (backup antes). Classifica os nomes LIMPOS
   (rode antes o limpar-setores.js: CIT→CTI, Hemodinâmica HNSC→Hemodinâmica Cardíaca etc.). */

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

/* setor → tipo. Nomes já na forma limpa (pós limpar-setores.js). */
const TIPOS = {
  'CTI - Dr. Joaquim David Ferreira Lima': 'Internação',
  'UTI Neonatal / Pediátrica': 'Internação',
  'Unidade 01 - Alojamento Conjunto': 'Internação',
  'Unidade 04 - Pediatria Menino Jesus': 'Internação',
  'Unidade 05 - Dr Otto': 'Internação',
  'Unidade 06 - Irma Zita': 'Internação',
  'Unidade 07 - Coraçao de Jesus': 'Internação',
  'Unidade 08 - Santa Terezinha': 'Internação',
  'Unidade 09 - Sao Francisco': 'Internação',
  'Unidade 11 - Sao Camilo': 'Internação',
  'Unidade 12 - Sao Lucas': 'Internação',
  'Unidade 19 - Sao Vicente de Paula': 'Internação',
  'Unidade 21 - Provida': 'Internação',
  'Alta Complexidade - 01': 'Internação',
  'Berçário RN': 'Internação',

  'Emergência': 'Porta de entrada',
  'Pronto Atendimento': 'Porta de entrada',
  'Unidade de Espera - Sala Vermelha': 'Porta de entrada',
  'Unidade de Espera de Leitos - Pronto Atendimento': 'Porta de entrada',
  'Unidade de Espera de Leitos - Emergência': 'Porta de entrada',
  'Unidade de Espera de Leitos - Emergência Pediátrica': 'Porta de entrada',

  'Unidade de Espera Centro Obstetrico': 'Espera/recuperação',
  'Unidade de Espera Sala de Preparo': 'Espera/recuperação',
  'Unidade de Espera Pos Operatoria': 'Espera/recuperação',
  'Unidade de Espera de Leitos Clínicos': 'Espera/recuperação',
  'Unidade de Espera Cirúrgica': 'Espera/recuperação',
  'Unidade de Espera Neonatal / Pediatrica': 'Espera/recuperação',
  'Recuperação Pós Anestésica Obstétrica': 'Espera/recuperação',

  'Centro Cirúrgico': 'Cirúrgico/obstétrico',
  'Centro Obstétrico': 'Cirúrgico/obstétrico',

  'Oncologia': 'Ambulatório',
  'Ambulatório 01 - Ambulatório SUS': 'Ambulatório',
  'Medicina do Trabalho': 'Ambulatório',

  'Laboratório de Analises Clinicas': 'Apoio',
  'Agencia Transfusional': 'Apoio',
  'Banco de Leite': 'Apoio',
  'Hemodinâmica Cardíaca': 'Apoio',
  'Eletrocardiograma HNSC': 'Apoio',
  'Serviço Terceirizado': 'Apoio',

  'Estorno de Alta Faturamento': 'Administrativo',

  'HNSC (não especificado)': 'Não especificado'
};

const cache = {};
function ler(nome) {
  if (!cache[nome]) {
    const wb = XLSX.read(fs.readFileSync(path.join(PASTA, ESQUEMAS[nome].arquivo)), { type: 'buffer' });
    const banco = {};
    wb.SheetNames.forEach(aba => { banco[aba] = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '', raw: false }); });
    cache[nome] = { wb, banco };
  }
  return cache[nome];
}

/* Setores realmente em uso nos dados (para conferir cobertura da classificação). */
const emUso = new Map();
for (const [banco, aba, campo] of VOCAB_APLICACAO.setores) {
  for (const linha of (ler(banco).banco[aba] || [])) {
    const v = String(linha[campo] || '').trim();
    if (v) emUso.set(v, (emUso.get(v) || 0) + 1);
  }
}

/* Fusões pendentes (limpar-setores.js): não precisam de tipo, viram outro setor. */
const FUNDIDOS = new Set(['CIT', 'Hemodinâmica HNSC', 'H CENTRO OBSTETRICO (HNSC)',
  'H UNID 04 PEDIAT. MENINO JESUS (HNSC)']);

const porTipo = new Map();
for (const [setor, tipo] of Object.entries(TIPOS)) {
  if (!porTipo.has(tipo)) porTipo.set(tipo, []);
  porTipo.get(tipo).push(setor);
}
console.log('== classificação por tipo ==');
for (const [tipo, setores] of porTipo) {
  console.log(`\n${tipo} (${setores.length}):`);
  setores.forEach(s => console.log(`   · ${s}  (${emUso.get(s) || 0})`));
}

/* Cobertura: todo setor em uso (fora os que serão fundidos) precisa de um tipo. */
const semTipo = [...emUso.keys()].filter(s => !TIPOS[s] && !FUNDIDOS.has(s));
if (semTipo.length) {
  console.log(`\n⚠ setores em uso SEM tipo (${semTipo.length}) — reveja antes de gravar:`);
  semTipo.forEach(s => console.log(`   ${String(emUso.get(s)).padStart(6)}  ${JSON.stringify(s)}`));
} else {
  console.log('\n✓ todo setor em uso tem um tipo (ou será fundido pelo limpar-setores.js).');
}

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar a aba setores_tipo.)');
  process.exit(semTipo.length ? 1 : 0);
}
if (semTipo.length) {
  console.log('\nAbortado: há setor em uso sem tipo. Classifique-os antes de gravar.');
  process.exit(1);
}

/* Grava a aba setores_tipo preservando as demais abas e colunas do config.xlsx. */
const { wb, banco } = ler('config');
const linhasTipo = Object.entries(TIPOS).map(([Setor, Tipo]) => ({ Setor, Tipo }));
const abaNova = XLSX.utils.json_to_sheet(linhasTipo, { header: ['Setor', 'Tipo'] });
if (!wb.SheetNames.includes('setores_tipo')) {
  XLSX.utils.book_append_sheet(wb, abaNova, 'setores_tipo');
} else {
  wb.Sheets['setores_tipo'] = abaNova;
}
const destino = path.join(PASTA, ESQUEMAS.config.arquivo);
fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const backup = path.join(PASTA, 'backups', 'config.backup-antes-tipos-setor.xlsx');
if (!fs.existsSync(backup)) fs.copyFileSync(destino, backup);
fs.writeFileSync(destino, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log(`\ngravado: aba setores_tipo com ${linhasTipo.length} setores em ${ESQUEMAS.config.arquivo}`);
console.log('backup em backups/config.backup-antes-tipos-setor.xlsx');
void banco;
