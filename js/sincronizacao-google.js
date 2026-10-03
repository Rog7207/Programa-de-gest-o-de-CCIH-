/* Sincronização com a planilha do Google dos miniapps (pedido de 03/10/2026): higiene das
   mãos e decisão de ATB não carregam dado sensível, então os miniapps enviam direto para o
   Apps Script (scripts/apps-script-recebimento.gs), que grava numa planilha do Google no
   Drive da CCIH. Em vez de importar arquivo, o aplicativo PUXA de lá o que chegou desde a
   última vez — no mesmo formato de pacote de miniapp, que ingerirMiniapp já trata (mesma
   deduplicação, mesmas regras). URL e segredo ficam na aba meta do config.xlsx (chaves
   envio_url / envio_segredo), como o e-mail da CCIH: são desta instalação, não do código.
   Funções puras testáveis em Node; a parte de rede e banco é `sincronizacaoGoogle`. */

const TIPOS_SINCRONIZAVEIS = [
  { tipo: 'higiene_maos', rotulo: 'Higiene das mãos', aba: 'higiene' },
  { tipo: 'decisao_atb', rotulo: 'Decisão de ATB empírica', aba: 'decisao' }
];
/* Margem de segurança: o filtro do servidor é pela data de chegada; voltar um dia cobre
   fuso e o envio que chegou enquanto a sincronização anterior rodava. A deduplicação do
   aplicativo descarta o que já entrou. */
const SINCRONIZACAO_MARGEM_DIAS = 1;

/* Linhas da aba meta ({Chave, Valor}) → { url, segredo, email }. */
function configSincronizacao(meta) {
  const valor = chave => { const l = (meta || []).find(x => x.Chave === chave); return l ? String(l.Valor || '').trim() : ''; };
  return { url: valor('envio_url'), segredo: valor('envio_segredo'), email: valor('email_ccih'), senhaBusca: valor('senha_busca_miniapp') };
}

/* ---- Lista de internados para a busca do paciente no miniapp de decisão de ATB ----
   Uma linha por paciente com internação aberta: prontuário, nome, setor/leito de hoje
   (foto 2396), atendimento. Vai para uma aba PRIVADA da planilha; o médico recebe só os
   melhores resultados de cada busca, mediante a senha dos médicos. */
