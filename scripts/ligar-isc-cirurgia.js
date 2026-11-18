/* Liga à cirurgia de origem as ISC confirmadas (segunda assinatura) que ficaram sem cirurgia —
   em geral as abertas pela revisão de culturas antes de 11/11/2026, quando a tela ainda não
   oferecia a lista de cirurgias (pedido de 18/11/2026). Mesma regra da aba Infecções
   (cirurgiasDoEpisodio + vincularCirurgiaIsc): candidatas = cirurgias do paciente (identidade)
   até 180 dias antes; liga SÓ quando há exatamente uma candidata na janela (30 dias, 90 com
   prótese/implante). Antes de contar: cirurgia no dia da detecção ou no anterior (0–1 dia) é o
   TRATAMENTO da infecção (reabordagem, drenagem, desbridamento), não a cirurgia de origem, e sai;
   linhas repetidas da mesma cirurgia (mesma data e procedimento) contam como uma. A data da infecção passa a ser a da cirurgia (padrão da CCIH), a da
   detecção fica guardada, e tudo tem rastro nas observações. Os demais são listados para
   decisão manual na ficha do paciente.

   Uso:  PASTA_CCIH="/caminho/Dados CCIH" node scripts/ligar-isc-cirurgia.js [--mes=2026-09]            (simulação)
         PASTA_CCIH="/caminho/Dados CCIH" node scripts/ligar-isc-cirurgia.js [--mes=2026-09] --aplicar  (grava, com backup) */

const fs = require('fs');
const path = require('path');
const os = require('os');
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
for (const [k, v] of Object.entries(imp)) if (!(k in global)) global[k] = v;

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const MES = (process.argv.find(a => a.startsWith('--mes=')) || '').slice(6);
const QUEM = process.env.USUARIO_CCIH || 'script ligar-isc-cirurgia';
const ler = f => { const wb = XLSX.read(fs.readFileSync(path.join(PASTA, f)), { type: 'buffer' }); const o = {}; wb.SheetNames.forEach(n => { o[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: false }); }); return { wb, o }; };
const gravar = (nome, wbOrig, dados) => {
  const esquema = esquemas.ESQUEMAS[nome];
  const saida = XLSX.utils.book_new();
  for (const [aba, colunas] of Object.entries(esquema.abas)) {
    const linhas = (dados[aba] || []).map(o => { const limpo = {}; colunas.forEach(k => { limpo[k] = o[k] === undefined ? '' : o[k]; }); return limpo; });
    XLSX.utils.book_append_sheet(saida, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
  }
  for (const aba of wbOrig.SheetNames) if (!esquema.abas[aba]) XLSX.utils.book_append_sheet(saida, XLSX.utils.json_to_sheet(dados[aba]), aba);
  fs.writeFileSync(path.join(PASTA, esquema.arquivo), XLSX.write(saida, { type: 'buffer', bookType: 'xlsx', compression: true }));
};

const I = ler('iras.xlsx'), C = ler('cirurgias.xlsx'), P = ler('pacientes.xlsx');
const identidadeDe = imp.identidadePorNome(P.o.pacientes || []);
const cirurgias = C.o.cirurgias || [];
const ligadaPorCaso = new Set(cirurgias.map(c => String(c.ID_IRAS || '')).filter(Boolean));
const alvo = (I.o.casos || []).filter(k => imp.grupoTopografia(k.Topografia) === 'isc'
  && ['confirmado', 'digitado'].includes(String(k.StatusInvestigacao)) && String(k.ConfirmadoPor || '').trim()
  && !String(k.ID_CirurgiaAssociada || '').trim() && !ligadaPorCaso.has(String(k.ID_IRAS))
  && (!MES || String(k.DataInfeccao || '').startsWith(MES)));
const quando = new Date().toISOString().slice(0, 16).replace('T', ' ');
let ligados = 0;
const pendentes = [];
for (const k of alvo) {
  const cand = imp.cirurgiasDoEpisodio(cirurgias, k, { identidadeDe });
  const vistas = new Set();
  const naJanela = cand.filter(x => x.naJanela && x.dias > 1).filter(x => {
    const chave = String(x.cirurgia.DataCirurgia).slice(0, 10) + '|' + normalizarTexto(x.cirurgia.Procedimento);
    if (vistas.has(chave)) return false; vistas.add(chave); return true;
  });
  const descr = `${k.ID_IRAS} · prontuário ${k.Prontuario} · ${String(k.DataInfeccao).slice(0, 10)} · ${k.Topografia}`;
  if (naJanela.length === 1) {
    const x = naJanela[0];
    const r = imp.vincularCirurgiaIsc(cirurgias, k, x.cirurgia.ID_Cirurgia, { usuario: QUEM, agora: quando });
    k.Observacoes = imp.acrescentarObservacao(k.Observacoes, 'Cirurgia',
      `ISC associada à cirurgia ${r.vinculada.DataCirurgia} · ${r.vinculada.Procedimento} (${x.cirurgia.ID_Cirurgia}) — única candidata na janela (${x.dias} dias antes)`, QUEM, quando);
    ligados++;
    console.log('LIGA   ', descr, '→', x.cirurgia.ID_Cirurgia, String(x.cirurgia.DataCirurgia).slice(0, 10), String(x.cirurgia.Procedimento).slice(0, 45), `(${x.dias} d${x.implante ? ', implante' : ''})`);
  } else {
    pendentes.push(descr);
    console.log('MANUAL ', descr, `— ${naJanela.length} candidata(s) na janela (sem as de 0–1 dia), ${cand.length} até 180 dias:`,
      cand.slice(0, 4).map(x => `${String(x.cirurgia.DataCirurgia).slice(0, 10)} ${String(x.cirurgia.Procedimento).slice(0, 30)} (${x.dias} d${x.naJanela ? '' : ', fora'})`).join(' | ') || 'nenhuma');
  }
}
console.log(`\nISC confirmadas sem cirurgia${MES ? ' em ' + MES : ''}: ${alvo.length} | ligadas: ${ligados} | para decidir na ficha: ${pendentes.length}`);
if (!APLICAR) { console.log('SIMULAÇÃO — nada gravado. Rode com --aplicar para gravar (com backup).'); process.exit(0); }
if (!ligados) { console.log('Nada a gravar.'); process.exit(0); }
fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
for (const f of ['iras.xlsx', 'cirurgias.xlsx']) fs.copyFileSync(path.join(PASTA, f), path.join(PASTA, 'backups', f.replace('.xlsx', `.backup-antes-ligar-isc-${carimbo}.xlsx`)));
gravar('iras', I.wb, I.o);
gravar('cirurgias', C.wb, C.o);
console.log('Gravado. Backups em backups/.');
