/* Publicação na web das páginas cifradas (pedido de 03/10/2026): no iPhone, um arquivo HTML
   baixado não roda — nem no Safari, nem no Chrome (que no iOS é o Safari por dentro). Só
   funciona SERVIDO por https. Então "publicar" = enviar o arquivo para um site estático de
   URL fixa; o celular abre o endereço e digita a senha.

   Destino: um repositório do GitHub com o GitHub Pages ligado — o aplicativo grava o arquivo
   pela API de conteúdo (um PUT por arquivo) e o Pages serve em
   https://<dono>.github.io/<repo>/<pasta>/<arquivo>. O repositório só recebe páginas
   CIFRADAS ou miniapps públicos (sem dado de paciente), por isso pode ser público; o token é
   de granularidade fina (só "contents: write" nesse repositório) e fica no navegador desta
   máquina (localStorage), nunca no código nem na pasta de dados.

   Funções puras (montar requisição, URL pública, base64 UTF-8) testáveis em Node; a parte
   que fala com a rede é `publicacaoWeb.publicar`. */

const PUBLICACAO_WEB_CHAVE = 'ccih.publicacaoWeb';

/* btoa só aceita Latin-1: o HTML tem acentos e emojis, então passa por UTF-8 antes. */
function base64Utf8(texto) {
  const bytes = new TextEncoder().encode(String(texto == null ? '' : texto));
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(s);
}

/* { repo: 'dono/nome', branch: 'main', pasta: 'miniapps', urlBase: '' , token } → campos
   normalizados; urlBase vazia vira o endereço padrão do GitHub Pages. */
function normalizarConfigPublicacao(cfg) {
  const c = Object.assign({ repo: '', branch: 'main', pasta: '', urlBase: '', token: '' }, cfg || {});
  c.repo = String(c.repo).trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '').replace(/\.git$/, '');
  c.branch = String(c.branch || 'main').trim();
  c.pasta = String(c.pasta || '').trim().replace(/^\/+|\/+$/g, '');
  c.urlBase = String(c.urlBase || '').trim().replace(/\/+$/, '');
  c.token = String(c.token || '').trim();
  const [dono, nome] = c.repo.split('/');
  if (!c.urlBase && dono && nome) c.urlBase = `https://${dono.toLowerCase()}.github.io/${nome}`;
  return c;
}

function publicacaoWebConfigurada(cfg) {
  const c = normalizarConfigPublicacao(cfg);
  return Boolean(c.repo && c.repo.includes('/') && c.token);
}

function urlPublicaDe(cfg, nome) {
  const c = normalizarConfigPublicacao(cfg);
  return [c.urlBase, c.pasta, nome].filter(Boolean).join('/');
}

function caminhoNoRepositorio(cfg, nome) {
  const c = normalizarConfigPublicacao(cfg);
  return [c.pasta, nome].filter(Boolean).join('/');
}

/* Requisição de gravação (API de conteúdo do GitHub). `shaAtual` = sha do arquivo que já
   existe no repositório (obrigatório para sobrescrever); vazio quando é a primeira vez. */
function montarRequisicaoPublicacao(cfg, nome, texto, shaAtual, mensagem) {
  const c = normalizarConfigPublicacao(cfg);
  const corpo = { message: mensagem || `CCIH: publica ${nome}`, content: base64Utf8(texto), branch: c.branch };
  if (shaAtual) corpo.sha = shaAtual;
  return {
    url: `https://api.github.com/repos/${c.repo}/contents/${caminhoNoRepositorio(c, nome)}`,
    metodo: 'PUT',
    cabecalhos: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    corpo
  };
}

const publicacaoWeb = {
  ler() {
    try { return normalizarConfigPublicacao(JSON.parse(localStorage.getItem(PUBLICACAO_WEB_CHAVE) || 'null')); }
    catch (e) { return normalizarConfigPublicacao(null); }
  },
  gravar(cfg) {
    const c = normalizarConfigPublicacao(cfg);
    try { localStorage.setItem(PUBLICACAO_WEB_CHAVE, JSON.stringify(c)); } catch (e) { /* sem armazenamento */ }
    return c;
  },
  configurada() { return publicacaoWebConfigurada(this.ler()); },
  urlDe(nome) { return urlPublicaDe(this.ler(), nome); },

  /* Confere repositório e token (GET no repositório). Devolve { ok, mensagem }. */
  async testar() {
    const c = this.ler();
    if (!publicacaoWebConfigurada(c)) return { ok: false, mensagem: 'Preencha repositório (dono/nome) e token.' };
    const r = await fetch(`https://api.github.com/repos/${c.repo}`, { headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json' } });
    if (r.status === 401) return { ok: false, mensagem: 'Token recusado (401). Gere um token de granularidade fina com "Contents: read and write" neste repositório.' };
    if (r.status === 404) return { ok: false, mensagem: `Repositório ${c.repo} não encontrado (404) — ou o token não tem acesso a ele.` };
    if (!r.ok) return { ok: false, mensagem: `GitHub respondeu ${r.status}.` };
    const info = await r.json();
    return { ok: true, mensagem: `OK: ${info.full_name} (${info.private ? 'privado' : 'público'}). Páginas em ${c.urlBase}/ — o GitHub Pages precisa estar ligado na branch ${c.branch}.` };
  },

  /* Grava (cria ou sobrescreve) o arquivo e devolve { url, commit }. O Pages leva de alguns
     segundos a ~1 minuto para servir a versão nova. */
  async publicar(nome, texto, mensagem) {
    const c = this.ler();
    if (!publicacaoWebConfigurada(c)) throw new Error('Publicação na web não configurada (Configurações → Publicação na web).');
    const caminho = caminhoNoRepositorio(c, nome);
    const cabecalhos = { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    let sha = '';
    const atual = await fetch(`https://api.github.com/repos/${c.repo}/contents/${caminho}?ref=${encodeURIComponent(c.branch)}`, { headers: cabecalhos });
    if (atual.ok) sha = (await atual.json()).sha || '';
    else if (atual.status !== 404) throw new Error(`GitHub respondeu ${atual.status} ao consultar ${caminho}.`);
    const req = montarRequisicaoPublicacao(c, nome, texto, sha, mensagem);
    const r = await fetch(req.url, { method: req.metodo, headers: req.cabecalhos, body: JSON.stringify(req.corpo) });
    if (!r.ok) {
      let detalhe = '';
      try { detalhe = (await r.json()).message || ''; } catch (e) { /* sem corpo */ }
      throw new Error(`GitHub recusou a gravação (${r.status})${detalhe ? ': ' + detalhe : ''}.`);
    }
    const resp = await r.json();
    return { url: urlPublicaDe(c, nome), commit: (resp.commit || {}).sha || '' };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { base64Utf8, normalizarConfigPublicacao, publicacaoWebConfigurada, urlPublicaDe, caminhoNoRepositorio, montarRequisicaoPublicacao, PUBLICACAO_WEB_CHAVE };
}
