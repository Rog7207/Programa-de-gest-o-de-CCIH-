/* Preenche SitioSwab (retal / orofaringe / nasal / axilar / perianal / vaginal) nas culturas
   de vigilância já gravadas, relendo os laudos PDF guardados em importados/ — o vocabulário
   reduziu o material a "Swab de vigilância" e o sítio se perdeu (03/11/2026). As importações
   novas já gravam o sítio sozinhas; isto é o retroativo.

   Casamento: paciente (prontuário do laudo, ou nome → prontuário pelo cadastro) + data da
   coleta + swab. Linha já com sítio não é tocada. Precisa de `pdftotext` (poppler).

   Uso:  PASTA_CCIH="/caminho/Dados CCIH" node scripts/preencher-sitio-swab.js            (simulação)
         PASTA_CCIH="/caminho/Dados CCIH" node scripts/preencher-sitio-swab.js --aplicar  (grava, com backup) */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const raiz = path.join(__dirname, '..');
global.XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(raiz, 'js', 'esquemas.js'));
global.TIPOS_RELATORIO = esquemas.TIPOS_RELATORIO;
global.CLASSES_TRIAGEM = esquemas.CLASSES_TRIAGEM;
global.CLASSIFICACOES_CULTURA = esquemas.CLASSIFICACOES_CULTURA;
global.SINONIMOS_CLASSIFICACAO = esquemas.SINONIMOS_CLASSIFICACAO;
const leitura = require(path.join(raiz, 'js', 'leitura.js'));
global.normalizarTexto = leitura.normalizarTexto;
const imp = require(path.join(raiz, 'js', 'importacao.js'));
global.normalizarProntuario = imp.normalizarProntuario;
const col = require(path.join(raiz, 'js', 'colonizacao.js'));

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const arquivo = path.join(PASTA, 'culturas.xlsx');
if (!fs.existsSync(arquivo)) { console.error('culturas.xlsx não encontrado em ' + PASTA); process.exit(2); }

const wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
const banco = {};
wb.SheetNames.forEach(n => { banco[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }); });
const pacientes = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(path.join(PASTA, 'pacientes.xlsx')), { type: 'buffer' }).Sheets.pacientes, { defval: '' });
/* O mesmo nome tem mais de um número (registro provisório do laudo + prontuário real,
   unificados depois): todos são candidatos. */
const prontPorNome = new Map();
for (const p of pacientes) { const k = normalizarTexto(p.Nome); if (!k) continue; if (!prontPorNome.has(k)) prontPorNome.set(k, []); prontPorNome.get(k).push(normalizarProntuario(p.Prontuario)); }

/* Índice dos swabs sem sítio: chave paciente|data. */
const n = normalizarTexto;
const swabs = banco.culturas.filter(c => col.ehSwabVigilancia(c) && !String(c.SitioSwab || '').trim());
const porChave = new Map();
for (const c of swabs) {
  const k = normalizarProntuario(c.Prontuario) + '|' + String(c.DataColeta || '').slice(0, 10);
  if (!porChave.has(k)) porChave.set(k, []);
  porChave.get(k).push(c);
}
console.log(`culturas: ${banco.culturas.length} | swabs sem sítio: ${swabs.length}`);

/* Laudos PDF guardados. */
const pastaImp = path.join(PASTA, 'importados');
const pdfs = [];
if (fs.existsSync(pastaImp)) for (const sub of fs.readdirSync(pastaImp)) {
  const dir = path.join(pastaImp, sub);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) if (/\.pdf$/i.test(f)) pdfs.push(path.join(dir, f));
}
console.log(`laudos PDF: ${pdfs.length}`);

const dataISO = br => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(br || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
let preenchidas = 0, semPar = 0, ambiguos = 0;
const porSitio = {};
const vistas = new Set();
for (const pdf of pdfs) {
  let texto;
  try { texto = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { console.error('falha ao ler ' + path.basename(pdf) + ': ' + e.message); continue; }
  const linhas = imp.analisarPDFCulturas(texto.split('\n'));
  if (!linhas) continue;
  for (const l of linhas.slice(1)) {
    const [identificacao, nome, dataBR, , material] = l;
    const sitio = col.sitioDoSwab(material);
    if (!sitio) continue;
    const data = dataISO(dataBR);
    const candidatos = [normalizarProntuario(identificacao), ...(prontPorNome.get(n(nome)) || [])].filter(Boolean);
    let alvo = null;
    for (const p of candidatos) { const lista = porChave.get(p + '|' + data); if (lista && lista.length) { alvo = lista; break; } }
    if (!alvo) { semPar++; continue; }
    /* Vários swabs do mesmo paciente no mesmo dia (retal + orofaringe): o laudo lista um por
       vez; pega o primeiro ainda sem sítio. Sem sobra, é ambíguo e fica para a próxima linha. */
    const livre = alvo.find(c => !String(c.SitioSwab || '').trim() && !vistas.has(c.ID_Cultura));
    if (!livre) { ambiguos++; continue; }
    livre.SitioSwab = sitio; vistas.add(livre.ID_Cultura); preenchidas++;
    porSitio[sitio] = (porSitio[sitio] || 0) + 1;
  }
}
console.log(`sítios preenchidos: ${preenchidas}`, porSitio);
console.log(`linhas do laudo sem par no banco: ${semPar} | laudos sem swab livre para receber (já preenchido): ${ambiguos}`);
console.log(`swabs que continuam sem sítio: ${swabs.filter(c => !String(c.SitioSwab || '').trim()).length}`);

if (!APLICAR) { console.log('\nSIMULAÇÃO — nada gravado. Rode com --aplicar para gravar (com backup).'); process.exit(0); }
fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
fs.copyFileSync(arquivo, path.join(PASTA, 'backups', `culturas.backup-antes-sitio-swab-${carimbo}.xlsx`));
const saida = XLSX.utils.book_new();
for (const [aba, colunas] of Object.entries(esquemas.ESQUEMAS.culturas.abas)) {
  const linhas = (banco[aba] || []).map(o => { const limpo = {}; colunas.forEach(c => { limpo[c] = o[c] === undefined ? '' : o[c]; }); return limpo; });
  XLSX.utils.book_append_sheet(saida, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
}
fs.writeFileSync(arquivo, XLSX.write(saida, { type: 'buffer', bookType: 'xlsx', compression: true }));
console.log('\nGravado. Backup em backups/.');
