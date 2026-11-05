/* Completa o telefone (e caráter) das cirurgias já gravadas a partir dos relatórios do centro
   cirúrgico guardados em importados/ — a reimportação não atualizava a linha existente, e o
   arquivo de setembro/2026 chegou com a coluna de telefone vazia (05/11/2026). Casa por
   atendimento + data da cirurgia; só preenche campo VAZIO.

   Uso:  PASTA_CCIH="/caminho/Dados CCIH" node scripts/preencher-telefones-cirurgias.js            (simulação)
         PASTA_CCIH="/caminho/Dados CCIH" node scripts/preencher-telefones-cirurgias.js --aplicar  (grava, com backup) */

const fs = require('fs');
const path = require('path');
const os = require('os');
const raiz = path.join(__dirname, '..');
global.XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(raiz, 'js', 'esquemas.js'));

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const arquivo = path.join(PASTA, 'cirurgias.xlsx');
if (!fs.existsSync(arquivo)) { console.error('cirurgias.xlsx não encontrado em ' + PASTA); process.exit(2); }

const wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
const banco = {};
wb.SheetNames.forEach(n => { banco[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }); });
const porChave = new Map();
for (const c of banco.cirurgias) {
  const k = String(c.Atendimento || '').trim() + '|' + String(c.DataCirurgia || '').slice(0, 10);
  if (!porChave.has(k)) porChave.set(k, []);
  porChave.get(k).push(c);
}
const toISO = v => {
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : ''; }
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v)); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(v).slice(0, 10);
};
const n = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

const pastaImp = path.join(PASTA, 'importados');
const arquivos = [];
if (fs.existsSync(pastaImp)) for (const sub of fs.readdirSync(pastaImp)) {
  const dir = path.join(pastaImp, sub);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) if (/cirur|cesar|\bcc\b/i.test(f) && /\.xlsx?$/i.test(f)) arquivos.push(path.join(dir, f));
}
console.log(`cirurgias no banco: ${banco.cirurgias.length} | sem telefone: ${banco.cirurgias.filter(c => !String(c.Telefone).trim()).length} | relatórios guardados: ${arquivos.length}`);

let telefones = 0, carater = 0;
for (const f of arquivos.sort()) {
  const r = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(f), { type: 'buffer' }).Sheets[XLSX.read(fs.readFileSync(f), { type: 'buffer' }).SheetNames[0]], { header: 1, defval: '' });
  const h = r.findIndex(l => l.some(x => /procedimento/i.test(x)));
  if (h < 0) continue;
  const cab = r[h].map(n);
  const iA = cab.findIndex(x => /^atend/.test(x)), iD = cab.findIndex(x => /^data$|inicioreal/.test(x)), iC = cab.findIndex(x => /^carater/.test(x));
  const iTs = cab.map((x, i) => /telef|fone|celular/.test(x) ? i : -1).filter(i => i >= 0);
  if (iA < 0 || iD < 0) continue;
  for (const l of r.slice(h + 1)) {
    const k = String(l[iA] || '').trim() + '|' + toISO(l[iD]);
    const alvos = porChave.get(k); if (!alvos) continue;
    /* várias colunas "Telefone": a primeira preenchida vale */
    const tel = iTs.map(i => String(l[i] || '').trim()).find(t => t.replace(/\D/g, '').length >= 8) || '';
    const car = iC >= 0 ? String(l[iC] || '').trim() : '';
    for (const c of alvos) {
      if (tel && !String(c.Telefone || '').trim()) { c.Telefone = tel; telefones++; }
      if (car && !String(c.Carater || '').trim()) { c.Carater = car; carater++; }
    }
  }
}
console.log(`telefones preenchidos: ${telefones} | caráter preenchido: ${carater} | ainda sem telefone: ${banco.cirurgias.filter(c => !String(c.Telefone).trim()).length}`);
if (!APLICAR) { console.log('\nSIMULAÇÃO — nada gravado. Rode com --aplicar para gravar (com backup).'); process.exit(0); }
fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
fs.copyFileSync(arquivo, path.join(PASTA, 'backups', `cirurgias.backup-antes-telefones-${carimbo}.xlsx`));
const saida = XLSX.utils.book_new();
for (const [aba, colunas] of Object.entries(esquemas.ESQUEMAS.cirurgias.abas)) {
  const linhas = (banco[aba] || []).map(o => { const limpo = {}; colunas.forEach(c => { limpo[c] = o[c] === undefined ? '' : o[c]; }); return limpo; });
  XLSX.utils.book_append_sheet(saida, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
}
fs.writeFileSync(arquivo, XLSX.write(saida, { type: 'buffer', bookType: 'xlsx', compression: true }));
console.log('\nGravado. Backup em backups/.');
