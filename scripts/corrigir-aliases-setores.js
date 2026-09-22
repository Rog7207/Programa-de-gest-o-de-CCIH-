/* Saneia os ALIASES de setor do config.xlsx — o mecanismo que normaliza nomes na importação.
   Depois de limpar vocabulário e dados, o lixo voltava a cada importação porque havia aliases
   venenosos (achados em 22/09/2026 na pasta operacional):
   - alias cujo DESTINO (Para) é um rótulo cru do Tasy ("Centro Obstetrico CC" →
     "H CENTRO OBSTETRICO (HNSC)"): reaponta para o nome limpo;
   - alias de LEITO para LEITO ("- 246-1" → "- 244-1"): número de leito não é setor — apaga;
   - alias cujo destino não existe no vocabulário limpo: reporta para decisão humana.
   Roda em simulação; grava só com --aplicar (backup antes). PASTA_CCIH escolhe a pasta. */

const fs = require('fs');
const path = require('path');
const os = require('os');
const raiz = path.join(__dirname, '..');
const XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
global.XLSX = XLSX;
const { normalizarTexto } = require(path.join(raiz, 'js', 'leitura.js'));
global.normalizarTexto = normalizarTexto;
const { ESQUEMAS } = require(path.join(raiz, 'js', 'esquemas.js'));

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');

/* Rótulos crus do Tasy que já têm nome limpo (mesmo de-para do limpar-setores.js). */
const NOME_LIMPO = {
  'H CENTRO OBSTETRICO (HNSC)': 'Centro Obstétrico',
  'H UNID 01 ALOJ CONJUNTO (HNSC)': 'Unidade 01 - Alojamento Conjunto',
  'H UNID 04 PEDIAT. MENINO JESUS (HNSC)': 'Unidade 04 - Pediatria Menino Jesus',
  'H UNID 07 CORACAO DE JESUS (HNSC)': 'Unidade 07 - Coraçao de Jesus',
  'H UNID ESPERA CENT OBSTETRICO (HNSC)': 'Unidade de Espera Centro Obstetrico',
  'H HEMO CARDIACA DIAG E CIRURG (HNSC)': 'Hemodinâmica Cardíaca',
  'H UNID DE ESPERA DE PREPARO (HNSC)': 'Unidade de Espera Sala de Preparo',
  'H UNID 22 ONCOLOGIA (HNSC)': 'Oncologia',
  'H ESPERA DE CIRURGIA (HNSC)': 'Unidade de Espera Cirúrgica',
  'H UNIDADE DE ESPERA DE LEITO - (HNSC)': 'Unidade de Espera de Leitos - Emergência',
  'H RECUPERACAO POS ANESTESICA OBSTETRICA': 'Recuperação Pós Anestésica Obstétrica'
};
/* Nomes limpos que foram APOSENTADOS por fusão posterior (limpar-setores.js): um alias que
   ainda aponte para eles recriaria o setor extinto na próxima importação. */
const NOME_APOSENTADO = {
  'Unidade de Espera de Leitos Clínicos': 'Unidade de Espera de Leitos - Emergência'
};
const EH_LEITO = /^-?\s*\d{2,3}-\d+$/;
const EH_CRU = /\(hnsc\)|^h unid|^h centro|^h espera|^h hemo|^h recuper|^h unidade/i;

const arquivo = path.join(PASTA, ESQUEMAS.config.arquivo);
const wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
const banco = {};
wb.SheetNames.forEach(aba => { banco[aba] = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '', raw: false }); });
const vocab = new Set((banco.setores || []).map(l => String(l.Nome || '').trim()).filter(Boolean));
const aliases = banco.aliases || [];

let reapontados = 0, apagados = 0;
const pendentes = [];
const saida = [];
for (const a of aliases) {
  if (a.Campo !== 'setores') { saida.push(a); continue; }
  const de = String(a.De || '').trim(), para = String(a.Para || '').trim();
  if (EH_LEITO.test(de) || EH_LEITO.test(para)) {
    console.log(`   apagar (leito):      "${de}" → "${para}"`);
    apagados++; continue;
  }
  if (EH_CRU.test(para) && NOME_LIMPO[para]) {
    console.log(`   reapontar (cru→limpo): "${de}" → "${para}"  ⇒  "${NOME_LIMPO[para]}"`);
    saida.push({ ...a, Para: NOME_LIMPO[para] }); reapontados++; continue;
  }
  if (NOME_APOSENTADO[para]) {
    console.log(`   reapontar (aposentado): "${de}" → "${para}"  ⇒  "${NOME_APOSENTADO[para]}"`);
    saida.push({ ...a, Para: NOME_APOSENTADO[para] }); reapontados++; continue;
  }
  if (!vocab.has(para)) pendentes.push([de, para]);
  saida.push(a);
}
console.log(`\npasta: ${PASTA}`);
console.log(`aliases de setor: ${aliases.filter(a => a.Campo === 'setores').length} · reapontados: ${reapontados} · apagados: ${apagados}`);
if (pendentes.length) {
  console.log(`\n⚠ destino fora do vocabulário limpo (decisão humana, NÃO alterados): ${pendentes.length}`);
  pendentes.forEach(([de, para]) => console.log(`   "${de}" → "${para}"`));
}
if (!APLICAR) { console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)'); process.exit(0); }
if (!reapontados && !apagados) { console.log('\nnada a gravar.'); process.exit(0); }

/* Grava preservando abas e colunas extras. */
banco.aliases = saida;
const out = XLSX.utils.book_new();
const abas = [...new Set([...Object.keys(ESQUEMAS.config.abas), ...Object.keys(banco)])];
for (const aba of abas) {
  const linhas = banco[aba] || [];
  const doEsquema = ESQUEMAS.config.abas[aba] || [];
  const extras = [];
  for (const l of linhas) for (const k of Object.keys(l)) if (!doEsquema.includes(k) && !extras.includes(k)) extras.push(k);
  const colunas = [...doEsquema, ...extras];
  const limpas = linhas.map(o => { const s = {}; colunas.forEach(k => { s[k] = o[k] == null ? '' : String(o[k]); }); return s; });
  XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(limpas, { header: colunas }), aba);
}
fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const backup = path.join(PASTA, 'backups', 'config.backup-antes-aliases-setores.xlsx');
if (!fs.existsSync(backup)) fs.copyFileSync(arquivo, backup);
fs.writeFileSync(arquivo, XLSX.write(out, { type: 'buffer', bookType: 'xlsx' }));
console.log(`\ngravado: ${reapontados} reapontado(s), ${apagados} apagado(s). backup em backups/config.backup-antes-aliases-setores.xlsx`);
