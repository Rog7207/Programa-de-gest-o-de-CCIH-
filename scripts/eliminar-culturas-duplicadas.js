/* Elimina a cultura que entrou DUAS VEZES por portas diferentes: uma pela planilha do
   laboratório (com ID do exame) e outra pelo PDF diário (sem ID).

   A chave de deduplicação da importação nunca enxergou o par: a linha do laboratório é
   identificada pelo ID do exame, a do PDF pela chave composta — chaves de naturezas
   diferentes não colidem (corrigido na importação em 23/10/2026; este script limpa o que já
   entrou). Às vezes os prontuários ainda diferem (o PDF criava registro provisório
   nascimento+iniciais). O casamento aqui é pelo NOME do paciente no cadastro + data +
   material + germe + resultado, e só remove a linha SEM ID do laboratório quando existe a
   irmã do laboratório no mesmo grupo. Avaliação da CCIH, antibiograma, mecanismo e vínculo
   com IRAS que só a linha removida tenha são herdados pela sobrevivente antes da remoção;
   as IRAS que apontavam para a removida (ID_CulturaAgente) passam a apontar para a
   sobrevivente.

   Uso:  node scripts/eliminar-culturas-duplicadas.js            (simulação)
         node scripts/eliminar-culturas-duplicadas.js --aplicar  (grava, com backup)  */

const fs = require('fs');
const path = require('path');
const os = require('os');

