/* Culturas que a CCIH já classificou como IRAS / bacteremia secundária mas que NÃO têm caso
   correspondente em iras.xlsx (achado de 22/09/2026: 786 de 1.243 — a base unificada de
   culturas entrou em 25/08 já classificada, antes de a importação registrar casos).
   Cria um caso por EPISÓDIO (mesmo paciente por identidade, coletas em até 14 dias viram
   um caso só; o agente é o germe da coleta mais antiga), com CriterioDiagnostico
   "Cultura classificada pela CCIH (retroativo)".

   Situação do caso: --status=investigacao (padrão; entra na fila de confirmação) ou
   --status=confirmado (histórico já validado). --desde=AAAA-MM-DD limita por data de coleta.
   Roda em simulação; grava só com --aplicar (backup). PASTA_CCIH escolhe a pasta. */

const fs = require('fs');
const path = require('path');
const os = require('os');
const raiz = path.join(__dirname, '..');
const XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
global.XLSX = XLSX;
const { normalizarTexto } = require(path.join(raiz, 'js', 'leitura.js'));
global.normalizarTexto = normalizarTexto;
const esquemas = require(path.join(raiz, 'js', 'esquemas.js'));
global.TIPOS_RELATORIO = esquemas.TIPOS_RELATORIO;
const { ESQUEMAS } = esquemas;
const imp = require(path.join(raiz, 'js', 'importacao.js'));
const np = imp.normalizarProntuario;

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const arg = nome => { const a = process.argv.find(x => x.startsWith('--' + nome + '=')); return a ? a.split('=')[1] : ''; };
const STATUS = arg('status') === 'confirmado' ? 'confirmado' : 'em investigação';
const DESDE = arg('desde') || '';
const USUARIO = process.env.USUARIO_CCIH || 'CCIH (retroativo)';

function ler(nome) {
  const wb = XLSX.read(fs.readFileSync(path.join(PASTA, ESQUEMAS[nome].arquivo)), { type: 'buffer' });
  const banco = {};
  wb.SheetNames.forEach(aba => { banco[aba] = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '', raw: false }); });
  return banco;
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
  const backup = path.join(PASTA, 'backups', esquema.arquivo.replace('.xlsx', '.backup-antes-casos-de-culturas.xlsx'));
  fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
  if (!fs.existsSync(backup)) fs.copyFileSync(destino, backup);
  fs.writeFileSync(destino, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

console.log(`Pasta: ${PASTA}${APLICAR ? '' : '   (SIMULAÇÃO — use --aplicar para gravar)'}`);
console.log(`Situação dos casos novos: ${STATUS}${DESDE ? `; só coletas desde ${DESDE}` : ''}\n`);

const culturas = ler('culturas').culturas || [];
const bancoIras = ler('iras');
bancoIras.casos = bancoIras.casos || [];
const pacientes = ler('pacientes').pacientes || [];
const identidadeDe = imp.identidadePorNome(pacientes);

/* "Já tem caso" aqui é QUALQUER caso do mesmo paciente (identidade) em ±14 dias da coleta,
   independente da topografia: o caso confirmado importado diz "Pulmonar / PAV" e a cultura
   só diz "IRAS" — é o mesmo episódio, não pode virar segundo caso. */
const casosPorIdentidade = new Map();
for (const k of bancoIras.casos) {
  const i = identidadeDe(np(k.Prontuario));
  if (!casosPorIdentidade.has(i)) casosPorIdentidade.set(i, []);
  casosPorIdentidade.get(i).push(Date.parse(String(k.DataInfeccao).slice(0, 10) + 'T00:00:00Z'));
}
const jaTemCaso = c => {
  const d = Date.parse(String(c.DataColeta).slice(0, 10) + 'T00:00:00Z');
  return (casosPorIdentidade.get(identidadeDe(np(c.Prontuario))) || []).some(x => isFinite(x) && Math.abs(x - d) / 864e5 <= 14);
};
const classificadas = culturas
  .filter(c => c.StatusRevisao === 'avaliada' && /^(iras|bacteremia)/i.test(String(c.AvaliacaoCCIH || '')))
  .filter(c => !DESDE || String(c.DataColeta).slice(0, 10) >= DESDE);
const candidatas = classificadas.filter(c => !jaTemCaso(c))
  .sort((a, b) => String(a.DataColeta).localeCompare(String(b.DataColeta)));
console.log(`Culturas classificadas como IRAS/bacteremia${DESDE ? ' no período' : ''}: ${classificadas.length}; sem caso do episódio: ${candidatas.length}`);

/* Topografia: a classificação "IRAS — X" traz a topografia; "Bacteremia secundária" é corrente
   sanguínea; IRAS sem topografia fica vazia para a CCIH completar na confirmação. */
const topografiaDe = c => {
  const a = String(c.AvaliacaoCCIH || '');
  const m = /^iras\s*[—–-]\s*(.+)$/i.exec(a);
  if (m) return m[1].trim();
  if (/^bacteremia/i.test(a)) return 'Corrente sanguínea (bacteremia secundária)';
  return '';
};
const gerarID = imp.proximoID(bancoIras.casos, 'ID_IRAS', 'IRA');
const agora = new Date().toISOString().slice(0, 16).replace('T', ' ');
let novos = 0, jaTinham = 0;
const porAno = {};
for (const c of candidatas) {
  const { novo } = imp.registrarCasoIras(bancoIras.casos, {
    Prontuario: c.Prontuario, DataInfeccao: String(c.DataColeta).slice(0, 10), Topografia: topografiaDe(c),
    CriterioDiagnostico: 'Cultura classificada pela CCIH (retroativo)', Setor: c.Setor || '',
    DispositivoAssociado: '', Microrganismo: c.Microrganismo || '', ID_CulturaAgente: c.ID_Cultura,
    Desfecho: '', StatusInvestigacao: STATUS, NotificadoANVISA: '',
    CriadoPor: USUARIO, CriadoEm: agora
  }, gerarID, identidadeDe);
  if (novo) { novos++; const ano = String(c.DataColeta).slice(0, 4); porAno[ano] = (porAno[ano] || 0) + 1; }
  else jaTinham++;
}
console.log(`Casos NOVOS (um por episódio): ${novos}; culturas que já tinham caso do episódio: ${jaTinham}`);
console.log('  por ano: ' + Object.entries(porAno).sort().map(([a, n]) => `${a}: ${n}`).join(' | '));

if (!APLICAR) { console.log('\nNada gravado (simulação).'); process.exit(0); }
gravar('iras', bancoIras);
console.log(`\nGravado: ${ESQUEMAS.iras.arquivo} (backup em backups/).`);
