/* Exporta para UM arquivo de texto todas as evoluções MÉDICAS (categoria "E") que o banco
   conhece — a foto atual, os backups, a pasta congelada, os exports originais arquivados em
   importados/ e arquivos extras passados na linha de comando (--fonte=caminho). Pedido de
   05/10/2026: material para testar uma IA local na detecção de infecção.

   Deduplica por atendimento + data + texto. O arquivo sai DENTRO da pasta de dados
   (exportacoes/), nunca no repositório: o texto das evoluções tem nome de paciente.
   Uso: PASTA_CCIH=... node scripts/exportar-evolucoes-medicas.js [--fonte=/x/evoluc.xls]... */

const fs = require('fs');
const path = require('path');
const os = require('os');
const raiz = path.join(__dirname, '..');
const XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
global.XLSX = XLSX;
const esquemas = require(path.join(raiz, 'js', 'esquemas.js'));
global.TIPOS_RELATORIO = esquemas.TIPOS_RELATORIO;
global.CLASSES_TRIAGEM = esquemas.CLASSES_TRIAGEM;
const { normalizarTexto } = require(path.join(raiz, 'js', 'leitura.js'));
global.normalizarTexto = normalizarTexto;

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const extras = process.argv.filter(a => a.startsWith('--fonte=')).map(a => a.slice(8));

const evolucoes = new Map();   /* chave → { Atendimento, Prontuario, Setor, DataEvolucao, Autor, Texto, fontes: [] } */
const porFonte = {};
const chaveDe = e => [String(e.Atendimento || '').replace(/\D/g, ''), String(e.DataEvolucao || '').slice(0, 10), normalizarTexto(e.Texto).slice(0, 400)].join('|');
function juntar(lista, fonte) {
  let n = 0;
  for (const e of lista) {
    if (!String(e.Texto || '').trim()) continue;
    const k = chaveDe(e);
    if (!evolucoes.has(k)) { evolucoes.set(k, { ...e, fontes: [] }); n++; }
    const reg = evolucoes.get(k);
    if (!reg.fontes.includes(fonte)) reg.fontes.push(fonte);
    /* Texto mais longo vence (a foto do banco apara em TAMANHO_EVOLUCAO; o export cru não). */
    if (String(e.Texto).length > String(reg.Texto).length) reg.Texto = e.Texto;
    if (!reg.Prontuario && e.Prontuario) reg.Prontuario = e.Prontuario;
  }
  porFonte[fonte] = { lidas: lista.length, novas: n };
}

/* Foto do banco (evolucoes.xlsx e cópias): só a aba evolucoes, Categoria E. */
function doBanco(arquivo, fonte) {
  if (!fs.existsSync(arquivo)) return;
  const wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
  if (!wb.Sheets.evolucoes) return;
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets.evolucoes, { defval: '', raw: false }).filter(e => e.Categoria === 'E');
  juntar(linhas, fonte);
}

/* Export cru do Tasy: TODAS as linhas com "Ie evolucao clinica" = E (a foto guarda só a
   última; aqui entram todas), sem as inativadas. */
function doExport(arquivo, fonte) {
  if (!fs.existsSync(arquivo)) return false;
  let wb;
  try { wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer', raw: true }); } catch (e) { return false; }
  for (const nome of wb.SheetNames) {
    const m = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: '' });
    let cab = -1, col = {};
    for (let i = 0; i < Math.min(m.length, 5); i++) {
      const nomes = (m[i] || []).map(c => normalizarTexto(c));
      if (nomes.includes('nratendimento') && nomes.includes('dsevolucao')) { cab = i; nomes.forEach((n, j) => { col[n] = j; }); break; }
    }
    if (cab < 0) continue;
    const v = (l, n) => col[n] === undefined ? '' : (l[col[n]] == null ? '' : l[col[n]]);
    const dataDe = x => {
      const n = Number(x);
      if (isFinite(n) && n > 40000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 864e5).toISOString().slice(0, 10);
      const mm = String(x).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      return mm ? `${mm[3]}-${mm[2].padStart(2, '0')}-${mm[1].padStart(2, '0')}` : '';
    };
    const linhas = [];
    for (const l of m.slice(cab + 1)) {
      if (String(v(l, 'ieevolucaoclinica')).trim() !== 'E') continue;
      if (String(v(l, 'dtinativacao')).trim()) continue;
      linhas.push({ Atendimento: String(v(l, 'nratendimento')).replace(/\D/g, ''), Prontuario: '', Setor: String(v(l, 'dssetoratendimento')).trim(),
        DataEvolucao: dataDe(v(l, 'dtevolucao')), Autor: String(v(l, 'nmpessoaevolucao')).trim(), Texto: String(v(l, 'dsevolucao')) });
    }
    juntar(linhas, fonte);
    return true;
  }
  return false;
}

