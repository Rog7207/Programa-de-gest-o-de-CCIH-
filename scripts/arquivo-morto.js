/* Arquivo morto pela linha de comando (27/11/2026): o mesmo que o botão de Configurações →
   "Arquivo morto", com o MESMO código do aplicativo (excel.js + arquivo-morto.js) sobre a
   pasta de dados no disco. Útil para a primeira vez numa pasta grande, fora do navegador.

   Uso:  PASTA_CCIH="/caminho/Dados CCIH" node scripts/arquivo-morto.js            (simulação)
         PASTA_CCIH="/caminho/Dados CCIH" node scripts/arquivo-morto.js --aplicar  (grava, com backup) */

const fs = require('fs');
const path = require('path');
const os = require('os');
const raiz = path.join(__dirname, '..');
global.XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(raiz, 'js', 'esquemas.js'));
global.ESQUEMAS = esquemas.ESQUEMAS;
const leitura = require(path.join(raiz, 'js', 'leitura.js'));
global.normalizarTexto = leitura.normalizarTexto;
Object.assign(global, { TIPOS_RELATORIO: esquemas.TIPOS_RELATORIO, CLASSES_TRIAGEM: esquemas.CLASSES_TRIAGEM,
  CLASSIFICACOES_CULTURA: esquemas.CLASSIFICACOES_CULTURA, SINONIMOS_CLASSIFICACAO: esquemas.SINONIMOS_CLASSIFICACAO, linhaDeItens: leitura.linhaDeItens });
global.normalizarProntuario = require(path.join(raiz, 'js', 'importacao.js')).normalizarProntuario;
const am = require(path.join(raiz, 'js', 'arquivo-morto.js'));
const excel = require(path.join(raiz, 'js', 'excel.js'));

const PASTA = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
const APLICAR = process.argv.includes('--aplicar');
const BANCOS = ['pacientes', 'culturas', 'iras', 'cirurgias', 'antibioticos', 'isolamentos',
  'sepse', 'surtos', 'uti', 'evolucoes', 'dispositivos', 'sinan', 'denominadores'];

/* A pasta do navegador (File System Access) imitada sobre o disco. */
function dirHandle(dir) {
  return {
    kind: 'directory', name: path.basename(dir),
    async getFileHandle(nome, op) {
      const f = path.join(dir, nome);
      if (!fs.existsSync(f)) { if (!(op && op.create)) throw Object.assign(new Error('não existe: ' + nome), { name: 'NotFoundError' }); fs.writeFileSync(f, ''); }
      return { kind: 'file',
        getFile: async () => { const st = fs.statSync(f); return { lastModified: st.mtimeMs, size: st.size, arrayBuffer: async () => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } }; },
        createWritable: async () => { let dados; return { write: async d => { dados = d; }, close: async () => { fs.writeFileSync(f, Buffer.from(dados)); }, abort: async () => {} }; } };
    },
    async getDirectoryHandle(nome, op) {
      const d = path.join(dir, nome);
      if (!fs.existsSync(d)) { if (!(op && op.create)) throw Object.assign(new Error('não existe: ' + nome), { name: 'NotFoundError' }); fs.mkdirSync(d); }
      return dirHandle(d);
    },
    async *entries() { for (const n of fs.readdirSync(dir)) yield [n, { kind: fs.statSync(path.join(dir, n)).isDirectory() ? 'directory' : 'file' }]; },
    async removeEntry(nome) { fs.rmSync(path.join(dir, nome)); }
  };
}

(async () => {
  excel.pasta.handle = dirHandle(PASTA);
  const corte = am.corteArquivoMorto(new Date().toISOString().slice(0, 10));
  const lote = 'ate-' + (Number(corte.slice(0, 4)) - 1);
  const bancos = {};
  for (const n of BANCOS) { try { bancos[n] = await excel.lerBanco(n); } catch (e) { bancos[n] = {}; } }
  const sep = am.separarArquivoMorto(bancos, corte);
  console.log(`corte ${corte} (lote ${lote}):`, sep.contagem);
  if (!APLICAR) { console.log('\nSIMULAÇÃO — nada gravado. Rode com --aplicar para gravar (com backup).'); return; }
  const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const dirBackup = path.join(PASTA, 'backups', 'arquivo-morto-' + carimbo);
  fs.mkdirSync(dirBackup, { recursive: true });
  for (const n of ['pacientes', 'culturas']) fs.copyFileSync(path.join(PASTA, ESQUEMAS[n].arquivo), path.join(dirBackup, ESQUEMAS[n].arquivo));
  /* arquivo morto primeiro: falha no meio = linha repetida, nunca perdida */
  console.log(await excel.gravarArquivoMorto('pacientes', lote, sep.morto.pacientes));
  console.log(await excel.gravarArquivoMorto('culturas', lote, sep.morto.culturas));
  await excel.gravarBanco('pacientes', Object.assign({}, bancos.pacientes, sep.ativo.pacientes));
  await excel.gravarBanco('culturas', Object.assign({}, bancos.culturas, sep.ativo.culturas));
  console.log(`Gravado. Backup em ${path.relative(PASTA, dirBackup)}/`);
})().catch(e => { console.error(e); process.exit(1); });
