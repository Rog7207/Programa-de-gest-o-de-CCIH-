/* Avalia os dossiês de uma pasta com um modelo LOCAL via Ollama (pedido de 16/10/2026).

   Para cada ATD-*.md da pasta, manda PROMPT-avaliacao.md (instrução) + o dossiê ao Ollama em
   http://127.0.0.1:11434 — SÓ localhost: o texto não sai da máquina — e grava a resposta em
   ATD-*.ia.md, mais um resumo _avaliacao-ia.json/_avaliacao-ia.md (faixa, sítio, dia, confiança,
   tempo). Se houver _gabarito.json (gerar-dossies --cego), o resumo põe lado a lado o que a CCIH
   já registrou.

   Uso: node scripts/avaliar-dossies-ollama.js <pasta-dos-dossies> [--modelo=qwen3:8b]
        [--sem-pensar] [--refazer] [--so=1440176,1443876] [--max-tokens=6000] */

const fs = require('fs');
const path = require('path');
const { conferirTrechos, suspeitaJaNotificada } = require(path.join(__dirname, '..', 'js', 'dossie.js'));

const pasta = process.argv.slice(2).find(a => !a.startsWith('--'));
const arg = nome => { const a = process.argv.find(x => x.startsWith('--' + nome + '=')); return a ? a.slice(nome.length + 3) : ''; };
const flag = nome => process.argv.includes('--' + nome);
if (!pasta || !fs.existsSync(path.join(pasta, 'PROMPT-avaliacao.md'))) {
  console.error('Uso: node scripts/avaliar-dossies-ollama.js <pasta com PROMPT-avaliacao.md e ATD-*.md>');
  process.exit(2);
}
const modelo = arg('modelo') || 'qwen3:8b';
const URL_OLLAMA = 'http://127.0.0.1:11434/api/chat';
const prompt = fs.readFileSync(path.join(pasta, 'PROMPT-avaliacao.md'), 'utf-8');
const so = arg('so') ? new Set(arg('so').split(',').map(s => s.trim())) : null;
const gabarito = fs.existsSync(path.join(pasta, '_gabarito.json'))
  ? new Map(JSON.parse(fs.readFileSync(path.join(pasta, '_gabarito.json'), 'utf-8')).map(g => [g.atendimento, g])) : new Map();

/* Contexto: ~2,8 caracteres por token em português, + folga para o raciocínio e a resposta. */
function contextoPara(caracteres) {
  const tokens = Math.ceil(caracteres / 2.8) + 7168;
  return Math.min(32768, Math.max(8192, Math.ceil(tokens / 4096) * 4096));
}

/* Extrai os campos do formato pedido no prompt (tolerante a negrito/markdown). */
function lerCampos(texto) {
  const t = String(texto || '').replace(/\*\*/g, '');
  const campo = rot => { const m = new RegExp('^\\s*[-#]*\\s*' + rot + '\\s*:\\s*(.+)$', 'im').exec(t); return m ? m[1].trim() : ''; };
  const faixaBruta = campo('FAIXA');
  const f = faixaBruta.toUpperCase();
  const faixa = /SEM EVID/.test(f) ? 'sem evidência' : /\bALTA\b/.test(f) ? 'alta' : /M[ÉE]DIA/.test(f) ? 'média' : /BAIXA/.test(f) ? 'baixa' : '?';
  return { faixa, faixaBruta, sitio: campo('S[ÍI]TIO PROV[ÁA]VEL'), dispositivo: campo('DISPOSITIVO ASSOCIADO'),
    dia: campo('DIA PROV[ÁA]VEL DE IN[ÍI]CIO'), admissao: campo('INFEC[ÇC][ÃA]O NA ADMISS[ÃA]O'), confianca: (campo('CONFIAN[ÇC]A').match(/\d+/) || [''])[0] };
}

