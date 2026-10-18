/* Reconcilia as passagens por setor JÁ gravadas (pedido de 18/10/2026): foto diária (2396) ×
   movimentação de pacientes (2536). Daqui em diante as importações fazem isso sozinhas
   (reconciliarPassagens, importacao.js); este script corrige o que já está no banco.

   Por padrão só SIMULA e mostra os números; com --aplicar grava denominadores.xlsx depois de
   copiar o arquivo para backups/. Preserva as outras abas do arquivo.

   Uso: PASTA_CCIH="/caminho/Dados CCIH" node scripts/reconciliar-passagens.js [--aplicar] */

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
const arqDen = path.join(PASTA, 'denominadores.xlsx');
if (!fs.existsSync(arqDen)) { console.error('denominadores.xlsx não encontrado em ' + PASTA); process.exit(2); }

const wbDen = XLSX.read(fs.readFileSync(arqDen), { type: 'buffer' });
const passagens = XLSX.utils.sheet_to_json(wbDen.Sheets.passagem_setor, { defval: '', raw: false });
const wbPac = XLSX.read(fs.readFileSync(path.join(PASTA, 'pacientes.xlsx')), { type: 'buffer' });
const internacoes = XLSX.utils.sheet_to_json(wbPac.Sheets.internacoes, { defval: '', raw: false });

const abertasAntes = passagens.filter(p => !String(p.SaidaSetor || '').trim()).length;
const r = imp.reconciliarPassagens(passagens, internacoes);
const abertasDepois = r.passagens.filter(p => !String(p.SaidaSetor || '').trim());
const atdAbertos = new Set(abertasDepois.map(p => imp.normalizarProntuario(p.Atendimento)));
const abertosPorAtd = {};
abertasDepois.forEach(p => { const a = imp.normalizarProntuario(p.Atendimento); abertosPorAtd[a] = (abertosPorAtd[a] || 0) + 1; });

console.log(`Passagens: ${passagens.length} → ${r.passagens.length}`);
console.log(`  inválidas retiradas (setor só com número ou entrada sem data): ${r.invalidas}`);
console.log(`  repetidas exatas retiradas: ${r.repetidas}`);
console.log(`  da foto cobertas pelo 2536 retiradas: ${r.cobertasPelo2536}`);
console.log(`  abertas fechadas pela passagem seguinte: ${r.fechadasPorPosterior}`);
console.log(`  abertas fechadas pela alta: ${r.fechadasPorAlta}`);
console.log(`Passagens abertas: ${abertasAntes} → ${abertasDepois.length} (${atdAbertos.size} atendimentos; com mais de uma aberta: ${Object.values(abertosPorAtd).filter(n => n > 1).length})`);
console.log(`Internações sem alta no censo: ${internacoes.filter(i => !String(i.DataAlta || '').trim()).length}`);

const mudancas = r.invalidas + r.repetidas + r.cobertasPelo2536 + r.fechadasPorPosterior + r.fechadasPorAlta;
if (!mudancas) { console.log('\nNada a corrigir — o banco já está reconciliado (as importações com o app atualizado fazem isso sozinhas).'); process.exit(0); }
if (!aplicar) { console.log('\nSIMULAÇÃO — nada gravado. Rode com --aplicar para gravar (com backup).'); process.exit(0); }
const dirBackup = path.join(PASTA, 'backups');
fs.mkdirSync(dirBackup, { recursive: true });
const backup = path.join(dirBackup, 'denominadores.backup-antes-reconciliar-passagens.xlsx');
fs.copyFileSync(arqDen, backup);
const colunas = esquemas.ESQUEMAS.denominadores.abas.passagem_setor.slice();
for (const p of r.passagens) for (const k of Object.keys(p)) if (!colunas.includes(k)) colunas.push(k);
wbDen.Sheets.passagem_setor = XLSX.utils.json_to_sheet(r.passagens, { header: colunas });
XLSX.writeFile(wbDen, arqDen);
console.log(`\nGravado. Backup em ${backup}`);
