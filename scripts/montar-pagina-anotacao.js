/* Monta a PÁGINA DE ANOTAÇÃO dos fragmentos (pedido de 16/10/2026): um HTML autônomo, gravado
   DENTRO da pasta dos dossiês (dados de paciente — nunca vai para nuvem), que a CCIH abre no
   navegador e percorre fragmento a fragmento marcando SUSPEITO / NÃO SUSPEITO. Mostra as duas
   sugestões (modelo local e regra determinística); a marcação humana é o rótulo de treino.

   As marcações ficam no navegador (localStorage) e saem pelo botão "Exportar" como
   anotacoes-<data>.jsonl, já com a partição treino/teste POR PACIENTE. "Importar" retoma um
   arquivo exportado antes (outro computador, outra pessoa).

   Uso: node scripts/montar-pagina-anotacao.js <pasta com _treino.jsonl [e _pre-anotacao.jsonl]> */

const fs = require('fs');
const path = require('path');
const dossie = require(path.join(__dirname, '..', 'js', 'dossie.js'));

const pasta = process.argv[2];
if (!pasta || !fs.existsSync(path.join(pasta, '_treino.jsonl'))) {
  console.error('Uso: node scripts/montar-pagina-anotacao.js <pasta com _treino.jsonl>');
  process.exit(2);
}
const ler = arq => fs.existsSync(arq) ? fs.readFileSync(arq, 'utf-8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) : [];
const fragmentos = ler(path.join(pasta, '_treino.jsonl'));
const pre = new Map();
for (const p of ler(path.join(pasta, '_pre-anotacao.jsonl'))) {
  const k = p.atendimento + '|' + p.dia;
  const atual = pre.get(k);
  if (!atual || (p.versaoPrompt || 0) >= (atual.versaoPrompt || 0)) pre.set(k, p);
}
const dados = fragmentos.map(f => {
  const p = pre.get(f.atendimento + '|' + f.dia) || {};
  const regra = p.sinaisRegra || dossie.sinaisDeterministicosDoFragmento(f.texto, f.dia);
  return { a: f.atendimento, d: f.dia, e: f.evolucoes || 0, t: f.texto, p: dossie.particaoDoAtendimento(f.atendimento),
    ia: p.suspeitoIA === undefined ? null : p.suspeitoIA, iaS: p.sitioIA || '', iaM: p.motivoIA || '', r: regra };
});
const id = path.basename(path.resolve(pasta));
const json = JSON.stringify(dados).replace(/</g, '\\u003c');

const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Anotação de fragmentos</title>
<style>
:root { --fundo:#f6f7f9; --cartao:#fff; --texto:#1f2933; --suave:#61707f; --borda:#dde3ea; --azul:#0d3f7a; --verde:#1b7a3a; --vermelho:#b03a2e; --ambar:#a86a00; }
@media (prefers-color-scheme: dark) { :root { --fundo:#14181d; --cartao:#1d232a; --texto:#e4e8ec; --suave:#9aa6b2; --borda:#2e3740; --azul:#7fb0ef; --verde:#6fcf8e; --vermelho:#f08a7e; --ambar:#e6b14d; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--fundo); color:var(--texto); font:15px/1.5 "Segoe UI",system-ui,sans-serif; }
header { padding:12px 16px; border-bottom:1px solid var(--borda); background:var(--cartao); display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center; }
header h1 { font-size:17px; margin:0; color:var(--azul); }
main { max-width:980px; margin:0 auto; padding:16px; }
.cartao { background:var(--cartao); border:1px solid var(--borda); border-radius:8px; padding:14px 16px; margin-bottom:12px; }
.suave { color:var(--suave); font-size:13px; }
.sug { display:flex; flex-wrap:wrap; gap:8px; margin:8px 0; }
.pilula { border-radius:999px; padding:2px 10px; font-size:13px; border:1px solid var(--borda); }
.sim { color:var(--vermelho); border-color:var(--vermelho); } .nao { color:var(--verde); border-color:var(--verde); } .regra { color:var(--ambar); border-color:var(--ambar); }
pre { white-space:pre-wrap; word-wrap:break-word; font:14px/1.5 ui-monospace,Consolas,monospace; margin:10px 0 0; max-height:60vh; overflow:auto; }
button, select, input, textarea { font:inherit; color:inherit; background:var(--cartao); border:1px solid var(--borda); border-radius:6px; padding:6px 10px; }
button { cursor:pointer; } button:hover { border-color:var(--azul); }
.b-sim { border-color:var(--vermelho); color:var(--vermelho); font-weight:600; } .b-nao { border-color:var(--verde); color:var(--verde); font-weight:600; }
.feito-sim { background:var(--vermelho); color:#fff; } .feito-nao { background:var(--verde); color:#fff; }
.linha { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px; }
textarea { width:100%; min-height:48px; }
details summary { cursor:pointer; color:var(--azul); font-size:13px; }
</style></head><body>
<header>
  <h1>Anotação de fragmentos — suspeita de infecção</h1>
  <label class="suave">Anotador: <input id="anotador" size="16" placeholder="seu nome"></label>
  <label class="suave">Mostrar: <select id="filtro">
    <option value="pendentes">não anotados</option><option value="sugeridos">sugeridos como suspeitos (modelo ou regra)</option>
    <option value="divergentes">modelo e regra discordam</option><option value="todos">todos</option><option value="anotados">já anotados</option></select></label>
  <span id="progresso" class="suave"></span>
  <button id="exportar">Exportar anotações</button>
  <label class="suave"><input type="file" id="importar" accept=".jsonl,.json" style="display:none"><button onclick="document.getElementById('importar').click()">Importar</button></label>
</header>
<main>
  <div class="cartao suave">
    <strong>Fragmento suspeito</strong>: neste dia aparece um sinal NOVO de infecção não explicado pela infecção da admissão — febre ou hipotermia; secreção purulenta nova; piora respiratória; instabilidade hemodinâmica nova; antibiótico novo ou escalonado (não profilaxia); cultura colhida por suspeita ou positiva de sítio estéril; protocolo de sepse; infecção nomeada pelo médico.
    <strong>Não</strong> é suspeito: dia estável; continuidade do tratamento da admissão; colonização; contaminante em hemocultura única; profilaxia; cirurgia sozinha.
    Atalhos: <strong>S</strong> suspeito · <strong>N</strong> não suspeito · <strong>→</strong> pular · <strong>←</strong> voltar.
  </div>
  <div id="area"></div>
</main>
<script>
const DADOS = ${json};
const CHAVE = 'anotacao-fragmentos:${id}';
let anot = {};
try { anot = JSON.parse(localStorage.getItem(CHAVE) || '{}'); } catch (e) { anot = {}; }
try { document.getElementById('anotador').value = localStorage.getItem('anotacao-fragmentos:anotador') || ''; } catch (e) {}
const salvar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(anot)); } catch (e) {} };
const k = f => f.a + '|' + f.d;
const sugerido = f => f.ia === true || f.r.length > 0;
let lista = [], pos = 0;
function filtrar() {
  const v = document.getElementById('filtro').value;
  lista = DADOS.filter(f => v === 'todos' ? true : v === 'anotados' ? !!anot[k(f)] : v === 'sugeridos' ? sugerido(f) && !anot[k(f)]
    : v === 'divergentes' ? (f.ia === true) !== (f.r.length > 0) && !anot[k(f)] : !anot[k(f)]);
  pos = Math.min(pos, Math.max(0, lista.length - 1));
  desenhar();
}
function contar() {
  const n = Object.keys(anot).length, s = Object.values(anot).filter(x => x.suspeito).length;
  document.getElementById('progresso').textContent = n + ' de ' + DADOS.length + ' anotados · ' + s + ' suspeitos' + (n ? ' (' + Math.round(100 * s / n) + '%)' : '') + ' · nesta lista: ' + (lista.length ? pos + 1 : 0) + '/' + lista.length;
}
function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]); }
function desenhar() {
  contar();
  const area = document.getElementById('area');
  if (!lista.length) { area.innerHTML = '<div class="cartao">Nada nesta lista.</div>'; return; }
  const f = lista[pos], a = anot[k(f)];
  const vizinhos = DADOS.filter(x => x.a === f.a && Math.abs(x.d - f.d) === 1);
  area.innerHTML = '<div class="cartao">'
    + '<div><strong>Atendimento ' + esc(f.a) + ' · D' + f.d + '</strong> <span class="suave">· ' + f.e + ' evolução(ões) · ' + f.p + '</span></div>'
    + '<div class="sug">'
    + (f.ia === null ? '<span class="pilula suave">modelo: sem resposta</span>' : '<span class="pilula ' + (f.ia ? 'sim' : 'nao') + '">modelo: ' + (f.ia ? 'suspeito' : 'não suspeito') + (f.iaS && f.iaS !== 'nenhum' ? ' · ' + esc(f.iaS) : '') + '</span>')
    + (f.iaM ? '<span class="suave">“' + esc(f.iaM) + '”</span>' : '')
    + (f.r.length ? '<span class="pilula regra">regra: ' + esc(f.r.join('; ')) + '</span>' : '<span class="pilula suave">regra: nada</span>')
    + '</div>'
    + '<pre>' + esc(f.t) + '</pre>'
    + (vizinhos.length ? '<details><summary>ver dia anterior/seguinte</summary>' + vizinhos.map(v => '<pre class="suave">' + esc(v.t) + '</pre>').join('') + '</details>' : '')
    + '<div class="linha">'
    + '<button class="b-sim ' + (a && a.suspeito ? 'feito-sim' : '') + '" id="bs">Suspeito (S)</button>'
    + '<select id="sitio"><option value="">sítio (opcional)</option>' + ['pneumonia', 'IPCS', 'ITU', 'ISC', 'pele e partes moles', 'abdominal', 'outro'].map(s => '<option' + ((a && a.sitio === s) || (!a && f.iaS === s) ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>'
    + '<button class="b-nao ' + (a && a.suspeito === false ? 'feito-nao' : '') + '" id="bn">Não suspeito (N)</button>'
    + '<button id="bv">← Voltar</button><button id="bp">Pular →</button>'
    + '</div><div class="linha"><textarea id="nota" placeholder="observação (opcional)">' + esc(a && a.nota || '') + '</textarea></div></div>';
  document.getElementById('bs').onclick = () => marcar(true);
  document.getElementById('bn').onclick = () => marcar(false);
  document.getElementById('bv').onclick = () => { pos = Math.max(0, pos - 1); desenhar(); };
  document.getElementById('bp').onclick = () => { pos = Math.min(lista.length - 1, pos + 1); desenhar(); };
}
function marcar(suspeito) {
  const f = lista[pos];
  const nome = document.getElementById('anotador').value.trim();
  if (!nome) { alert('Escreva seu nome no campo Anotador.'); return; }
  try { localStorage.setItem('anotacao-fragmentos:anotador', nome); } catch (e) {}
  anot[k(f)] = { suspeito, sitio: suspeito ? document.getElementById('sitio').value : '', nota: document.getElementById('nota').value.trim(), anotador: nome, em: new Date().toISOString() };
  salvar();
  const filtroSomePendentes = document.getElementById('filtro').value !== 'todos' && document.getElementById('filtro').value !== 'anotados';
  if (filtroSomePendentes) { lista.splice(pos, 1); if (pos >= lista.length) pos = Math.max(0, lista.length - 1); }
  else pos = Math.min(lista.length - 1, pos + 1);
  desenhar();
}
document.addEventListener('keydown', e => {
  if (/textarea|input|select/i.test(e.target.tagName)) return;
  if (e.key === 's' || e.key === 'S') marcar(true);
  else if (e.key === 'n' || e.key === 'N') marcar(false);
  else if (e.key === 'ArrowRight') { pos = Math.min(lista.length - 1, pos + 1); desenhar(); }
  else if (e.key === 'ArrowLeft') { pos = Math.max(0, pos - 1); desenhar(); }
});
document.getElementById('filtro').onchange = () => { pos = 0; filtrar(); };
document.getElementById('exportar').onclick = () => {
  const linhas = DADOS.filter(f => anot[k(f)]).map(f => JSON.stringify({ atendimento: f.a, dia: f.d, particao: f.p, texto: f.t,
    suspeito: anot[k(f)].suspeito, sitio: anot[k(f)].sitio, nota: anot[k(f)].nota, anotador: anot[k(f)].anotador, anotadoEm: anot[k(f)].em,
    suspeitoModelo: f.ia, sitioModelo: f.iaS, suspeitoRegra: f.r.length > 0, sinaisRegra: f.r }));
  if (!linhas.length) { alert('Nenhuma anotação ainda.'); return; }
  const url = URL.createObjectURL(new Blob([linhas.join('\\n') + '\\n'], { type: 'application/x-ndjson' }));
  const el = document.createElement('a'); el.href = url; el.download = 'anotacoes-' + new Date().toISOString().slice(0, 10) + '.jsonl'; el.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
document.getElementById('importar').onchange = async e => {
  const arq = e.target.files[0]; if (!arq) return;
  let n = 0;
  for (const l of (await arq.text()).split('\\n').filter(Boolean)) {
    try { const r = JSON.parse(l); if (r.atendimento && r.dia !== undefined && typeof r.suspeito === 'boolean') { anot[r.atendimento + '|' + r.dia] = { suspeito: r.suspeito, sitio: r.sitio || '', nota: r.nota || '', anotador: r.anotador || '', em: r.anotadoEm || '' }; n++; } } catch (er) {}
  }
  salvar(); alert(n + ' anotações importadas.'); filtrar();
};
filtrar();
</script></body></html>
`;
const destino = path.join(pasta, 'anotar-fragmentos.html');
fs.writeFileSync(destino, html, 'utf-8');
const comIA = dados.filter(d => d.ia !== null).length;
console.log(`Página: ${destino}`);
console.log(`${dados.length} fragmentos · pré-anotados pelo modelo: ${comIA} (suspeitos ${dados.filter(d => d.ia === true).length}) · sugeridos pela regra: ${dados.filter(d => d.r.length).length} · modelo OU regra: ${dados.filter(d => d.ia === true || d.r.length).length}`);
