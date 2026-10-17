/* Pré-anota os fragmentos de _treino.jsonl como SUSPEITO / não suspeito com um modelo LOCAL
   (Ollama em 127.0.0.1 — nada sai da máquina). Pedido de 16/10/2026: a 1ª fase do
   classificador de 512 tokens aprende SUSPEITA; o Qwen sugere, a CCIH corrige na página de
   anotação (scripts/montar-pagina-anotacao.js) e a correção humana é o rótulo.

   Grava _pre-anotacao.jsonl (uma linha por fragmento: atendimento, dia, suspeitoIA, sitioIA,
   motivoIA, modelo, versão do prompt, segundos). RETOMA de onde parou: fragmento já pré-anotado
   com o mesmo modelo e versão não roda de novo.

   Uso: node scripts/pre-anotar-fragmentos.js <pasta com _treino.jsonl> [--modelo=qwen3:8b]
        [--limite=50] (só os N primeiros pendentes, para testar) */

const fs = require('fs');
const path = require('path');
const dossie = require(path.join(__dirname, '..', 'js', 'dossie.js'));

const pasta = process.argv.slice(2).find(a => !a.startsWith('--'));
const arg = nome => { const a = process.argv.find(x => x.startsWith('--' + nome + '=')); return a ? a.slice(nome.length + 3) : ''; };
if (!pasta || !fs.existsSync(path.join(pasta, '_treino.jsonl'))) {
  console.error('Uso: node scripts/pre-anotar-fragmentos.js <pasta com _treino.jsonl> (gerada por gerar-dossies --treino)');
  process.exit(2);
}
const modelo = arg('modelo') || 'qwen3:8b';
const limite = Number(arg('limite')) || Infinity;
const arqSaida = path.join(pasta, '_pre-anotacao.jsonl');
const chave = f => f.atendimento + '|' + f.dia;

const fragmentos = fs.readFileSync(path.join(pasta, '_treino.jsonl'), 'utf-8').trim().split('\n').filter(Boolean).map(JSON.parse);
const feitos = new Set();
if (fs.existsSync(arqSaida)) {
  for (const l of fs.readFileSync(arqSaida, 'utf-8').split('\n').filter(Boolean)) {
    try { const r = JSON.parse(l); if (r.modelo === modelo && r.versaoPrompt === dossie.VERSAO_PROMPT_SUSPEITA && r.suspeitoIA !== null) feitos.add(chave(r)); } catch (e) { /* linha truncada */ }
  }
}
const pendentes = fragmentos.filter(f => !feitos.has(chave(f))).slice(0, limite);

async function perguntar(texto) {
  const corpo = {
    model: modelo, stream: false, think: false,
    messages: [{ role: 'system', content: dossie.PROMPT_SUSPEITA_FRAGMENTO }, { role: 'user', content: texto }],
    /* sem raciocínio: amostragem recomendada pela Qwen para o modo direto */
    options: { num_ctx: 4096, temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.0, num_predict: 120 }
  };
  const r = await fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  if (!r.ok) throw new Error('Ollama ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return String((j.message && j.message.content) || '').replace(/<think>[\s\S]*?<\/think>/, '').trim();
}

(async () => {
  try { await fetch('http://127.0.0.1:11434/api/tags'); } catch (e) { console.error('Ollama não está rodando (ollama serve).'); process.exit(2); }
  console.log(`${fragmentos.length} fragmentos · ${feitos.size} já pré-anotados · ${pendentes.length} a fazer · modelo ${modelo}`);
  const t0 = Date.now();
  let n = 0, sim = 0, falhas = 0;
  for (const f of pendentes) {
    const t1 = Date.now();
    let resp = '', lido = { suspeito: null, sitio: '', motivo: '' };
    try {
      resp = await perguntar(f.texto);
      lido = dossie.lerRespostaSuspeita(resp);
      if (lido.suspeito === null) { resp = await perguntar(f.texto); lido = dossie.lerRespostaSuspeita(resp); }   /* 2ª tentativa */
    } catch (e) { falhas++; resp = 'ERRO ' + e.message; }
    n++; if (lido.suspeito) sim++;
    const regra = dossie.sinaisDeterministicosDoFragmento(f.texto, f.dia);
    fs.appendFileSync(arqSaida, JSON.stringify({ atendimento: f.atendimento, dia: f.dia, suspeitoIA: lido.suspeito, sitioIA: lido.sitio, motivoIA: lido.motivo,
      suspeitoRegra: regra.length > 0, sinaisRegra: regra,
      respostaBruta: lido.suspeito === null ? resp.slice(0, 300) : '', modelo, versaoPrompt: dossie.VERSAO_PROMPT_SUSPEITA,
      segundos: Math.round((Date.now() - t1) / 100) / 10, em: new Date().toISOString() }) + '\n', 'utf-8');
    if (n % 50 === 0 || n === pendentes.length) {
      const seg = (Date.now() - t0) / 1000 / n;
      console.log(`  ${n}/${pendentes.length} · suspeitos ${sim} (${Math.round(100 * sim / n)}%) · ${seg.toFixed(1)} s/fragmento · faltam ~${Math.round(seg * (pendentes.length - n) / 60)} min${falhas ? ' · falhas ' + falhas : ''}`);
    }
  }
  console.log('Pronto: ' + arqSaida);
})();
