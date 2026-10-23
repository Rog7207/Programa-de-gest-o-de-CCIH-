/* Aplica a regra D1–D3 (cultura colhida até o 3º dia da internação = presente na admissão,
   salvo readmissão ≤30 d ou cirurgia ≤90 d) às culturas JÁ PENDENTES no banco — decisão da
   CCIH de 16/10/2026. As importações novas já aplicam sozinhas; isto é o retroativo.

   Só toca cultura PENDENTE, positiva e sem classificação (julgamento humano nunca muda).
   Por padrão só SIMULA; com --aplicar grava, depois de copiar culturas.xlsx para backups/.
   Multirresistente classificado pela regra continua na tela de isolamentos.

   Uso: PASTA_CCIH="/caminho/Dados CCIH" node scripts/aplicar-regra-admissao.js [--aplicar] */

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

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const aplicar = process.argv.includes('--aplicar');
const arqCulturas = path.join(PASTA, 'culturas.xlsx');
if (!fs.existsSync(arqCulturas)) { console.error('culturas.xlsx não encontrado em ' + PASTA); process.exit(2); }

const ler = (arquivo, aba) => {
  const wb = XLSX.read(fs.readFileSync(path.join(PASTA, arquivo)), { type: 'buffer' });
  return wb.Sheets[aba] ? XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '', raw: false }) : [];
};
const wbCul = XLSX.read(fs.readFileSync(arqCulturas), { type: 'buffer' });
const culturas = XLSX.utils.sheet_to_json(wbCul.Sheets.culturas, { defval: '', raw: false });
const internacoes = ler('pacientes.xlsx', 'internacoes');
const cirurgias = fs.existsSync(path.join(PASTA, 'cirurgias.xlsx')) ? ler('cirurgias.xlsx', 'cirurgias') : [];

const pendentesAntes = culturas.filter(c => c.StatusRevisao === 'pendente' && c.Microrganismo).length;
const r = imp.aplicarRegraAdmissao(culturas, internacoes, cirurgias);
const pendentesDepois = culturas.filter(c => c.StatusRevisao === 'pendente' && c.Microrganismo).length;
const mdr = culturas.filter(c => /^regra D1/.test(c.TriagemRegra || '') && String(c.MecanismoResistencia || '').trim()).length;

console.log(`Culturas pendentes com germe: ${pendentesAntes} → ${pendentesDepois}`);
console.log(`Classificadas como presente na admissão pela regra: ${r.classificadas} (${mdr} com mecanismo de resistência — continuam na tela de isolamentos)`);
console.log(`Exceções (readmissão ≤30 d ou cirurgia ≤90 d), seguem pendentes com o motivo: ${r.excecoes}`);
const porDia = {};
for (const c of culturas) { const m = /coleta em (D\d+)/.exec(c.TriagemRegra || ''); if (m && /^regra/.test(c.TriagemRegra)) porDia[m[1]] = (porDia[m[1]] || 0) + 1; }
console.log('Por dia da coleta:', JSON.stringify(porDia));

if (!aplicar) { console.log('\nSIMULAÇÃO — nada gravado. Rode com --aplicar para gravar (com backup).'); process.exit(0); }

const dirBackup = path.join(PASTA, 'backups');
fs.mkdirSync(dirBackup, { recursive: true });
const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const backup = path.join(dirBackup, `culturas.backup-antes-regra-admissao-d3-${carimbo}.xlsx`);
fs.copyFileSync(arqCulturas, backup);
/* Preserva todas as colunas e abas: reescreve só a aba culturas, com a coluna nova no fim. */
const colunas = esquemas.ESQUEMAS.culturas.abas.culturas.slice();
for (const c of culturas) for (const k of Object.keys(c)) if (!colunas.includes(k)) colunas.push(k);
wbCul.Sheets.culturas = XLSX.utils.json_to_sheet(culturas, { header: colunas });
/* XLSX.writeFile não acessa o disco nesta build carregada por require — grava o buffer. */
fs.writeFileSync(arqCulturas, XLSX.write(wbCul, { type: 'buffer', bookType: 'xlsx', compression: true }));
console.log(`\nGravado. Backup em ${backup}`);
