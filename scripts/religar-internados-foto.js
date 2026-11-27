/* Internados que sumiam da lista do setor (27/11/2026): a foto 2396 só traz o atendimento, e o
   censo 50023 só o movimento do dia — quem internou num dia sem censo carregado não tinha
   internação no banco e a tela o descartava (no dia: 47 de 263 atendimentos, 6 dos 27 do CTI).

   O que o script faz, uma vez, com o que já está arquivado em importados/:
   1. lê TODOS os 2536 arquivados e monta atendimento → prontuário (+ nome);
   2. grava o prontuário nas passagens (denominadores.passagem_setor) que não o tinham;
   3. reaplica a ÚLTIMA foto 2396 arquivada (ou --foto=caminho): a internação que faltava é
      criada com o prontuário do 2536 e a data de entrada da foto (aplicarFotoInternados);
   4. cria o cadastro (prontuário + nome) de quem ainda não tinha.
   Daqui para frente o app faz o mesmo sozinho a cada 2536 + 2396.

   Uso:  PASTA_CCIH="/caminho/Dados CCIH" node scripts/religar-internados-foto.js [--foto=...xls]            (simulação)
         PASTA_CCIH="/caminho/Dados CCIH" node scripts/religar-internados-foto.js [--foto=...xls] --aplicar  (grava, com backup) */

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
global.linhaDeItens = leitura.linhaDeItens;
const imp = require(path.join(raiz, 'js', 'importacao.js'));
global.normalizarProntuario = imp.normalizarProntuario;
const N = imp.normalizarProntuario;

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const FOTO = (process.argv.find(a => a.startsWith('--foto=')) || '').slice(7);
const QUEM = process.env.USUARIO_CCIH || 'script religar-internados-foto';
const agora = new Date().toISOString().slice(0, 16).replace('T', ' ');

const lerBanco = nome => {
  const wb = XLSX.read(fs.readFileSync(path.join(PASTA, nome + '.xlsx')), { type: 'buffer' });
  const banco = {};
  wb.SheetNames.forEach(n => { banco[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: false }); });
  return { banco, abas: wb.SheetNames };
};
const gravarBanco = (nome, banco, abasOriginais, carimbo) => {
  const arquivo = path.join(PASTA, nome + '.xlsx');
  fs.copyFileSync(arquivo, path.join(PASTA, 'backups', `${nome}.backup-antes-religar-internados-${carimbo}.xlsx`));
  const saida = XLSX.utils.book_new();
  const abasEsquema = esquemas.ESQUEMAS[nome].abas;
  for (const [aba, colunas] of Object.entries(abasEsquema)) {
    const extras = [...new Set((banco[aba] || []).flatMap(o => Object.keys(o)))].filter(k => !colunas.includes(k) && !k.startsWith('_'));
    const todas = colunas.concat(extras);
    const linhas = (banco[aba] || []).map(o => { const limpo = {}; todas.forEach(k => { limpo[k] = o[k] === undefined ? '' : o[k]; }); return limpo; });
    XLSX.utils.book_append_sheet(saida, XLSX.utils.json_to_sheet(linhas, { header: todas }), aba);
  }
  for (const aba of abasOriginais) if (!abasEsquema[aba]) XLSX.utils.book_append_sheet(saida, XLSX.utils.json_to_sheet(banco[aba]), aba);
  fs.writeFileSync(arquivo, XLSX.write(saida, { type: 'buffer', bookType: 'xlsx', compression: true }));
};

/* 1. atendimento → prontuário pelos 2536 arquivados */
const dirImp = path.join(PASTA, 'importados');
const arquivos = [];
for (const mes of fs.readdirSync(dirImp)) {
  const dir = path.join(dirImp, mes);
  if (fs.statSync(dir).isDirectory()) fs.readdirSync(dir).forEach(a => arquivos.push(path.join(dir, a)));
}
const identidade = new Map();
for (const a of arquivos.filter(a => /2536/.test(path.basename(a))).sort()) {
  try {
    const r = imp.lerMovimentacaoPacientes(leitura.lerBruto(fs.readFileSync(a), path.basename(a), 'auto').linhas);
    for (const l of r.linhas) if (l.Prontuario) identidade.set(l.Atendimento, { pront: l.Prontuario, nome: l.NomePaciente });
  } catch (e) { console.log('2536 ilegível:', path.basename(a), e.message); }
}
console.log(`2536 arquivados: ${fmt(identidade.size)} atendimentos com prontuário`);