global.XLSX = require(path.join(__dirname, '..', 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(__dirname, '..', 'js', 'esquemas.js'));
const leitura = require(path.join(__dirname, '..', 'js', 'leitura.js'));
global.TIPOS_RELATORIO = esquemas.TIPOS_RELATORIO;
global.CLASSIFICACOES_CULTURA = esquemas.CLASSIFICACOES_CULTURA;
global.CLASSES_TRIAGEM = esquemas.CLASSES_TRIAGEM;
global.SINONIMOS_CLASSIFICACAO = esquemas.SINONIMOS_CLASSIFICACAO;
global.normalizarTexto = leitura.normalizarTexto;
const imp = require(path.join(__dirname, '..', 'js', 'importacao.js'));
global.normalizarProntuario = imp.normalizarProntuario;

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const ESQUEMAS = esquemas.ESQUEMAS;
const arquivo = path.join(PASTA, ESQUEMAS.culturas.arquivo);

const lerAba = (f, a) => XLSX.utils.sheet_to_json(
  XLSX.read(fs.readFileSync(path.join(PASTA, f)), { type: 'buffer' }).Sheets[a], { defval: '' });

const wbEntrada = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
const banco = {};
wbEntrada.SheetNames.forEach(n => { banco[n] = XLSX.utils.sheet_to_json(wbEntrada.Sheets[n], { defval: '' }); });
const pacientes = lerAba(ESQUEMAS.pacientes.arquivo, 'pacientes');
const arquivoIras = path.join(PASTA, ESQUEMAS.iras.arquivo);
const wbIras = XLSX.read(fs.readFileSync(arquivoIras), { type: 'buffer' });
const bancoIras = {};
wbIras.SheetNames.forEach(n => { bancoIras[n] = XLSX.utils.sheet_to_json(wbIras.Sheets[n], { defval: '' }); });
console.log(`culturas: ${banco.culturas.length} | sensibilidade: ${banco.sensibilidade.length}\n`);

const n = normalizarTexto;
const nomeDe = new Map(pacientes.map(p => [normalizarProntuario(p.Prontuario), n(p.Nome)]));
const temIdLab = c => { const o = String(c.IDOrigem || '').trim(); return o && !/^CUL-\d+$/i.test(o); };

const sensPorCultura = new Map();
for (const s of banco.sensibilidade) {
  if (!sensPorCultura.has(s.ID_Cultura)) sensPorCultura.set(s.ID_Cultura, []);
  sensPorCultura.get(s.ID_Cultura).push(s);
}

/* Identidade por pessoa (nome do cadastro), não por número — é exatamente o que os dois
   prontuários divergentes têm em comum. Resultado entra na chave por segurança extra. */
const chave = c => {
  const nome = nomeDe.get(normalizarProntuario(c.Prontuario));
  if (!nome) return null;
  return [nome, String(c.DataColeta).slice(0, 10), n(c.Material),
    n((imp.separarMecanismoDoNome(c.Microrganismo) || {}).nome || c.Microrganismo),
    n(c.Resultado)].join('|');
};

const grupos = new Map();
for (const c of banco.culturas) {
  const k = chave(c);
  if (!k) continue;
  if (!grupos.has(k)) grupos.set(k, []);
  grupos.get(k).push(c);
}

const remover = new Set();
const sobrevivente = new Map();   /* ID removido → ID que fica (para religar as IRAS) */
const porMes = new Map();
let gruposMistos = 0, provisoriasMantidas = 0, paineisTrocados = 0;
const exemplos = [];

for (const [, grupo] of grupos) {
  if (grupo.length < 2) continue;
  const doLab = grupo.filter(temIdLab);
  /* Sem ID do laboratório = veio do PDF (prontuário real ou provisório, tanto faz). */
  const provisorias = grupo.filter(c => !temIdLab(c));
  if (!doLab.length || !provisorias.length) continue;
  gruposMistos++;
  /* Cada provisória casa com uma linha do laboratório; sobrando provisórias além das
     linhas do lab, as excedentes podem ser exames distintos e ficam. */
  const pares = Math.min(provisorias.length, doLab.length);
  for (let i = 0; i < pares; i++) {
    const morre = provisorias[i];
    const sobrevive = doLab[i % doLab.length];
    remover.add(morre.ID_Cultura);
    const mes = String(morre.DataColeta || '').slice(0, 7) || '(sem data)';
    porMes.set(mes, (porMes.get(mes) || 0) + 1);
    /* Julgamento humano e antibiograma nunca se perdem — migram para a sobrevivente. */
    if (morre.StatusRevisao === 'avaliada' && sobrevive.StatusRevisao !== 'avaliada') {
      sobrevive.StatusRevisao = morre.StatusRevisao;
      sobrevive.AvaliacaoCCIH = morre.AvaliacaoCCIH;
    }
    /* Painel S/I/R: fica o mais completo. A planilha do laboratório costuma trazer só a
       lista de resistentes (3 linhas); o PDF traz o antibiograma inteiro (9+). */
    const sensFica = sensPorCultura.get(sobrevive.ID_Cultura) || [];
    const sensMorre = sensPorCultura.get(morre.ID_Cultura) || [];
    if (sensMorre.length > sensFica.length) {
      banco.sensibilidade = banco.sensibilidade.filter(x => x.ID_Cultura !== sobrevive.ID_Cultura);
      sensPorCultura.set(sobrevive.ID_Cultura, sensMorre.map(x => ({ ...x, ID_Cultura: sobrevive.ID_Cultura })));
      banco.sensibilidade.push(...sensPorCultura.get(sobrevive.ID_Cultura));
      if (String(morre.Antibiograma || '').trim()) sobrevive.Antibiograma = morre.Antibiograma;
      paineisTrocados++;
    } else if (!String(sobrevive.Antibiograma || '').trim() && String(morre.Antibiograma || '').trim()) {
      sobrevive.Antibiograma = morre.Antibiograma;
    }
    if (!String(sobrevive.MecanismoResistencia || '').trim() && String(morre.MecanismoResistencia || '').trim()) {
      sobrevive.MecanismoResistencia = morre.MecanismoResistencia;
    }
    if (!String(sobrevive.ID_IRAS || '').trim() && String(morre.ID_IRAS || '').trim()) sobrevive.ID_IRAS = morre.ID_IRAS;
    if (!String(sobrevive.DataResultado || '').trim() && String(morre.DataResultado || '').trim()) sobrevive.DataResultado = morre.DataResultado;
    sobrevivente.set(morre.ID_Cultura, sobrevive.ID_Cultura);
  }
  provisoriasMantidas += provisorias.length - pares;
  if (exemplos.length < 6) {
    exemplos.push(grupo.map(c =>
      `${c.ID_Cultura}${remover.has(c.ID_Cultura) ? ' (remove)' : ' (fica)'} pront=[${c.Prontuario}] IDor=[${c.IDOrigem || '—'}] ` +
      `${c.DataColeta} ${String(c.Material).slice(0, 14)} "${String(c.Microrganismo).slice(0, 30)}" ${c.StatusRevisao}`
    ).join('\n     '));
  }
}

console.log(`grupos mistos (lab + PDF da mesma pessoa): ${gruposMistos}`);
console.log(`linhas do PDF a remover: ${remover.size}`);
if (provisoriasMantidas) console.log(`linhas do PDF mantidas por excederem as do lab (podem ser exames distintos): ${provisoriasMantidas}`);
let irasReligadas = 0;
for (const k of (bancoIras.casos || [])) {
  const novo = sobrevivente.get(String(k.ID_CulturaAgente || '').trim());
  if (novo) { k.ID_CulturaAgente = novo; irasReligadas++; }
}
console.log(`IRAS religadas à cultura sobrevivente: ${irasReligadas}`);
console.log(`antibiogramas completados com o painel do PDF: ${paineisTrocados}`);
console.log('\npor mês de coleta:');
[...porMes.entries()].sort().forEach(([m, v]) => console.log('  ', m, v));
console.log('\nexemplos:');
exemplos.forEach(e => console.log('  --', e, '\n'));

const antesC = banco.culturas.length, antesS = banco.sensibilidade.length;
/* Positivas por mês antes × depois, para conferir o efeito onde a duplicação apareceu. */
const positiva = c => String(c.Microrganismo || '').trim() && !/negativ|sem crescimento|ausencia/i.test(String(c.Microrganismo));
const posPorMes = lista => { const m = new Map(); lista.filter(positiva).forEach(c => { const k = String(c.DataColeta || '').slice(0, 7); m.set(k, (m.get(k) || 0) + 1); }); return m; };
const posAntes = posPorMes(banco.culturas);
banco.culturas = banco.culturas.filter(c => !remover.has(c.ID_Cultura));
const posDepois = posPorMes(banco.culturas);
console.log('\nculturas positivas por mês (antes -> depois), só meses alterados:');
[...posAntes.keys()].sort().forEach(m => { if (posAntes.get(m) !== posDepois.get(m)) console.log('  ', m, posAntes.get(m), '->', posDepois.get(m) || 0); });
banco.sensibilidade = banco.sensibilidade.filter(s => !remover.has(s.ID_Cultura));
console.log(`culturas: ${antesC} -> ${banco.culturas.length}`);
console.log(`sensibilidade: ${antesS} -> ${banco.sensibilidade.length}`);

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
/* Nome com data/hora: um backup por execução. (Com nome fixo, a segunda rodada — em outro
   banco, com a mesma pasta backups/ copiada — não gravava backup nenhum.) */
const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const backup = path.join(PASTA, 'backups', `culturas.backup-antes-dedup-${carimbo}.xlsx`);
fs.copyFileSync(arquivo, backup);

const wb = XLSX.utils.book_new();
for (const [aba, colunas] of Object.entries(ESQUEMAS.culturas.abas)) {
  const linhas = (banco[aba] || []).map(o => {
    const limpo = {};
    colunas.forEach(col => { limpo[col] = o[col] === undefined ? '' : o[col]; });
    return limpo;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
}
fs.writeFileSync(arquivo, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
if (irasReligadas) {
  const backupIras = path.join(PASTA, 'backups', `iras.backup-antes-dedup-${carimbo}.xlsx`);
  fs.copyFileSync(arquivoIras, backupIras);
  const wb2 = XLSX.utils.book_new();
  wbIras.SheetNames.forEach(aba => XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet(bancoIras[aba]), aba));
  fs.writeFileSync(arquivoIras, XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' }));
}
console.log(`\ngravado. Backup em ${backup}`);