/* 1. Foto atual, backups e pasta congelada. */
doBanco(path.join(PASTA, 'evolucoes.xlsx'), 'banco atual');
const pastaBackups = path.join(PASTA, 'backups');
if (fs.existsSync(pastaBackups)) {
  for (const f of fs.readdirSync(pastaBackups).filter(f => /^evolucoes\..*\.xlsx$/.test(f))) doBanco(path.join(pastaBackups, f), 'backup ' + f);
}
const pai = path.dirname(PASTA);
for (const d of fs.readdirSync(pai).filter(d => d.startsWith(path.basename(PASTA) + ' - congelada'))) doBanco(path.join(pai, d, 'evolucoes.xlsx'), d);

/* 2. Originais arquivados pela importação (importados/AAAA-MM/*). */
const pastaImportados = path.join(PASTA, 'importados');
if (fs.existsSync(pastaImportados)) {
  for (const mes of fs.readdirSync(pastaImportados)) {
    const dir = path.join(pastaImportados, mes);
    if (!fs.statSync(dir).isDirectory()) continue;
    /* A importação arquiva com o nome original, às vezes sem extensão ("EVO", "evo"):
       tenta todos; o que não for export de evoluções é ignorado em silêncio. */
    for (const f of fs.readdirSync(dir)) {
      const arq = path.join(dir, f);
      if (fs.statSync(arq).isFile() && fs.statSync(arq).size > 1000) doExport(arq, 'importados/' + mes + '/' + f);
    }
  }
}
/* 3. Arquivos extras. */
for (const f of extras) { if (!doExport(f, 'extra ' + path.basename(f))) console.log('(não reconhecido como export de evoluções: ' + f + ')'); }

/* Prontuário pelo atendimento, quando o banco sabe. */
try {
  const wb = XLSX.read(fs.readFileSync(path.join(PASTA, 'pacientes.xlsx')), { type: 'buffer' });
  const pronDoAt = new Map();
  for (const i of XLSX.utils.sheet_to_json(wb.Sheets.internacoes, { defval: '', raw: false })) {
    const a = String(i.Atendimento || '').replace(/\D/g, ''), p = String(i.Prontuario || '').replace(/\D/g, '');
    if (a && p) pronDoAt.set(a, p);
  }
  for (const e of evolucoes.values()) if (!e.Prontuario) e.Prontuario = pronDoAt.get(String(e.Atendimento || '').replace(/\D/g, '')) || '';
} catch (e) { /* sem pacientes.xlsx */ }

const lista = [...evolucoes.values()].sort((a, b) => String(a.Atendimento).localeCompare(String(b.Atendimento)) || String(a.DataEvolucao).localeCompare(String(b.DataEvolucao)));
const hoje = new Date().toISOString().slice(0, 10);
const destinoDir = path.join(PASTA, 'exportacoes');
fs.mkdirSync(destinoDir, { recursive: true });
const destino = path.join(destinoDir, `evolucoes-medicas-${hoje}.txt`);
const cabecalho = [
  `# Evoluções médicas (categoria E) — ${lista.length} evoluções únicas, ${new Set(lista.map(e => e.Atendimento)).size} atendimentos`,
  `# Gerado em ${hoje} por scripts/exportar-evolucoes-medicas.js. CONTÉM DADOS DE PACIENTES — uso interno da CCIH.`,
  '# Fontes: ' + Object.entries(porFonte).map(([f, n]) => `${f} (${n.lidas} lidas, ${n.novas} novas)`).join('; '),
  '# Formato: uma evolução por bloco; linha "### atendimento | prontuário | setor | data | autor | fontes", depois o texto, depois uma linha em branco.',
  ''
];
const blocos = lista.map(e => `### ${e.Atendimento} | ${e.Prontuario || '?'} | ${e.Setor || '?'} | ${e.DataEvolucao || '?'} | ${e.Autor || '?'} | ${e.fontes.join(', ')}\n${String(e.Texto).replace(/\r\n?/g, '\n').trim()}\n`);
fs.writeFileSync(destino, cabecalho.join('\n') + blocos.join('\n'), 'utf-8');

console.log(`Fontes:`);
for (const [f, n] of Object.entries(porFonte)) console.log(`  ${f}: ${n.lidas} médicas lidas, ${n.novas} novas`);
console.log(`\nEvoluções médicas únicas: ${lista.length} (${new Set(lista.map(e => e.Atendimento)).size} atendimentos, ${lista.filter(e => e.Prontuario).length} com prontuário)`);
const datas = lista.map(e => e.DataEvolucao).filter(Boolean).sort();
console.log(`Período: ${datas[0]} a ${datas[datas.length - 1]}`);
console.log(`Arquivo: ${destino} (${Math.round(fs.statSync(destino).size / 1024)} KB)`);
