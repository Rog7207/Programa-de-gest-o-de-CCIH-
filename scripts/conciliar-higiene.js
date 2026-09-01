/* Põe as observações de higiene já gravadas na forma única do banco.

   O miniapp e a exportação do Vigispec usam os mesmos nomes de coluna com sentidos
   diferentes: no miniapp `Acao` guarda o insumo ("Álcool", "Água e sabão"),
   `TipoHigienizacao` guarda a técnica ("Simples") e `Momento` guarda o número da OMS.
   As observações do celular entravam no banco e sumiam do painel — contavam como
   "não higienizou" e criavam momentos chamados "1" e "3".

   Uso:  node scripts/conciliar-higiene.js            (simulação)
         node scripts/conciliar-higiene.js --aplicar  (grava, com backup)  */

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
const arquivo = path.join(PASTA, ESQUEMAS.higiene_maos.arquivo);

const wbEntrada = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
const banco = {};
wbEntrada.SheetNames.forEach(n => { banco[n] = XLSX.utils.sheet_to_json(wbEntrada.Sheets[n], { defval: '' }); });

console.log(`observações no banco: ${banco.observacoes.length}\n`);

const antes = { acao: new Map(), momento: new Map(), categoria: new Map() };
const depois = { acao: new Map(), momento: new Map(), categoria: new Map() };
const conta = (mapa, chave) => mapa.set(chave || '(vazio)', (mapa.get(chave || '(vazio)') || 0) + 1);

let alteradas = 0;
banco.observacoes = banco.observacoes.map(o => {
  conta(antes.acao, o.Acao); conta(antes.momento, o.Momento); conta(antes.categoria, o.Categoria);
  const nova = imp.normalizarObservacaoHigiene(o);
  if (['Acao', 'TipoHigienizacao', 'Momento', 'Categoria', 'Tecnica'].some(c => (o[c] || '') !== (nova[c] || ''))) alteradas++;
  conta(depois.acao, nova.Acao); conta(depois.momento, nova.Momento); conta(depois.categoria, nova.Categoria);
  return nova;
});

const mostrar = (titulo, mapa) => {
  console.log(titulo);
  [...mapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .forEach(([k, n]) => console.log('   ' + String(n).padStart(5), k));
};
mostrar('Acao ANTES:', antes.acao);
mostrar('Acao DEPOIS:', depois.acao);
mostrar('\nMomento ANTES:', antes.momento);
mostrar('Momento DEPOIS:', depois.momento);
mostrar('\nCategoria ANTES:', antes.categoria);
mostrar('Categoria DEPOIS:', depois.categoria);

const higienizou = banco.observacoes.filter(o => o.Acao === 'Higienizou').length;
console.log(`\nlinhas alteradas: ${alteradas}`);
console.log(`adesão depois: ${higienizou}/${banco.observacoes.length}`
  + ` = ${(higienizou / banco.observacoes.length * 100).toFixed(1)}%`);

if (!APLICAR) {
  console.log('\n(simulação — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const backup = path.join(PASTA, 'backups', 'higiene_maos.backup-antes-conciliacao.xlsx');
if (!fs.existsSync(backup)) fs.copyFileSync(arquivo, backup);

const wb = XLSX.utils.book_new();
for (const [aba, colunas] of Object.entries(ESQUEMAS.higiene_maos.abas)) {
  const linhas = (banco[aba] || []).map(o => {
    const limpo = {};
    colunas.forEach(col => { limpo[col] = o[col] === undefined ? '' : o[col]; });
    return limpo;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas, { header: colunas }), aba);
}
fs.writeFileSync(arquivo, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log(`\ngravado. Backup em ${backup}`);