function montarListaInternados(bancos) {
  const nomes = new Map((((bancos || {}).pacientes || {}).pacientes || []).map(p => [normalizarProntuario(p.Prontuario), String(p.Nome || '').trim()]));
  const lista = [], vistos = new Set();
  for (const i of (((bancos || {}).pacientes || {}).internacoes || [])) {
    if (String(i.DataAlta || '').trim()) continue;
    const pront = normalizarProntuario(i.Prontuario);
    if (!pront || vistos.has(pront)) continue;
    vistos.add(pront);
    lista.push({ prontuario: pront, nome: nomes.get(pront) || '', setor: String(i.SetorAtual || '').trim(), leito: String(i.Leito || '').trim(),
      atendimento: normalizarProntuario(i.Atendimento), dataInternacao: String(i.DataInternacao || '').slice(0, 10) });
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}
function corpoPublicacaoInternados(cfg, lista, senhaBusca) {
  return { segredo: (cfg || {}).segredo || '', acao: 'publicar-internados', internados: lista || [], senhaBusca: senhaBusca || '' };
}
/* Endereço que o médico abre no celular (o script serve o miniapp por https). */
function urlAppMedicos(cfg, app) {
  const base = String((cfg || {}).url || '').trim();
  return base ? base + '?app=' + encodeURIComponent(app) : '';
}

function sincronizacaoConfigurada(cfg) {
  return Boolean(cfg && /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(String(cfg.url || '').trim()) && cfg.segredo);
}

function desdeComMargem(ultimaSincronizacao) {
  const d = String(ultimaSincronizacao || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  return new Date(Date.parse(d + 'T00:00:00Z') - SINCRONIZACAO_MARGEM_DIAS * 864e5).toISOString().slice(0, 10);
}

function urlDeConsulta(cfg, tipo, desde) {
  const base = String((cfg || {}).url || '').trim();
  const partes = ['segredo=' + encodeURIComponent((cfg || {}).segredo || ''), 'tipo=' + encodeURIComponent(tipo)];
  if (desde) partes.push('desde=' + encodeURIComponent(desde));
  return base + '?' + partes.join('&');
}

/* Corpo do POST que publica um miniapp no Drive da CCIH através do Apps Script (os
   computadores da CCIH são terminais sem cliente do Drive — este é o caminho do PC ao
   Drive). O script grava/sobrescreve o arquivo na pasta PASTA_MINIAPPS_ID. */
function corpoPublicacaoDrive(cfg, nome, html) {
  return { segredo: (cfg || {}).segredo || '', acao: 'publicar', nome: String(nome), conteudo: String(html) };
}

/* Valores da instalação que os miniapps gravados na pasta espelhada levam dentro
   (constantes ENVIO_URL / ENVIO_SEGREDO / EMAIL_DESTINO). */
function instalacaoParaMiniapps(cfg) {
  const c = cfg || {};
  const v = {};
  if (c.url) v.ENVIO_URL = c.url;
  if (c.segredo) v.ENVIO_SEGREDO = c.segredo;
  if (c.email) v.EMAIL_DESTINO = c.email;
  return v;
}

const sincronizacaoGoogle = {
  async config() {
    try { return configSincronizacao((await lerBanco('config')).meta || []); }
    catch (e) { return configSincronizacao([]); }
  },
  async configurada() { return sincronizacaoConfigurada(await this.config()); },

  /* Grava chaves na aba meta do config.xlsx sem passar pela fusão de config.salvar. */
  async gravarMeta(valores) {
    await comTrava(['config'], async () => {
      const banco = await lerBanco('config');
      banco.meta = banco.meta || [];
      for (const [chave, valor] of Object.entries(valores)) {
        const linha = banco.meta.find(l => l.Chave === chave);
        if (linha) linha.Valor = valor;
        else banco.meta.push({ Chave: chave, Valor: valor });
      }
      await gravarBanco('config', banco);
    });
  },

  async testar() {
    const cfg = await this.config();
    if (!sincronizacaoConfigurada(cfg)) return { ok: false, mensagem: 'Preencha a URL do app da Web (…/exec) e o segredo.' };
    const r = await fetch(urlDeConsulta(cfg, 'ping'), { redirect: 'follow' });
    const corpo = await r.text();
    if (corpo.startsWith('##erro')) return { ok: false, mensagem: corpo.replace('##erro;', 'Apps Script respondeu: ') };
    try {
      const info = JSON.parse(corpo);
      if (!info.ok) return { ok: false, mensagem: 'Apps Script respondeu: ' + (info.erro || corpo.slice(0, 200)) };
      const pasta = info.pastaMiniapps ? `; pasta dos miniapps no Drive: "${info.pastaMiniapps}"` : '; sem PASTA_MINIAPPS_ID no script (publicação no Drive desligada)';
      return { ok: true, mensagem: `OK: planilha "${info.planilha}" — abas: ${(info.abas || []).join(', ') || 'nenhuma ainda'}${pasta}.` };
    } catch (e) {
      return { ok: false, mensagem: 'Resposta inesperada do Apps Script: ' + corpo.slice(0, 200) };
    }
  },

  /* Publica um miniapp no Drive da CCIH pelo Apps Script. Devolve { ok, url, pasta } ou
     lança erro com a mensagem do script. */
  async publicarNoDrive(nome, html) {
    const cfg = await this.config();
    if (!sincronizacaoConfigurada(cfg)) throw new Error('Planilha do Google não configurada (Configurações).');
    /* Content-Type text/plain = requisição "simples", sem preflight; o Apps Script responde
       pelo redirecionamento do Google com permissão de origem cruzada. */
    const r = await fetch(cfg.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corpoPublicacaoDrive(cfg, nome, html)) });
    const corpo = await r.text();
    let info;
    try { info = JSON.parse(corpo); } catch (e) { throw new Error('Resposta inesperada do Apps Script: ' + corpo.slice(0, 200)); }
    if (!info.ok) throw new Error('Apps Script: ' + (info.erro || corpo.slice(0, 200)));
    return info;
  },

  /* Publica a lista de internados (e a senha dos médicos, se definida) na planilha. */
  async publicarInternados(bancos) {
    const cfg = await this.config();
    if (!sincronizacaoConfigurada(cfg)) throw new Error('Planilha do Google não configurada (Configurações).');
    const b = bancos || { pacientes: await lerBanco('pacientes') };
    const lista = montarListaInternados(b);
    const r = await fetch(cfg.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corpoPublicacaoInternados(cfg, lista, cfg.senhaBusca)) });
    const corpo = await r.text();
    let info;
    try { info = JSON.parse(corpo); } catch (e) { throw new Error('Resposta inesperada do Apps Script: ' + corpo.slice(0, 200)); }
    if (!info.ok) throw new Error('Apps Script: ' + (info.erro || corpo.slice(0, 200)));
    await this.gravarMeta({ internados_publicados_em: info.atualizadoEm || new Date().toISOString().slice(0, 16).replace('T', ' ') });
    return Object.assign({ total: lista.length }, info);
  },

  /* Puxa um tipo e ingere pelo caminho dos miniapps. Devolve o texto-resumo da ingestão. */
  async sincronizarTipo(tipo) {
    const cfg = await this.config();
    if (!sincronizacaoConfigurada(cfg)) throw new Error('Sincronização não configurada (Configurações → Planilha do Google).');
    const meta = (await lerBanco('config')).meta || [];
    const ultima = (meta.find(l => l.Chave === 'sync_' + tipo + '_em') || {}).Valor || '';
    const r = await fetch(urlDeConsulta(cfg, tipo, desdeComMargem(ultima)), { redirect: 'follow' });
    const corpo = await r.text();
    if (corpo.startsWith('##erro')) throw new Error(corpo.replace('##erro;', 'Apps Script: '));
    const pacote = analisarPacoteCSV(corpo);
    if (!pacote) throw new Error('Resposta do Apps Script não é um pacote de miniapp: ' + corpo.slice(0, 120));
    const total = Object.values(pacote.abas).reduce((s, l) => s + (l || []).length, 0);
    const agora = new Date().toISOString().slice(0, 16).replace('T', ' ');
    let resumo = `${tipo}: nada novo na planilha${ultima ? ' desde ' + ultima.slice(0, 10) : ''}.`;
    if (total) {
      const arquivo = new File([corpo], `planilha-google_${tipo}_${agora.slice(0, 10)}.csv`, { type: 'text/csv' });
      resumo = await ingerirMiniapp(pacote.tipo || tipo, pacote.abas, arquivo, true);
    }
    await this.gravarMeta({ ['sync_' + tipo + '_em']: agora });
    return resumo;
  },

  async sincronizar(tipos) {
    const lista = tipos && tipos.length ? tipos : TIPOS_SINCRONIZAVEIS.map(t => t.tipo);
    const resultados = [];
    for (const tipo of lista) {
      try { resultados.push({ tipo, ok: true, texto: await this.sincronizarTipo(tipo) }); }
      catch (e) { resultados.push({ tipo, ok: false, texto: e.message }); }
    }
    return resultados;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TIPOS_SINCRONIZAVEIS, SINCRONIZACAO_MARGEM_DIAS, configSincronizacao, sincronizacaoConfigurada, desdeComMargem, urlDeConsulta, instalacaoParaMiniapps, corpoPublicacaoDrive,
    montarListaInternados, corpoPublicacaoInternados, urlAppMedicos };
}
