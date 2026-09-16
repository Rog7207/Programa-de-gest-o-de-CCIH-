/* Preenche ProfilaxiaAntibiotico nas cirurgias do banco a partir do relatório do Tasy
   "antibióticos por cirurgia" (baixas de material do centro cirúrgico).

   Ligação: Nº do atendimento (igual nos dois lados) + proximidade de data — baixa entre
   D-1 e D+1 da cirurgia é a profilaxia; baixas da MESMA janela em dias seguintes (D+2 a
   D+7) viram o sufixo "baixas até D+N", o sinal de profilaxia prolongada. O relatório só
   traz o DIA da baixa (sem hora), então a janela de 60 minutos pré-incisão
   (IntervaloProfilaxia) fica de fora — precisa do relatório com hora da administração.

   Só preenche cirurgia com o campo VAZIO (nunca sobrescreve registro manual).
   Uso: node scripts/preencher-profilaxia-cirurgias.js "<arquivo do Tasy>" [--aplicar]
   Simulação por padrão; --aplicar grava com backup. PASTA_CCIH aponta para outra pasta. */

const fs = require('fs');
const path = require('path');
const os = require('os');

global.XLSX = require(path.join(__dirname, '..', 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(__dirname, '..', 'js', 'esquemas.js'));
const leitura = require(path.join(__dirname, '..', 'js', 'leitura.js'));
global.normalizarTexto = leitura.normalizarTexto;
global.CLASSES_TRIAGEM = esquemas.CLASSES_TRIAGEM;
const imp = require(path.join(__dirname, '..', 'js', 'importacao.js'));

const _dif = (d0, d1) => {
  const a = Date.parse(String(d0).slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(String(d1).slice(0, 10) + 'T00:00:00Z');
  return (isFinite(a) && isFinite(b)) ? Math.round((b - a) / 864e5) : null;
};

/* Decide a profilaxia de UMA cirurgia a partir das baixas do atendimento dela.
   Devolve { drogas, texto } ou null quando nenhuma baixa cai na janela D-1..D+1.
   Pura, testável. */
function profilaxiaDaCirurgia(dataCirurgia, baixas) {
  if (!/^\d{4}-/.test(String(dataCirurgia))) return null;
  const noDia = [], diasDepois = [];
  for (const b of (baixas || [])) {
    const d = _dif(dataCirurgia, b.Data);
    if (d === null) continue;
    if (d >= -1 && d <= 1) noDia.push(b);
    else if (d >= 2 && d <= 7) diasDepois.push(d);
  }
  if (!noDia.length) return null;
  const drogas = [...new Set(noDia.map(b => String(b.Droga).trim()).filter(Boolean))];
  const ate = diasDepois.length ? Math.max(...diasDepois) : 0;
  return { drogas, texto: drogas.join(' + ') + (ate ? ` — baixas até D+${ate}` : '') };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { profilaxiaDaCirurgia };
}
if (require.main === module) main();

function main() {

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const arquivoTasy = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!arquivoTasy || !fs.existsSync(arquivoTasy)) {
  console.log('uso: node scripts/preencher-profilaxia-cirurgias.js "<arquivo do Tasy>" [--aplicar]');
  process.exit(1);
}
const ESQUEMAS = esquemas.ESQUEMAS;
const N = imp.normalizarProntuario;
const dataDe = v => {
  const n = Number(v);
  if (isFinite(n) && n > 40000 && n < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + n * 864e5).toISOString().slice(0, 10);
  }
  const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};

const wbT = XLSX.read(fs.readFileSync(arquivoTasy), { type: 'buffer' });
const linhas = XLSX.utils.sheet_to_json(wbT.Sheets[wbT.SheetNames[0]], { defval: '' });
const porAtendimento = new Map();
for (const l of linhas) {
  const a = N(l['Nr atendimento']);
  const data = dataDe(l['Dt baixa']);
  const droga = String(l['Ds medicamento'] || '').trim();
  if (!a || !data || !droga) continue;
  if (!porAtendimento.has(a)) porAtendimento.set(a, []);
  porAtendimento.get(a).push({ Droga: droga, Data: data });
}
console.log(`arquivo: ${path.basename(arquivoTasy)} — ${linhas.length} baixas, ${porAtendimento.size} atendimentos`);

const arquivoCir = path.join(PASTA, ESQUEMAS.cirurgias.arquivo);
const wbC = XLSX.read(fs.readFileSync(arquivoCir), { type: 'buffer' });
const bancoCir = {};
wbC.SheetNames.forEach(n => { bancoCir[n] = XLSX.utils.sheet_to_json(wbC.Sheets[n], { defval: '' }); });
const cirurgias = bancoCir.cirurgias || [];
console.log(`pasta: ${PASTA} — ${cirurgias.length} cirurgias no banco\n`);

let preenchidas = 0, jaTinham = 0, semBaixa = 0, semAtendimento = 0, prolongadas = 0;
const porDroga = {};
for (const c of cirurgias) {
  const a = N(c.Atendimento);
  if (!a) { semAtendimento++; continue; }
  if (String(c.ProfilaxiaAntibiotico || '').trim()) { jaTinham++; continue; }
  const prof = profilaxiaDaCirurgia(String(c.DataCirurgia).slice(0, 10), porAtendimento.get(a));
  if (!prof) { semBaixa++; continue; }
  c.ProfilaxiaAntibiotico = prof.texto;
  preenchidas++;
  if (prof.texto.includes('D+')) prolongadas++;
  prof.drogas.forEach(d => { porDroga[d] = (porDroga[d] || 0) + 1; });
}
console.log(`profilaxia preenchida: ${preenchidas} cirurgias (${prolongadas} com baixas além de D+1)`);
console.log(`já tinham o campo: ${jaTinham} · sem baixa casável: ${semBaixa} · sem atendimento: ${semAtendimento}`);
console.log('drogas mais usadas: ' + Object.entries(porDroga).sort((x, y) => y[1] - x[1]).slice(0, 8)
  .map(([k, v]) => `${k}=${v}`).join(', '));

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const backup = path.join(PASTA, 'backups', 'cirurgias.backup-antes-profilaxia.xlsx');
if (!fs.existsSync(backup)) fs.copyFileSync(arquivoCir, backup);

const wb = XLSX.utils.book_new();
for (const [aba, colunas] of Object.entries(ESQUEMAS.cirurgias.abas)) {
  const abaLinhas = (bancoCir[aba] || []).map(o => {
    const limpo = {};
    colunas.forEach(col => { limpo[col] = o[col] === undefined ? '' : o[col]; });
    return limpo;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(abaLinhas, { header: colunas }), aba);
}
fs.writeFileSync(arquivoCir, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log(`\ngravado. Backup em ${backup}`);

}
