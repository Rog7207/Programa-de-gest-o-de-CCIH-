/* Funde as culturas que entraram duas vezes por causa das duas identidades do mesmo paciente:
   o PDF do laboratório não traz prontuário, então cria um pseudo-registro (nascimento+iniciais),
   enquanto a base do hospital usa o número de atendimento.

   Duas etapas:
   1) unifica os pseudo-pacientes que casam por nome com um paciente real (em todos os arquivos);
   2) nos exames que ficam duplicados, MANTÉM a linha da base (que tem a classificação da CCIH e
      o ID do laboratório), leva para ela o antibiograma da linha do PDF — que é a única com
      painel completo, S/I/R — e só então descarta a linha do PDF.

   Uso:  node scripts/fundir-culturas-do-laboratorio.js            (simulação)
         node scripts/fundir-culturas-do-laboratorio.js --aplicar  (grava, com backup)  */

const fs = require('fs');
const path = require('path');

global.XLSX = require(path.join(__dirname, '..', 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(__dirname, '..', 'js', 'esquemas.js'));
const leitura = require(path.join(__dirname, '..', 'js', 'leitura.js'));
global.TIPOS_RELATORIO = esquemas.TIPOS_RELATORIO;
global.CLASSIFICACOES_CULTURA = esquemas.CLASSIFICACOES_CULTURA;
global.SINONIMOS_CLASSIFICACAO = esquemas.SINONIMOS_CLASSIFICACAO;
global.normalizarTexto = leitura.normalizarTexto;
const imp = require(path.join(__dirname, '..', 'js', 'importacao.js'));

const PASTA = '/home/rogerio/Documentos/Dados CCIH HNSC';
const APLICAR = process.argv.includes('--aplicar');
const ESQUEMAS = esquemas.ESQUEMAS;

const ler = arquivo => XLSX.read(fs.readFileSync(path.join(PASTA, arquivo)), { type: 'buffer' });
const abas = wb => {
  const dados = {};
  wb.SheetNames.forEach(n => { dados[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }); });
  return dados;
};
const gravar = (nomeEsquema, dados) => {
  const esquema = ESQUEMAS[nomeEsquema];
  const wb = XLSX.utils.book_new();
  for (const [aba, colunas] of Object.entries(esquema.abas)) {
    const linhas = (dados[aba] || []).map(o => {
      const limpo = {};
      colunas.forEach(c => { limpo[c] = o[c] == null ? '' : String(o[c]); });
      return limpo;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
  }
  fs.writeFileSync(path.join(PASTA, esquema.arquivo), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
};
const nP = imp.normalizarProntuario;

/* ---- 1. pseudo-pacientes que casam por nome com um paciente real ---- */
const bancos = {};
for (const nome of Object.keys(ESQUEMAS)) {
  if (nome === 'config') continue;
  const arquivo = path.join(PASTA, ESQUEMAS[nome].arquivo);
  if (fs.existsSync(arquivo)) bancos[nome] = abas(ler(ESQUEMAS[nome].arquivo));
}
const pacientes = bancos.pacientes.pacientes;
const sugestoes = imp.sugerirUnificacoes(pacientes);
console.log(`pacientes no cadastro: ${pacientes.length}`);
console.log(`pseudo-registros do laboratório: ${pacientes.filter(p => imp.ehPseudoProntuario(p.Prontuario)).length}`);
console.log(`unificações possíveis por nome: ${sugestoes.length}`);

const paraReal = new Map(sugestoes.map(s => [nP(s.de), nP(s.para)]));

/* ---- 2. aplica a unificação em todos os arquivos ---- */
let linhasReapontadas = 0;
for (const [nomeEsquema, dados] of Object.entries(bancos)) {
  for (const [aba, colunas] of Object.entries(ESQUEMAS[nomeEsquema].abas)) {
    if (!colunas.includes('Prontuario')) continue;
    for (const linha of dados[aba] || []) {
      const atual = nP(linha.Prontuario);
      if (paraReal.has(atual)) { linha.Prontuario = paraReal.get(atual); linhasReapontadas++; }
    }
  }
}
/* cadastros que passaram a dividir o mesmo prontuário viram um só */
let pacientesFundidos = 0;
{
  const porProntuario = new Map();
  for (const p of pacientes) {
    const chave = nP(p.Prontuario);
    if (!porProntuario.has(chave)) porProntuario.set(chave, []);
    porProntuario.get(chave).push(p);
  }
  const descartar = new Set();
  for (const linhas of porProntuario.values()) {
    if (linhas.length < 2) continue;
    const principal = linhas.slice().sort((a, b) =>
      String(a.CriadoEm || '').localeCompare(String(b.CriadoEm || '')))[0];
    for (const outro of linhas) {
      if (outro === principal) continue;
      for (const campo of ['Nome', 'Telefone', 'DataNascimento', 'Sexo']) {
        if (!principal[campo] && outro[campo]) principal[campo] = outro[campo];
      }
      descartar.add(outro);
      pacientesFundidos++;
    }
  }
  bancos.pacientes.pacientes = pacientes.filter(p => !descartar.has(p));
}
console.log(`\nlinhas reapontadas para o prontuário real: ${linhasReapontadas}`);
console.log(`cadastros de paciente fundidos: ${pacientesFundidos}`);

/* ---- 3. reimportação do mesmo lote do laboratório ----
   Diagnóstico: os PDFs do laboratório foram importados duas vezes (26/08 e 29/08), e a segunda
   vez trouxe uma coluna de ID que virou IDOrigem com valores "CUL-000001"… Como o IDOrigem é a
   identidade do exame, linhas com ID nunca colidem com linhas sem ID, e tudo entrou como novo.
   A limpeza vale SÓ para as linhas vindas do laboratório (sem IDOrigem, ou com esse ID falso):
   nas linhas da base do hospital, o ID do laboratório é confiável e exames repetidos no mesmo
   dia são exames distintos (par de hemoculturas, swabs de sítios diferentes) — essas não são tocadas. */
const culturas = bancos.culturas.culturas;
const sensibilidade = bancos.culturas.sensibilidade || [];
const sensPorCultura = new Map();
sensibilidade.forEach(s => {
  if (!sensPorCultura.has(s.ID_Cultura)) sensPorCultura.set(s.ID_Cultura, []);
  sensPorCultura.get(s.ID_Cultura).push(s);
});
const antibiograma = id => sensPorCultura.get(id) || [];
const temPainelCompleto = id => antibiograma(id).some(s => s.Resultado === 'S');
const idFalso = c => /^CUL-/.test(String(c.IDOrigem || ''));
const doLaboratorio = c => !String(c.IDOrigem || '').trim() || idFalso(c);

const grupos = new Map();
for (const c of culturas) {
  if (!doLaboratorio(c)) continue;
  const chave = [nP(c.Prontuario), String(c.DataColeta).slice(0, 10), normalizarTexto(c.Material),
    normalizarTexto(c.Microrganismo), normalizarTexto(c.Resultado)].join('|');
  if (!grupos.has(chave)) grupos.set(chave, []);
  grupos.get(chave).push(c);
}

const remover = new Set();
let antibiogramasPreservados = 0;
const exemplos = [];
for (const grupo of grupos.values()) {
  if (grupo.length < 2) continue;
  /* Fica a linha mais informativa: painel completo > qualquer antibiograma > mais antiga. */
  const ordenado = grupo.slice().sort((a, b) => {
    const painel = Number(temPainelCompleto(b.ID_Cultura)) - Number(temPainelCompleto(a.ID_Cultura));
    if (painel) return painel;
    const atb = antibiograma(b.ID_Cultura).length - antibiograma(a.ID_Cultura).length;
    if (atb) return atb;
    return String(a.ID_Cultura).localeCompare(String(b.ID_Cultura));
  });
  const manter = ordenado[0];
  for (const extra of ordenado.slice(1)) {
    /* O antibiograma só é descartado quando a linha que fica já tem um pelo menos tão bom. */
    if (antibiograma(extra.ID_Cultura).length && !antibiograma(manter.ID_Cultura).length) {
      antibiograma(extra.ID_Cultura).forEach(s => { s.ID_Cultura = manter.ID_Cultura; });
      sensPorCultura.set(manter.ID_Cultura, antibiograma(extra.ID_Cultura));
      antibiogramasPreservados++;
    } else {
      antibiograma(extra.ID_Cultura).forEach(s => { s._remover = true; });
    }
    if (!String(manter.MecanismoResistencia || '').trim() && String(extra.MecanismoResistencia || '').trim()) {
      manter.MecanismoResistencia = extra.MecanismoResistencia;
    }
    if (!String(manter.Antibiograma || '').trim() && extra.Antibiograma) manter.Antibiograma = extra.Antibiograma;
    if (!String(manter.AvaliacaoCCIH || '').trim() && String(extra.AvaliacaoCCIH || '').trim()) {
      manter.AvaliacaoCCIH = extra.AvaliacaoCCIH;
      manter.StatusRevisao = extra.StatusRevisao;
    }
    remover.add(extra.ID_Cultura);
    if (exemplos.length < 5) {
      exemplos.push(`${manter.Prontuario} · ${manter.DataColeta} · ${manter.Material} · ${manter.Microrganismo || '(negativa)'}`
        + ` — fica ${manter.ID_Cultura}, sai ${extra.ID_Cultura}`);
    }
  }
}
console.log(`\n=== reimportação do laboratório ===`);
console.log(`linhas vindas do laboratório: ${culturas.filter(doLaboratorio).length}`);
console.log(`culturas repetidas a descartar: ${remover.size}`);
console.log(`antibiogramas movidos para a linha que fica: ${antibiogramasPreservados}`);
exemplos.forEach(e => console.log('   ' + e));

/* decisões de isolamento que apontavam para a linha descartada */
let decisoesReapontadas = 0;
if (bancos.isolamentos) {
  const paraAlvo = new Map();
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const manter = grupo.find(c => !remover.has(c.ID_Cultura));
    if (!manter) continue;
    grupo.forEach(c => { if (remover.has(c.ID_Cultura)) paraAlvo.set(c.ID_Cultura, manter.ID_Cultura); });
  }
  for (const d of bancos.isolamentos.decisoes || []) {
    if (paraAlvo.has(d.ID_Cultura)) { d.ID_Cultura = paraAlvo.get(d.ID_Cultura); decisoesReapontadas++; }
  }
}

/* O IDOrigem falso sai: ele colide com o nosso próprio espaço de IDs e faria a próxima
   importação errar de novo. */
let idsFalsosLimpos = 0;
for (const c of culturas) {
  if (idFalso(c)) { c.IDOrigem = ''; idsFalsosLimpos++; }
}

bancos.culturas.culturas = culturas.filter(c => !remover.has(c.ID_Cultura));
bancos.culturas.sensibilidade = sensibilidade.filter(s => !s._remover && !remover.has(s.ID_Cultura));
bancos.culturas.sensibilidade.forEach(s => { delete s._remover; });

const painelDepois = bancos.culturas.culturas.filter(c => temPainelCompleto(c.ID_Cultura)).length;
const restantesPseudo = bancos.pacientes.pacientes.filter(p => imp.ehPseudoProntuario(p.Prontuario)).length;
console.log(`\n=== resultado ===`);
console.log(`culturas: ${culturas.length} → ${bancos.culturas.culturas.length}`);
console.log(`linhas de antibiograma: ${sensibilidade.length} → ${bancos.culturas.sensibilidade.length}`);
console.log(`culturas com painel completo: ${painelDepois} (antes: ${culturas.filter(c => temPainelCompleto(c.ID_Cultura)).length})`);
console.log(`IDs falsos "CUL-" limpos do campo IDOrigem: ${idsFalsosLimpos}`);
console.log(`decisões de isolamento reapontadas: ${decisoesReapontadas}`);
console.log(`pseudo-registros ainda sem par (laboratório não informa prontuário): ${restantesPseudo}`);

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

for (const nomeEsquema of ['pacientes', 'culturas', 'isolamentos'].filter(n => bancos[n])) {
  const arquivo = ESQUEMAS[nomeEsquema].arquivo;
  const backup = path.join(PASTA, 'backups', arquivo.replace('.xlsx', '.backup-antes-fusao-lab.xlsx'));
  fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
  if (!fs.existsSync(backup)) fs.copyFileSync(path.join(PASTA, arquivo), backup);
  gravar(nomeEsquema, bancos[nomeEsquema]);
  console.log(`gravado: ${arquivo}`);
}
for (const nomeEsquema of Object.keys(bancos)) {
  if (['pacientes', 'culturas', 'isolamentos'].includes(nomeEsquema)) continue;
  gravar(nomeEsquema, bancos[nomeEsquema]);
}
console.log('demais arquivos regravados com os prontuários unificados.');
