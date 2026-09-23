/* Corrige as culturas que a importação da base (25/08/2026) marcou como "Não é cultura" e
   descartou (decisão da CCIH, 23/09/2026):
   - "Bacterioscopia"/BAAR (Gram) da base → Informativa, status triagem (visível, fora da fila);
   - alias venenoso "Levedura" → __NAO_CULTURA__ é apagado e as hemoculturas com Levedura
     voltam para a fila (pendente): levedura em hemocultura é achado relevante até sair a espécie;
   - "Positivo (++)" e "Microrganismo isolado" continuam "Não é cultura" (é ruído).
   Simulação por padrão; --aplicar grava com backup. PASTA_CCIH escolhe a pasta. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const raiz = path.join(__dirname, '..');
const XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
const { normalizarTexto } = require(path.join(raiz, 'js', 'leitura.js'));
const { ESQUEMAS } = require(path.join(raiz, 'js', 'esquemas.js'));
const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const RUIDO = new Set(['positivo(++)', 'microrganismoisolado']);

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
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas.map(o => { const s = {}; colunas.forEach(c => { s[c] = o[c] == null ? '' : String(o[c]); }); return s; }), { header: colunas }), aba);
  }
  const destino = path.join(PASTA, esquema.arquivo);
  const backup = path.join(PASTA, 'backups', esquema.arquivo.replace('.xlsx', '.backup-antes-corrigir-nao-e-cultura.xlsx'));
  fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
  if (!fs.existsSync(backup)) fs.copyFileSync(destino, backup);
  fs.writeFileSync(destino, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

console.log(`Pasta: ${PASTA}${APLICAR ? '' : '   (SIMULAÇÃO — use --aplicar para gravar)'}\n`);
const bCul = ler('culturas'), bCfg = ler('config');
let informativas = 0, pendentes = 0, ruido = 0;
for (const c of bCul.culturas || []) {
  if (c.AvaliacaoCCIH !== 'Não é cultura') continue;
  const m = normalizarTexto(c.Microrganismo);
  if (RUIDO.has(m) || !m) { ruido++; continue; }
  if (m === 'levedura') { c.AvaliacaoCCIH = ''; c.StatusRevisao = 'pendente'; pendentes++; continue; }
  c.AvaliacaoCCIH = 'Informativa'; c.StatusRevisao = 'triagem'; informativas++;
}
const antes = (bCfg.aliases || []).length;
bCfg.aliases = (bCfg.aliases || []).filter(a => !(a.Campo === 'microrganismos' && normalizarTexto(a.De) === 'levedura' && a.Para === '__NAO_CULTURA__'));
console.log(`Gram/BAAR → Informativa (triagem): ${informativas}`);
console.log(`Levedura → pendente (volta à fila): ${pendentes}`);
console.log(`Ruído mantido como "Não é cultura": ${ruido}`);
console.log(`Alias "Levedura → não é cultura" removido: ${antes - bCfg.aliases.length}`);
if (!APLICAR) { console.log('\nNada gravado (simulação).'); process.exit(0); }
gravar('culturas', bCul); gravar('config', bCfg);
console.log('\nGravado: culturas.xlsx e config.xlsx (backups em backups/).');
