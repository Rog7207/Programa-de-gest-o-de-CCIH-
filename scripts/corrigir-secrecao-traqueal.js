/* Culturas que entraram como "Secreção traqueal" sem ser (11/11/2026): no histórico (BASE
   UNIFICADA de 24/08/2026) o material cru era "Secreção" — genérico — e o de-para da época o
   mandou para "Secreção traqueal". O sítio agrupado do laboratório denuncia o erro: "Pele e
   Partes Moles", "Sistema Nervoso Central", "Osteoarticular" não são aspirado traqueal.

   Regra: Material = "Secreção traqueal" e Sitio não pulmonar → "Secreção de partes moles" (sítio
   Pele e Partes Moles) ou "Secreção (sítio não informado)" (outros sítios). Sitio vazio: só corrige
   quando o arquivo de origem (--base=caminho.xlsx) diz que o material cru não era traqueal.
   Tudo com rastro em HistoricoEdicao (editarRegistro).

   Uso:  PASTA_CCIH="/caminho/Dados CCIH" node scripts/corrigir-secrecao-traqueal.js [--base=...xlsx]           (simulação)
         PASTA_CCIH="/caminho/Dados CCIH" node scripts/corrigir-secrecao-traqueal.js [--base=...xlsx] --aplicar (grava, com backup) */

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
const APLICAR = process.argv.includes('--aplicar');
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').slice(7);
const QUEM = process.env.USUARIO_CCIH || 'script corrigir-secrecao-traqueal';
const arquivo = path.join(PASTA, 'culturas.xlsx');

const wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
const banco = {};
wb.SheetNames.forEach(n => { banco[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }); });

/* Material cru por ID de origem, quando o arquivo de origem for informado. */
const cruPorOrigem = new Map();
if (BASE) {
  const wbB = XLSX.read(fs.readFileSync(BASE), { type: 'buffer' });
  for (const n of wbB.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json(wbB.Sheets[n], { defval: '' });
    for (const l of linhas) {
      const id = String(l.IDOrigem || l['ID'] || l['Id'] || l['Requisição'] || l['Requisicao'] || Object.values(l)[0] || '').trim();
      const mat = l.Material || l.material || l['Material'] || '';
      if (id && mat) cruPorOrigem.set(id, String(mat).trim());
    }
  }
  console.log(`arquivo de origem: ${cruPorOrigem.size} materiais crus por ID`);
}

const PULMONAR = /pulmon|respirat|traque/i;
const quando = new Date().toISOString().slice(0, 16).replace('T', ' ');
const porDestino = {};
let corrigidas = 0, semSitioMantidas = 0;
for (const c of banco.culturas.filter(c => c.Material === 'Secreção traqueal')) {
  const sitio = String(c.Sitio || '').trim();
  const cru = cruPorOrigem.get(String(c.IDOrigem || '').trim()) || '';
  let novo = '';
  if (sitio && !PULMONAR.test(sitio)) novo = /pele|partes moles/i.test(sitio) ? 'Secreção de partes moles' : 'Secreção (sítio não informado)';
  else if (!sitio && cru && !/traque|aspirado/i.test(cru)) novo = /ferida|operat/i.test(cru) ? 'Ferida operatória' : 'Secreção (sítio não informado)';
  else if (!sitio) { semSitioMantidas++; continue; }
  if (!novo) continue;
  const r = imp.editarRegistro(banco.culturas, { ID_Cultura: c.ID_Cultura }, { Material: novo },
    { quem: QUEM, quando, nota: `material cru "${cru || 'Secreção'}" com sítio "${sitio || '—'}" não é aspirado traqueal` });
  if (r.alteracoes.length) { corrigidas++; porDestino[novo] = (porDestino[novo] || 0) + 1; }
}
console.log(`"Secreção traqueal" no banco: ${banco.culturas.filter(c => c.Material === 'Secreção traqueal' || Object.keys(porDestino).includes(c.Material)).length}`);
console.log(`corrigidas: ${corrigidas}`, porDestino, `| sem sítio mantidas: ${semSitioMantidas}`);
if (!APLICAR) { console.log('\nSIMULAÇÃO — nada gravado. Rode com --aplicar para gravar (com backup).'); process.exit(0); }
if (!corrigidas) { console.log('Nada a corrigir.'); process.exit(0); }
fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
fs.copyFileSync(arquivo, path.join(PASTA, 'backups', `culturas.backup-antes-secrecao-traqueal-${carimbo}.xlsx`));
const saida = XLSX.utils.book_new();
for (const [aba, colunas] of Object.entries(esquemas.ESQUEMAS.culturas.abas)) {
  const linhas = (banco[aba] || []).map(o => { const limpo = {}; colunas.forEach(k => { limpo[k] = o[k] === undefined ? '' : o[k]; }); return limpo; });
  XLSX.utils.book_append_sheet(saida, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
}
for (const aba of wb.SheetNames) if (!esquemas.ESQUEMAS.culturas.abas[aba]) XLSX.utils.book_append_sheet(saida, XLSX.utils.json_to_sheet(banco[aba]), aba);
fs.writeFileSync(arquivo, XLSX.write(saida, { type: 'buffer', bookType: 'xlsx', compression: true }));
console.log('\nGravado. Backup em backups/.');