async function avaliar(arquivo) {
  const dossie = fs.readFileSync(path.join(pasta, arquivo), 'utf-8');
  const corpo = {
    model: modelo, stream: false,
    messages: [{ role: 'system', content: prompt }, { role: 'user', content: dossie }],
    /* Amostragem recomendada pela Qwen para o qwen3: com raciocínio, temperatura 0,6 (perto de
       zero o modelo entra em laço repetindo o raciocínio — visto em 16/10/2026, 11 mil tokens
       num dossiê só); sem raciocínio, 0,7. num_predict limita o pior caso. */
    options: { num_ctx: contextoPara(prompt.length + dossie.length), top_p: 0.8, top_k: 20,
      temperature: flag('sem-pensar') ? 0.7 : 0.6, presence_penalty: 1.0,
      num_predict: Number(arg('max-tokens')) || (flag('sem-pensar') ? 1500 : 6000) }
  };
  if (flag('sem-pensar')) corpo.think = false;
  const t0 = Date.now();
  const r = await fetch(URL_OLLAMA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  if (!r.ok) throw new Error('Ollama respondeu ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  const segundos = Math.round((Date.now() - t0) / 1000);
  let resposta = (j.message && j.message.content) || '';
  const pensamento = (j.message && j.message.thinking) || '';
  /* qwen3 sem o campo thinking separado devolve <think>…</think> no conteúdo */
  const mThink = /<think>([\s\S]*?)<\/think>/.exec(resposta);
  const raciocinio = pensamento || (mThink ? mThink[1].trim() : '');
  resposta = resposta.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  const cortado = j.done_reason === 'length';
  if (cortado && !/FAIXA\s*:/i.test(resposta)) resposta = '(RESPOSTA CORTADA: o modelo atingiu o limite de tokens sem concluir)\n' + resposta;
  return { resposta, raciocinio, segundos, cortado, num_ctx: corpo.options.num_ctx,
    tokensEntrada: j.prompt_eval_count, tokensSaida: j.eval_count };
}

(async () => {
  try { await fetch('http://127.0.0.1:11434/api/tags'); } catch (e) { console.error('Ollama não está rodando (ollama serve).'); process.exit(2); }
  const arquivos = fs.readdirSync(pasta).filter(f => /^ATD-\d+\.md$/.test(f)).sort()
    .filter(f => !so || so.has(f.replace(/\D/g, '')));
  console.log(`${arquivos.length} dossiês · modelo ${modelo}${flag('sem-pensar') ? ' (sem raciocínio)' : ''}`);
  const resultados = [];
  for (const arq of arquivos) {
    const atd = arq.replace(/\D/g, '');
    const saida = path.join(pasta, arq.replace(/\.md$/, '.ia.md'));
    let res;
    if (fs.existsSync(saida) && !flag('refazer')) {
      const txt = fs.readFileSync(saida, 'utf-8');
      res = { resposta: txt.split('\n## Resposta\n')[1] || txt, segundos: Number((/tempo: (\d+)/.exec(txt) || [])[1]) || 0, reaproveitado: true };
    } else {
      process.stdout.write(`  ${atd} … `);
      try { res = await avaliar(arq); } catch (e) { console.log('ERRO ' + e.message); continue; }
      fs.writeFileSync(saida, [`# Avaliação por IA — ${arq}`, '',
        `modelo: ${modelo} · tempo: ${res.segundos} s · contexto: ${res.num_ctx} · tokens entrada/saída: ${res.tokensEntrada}/${res.tokensSaida}`, '',
        '## Resposta', res.resposta, '', res.raciocinio ? '## Raciocínio do modelo\n\n' + res.raciocinio : ''].join('\n'), 'utf-8');
    }
    const campos = lerCampos(res.resposta);
    /* Trechos citados × texto do dossiê: o modelo às vezes parafraseia ou inventa. */
    const conf = conferirTrechos(res.resposta, fs.readFileSync(path.join(pasta, arq), 'utf-8'));
    if (!res.reaproveitado) {
      fs.appendFileSync(saida, '\n## Conferência dos trechos citados\n\n' + (conf.itens.length
        ? conf.itens.map(i => `- [${i.situacao}] "${i.trecho}"${i.dia ? ' (' + i.dia + ')' : ''}`).join('\n')
        : '- nenhum trecho citado') + '\n', 'utf-8');
    }
    const g = gabarito.get(atd);
    /* Mesma IRAS já notificada na janela (mesmo sítio, ±14 d): a suspeita é desconsiderada. */
    const jaNotif = g && /alta|m[ée]dia/.test(campos.faixa) ? suspeitaJaNotificada(campos, g.iras) : { situacao: 'nova', caso: null };
    const situacao = jaNotif.situacao === 'ja_notificada' ? `já notificada (${jaNotif.caso.id || jaNotif.caso.topografia}) — desconsiderar`
      : jaNotif.situacao === 'descartada_antes' ? `CCIH já descartou ${jaNotif.caso.topografia} (D${jaNotif.caso.dia}) — conferir se é episódio novo`
      : (/alta|m[ée]dia/.test(campos.faixa) ? 'para a CCIH' : '');
    resultados.push({ atendimento: atd, ...campos, segundos: res.segundos, situacao,
      trechos: `${conf.literais}/${conf.itens.length}` + (conf.ausentes ? ` (${conf.ausentes} não achado${conf.ausentes > 1 ? 's' : ''})` : ''),
      ccih: g ? (g.iras.length ? g.iras.map(i => `${i.topografia} (D${i.dia}, ${i.status})`).join('; ') : 'nenhum caso registrado') : '' });
    if (!res.reaproveitado) console.log(`${campos.faixa} · ${campos.sitio || '-'} · ${res.segundos} s`);
  }
  fs.writeFileSync(path.join(pasta, '_avaliacao-ia.json'), JSON.stringify({ modelo, em: new Date().toISOString(), resultados }, null, 2), 'utf-8');
  const md = [`# Avaliação por IA (${modelo})`, '', '| Atendimento | Faixa | Sítio | Dispositivo | Dia | Confiança | Trechos literais | Situação | Tempo | Registrado pela CCIH |', '|---|---|---|---|---|---|---|---|---|---|',
    ...resultados.map(r => `| ${r.atendimento} | ${r.faixa} | ${r.sitio} | ${r.dispositivo} | ${r.dia} | ${r.confianca} | ${r.trechos} | ${r.situacao} | ${r.segundos} s | ${r.ccih} |`)];
  const fila = resultados.filter(r => r.situacao === 'para a CCIH' || /^CCIH já descartou/.test(r.situacao)).length;
  md.push('', `Fila para a CCIH: ${fila} de ${resultados.length} (alta/média, sem IRAS já notificada no mesmo sítio em ±14 dias).`);
  fs.writeFileSync(path.join(pasta, '_avaliacao-ia.md'), md.join('\n') + '\n', 'utf-8');
  console.log('\n' + md.join('\n'));
})();
