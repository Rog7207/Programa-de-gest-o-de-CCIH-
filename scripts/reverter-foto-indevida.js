/* Reverte uma "foto dos internados" (relatório 2396) gravada por engano — caso de
   04–05/10/2026: o relatório de sinais vitais (2411) foi reconhecido como foto e, com data
   03/10, criou 1.525 passagens de setor, encerrou as que estavam abertas e trocou o
   SetorAtual das internações pelo setor da medida.

   O que desfaz, a partir do MOMENTO da gravação (--criado=AAAA-MM-DD HH:MM) e da DATA da
   foto (--data=AAAA-MM-DD):
   1. passagem_setor: apaga as passagens criadas naquele momento e reabre as que foram
      encerradas com SaidaSetor = data da foto (só a importação indevida gravou nesse dia).
   2. internacoes abertas: SetorAtual volta ao setor da passagem que ficou aberta para o
      atendimento (= estado da última foto legítima). Leito não foi tocado (o 2411 não tem).
   Simulação por padrão; grava só com --aplicar (backup em backups/). PASTA_CCIH escolhe a pasta. */

const fs = require('fs');
const path = require('path');
const os = require('os');
const raiz = path.join(__dirname, '..');
const XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
const { ESQUEMAS } = require(path.join(raiz, 'js', 'esquemas.js'));

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const arg = nome => { const a = process.argv.find(x => x.startsWith('--' + nome + '=')); return a ? a.slice(nome.length + 3) : ''; };
const CRIADO = arg('criado');
const DATA = arg('data');
if (!CRIADO || !DATA) { console.log('Uso: node scripts/reverter-foto-indevida.js --criado="2026-10-05 01:57" --data=2026-10-03 [--aplicar]'); process.exit(1); }

function ler(nome) {
  const wb = XLSX.read(fs.readFileSync(path.join(PASTA, ESQUEMAS[nome].arquivo)), { type: 'buffer' });
  const banco = {};
  wb.SheetNames.forEach(aba => { banco[aba] = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '', raw: false }); });
  return banco;
}
function gravar(nome, banco) {
  const esquema = ESQUEMAS[nome];
  const wb = XLSX.utils.book_new();
  for (const aba of [...new Set([...Object.keys(esquema.abas), ...Object.keys(banco)])]) {
    const linhas = banco[aba] || [];
    const doEsquema = esquema.abas[aba] || [];
    const extras = [];
    for (const l of linhas) for (const k of Object.keys(l)) if (!doEsquema.includes(k) && !extras.includes(k)) extras.push(k);
    const colunas = [...doEsquema, ...extras];
    const limpas = linhas.map(o => { const s = {}; colunas.forEach(c => { s[c] = o[c] == null ? '' : String(o[c]); }); return s; });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(limpas, { header: colunas }), aba);
  }
  const destino = path.join(PASTA, esquema.arquivo);
  const backup = path.join(PASTA, 'backups', esquema.arquivo.replace('.xlsx', '.backup-antes-reverter-foto.xlsx'));
  fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
  if (!fs.existsSync(backup)) fs.copyFileSync(destino, backup);
  fs.writeFileSync(destino, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
const np = v => String(v == null ? '' : v).replace(/\D/g, '');

console.log(`Pasta: ${PASTA}${APLICAR ? '' : '   (SIMULAÇÃO — use --aplicar para gravar)'}`);
console.log(`Revertendo a foto gravada em "${CRIADO}" com data ${DATA}\n`);

const den = ler('denominadores');
const passagens = den.passagem_setor || [];
const criadas = passagens.filter(p => String(p.CriadoEm || '').startsWith(CRIADO));
const encerradas = passagens.filter(p => String(p.SaidaSetor || '').slice(0, 10) === DATA && !String(p.CriadoEm || '').startsWith(CRIADO));
console.log(`passagem_setor: ${passagens.length} linhas; criadas pela importação indevida: ${criadas.length}; encerradas por ela (SaidaSetor = ${DATA}): ${encerradas.length}`);
const idsCriadas = new Set(criadas.map(p => p.ID_Passagem));
den.passagem_setor = passagens.filter(p => !idsCriadas.has(p.ID_Passagem));
for (const p of den.passagem_setor) if (String(p.SaidaSetor || '').slice(0, 10) === DATA) p.SaidaSetor = '';
const abertasPorAtd = new Map();
for (const p of den.passagem_setor) if (!String(p.SaidaSetor || '').trim()) abertasPorAtd.set(np(p.Atendimento), p);
console.log(`  depois: ${den.passagem_setor.length} linhas, ${abertasPorAtd.size} passagens abertas`);

const pac = ler('pacientes');
let setorRestaurado = 0, semReferencia = 0;
for (const i of (pac.internacoes || [])) {
  if (String(i.DataAlta || '').trim()) continue;
  const aberta = abertasPorAtd.get(np(i.Atendimento));
  if (!aberta) { semReferencia++; continue; }
  if (String(i.SetorAtual || '').trim() !== String(aberta.Setor || '').trim()) { i.SetorAtual = aberta.Setor; setorRestaurado++; }
}
const emUTI = (pac.internacoes || []).filter(i => !String(i.DataAlta || '').trim() && /\b(uti|cti)\b/i.test(i.SetorAtual)).length;
console.log(`internacoes abertas: SetorAtual restaurado em ${setorRestaurado}; sem passagem aberta para conferir: ${semReferencia}; em UTI/CTI após a reversão: ${emUTI}`);

if (!APLICAR) { console.log('\nNada gravado (simulação).'); process.exit(0); }
gravar('denominadores', den);
gravar('pacientes', pac);
console.log('\nGravado: denominadores.xlsx e pacientes.xlsx (backups em backups/).');
