/* Servidor de miniapps — PROTÓTIPO (08/10/2026).
   Serve os miniapps por HTTP e RECEBE os envios gravando num arquivo local, SEM Google.
   Node puro (sem dependências). Objetivo: sentir a arquitetura on-premise — os dados nunca
   saem da máquina, sem depender de conta Google.

   ATENÇÃO (piloto): roda em localhost, SEM autenticação. Para uso de verdade é preciso:
   (1) HTTPS acessível pelos celulares — ex.: Cloudflare Tunnel (URL pública com cadeado,
       sem abrir portas); (2) autenticação em toda rota que grava/lê; (3) máquina confiável
       e sempre ligada, com backup da pasta de dados. Nunca trafega nome de paciente.

   Uso:  node scripts/servidor-miniapps.js      (porta 8123; PORTA/PASTA_* por env) */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const PASTA_MINIAPPS = process.env.PASTA_MINIAPPS || path.join(RAIZ, 'miniapps');
const PASTA_RECEBIDOS = process.env.PASTA_RECEBIDOS || path.join(RAIZ, 'recebidos-servidor');
const PORTA = Number(process.env.PORTA || 8123);
const LIMITE_CORPO = 256 * 1024; /* 256 KB por envio */

fs.mkdirSync(PASTA_RECEBIDOS, { recursive: true });

const TIPO_CONTEUDO = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function enviarJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function listarMiniapps() {
  try { return fs.readdirSync(PASTA_MINIAPPS).filter(n => n.endsWith('.html')).sort(); } catch (e) { return []; }
}
function arqDe(tipo) { return path.join(PASTA_RECEBIDOS, tipo + '.jsonl'); }
function contar(tipo) {
  try { return fs.readFileSync(arqDe(tipo), 'utf8').split('\n').filter(Boolean).length; } catch (e) { return 0; }
}
function tipoSeguro(t) { return String(t || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'sem-tipo'; }

/* Serve um arquivo de dentro de PASTA_MINIAPPS, barrando path traversal. */
function servirArquivo(res, nome) {
  const limpo = path.normalize(nome).replace(/^(\.\.(\/|\\|$))+/, '');
  const alvo = path.join(PASTA_MINIAPPS, limpo);
  if (!alvo.startsWith(PASTA_MINIAPPS)) { res.writeHead(403); res.end('proibido'); return; }
  fs.readFile(alvo, (err, dados) => {
    if (err) { res.writeHead(404); res.end('não encontrado'); return; }
    res.writeHead(200, { 'Content-Type': TIPO_CONTEUDO[path.extname(alvo)] || 'application/octet-stream' });
    res.end(dados);
  });
}

function paginaInicial() {
  const links = listarMiniapps().map(a => `<li><a href="/app/${a}">${a}</a></li>`).join('');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Servidor de miniapps CCIH (protótipo)</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:28px auto;padding:0 16px;color:#1f2933;line-height:1.5}
h1{color:#0d3f7a}h2{color:#0d3f7a;font-size:1.15em}a{color:#1257a8}.cartao{border:1px solid #dde3ea;border-radius:8px;padding:12px 16px;margin:14px 0}
button{padding:9px 16px;border-radius:6px;border:1px solid #1257a8;background:#1257a8;color:#fff;font-size:15px;cursor:pointer}
.suave{color:#667;font-size:.95em}</style></head><body>
<h1>Servidor de miniapps — protótipo</h1>
<p class="suave">Roda nesta máquina, serve os miniapps e recebe os envios <strong>sem Google</strong>. Nenhum nome de paciente trafega. (Piloto: sem autenticação, só em localhost.)</p>
<div class="cartao"><h2>Miniapps servidos (pasta miniapps/)</h2><ul>${links || '<li class="suave">nenhum .html em miniapps/</li>'}</ul></div>
<div class="cartao"><h2>Teste de recepção</h2>
<p class="suave">Envia um registro de exemplo de higiene — gravado no servidor (arquivo local), sem Google.</p>
<button onclick="enviar()">Enviar registro de teste</button> <span id="res" class="suave"></span></div>
<script>
async function enviar(){
  const dados={Momento:'1. Antes de contato com o paciente',Profissional:'Médico',Tipo:'Higiene com álcool',TempoSeg:12,Observacoes:'teste do protótipo'};
  try{
    const r=await fetch('/api/enviar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tipo:'higiene',dados})});
    const j=await r.json();
    document.getElementById('res').textContent=j.ok?('✓ gravado — total de higiene: '+j.total+(j.novo?'':' (já existia)')):('erro: '+(j.erro||'?'));
  }catch(e){document.getElementById('res').textContent='falha: '+e.message;}
}
</script></body></html>`;
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const caminho = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end(); return;
  }
  if (caminho === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(paginaInicial()); return; }
  if (caminho === '/api/ping') { return enviarJSON(res, 200, { ok: true, servidor: 'miniapps-ccih', hora: new Date().toISOString() }); }

  /* Recebe um envio: { tipo, dados } → grava uma linha JSON em recebidos-servidor/<tipo>.jsonl.
     Dedup simples por hash do conteúdo (mesma ideia do receptor do Apps Script). */
  if (caminho === '/api/enviar' && req.method === 'POST') {
    let corpo = '', excedeu = false;
    req.on('data', c => { corpo += c; if (corpo.length > LIMITE_CORPO) { excedeu = true; req.destroy(); } });
    req.on('end', () => {
      if (excedeu) return enviarJSON(res, 413, { ok: false, erro: 'corpo grande demais' });
      let pacote; try { pacote = JSON.parse(corpo); } catch (e) { return enviarJSON(res, 400, { ok: false, erro: 'JSON inválido' }); }
      const tipo = tipoSeguro(pacote.tipo);
      const chave = crypto.createHash('sha1').update(JSON.stringify(pacote.dados || {})).digest('hex').slice(0, 16);
      const registro = Object.assign({ RecebidoEm: new Date().toISOString(), Chave: chave }, pacote.dados || {});
      let jaTem = false;
      try { jaTem = fs.readFileSync(arqDe(tipo), 'utf8').includes('"' + chave + '"'); } catch (e) { /* arquivo novo */ }
      if (!jaTem) fs.appendFileSync(arqDe(tipo), JSON.stringify(registro) + '\n');
      return enviarJSON(res, 200, { ok: true, novo: !jaTem, total: contar(tipo) });
    });
    return;
  }

  /* Leitura: o app da CCIH buscaria daqui (substitui a planilha pública). */
  if (caminho === '/api/recebidos' && req.method === 'GET') {
    const tipo = tipoSeguro(url.searchParams.get('tipo'));
    let registros = [];
    try { registros = fs.readFileSync(arqDe(tipo), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (e) { /* vazio */ }
    return enviarJSON(res, 200, { tipo, total: registros.length, registros });
  }

  if (caminho.startsWith('/app/')) return servirArquivo(res, decodeURIComponent(caminho.slice('/app/'.length)));
  if (caminho === '/higiene') return servirArquivo(res, 'higiene-maos.html');
  if (caminho === '/decisao') return servirArquivo(res, 'decisao-atb.html');

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('não encontrado');
});

servidor.listen(PORTA, () => {
  console.log('Servidor de miniapps (protótipo) em http://localhost:' + PORTA);
  console.log('  miniapps :', PASTA_MINIAPPS);
  console.log('  recebidos:', PASTA_RECEBIDOS);
});
