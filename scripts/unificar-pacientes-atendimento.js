/* Unifica os pacientes criados com o Nº DO ATENDIMENTO no lugar do prontuário.

   Origem do problema: a leva de culturas importada em 25/08/2026 trazia o atendimento no
   campo de prontuário — cada internação virou um "paciente" novo (mesma pessoa com 2-3
   registros). A ligação atendimento → prontuário vem das internações importadas, então a
   troca é determinística; o nome só serve de trava (divergência real fica de fora e é
   listada para revisão).

   Reescreve o Prontuario em TODOS os bancos que têm a coluna (culturas, iras, cirurgias…)
   e funde os cadastros que passam a dividir o mesmo prontuário (fica o mais antigo,
   completado com o que faltava). Mesma regra do botão "Unificar" da aba Pacientes.

   Simulação por padrão; --aplicar grava com backup por arquivo. PASTA_CCIH aponta para
   outra pasta de dados (ex.: banco da Unimed). */

const fs = require('fs');
const path = require('path');
const os = require('os');

global.XLSX = require(path.join(__dirname, '..', 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(__dirname, '..', 'js', 'esquemas.js'));
const leitura = require(path.join(__dirname, '..', 'js', 'leitura.js'));
global.normalizarTexto = leitura.normalizarTexto;
global.CLASSES_TRIAGEM = esquemas.CLASSES_TRIAGEM;
const imp = require(path.join(__dirname, '..', 'js', 'importacao.js'));

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const ESQUEMAS = esquemas.ESQUEMAS;
const N = imp.normalizarProntuario;
/* --forcar DE=PARA (repetível): aplica um par que caiu em conflito de nome, DEPOIS de o
   usuário conferir os dois nomes e confirmar que é a mesma pessoa. */
const FORCADOS = process.argv.filter(a => /^\d+=\d+$/.test(a) || a.startsWith('--forcar='))
  .map(a => a.replace('--forcar=', ''))
  .map(a => a.split('=')).filter(p => p.length === 2);

const lerBancoXlsx = arquivo => {
  const wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
  const banco = {};
  wb.SheetNames.forEach(n => { banco[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }); });
  return banco;
};

const bancoPac = lerBancoXlsx(path.join(PASTA, ESQUEMAS.pacientes.arquivo));
const { pares, conflitos } = imp.paresAtendimentoProntuario(bancoPac.pacientes || [], bancoPac.internacoes || []);
console.log(`pasta: ${PASTA}`);
console.log(`pacientes: ${(bancoPac.pacientes || []).length} · unificáveis pelo atendimento: ${pares.length} · conflitos de nome (ficam de fora): ${conflitos.length}\n`);
if (conflitos.length) {
  console.log('CONFLITOS — o número casa com um atendimento, mas o NOME é de outra pessoa.');
  console.log('Na maioria é coincidência de número (prontuário real × atendimento antigo): NÃO unificar.');
  console.log('Se os dois nomes forem a mesma pessoa (grafia/abreviação), rode de novo com --forcar DE=PARA:\n');
  for (const c of conflitos) {
    console.log(`  ${String(c.de).padEnd(9)} "${c.nome || '(sem nome)'}"`);
    console.log(`  → ${String(c.para).padEnd(7)} "${c.nomePara || '(sem nome)'}"\n`);
  }
}

const mapa = new Map(pares.map(p => [N(p.de), N(p.para)]));
for (const [de, para] of FORCADOS) {
  const c = conflitos.find(x => N(x.de) === N(de) && N(x.para) === N(para));
  if (!c) { console.log(`--forcar ${de}=${para} IGNORADO: não é um dos conflitos listados.`); continue; }
  mapa.set(N(de), N(para));
  console.log(`forçado (confirmado pelo usuário): ${de} → ${para}`);
}
if (!mapa.size) { console.log('nada a unificar.'); process.exit(0); }

/* Reescreve o prontuário em todos os bancos com a coluna, como unificarProntuarios faz. */
const bancosComProntuario = Object.keys(ESQUEMAS).filter(nome =>
  nome !== 'config' && Object.values(ESQUEMAS[nome].abas).some(colunas => colunas.includes('Prontuario')));
const alterados = {};
const bancosLidos = {};

for (const nome of bancosComProntuario) {
  const arquivo = path.join(PASTA, ESQUEMAS[nome].arquivo);
  if (!fs.existsSync(arquivo)) continue;
  const banco = nome === 'pacientes' ? bancoPac : lerBancoXlsx(arquivo);
  bancosLidos[nome] = banco;
  let linhas = 0;
  for (const [aba, colunas] of Object.entries(ESQUEMAS[nome].abas)) {
    if (!colunas.includes('Prontuario')) continue;
    for (const linha of (banco[aba] || [])) {
      const k = N(linha.Prontuario);
      if (mapa.has(k)) { linha.Prontuario = mapa.get(k); linhas++; }
    }
  }
  if (linhas) alterados[nome] = linhas;
}

/* Funde os cadastros que agora dividem o mesmo prontuário: fica o mais antigo,
   completado com o que faltava nele. */
const alvos = new Set(mapa.values());
const porProntuario = new Map();
for (const p of (bancoPac.pacientes || [])) {
  const k = N(p.Prontuario);
  if (!alvos.has(k)) continue;
  if (!porProntuario.has(k)) porProntuario.set(k, []);
  porProntuario.get(k).push(p);
}
const descartar = new Set();
let fundidos = 0;
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
    fundidos++;
  }
}
if (descartar.size) bancoPac.pacientes = bancoPac.pacientes.filter(p => !descartar.has(p));

console.log('\nlinhas com prontuário reescrito, por banco:');
Object.entries(alterados).forEach(([nome, n]) => console.log('  ' + String(n).padStart(6) + '  ' + nome));
console.log(`cadastros fundidos: ${fundidos} → pacientes depois: ${bancoPac.pacientes.length}`);

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
for (const nome of Object.keys(alterados)) {
  const arquivo = path.join(PASTA, ESQUEMAS[nome].arquivo);
  const backup = path.join(PASTA, 'backups', ESQUEMAS[nome].arquivo.replace('.xlsx', '.backup-antes-unificar-atendimento.xlsx'));
  if (!fs.existsSync(backup)) fs.copyFileSync(arquivo, backup);
  const banco = bancosLidos[nome];
  const wb = XLSX.utils.book_new();
  for (const [aba, colunas] of Object.entries(ESQUEMAS[nome].abas)) {
    const linhas = (banco[aba] || []).map(o => {
      const limpo = {};
      colunas.forEach(col => { limpo[col] = o[col] === undefined ? '' : o[col]; });
      return limpo;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
  }
  fs.writeFileSync(arquivo, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  console.log(`gravado: ${ESQUEMAS[nome].arquivo} (backup em backups/)`);
}
