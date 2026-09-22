/* Unificação em lote de identidades fragmentadas COM PROVA de internação — o mesmo que a aba
   Pacientes faz ("Unificações sugeridas" → Unificar), sem clicar. Achado de 22/09/2026: a
   leva de culturas anterior ao censo criou um paciente por número de atendimento/laudo;
   sugerirUnificacoes (com culturas) só sugere quando há prova — cultura do registro órfão
   dentro de internação do homônimo, ou número que é o atendimento de internação dele.

   Para cada par de→para: o prontuário é reescrito em TODOS os arquivos que têm coluna
   Prontuario (mesma lista que unificarProntuarios em ui-abas.js) e, no cadastro, os registros
   que passaram a dividir o prontuário viram um só (fica o mais antigo, completado).

   Roda em simulação por padrão; grava só com --aplicar (backup de cada arquivo antes).
   PASTA_CCIH escolhe a pasta de dados. */

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

function ler(nome) {
  const arquivo = path.join(PASTA, ESQUEMAS[nome].arquivo);
  if (!fs.existsSync(arquivo)) return null;
  const wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
  const banco = {};
  wb.SheetNames.forEach(aba => { banco[aba] = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '', raw: false }); });
  return banco;
}

/* Grava preservando abas e colunas extras (mesmo cuidado dos outros scripts). */
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
  const backup = path.join(PASTA, 'backups', esquema.arquivo.replace('.xlsx', '.backup-antes-unificar-identidades.xlsx'));
  fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
  if (!fs.existsSync(backup)) fs.copyFileSync(destino, backup);
  fs.writeFileSync(destino, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

console.log(`Pasta: ${PASTA}${APLICAR ? '' : '   (SIMULAÇÃO — use --aplicar para gravar)'}\n`);

const bancoPac = ler('pacientes');
const bancoCul = ler('culturas') || { culturas: [] };
const sugestoes = imp.sugerirUnificacoes(bancoPac.pacientes || [], bancoPac.internacoes || [], bancoCul.culturas || []);
const mapa = new Map();
for (const s of sugestoes) {
  const de = np(s.de), para = np(s.para);
  if (de && para && de !== para) mapa.set(de, para);
}
const destinoDe = inicio => {
  let atual = mapa.get(inicio);
  const vistos = new Set([inicio]);
  while (mapa.has(atual) && !vistos.has(atual)) { vistos.add(atual); atual = mapa.get(atual); }
  return atual;
};
const porMotivo = {};
sugestoes.forEach(s => { const m = String(s.motivo || 'número é atendimento').replace(/\d+ de \d+/, 'n de m'); porMotivo[m] = (porMotivo[m] || 0) + 1; });
console.log(`Pares sugeridos (com prova): ${mapa.size}`);
Object.entries(porMotivo).forEach(([m, n]) => console.log(`  ${String(n).padStart(5)}  ${m}`));
if (!mapa.size) { console.log('\nNada a unificar.'); process.exit(0); }

const esquemasComProntuario = Object.keys(ESQUEMAS).filter(nome =>
  nome !== 'config' && Object.values(ESQUEMAS[nome].abas).some(colunas => colunas.includes('Prontuario')));
const alvos = new Set([...mapa.keys()].map(destinoDe));
let totalLinhas = 0, fundidos = 0;
const porArquivo = [];
for (const nome of esquemasComProntuario) {
  const banco = nome === 'pacientes' ? bancoPac : (nome === 'culturas' ? bancoCul : ler(nome));
  if (!banco) continue;
  let linhas = 0;
  for (const [aba, colunas] of Object.entries(ESQUEMAS[nome].abas)) {
    if (!colunas.includes('Prontuario')) continue;
    for (const linha of banco[aba] || []) {
      const atual = np(linha.Prontuario);
      if (mapa.has(atual)) { linha.Prontuario = destinoDe(atual); linhas++; }
    }
  }
  if (nome === 'pacientes') {
    const porProntuario = new Map();
    for (const p of banco.pacientes) {
      const chave = np(p.Prontuario);
      if (!alvos.has(chave)) continue;
      if (!porProntuario.has(chave)) porProntuario.set(chave, []);
      porProntuario.get(chave).push(p);
    }
    const descartar = new Set();
    for (const grupo of porProntuario.values()) {
      if (grupo.length < 2) continue;
      const principal = grupo.slice().sort((a, b) => String(a.CriadoEm || '').localeCompare(String(b.CriadoEm || '')))[0];
      for (const outro of grupo) {
        if (outro === principal) continue;
        for (const campo of ['Nome', 'Telefone', 'DataNascimento', 'Sexo']) {
          if (!principal[campo] && outro[campo]) principal[campo] = outro[campo];
        }
        descartar.add(outro);
        fundidos++;
      }
    }
    if (descartar.size) banco.pacientes = banco.pacientes.filter(p => !descartar.has(p));
  }
  if (linhas || (nome === 'pacientes' && fundidos)) porArquivo.push([nome, banco, linhas]);
  totalLinhas += linhas;
}
console.log(`\nLinhas que mudam de prontuário: ${totalLinhas}; registros de paciente fundidos: ${fundidos}`);
porArquivo.forEach(([nome, , linhas]) => console.log(`  ${ESQUEMAS[nome].arquivo}: ${linhas}`));

if (!APLICAR) { console.log('\nNada gravado (simulação).'); process.exit(0); }
for (const [nome, banco] of porArquivo) gravar(nome, banco);
console.log(`\nGravado: ${porArquivo.map(([n]) => ESQUEMAS[n].arquivo).join(', ')} (backups em backups/).`);
console.log('No aplicativo: recarregar (Ctrl+Shift+R) e reabrir a pasta.');
