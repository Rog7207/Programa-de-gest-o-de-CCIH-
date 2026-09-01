/* Aplica a triagem automática (negativa / colonização / água / leite) às culturas que já
   estão no banco, para que o histórico siga a mesma regra da importação daqui para a frente.

   Só mexe em linha ainda sem julgamento humano: pendente, ou já em triagem (para reaplicar
   a regra quando ela mudar). Linha 'avaliada' e 'descartada' fica intacta — o que a CCIH
   classificou vale mais que a regra.

   Uso:  node scripts/triar-culturas.js            (simulação)
         node scripts/triar-culturas.js --aplicar  (grava, com backup)  */

const fs = require('fs');
const path = require('path');

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

const PASTA = '/home/rogerio/Documentos/Dados CCIH HNSC';
const APLICAR = process.argv.includes('--aplicar');
const ESQUEMAS = esquemas.ESQUEMAS;
const arquivo = path.join(PASTA, ESQUEMAS.culturas.arquivo);

const wbEntrada = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
const banco = {};
wbEntrada.SheetNames.forEach(n => { banco[n] = XLSX.utils.sheet_to_json(wbEntrada.Sheets[n], { defval: '' }); });

const casos = fs.existsSync(path.join(PASTA, ESQUEMAS.sepse.arquivo))
  ? XLSX.utils.sheet_to_json(
      XLSX.read(fs.readFileSync(path.join(PASTA, ESQUEMAS.sepse.arquivo)), { type: 'buffer' }).Sheets.casos,
      { defval: '' })
  : [];
const sepse = imp.indiceSepse(casos);

console.log(`culturas no banco: ${banco.culturas.length}`);
console.log(`casos de sepse para cruzar: ${casos.length}\n`);

/* As linhas com status 'avaliada' foram classificadas pela CCIH, uma a uma — inclusive as
   ~28 mil marcadas como Negativa ou Colonização, que à primeira vista parecem saída de
   rodada automática. Não são. Nenhuma delas é tocada aqui, nem para "corrigir" procedência. */
const contagem = {};
const conta = k => { contagem[k] = (contagem[k] || 0) + 1; };
let alteradas = 0;

for (const c of banco.culturas) {
  if (c.StatusRevisao !== 'pendente' && c.StatusRevisao !== 'triagem') {
    conta('preservada (' + c.StatusRevisao + ')');
    continue;
  }
  const classe = imp.preClassificarCultura(c);
  if (!classe) { conta('segue pendente (precisa de revisão)'); continue; }
  if (c.AvaliacaoCCIH === classe && c.StatusRevisao === 'triagem') { conta('já triada como ' + classe); continue; }
  c.AvaliacaoCCIH = classe;
  c.StatusRevisao = 'triagem';
  alteradas++;
  conta('→ ' + classe);
}

Object.entries(contagem).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(String(n).padStart(7), k));
console.log(`\nlinhas classificadas pela triagem: ${alteradas}`);
const pendentes = banco.culturas.filter(c => c.StatusRevisao === 'pendente').length;
const noPainel = banco.culturas.filter(c => imp.culturaDoPainel(c));
const marcadas = banco.culturas.filter(c => imp.culturaDeProtocoloSepse(c, sepse));
console.log(`\nfila de revisão depois da triagem: ${pendentes}`);
console.log(`entram no painel (possível infecção): ${noPainel.length}`);
console.log(`colhidas em protocolo de sepse: ${marcadas.length}`
  + ` — destas, ${marcadas.filter(c => !imp.culturaDoPainel(c)).length} só aparecem por serem do protocolo`);

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const backup = path.join(PASTA, 'backups', 'culturas.backup-antes-triagem.xlsx');
if (!fs.existsSync(backup)) fs.copyFileSync(arquivo, backup);

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
console.log(`\ngravado. Backup em ${backup}`);