/* 2. prontuário nas passagens */
const { banco: den, abas: abasDen } = lerBanco('denominadores');
let passagensCompletadas = 0;
for (const p of den.passagem_setor || []) {
  if (String(p.Prontuario || '').trim()) continue;
  const id = identidade.get(N(p.Atendimento));
  if (id) { p.Prontuario = id.pront; passagensCompletadas++; }
}
console.log(`passagens que ganharam o prontuário: ${fmt(passagensCompletadas)}`);

/* 3. última foto */
const fotoArq = FOTO || arquivos.filter(a => /-2396-/.test(path.basename(a))).sort((x, y) => path.basename(x).localeCompare(path.basename(y))).pop();
if (!fotoArq) { console.log('Nenhuma foto 2396 arquivada.'); process.exit(1); }
const m = /2396-(20\d{2})(\d{2})(\d{2})/.exec(path.basename(fotoArq));
const dataFoto = m ? `${m[1]}-${m[2]}-${m[3]}` : new Date().toISOString().slice(0, 10);
const foto = imp.lerFotoInternados(leitura.lerBruto(fs.readFileSync(fotoArq), path.basename(fotoArq), 'auto').linhas);
const { banco: pac, abas: abasPac } = lerBanco('pacientes');
const prontuarioPorAtendimento = new Map([...identidade].map(([a, v]) => [a, v.pront]));
const r = imp.aplicarFotoInternados(foto.linhas, dataFoto, { pacientes: pac, denominadores: den, prontuarioPorAtendimento }, QUEM, agora);
console.log(`foto ${path.basename(fotoArq)} (${dataFoto}): ${fmt(foto.linhas.length)} atendimentos; `
  + `${fmt(r.internacoesCriadas)} internações criadas, ${fmt(r.desconhecidos)} ainda sem prontuário`);

/* 4. cadastro de quem não tinha */
const cadastro = new Map(pac.pacientes.map(p => [N(p.Prontuario), p]));
let cadastrosNovos = 0, nomesCompletados = 0;
for (const f of foto.linhas) {
  const id = identidade.get(f.Atendimento);
  if (!id) continue;
  const ex = cadastro.get(id.pront);
  if (!ex) { const n = { Prontuario: id.pront, Nome: id.nome || '', CriadoPor: QUEM, CriadoEm: agora }; pac.pacientes.push(n); cadastro.set(id.pront, n); cadastrosNovos++; }
  else if (!String(ex.Nome || '').trim() && id.nome) { ex.Nome = id.nome; nomesCompletados++; }
}
console.log(`cadastros criados: ${fmt(cadastrosNovos)}, nomes completados: ${fmt(nomesCompletados)}`);
const porSetor = {};
for (const f of foto.linhas) {
  const s = porSetor[f.Setor] || (porSetor[f.Setor] = { foto: 0, comInternacao: 0 });
  s.foto++;
  if (pac.internacoes.some(i => N(i.Atendimento) === f.Atendimento)) s.comInternacao++;
}
Object.entries(porSetor).sort((a, b) => b[1].foto - a[1].foto)
  .forEach(([s, o]) => console.log(`  ${s.padEnd(42)} ${o.comInternacao}/${o.foto}`));

if (!APLICAR) { console.log('\nSIMULAÇÃO — nada gravado. Rode com --aplicar para gravar (com backup).'); process.exit(0); }
fs.mkdirSync(path.join(PASTA, 'backups'), { recursive: true });
const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
gravarBanco('denominadores', den, abasDen, carimbo);
gravarBanco('pacientes', pac, abasPac, carimbo);
console.log('\nGravado. Backups em backups/.');

function fmt(n) { return Number(n).toLocaleString('pt-BR'); }
