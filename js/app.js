/* Casca do aplicativo: conexão à pasta de dados, navegação e abas simples. */

const ABAS = [
  { id: 'painel', rotulo: 'Painel', ativa: true },
  { id: 'pacientes', rotulo: 'Pacientes', ativa: true },
  { id: 'culturas', rotulo: 'Culturas', ativa: true },
  { id: 'antibioticos', rotulo: 'Antibióticos', ativa: true },
  { id: 'evolucoes', rotulo: 'Evoluções', ativa: false },
  { id: 'uti', rotulo: 'UTI', ativa: true },
  { id: 'higiene', rotulo: 'Higiene de mãos', ativa: true },
  { id: 'cirurgias', rotulo: 'Cirurgias', ativa: true },
  { id: 'vigilancia', rotulo: 'Pós-alta', ativa: true },
  { id: 'isolamentos', rotulo: 'Isolamentos', ativa: true },
  { id: 'iras', rotulo: 'Infecções', ativa: true },
  { id: 'sepse', rotulo: 'Sepse', ativa: true },
  { id: 'surtos', rotulo: 'Surtos', ativa: true },
  { id: 'relatorios', rotulo: 'Relatórios', ativa: true },
  { id: 'eventos', rotulo: 'Eventos', ativa: true },
  { id: 'importar', rotulo: 'Importar', ativa: true },
  { id: 'configuracoes', rotulo: 'Configurações', ativa: true }
];

const app = { usuario: localStorage.getItem('ccih.usuario') || '', abaAtual: 'importar' };

function el(tag, attrs, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) {
    if (f == null) continue;
    e.append(f.nodeType ? f : document.createTextNode(f));
  }
  return e;
}

function fmtInt(n) { return Number(n || 0).toLocaleString('pt-BR'); }

function usuariosRecentes() {
  try { return JSON.parse(localStorage.getItem('ccih.usuarios.recentes') || '[]'); } catch (e) { return []; }
}

function registrarUsuarioRecente(nome) {
  const lista = [nome].concat(usuariosRecentes().filter(u => u !== nome)).slice(0, 6);
  localStorage.setItem('ccih.usuarios.recentes', JSON.stringify(lista));
}

/* Identificação obrigatória a cada abertura — o nome assina tudo que a sessão gravar. */
function mostrarIdentificacao(continuar) {
  const raiz = document.getElementById('app');
  const campo = el('input', { type: 'text', placeholder: 'seu nome' });
  const entrar = nome => {
    nome = String(nome || '').trim();
    if (!nome) { campo.classList.add('campo-erro'); campo.focus(); return; }
    app.usuario = nome;
    localStorage.setItem('ccih.usuario', nome);
    registrarUsuarioRecente(nome);
    mostrarCarregando('Abrindo os bancos…');
    continuar();
  };
  campo.addEventListener('keydown', e => { if (e.key === 'Enter') entrar(campo.value); });
  const recentes = usuariosRecentes();
  raiz.replaceChildren(el('div', { class: 'tela-central' },
    el('div', { class: 'cartao cartao-conexao' },
      el('h1', {}, 'Quem está usando?'),
      el('p', { class: 'texto-suave' }, 'O nome fica registrado em tudo que for importado ou alterado nesta sessão.'),
      recentes.length ? el('div', { class: 'linha-botoes', style: 'flex-wrap:wrap;justify-content:center' },
        recentes.map(u => el('button', { class: 'botao-secundario', onclick: () => entrar(u) }, u))) : null,
      campo,
      el('button', { class: 'botao-primario', style: 'margin-top:10px;width:100%', onclick: () => entrar(campo.value) }, 'Entrar'))));
  campo.focus();
}

/* Tela de espera com etapa visível: o clique tem de mudar a tela NA HORA — sem isto,
   apertar "abrir pasta" não dava sinal nenhum até os bancos terminarem de carregar. */
function mostrarCarregando(etapa) {
  const raiz = document.getElementById('app');
  const existente = document.getElementById('carregando-etapa');
  if (existente) { existente.textContent = etapa; return; }
  raiz.replaceChildren(el('div', { class: 'tela-central' },
    el('div', { class: 'cartao cartao-conexao' },
      el('div', { class: 'girando' }),
      el('h2', {}, 'Abrindo o aplicativo'),
      el('p', { id: 'carregando-etapa', class: 'texto-suave' }, etapa))));
}

async function iniciar() {
  const raiz = document.getElementById('app');
  if (!pasta.suportada()) {
    raiz.replaceChildren(el('div', { class: 'tela-central' },
      el('div', { class: 'cartao aviso-erro' },
        el('h2', {}, 'Navegador não suportado'),
        el('p', {}, 'Este aplicativo precisa do Google Chrome ou Microsoft Edge para acessar a pasta de dados.'))));
    return;
  }
  const restaurada = await pasta.restaurar();
  if (restaurada && !restaurada.precisaPermissao) { mostrarIdentificacao(() => aposConectar()); return; }
  mostrarTelaConexao(restaurada ? restaurada.precisaPermissao : null, await pasta.recentes());
}

function mostrarTelaConexao(handlePendente, recentes) {
  const raiz = document.getElementById('app');
  const campoNome = el('input', { type: 'text', id: 'campo-usuario', placeholder: 'Seu nome (fica registrado nas importações)', value: app.usuario });
  const erro = el('p', { class: 'aviso-erro-texto' });

  const identificar = () => {
    app.usuario = campoNome.value.trim();
    if (!app.usuario) { campoNome.focus(); campoNome.classList.add('campo-erro'); return false; }
    localStorage.setItem('ccih.usuario', app.usuario);
    registrarUsuarioRecente(app.usuario);
    return true;
  };

  const conectar = async escolher => {
    if (!identificar()) return;
    try {
      mostrarCarregando('Abrindo a pasta de dados…');
      await escolher();
      mostrarCarregando('Conferindo os arquivos do banco…');
      /* Pasta vazia quase sempre significa seletor no lugar errado — confirmar antes de
         criar um banco novo evita o susto de achar que os dados sumiram. */
      if (await pasta.ehPastaNova()) {
        const nome = pasta.handle.name;
        if (!confirm(`A pasta "${nome}" não tem nenhum arquivo do banco.\n\n`
          + 'Se você quis abrir um banco que já existe, cancele e escolha a pasta certa.\n\n'
          + `Confirmar criação de um banco novo e vazio em "${nome}"?`)) {
          pasta.handle = null;
          erro.textContent = 'Nada foi criado. Escolha a pasta onde o banco já está.';
          return;
        }
      }
      await aposConectar();
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      pasta.handle = null;
      erro.textContent = e.message;
      mostrarTelaConexao(handlePendente, recentes);
      document.querySelector('.cartao-conexao').append(erro);
    }
  };

  const botoesRecentes = (recentes || []).map(h => el('button', {
    class: 'botao-secundario', style: 'width:100%;margin-top:6px;text-align:left',
    onclick: () => conectar(async () => {
      if (await h.queryPermission({ mode: 'readwrite' }) !== 'granted'
        && await h.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('permissão negada para "' + h.name + '"');
      }
      pasta.handle = h;
      await pasta.memorizar(h);
    })
  }, '📁 ' + h.name));

  const principal = el('button', { class: 'botao-primario', style: 'width:100%;margin-top:10px',
    onclick: () => conectar(async () => {
      if (handlePendente && await pasta.reautorizar(handlePendente)) return;
      await pasta.escolher();
    }) }, handlePendente ? 'Reconectar a "' + handlePendente.name + '"' : 'Escolher pasta de dados');

  raiz.replaceChildren(el('div', { class: 'tela-central' },
    el('div', { class: 'cartao cartao-conexao' },
      el('h1', {}, 'Aplicativo CCIH'),
      el('p', {}, 'Vigilância de infecções relacionadas à assistência à saúde'),
      campoNome,
      botoesRecentes.length
        ? el('div', {}, el('p', { class: 'texto-suave' }, 'Abrir a pasta de sempre:'), botoesRecentes)
        : null,
      el('p', { class: 'texto-suave' },
        'Escolha a pasta de dados da CCIH (na rede do hospital). Na primeira vez, os arquivos do banco são criados automaticamente.'),
      principal, erro)));
}

async function aposConectar() {
  mostrarCarregando('Conferindo a estrutura dos bancos…');
  await garantirEstrutura();
  mostrarCarregando('Lendo os bancos (a primeira leitura é a mais demorada)…');
  app.resumoPasta = await pasta.resumo();
  const avisos = [];
  for (const nome of Object.keys(ESQUEMAS)) avisos.push(...await validarEsquema(nome));
  await config.carregar();
  montarCasca(avisos);
  navegar(app.abaAtual, { historico: 'substituir' });
}

function montarCasca(avisosEsquema) {
  const raiz = document.getElementById('app');
  const menu = el('nav', { class: 'menu' },
    el('div', { class: 'menu-titulo' }, 'CCIH',
      el('span', { class: 'menu-subtitulo', title: app.resumoPasta || '' }, pasta.handle.name),
      app.resumoPasta ? el('span', { class: 'menu-subtitulo' }, app.resumoPasta) : null),
    ABAS.map(aba => el('button', {
      class: 'menu-item' + (aba.ativa ? '' : ' menu-item-inativo'),
      'data-aba': aba.id,
      title: aba.ativa ? '' : 'Disponível nas próximas fases',
      onclick: () => { if (aba.ativa) navegar(aba.id); }
    }, aba.rotulo)),
    el('button', { class: 'menu-item menu-rodape', title: 'Trocar usuário', onclick: () => location.reload() },
      app.usuario + ' · trocar'));
  const conteudo = el('main', { id: 'conteudo', class: 'conteudo' });
  const voltar = el('button', {
    id: 'botao-voltar', class: 'botao-voltar', title: 'Voltar à tela anterior (ou use a seta do navegador)',
    onclick: () => history.back()
  }, '← Voltar');
  raiz.replaceChildren(el('div', { class: 'layout' }, menu,
    el('div', { class: 'coluna-conteudo' }, voltar, conteudo)));
  atualizarBotaoVoltar();
  if (avisosEsquema.length) {
    conteudo.append(el('div', { class: 'cartao aviso-alerta' },
      el('strong', {}, 'Atenção: o banco foi alterado fora do aplicativo.'),
      el('ul', {}, avisosEsquema.map(a => el('li', {}, a)))));
  }
}

/* Navegação ligada ao histórico do navegador: clicar num paciente dentro de uma
   investigação de surto leva à aba Culturas, e o caminho de volta precisa existir. O botão
   ← e a seta "voltar" do navegador usam o mesmo mecanismo. O contexto (filtro aplicado,
   surto que estava aberto) viaja junto, senão voltar traria a tela certa sem o recorte. */
/* O botão só aparece quando existe para onde voltar dentro do aplicativo. */
function atualizarBotaoVoltar() {
  const botao = document.getElementById('botao-voltar');
  if (!botao) return;
  botao.style.display = (app.indiceNavegacao || 0) > 0 ? '' : 'none';
}

function contextoAtual() {
  return { filtroCulturas: app.filtroCulturas || null, surtoParaAbrir: app.surtoParaAbrir || null,
    pacienteAberto: app.pacienteAberto || null };
}

function navegar(abaId, opcoes) {
  const modo = (opcoes && opcoes.historico) || 'empilhar';
  /* A posição vai dentro do próprio estado: popstate dispara tanto ao voltar quanto ao
     avançar, então um contador nosso ficaria dessincronizado na primeira vez que ele
     usasse a seta "avançar" do navegador. */
  const atual = (history.state && Number.isFinite(history.state.indice)) ? history.state.indice : 0;
  const indice = modo === 'substituir' ? 0 : atual + 1;
  const estado = { aba: abaId, indice, contexto: contextoAtual() };
  try {
    if (modo === 'substituir') history.replaceState(estado, '', '#' + abaId);
    else if (modo === 'empilhar') history.pushState(estado, '', '#' + abaId);
    app.indiceNavegacao = indice;
  } catch (e) { /* file:// sem histórico — a navegação segue sem o botão voltar */ }
  renderizarAba(abaId);
}

window.addEventListener('popstate', evento => {
  const estado = evento.state;
  if (!estado || !estado.aba) return;
  app.filtroCulturas = (estado.contexto || {}).filtroCulturas || null;
  app.surtoParaAbrir = (estado.contexto || {}).surtoParaAbrir || null;
  app.pacienteAberto = (estado.contexto || {}).pacienteAberto || null;
  app.indiceNavegacao = Number.isFinite(estado.indice) ? estado.indice : 0;
  renderizarAba(estado.aba);
});

function renderizarAba(abaId) {
  app.abaAtual = abaId;
  atualizarBotaoVoltar();
  document.querySelectorAll('.menu-item').forEach(b =>
    b.classList.toggle('menu-item-atual', b.dataset.aba === abaId));
  const raiz = document.getElementById('conteudo');
  /* Cada renderização escreve num contêiner próprio: se a pessoa trocar de aba enquanto a
     anterior ainda carrega (as abas leem bancos de milhares de linhas), a renderização
     velha continua num nó órfão e não suja a aba nova. */
  const conteudo = el('div', {});
  raiz.replaceChildren(conteudo);
  /* Aviso imediato de carregamento, removido quando a aba terminar de montar — clicar no
     menu tem de mudar a tela na hora, mesmo quando os bancos levam segundos para ler. */
  const aguarde = el('p', { class: 'texto-suave' }, el('span', { class: 'girando girando-mini' }), ' Carregando…');
  conteudo.append(aguarde);
  const aoTerminar = promessa => Promise.resolve(promessa).catch(() => {}).finally(() => aguarde.remove());
  if (abaId === 'importar') aoTerminar(montarImportar(conteudo));
  else if (abaId === 'painel') aoTerminar(montarPainel(conteudo));
  else if (abaId === 'pacientes') aoTerminar(montarPacientes(conteudo));
  else if (abaId === 'culturas') aoTerminar(montarCulturas(conteudo));
  else if (abaId === 'antibioticos') aoTerminar(montarAntibioticosNovo(conteudo));
  else if (abaId === 'cirurgias') aoTerminar(montarCirurgias(conteudo));
  else if (abaId === 'vigilancia') aoTerminar(montarVigilancia(conteudo));
  else if (abaId === 'uti') aoTerminar(montarUti(conteudo));
  else if (abaId === 'isolamentos') aoTerminar(montarIsolamentos(conteudo));
  else if (abaId === 'higiene') aoTerminar(montarHigiene(conteudo));
  else if (abaId === 'iras') aoTerminar(montarInfeccoes(conteudo));
  else if (abaId === 'relatorios') aoTerminar(montarRelatorioMicro(conteudo));
  else if (abaId === 'eventos') aoTerminar(montarEventos(conteudo));
  else if (abaId === 'sepse') aoTerminar(montarSepse(conteudo));
  else if (abaId === 'surtos') aoTerminar(montarSurtos(conteudo));
  else if (abaId === 'paciente') aoTerminar(montarPaciente(conteudo));
  else if (abaId === 'configuracoes') aoTerminar(montarConfiguracoes(conteudo));
}

function grafBarras(titulo, pares, aoClicar) {
  const maximo = Math.max(...pares.map(p => p[1]), 1);
  return el('div', { class: 'cartao' }, el('h2', {}, titulo),
    pares.length ? pares.map(([rotulo, n]) => el('div', {
      class: 'barra-linha' + (aoClicar ? ' linha-clicavel' : ''),
      onclick: aoClicar ? () => aoClicar(rotulo) : null
    },
      el('span', { class: 'barra-rotulo', title: rotulo }, rotulo),
      el('div', { class: 'barra-trilho' }, el('div', { class: 'barra', style: `width:${Math.round(n / maximo * 100)}%` })),
      el('span', { class: 'barra-num' }, fmtInt(n))))
    : el('p', { class: 'texto-suave' }, 'sem dados no período'));
}

function contarPor(linhas, campo, limite) {
  const contagem = {};
  linhas.forEach(l => { const v = String(l[campo] || '').trim(); if (v) contagem[v] = (contagem[v] || 0) + 1; });
  return Object.entries(contagem).sort((a, b) => b[1] - a[1]).slice(0, limite || 8);
}

async function montarPainel(conteudo) {
  conteudo.append(el('h1', {}, 'Painel'));
  let culturas, antibioticos, pacientes, cirurgias, iras;
  try {
    [culturas, antibioticos, pacientes, cirurgias, iras] = await Promise.all(
      ['culturas', 'antibioticos', 'pacientes', 'cirurgias', 'iras'].map(n => lerBanco(n)));
  } catch (e) {
    conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message));
    return;
  }
  const hoje = new Date().toISOString().slice(0, 10);

  const todosSurtos = detectarSurtos(culturas.culturas);
  let investigacoes = [];
  try { investigacoes = (await lerBanco('surtos')).investigacoes || []; } catch (e) { /* banco novo */ }
  /* Suspeita marcada como "não é surto" sai do painel, mas continua registrada na aba Surtos. */
  const surtos = todosSurtos.filter(s => {
    const inv = investigacoes.find(i => mesmaSuspeita(s, i));
    return !inv || inv.Situacao !== 'descartado';
  });
  const descartados = todosSurtos.length - surtos.length;
  const mdr = detectarMultirresistentes(culturas.culturas, culturas.sensibilidade, hoje, MDR_JANELA_PAINEL_DIAS);
  const areaAlertas = el('div', {});
  if (surtos.length) {
    areaAlertas.append(el('div', { class: 'aviso-erro' },
      el('div', { class: 'alerta-titulo' }, `Suspeita de surto (${surtos.length})`),
      surtos.map(s => {
        const inv = investigacoes.find(i => mesmaSuspeita(s, i));
        const caixa = el('input', { type: 'checkbox', title: 'Desconsiderar — não é surto' });
        caixa.addEventListener('change', async () => {
          caixa.disabled = true;
          try {
            await salvarInvestigacao({
              ID_Surto: inv ? inv.ID_Surto : '', Setor: s.Setor, Microrganismo: s.Microrganismo,
              DataInicio: s.Inicio, DataFim: s.Fim, PacientesEnvolvidos: String(s.Pacientes),
              Situacao: caixa.checked ? 'descartado' : 'em investigação'
            });
            /* 'substituir': marcar cinco caixas não pode exigir cinco Voltar para sair. */
            navegar('painel', { historico: 'substituir' });
          } catch (e) { caixa.disabled = false; caixa.checked = false; alert(e.message); }
        });
        return el('div', { class: 'alerta-item linha-surto' },
          el('label', { class: 'rotulo-descartar', title: 'Desconsiderar — não é surto' },
            caixa, el('span', {}, 'não é surto')),
          el('span', { class: 'linha-clicavel', style: 'flex:1', onclick: () => {
            app.filtroCulturas = { status: 'todas', setor: s.Setor, busca: s.Microrganismo };
            navegar('culturas');
          } }, `${s.Setor}: ${s.Microrganismo} — ${s.Pacientes} pacientes entre ${s.Inicio} e ${s.Fim}`),
          el('button', { class: 'botao-secundario botao-investigar', onclick: () => {
            app.surtoParaAbrir = { Setor: s.Setor, Microrganismo: s.Microrganismo };
            navegar('surtos');
          } }, inv ? 'Ver investigação' : 'Investigar'));
      }),
      descartados ? el('p', { class: 'texto-suave' },
        `${fmtInt(descartados)} suspeita(s) marcada(s) como "não é surto" — visíveis na aba Surtos.`) : null));
  }
  if (mdr.length) {
    areaAlertas.append(el('div', { class: 'aviso-alerta' },
      el('div', { class: 'alerta-titulo' }, `Multirresistentes nos últimos ${MDR_JANELA_PAINEL_DIAS} dias (${mdr.length})`),
      mdr.slice(0, 12).map(m => el('div', { class: 'linha-clicavel alerta-item', onclick: () => {
        app.filtroCulturas = { status: 'todas', busca: m.Prontuario };
        navegar('culturas');
      } }, `${m.DataColeta} · ${m.Microrganismo} (${m.Mecanismo}${m.Origem === 'antibiograma' ? ', inferido do antibiograma' : ''}) · ${m.Setor || 'sem setor'} · prontuário ${m.Prontuario}`)),
      mdr.length > 12 ? el('p', { class: 'texto-suave' }, `… e mais ${fmtInt(mdr.length - 12)}.`) : null));
  }
  if (!surtos.length && descartados) {
    areaAlertas.append(el('div', { class: 'aviso-sucesso' },
      `Nenhuma suspeita de surto ativa (${fmtInt(descartados)} marcada(s) como "não é surto").`));
  }
  if (!surtos.length && !mdr.length && !descartados) {
    areaAlertas.append(el('div', { class: 'aviso-sucesso' }, 'Sem alertas ativos de surto ou multirresistência.'));
  }
  conteudo.append(areaAlertas);

  /* Registros provisórios do laboratório que já casam com um paciente real: aparecem aqui
     porque o relatório de internações costuma chegar dias depois da cultura, e sem um aviso
     o vínculo só seria notado por acaso. */
  const casaveis = sugerirUnificacoes(pacientes.pacientes || []);
  if (casaveis.length) {
    areaAlertas.append(el('div', { class: 'aviso-alerta' },
      el('div', { class: 'alerta-titulo' }, `${fmtInt(casaveis.length)} registro(s) do laboratório podem ser unificados`),
      el('div', { class: 'texto-suave' }, 'Culturas que entraram sem prontuário (registro provisório por nascimento + iniciais) '
        + 'e agora têm um paciente real com o mesmo nome.'),
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-secundario', onclick: () => navegar('pacientes') }, 'Revisar e unificar'))));
  }

  const suspeitasIras = (iras.casos || []).filter(k => k.StatusInvestigacao === 'em investigação').length;
  if (suspeitasIras) {
    areaAlertas.append(el('div', { class: 'aviso-alerta' },
      el('div', { class: 'alerta-titulo' }, `${fmtInt(suspeitasIras)} suspeita(s) de IRAS aguardando confirmação`),
      el('div', { class: 'texto-suave' }, 'A notificação oficial precisa da segunda análise, por outro profissional.'),
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-secundario', onclick: () => navegar('iras') }, 'Abrir a fila de confirmação'))));
  }

  /* Alertas de antimicrobianos (resistência ao ATB em uso, dose, duração) no topo,
     junto dos surtos — é acionável hoje, não estatística. */
  const alertasATB = alertasDeAntibioticos({ antibioticos, culturas }, hoje);
  if (alertasATB.length) {
    areaAlertas.append(el('div', { class: 'aviso-alerta' },
      el('div', { class: 'alerta-titulo' }, `Antimicrobianos: ${alertasATB.length} alerta(s)`),
      alertasATB.slice(0, 5).map(a => el('div', { class: 'alerta-item linha-clicavel',
        onclick: () => navegar('antibioticos') },
        ({ resistencia: '🦠 ', dose: '💊 ', duracao: '⏱ ' })[a.tipo] + a.detalhe)),
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-secundario', onclick: () => navegar('antibioticos') }, 'Abrir a fila de avaliação'))));
  }

  const pendentes = culturas.culturas.filter(c => c.StatusRevisao === 'pendente').length;
  const emVigilancia = cirurgias.cirurgias.filter(c => c.StatusVigilancia === 'pendente').length;
  const cartoes = [
    ['Pacientes', pacientes.pacientes.length, null],
    ['Culturas pendentes de revisão', pendentes, () => { app.filtroCulturas = { status: 'pendente' }; navegar('culturas'); }],
    ['Prescrições de antibióticos', antibioticos.prescricoes.length, () => navegar('antibioticos')],
    ['Cirurgias em vigilância', emVigilancia, () => navegar('cirurgias')],
    ['Casos de IRAS', iras.casos.length, null]
  ];
  try {
    const isolamentos = await lerBanco('isolamentos');
    const pendIso = pendenciasIsolamento(culturas.culturas, culturas.sensibilidade,
      isolamentos.precaucoes, isolamentos.decisoes, hoje);
    cartoes.push(['Pendências de isolamento', pendIso.length, () => navegar('isolamentos')]);
  } catch (e) { /* banco ainda não criado */ }
  conteudo.append(el('div', { class: 'grade-cartoes' }, ...cartoes.map(([rotulo, n, acao]) =>
    el('div', { class: 'cartao cartao-numero' + (acao ? ' linha-clicavel' : ''), onclick: acao },
      el('div', { class: 'numero-grande' }, fmtInt(n)), el('div', { class: 'texto-suave' }, rotulo)))));

  const selPeriodo = el('select', {}, [['30', '30 dias'], ['90', '90 dias'], ['180', '180 dias'], ['365', '1 ano'], ['', 'tudo']]
    .map(([v, r]) => el('option', { value: v, selected: v === '90' ? '' : null }, r)));
  const areaGraficos = el('div', { class: 'grade-graficos' });
  selPeriodo.addEventListener('change', desenhar);
  conteudo.append(el('div', { class: 'linha-campos' }, el('label', {}, 'Período dos gráficos: ', selPeriodo)), areaGraficos);

  function desenhar() {
    const dias = Number(selPeriodo.value);
    const corte = dias ? new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10) : '';
    /* Só o que pode ser infecção: sem as negativas, os swabs de vigilância e os controles
       de água/leite, que juntos são a maior parte do banco e distorceriam os gráficos. */
    const noPeriodo = culturas.culturas.filter(c => culturaDoPainel(c) && (!corte || String(c.DataColeta) >= corte));
    const aoClicarMicro = micro => { app.filtroCulturas = { status: 'todas', busca: micro }; navegar('culturas'); };
    const aoClicarSetor = setor => { app.filtroCulturas = { status: 'todas', setor }; navegar('culturas'); };
    areaGraficos.replaceChildren(
      grafBarras('Microrganismos mais isolados', contarPor(noPeriodo, 'Microrganismo'), aoClicarMicro),
      grafBarras('Culturas com possível infecção por setor', contarPor(noPeriodo, 'Setor'), aoClicarSetor));
  }
  desenhar();
}

async function montarConfiguracoes(conteudo) {
  conteudo.append(el('h1', {}, 'Configurações'));
  const campoNome = el('input', { type: 'text', value: app.usuario });
  conteudo.append(el('div', { class: 'cartao' },
    el('h2', {}, 'Usuário'),
    el('div', { class: 'linha-campos' }, campoNome,
      el('button', { class: 'botao-secundario', onclick: () => {
        app.usuario = campoNome.value.trim();
        localStorage.setItem('ccih.usuario', app.usuario);
        document.querySelector('.menu-rodape').textContent = app.usuario;
      } }, 'Salvar'))));
  const listaPerfis = config.perfis.length
    ? el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Nome', 'Tipo', 'Criado por', 'Em'].map(c => el('th', {}, c)))),
        el('tbody', {}, config.perfis.map(p => el('tr', {},
          el('td', {}, p.Nome), el('td', {}, (TIPOS_RELATORIO[p.Tipo] || {}).rotulo || p.Tipo),
          el('td', {}, p.CriadoPor), el('td', {}, p.CriadoEm)))))
    : el('p', { class: 'texto-suave' }, 'Nenhum perfil ainda — o primeiro é criado ao importar um relatório novo.');
  conteudo.append(el('div', { class: 'cartao' }, el('h2', {}, 'Perfis de importação'), listaPerfis));
  const vocabDiv = el('div', { class: 'cartao' }, el('h2', {}, 'Vocabulários'),
    el('p', { class: 'texto-suave' }, 'Unificar termo: o termo de origem é substituído em todos os dados, removido da lista e memorizado como sinônimo — importações futuras já normalizam.'));
  const msgVocab = el('p', { class: 'aviso-erro-texto' });
  const executarUnificacao = async (nome, de, para) => {
    if (!de || !para || de === para) return;
    try {
      const n = await unificarVocabulario(nome, de, para);
      msgVocab.className = 'texto-suave';
      msgVocab.textContent = `Unificado: "${de}" → "${para}" (${fmtInt(n)} registros atualizados).`;
      navegar('configuracoes');
    } catch (e) { msgVocab.className = 'aviso-erro-texto'; msgVocab.textContent = e.message; }
  };
  for (const [nome, termos] of Object.entries(config.vocabulario)) {
    const oficiais = (VOCABULARIO_INICIAL[nome] || []).map(x => typeof x === 'string' ? x : x.Nome);
    const sugestoes = (VOCAB_APLICACAO[nome] ? sugerirUnificacoesVocabulario(termos, oficiais) : []);
    const selDe = el('select', {}, termos.map(t => el('option', { value: t }, t)));
    const selPara = el('select', {}, termos.map(t => el('option', { value: t }, t)));
    vocabDiv.append(el('details', {},
      el('summary', {}, `${VOCAB_ROTULOS[nome] || nome} (${termos.length})` + (sugestoes.length ? ` — ${sugestoes.length} unificações sugeridas` : '')),
      sugestoes.length ? el('div', { class: 'secao-termos' },
        el('h3', {}, 'Unificações sugeridas'),
        sugestoes.map(s => el('div', { class: 'linha-termo' },
          el('strong', {}, s.de), el('span', { class: 'texto-suave' }, `→ ${s.para} (${s.regra})`),
          el('button', { class: 'botao-secundario', onclick: () => executarUnificacao(nome, s.de, s.para) }, 'Unificar')))) : null,
      VOCAB_APLICACAO[nome] ? el('div', { class: 'linha-campos' },
        el('label', {}, 'Unificar: ', selDe), el('label', {}, ' em: ', selPara),
        el('button', { class: 'botao-secundario', onclick: () => executarUnificacao(nome, selDe.value, selPara.value) }, 'Unificar manualmente')) : null,
      el('p', { class: 'texto-suave' }, termos.join(' · ') || 'vazio')));
  }
  vocabDiv.append(msgVocab);
  const aliasesDiv = config.aliases.length
    ? el('p', { class: 'texto-suave' }, config.aliases.map(a => `${a.De} → ${a.Para}`).join(' · '))
    : el('p', { class: 'texto-suave' }, 'Nenhum sinônimo registrado ainda.');
  conteudo.append(vocabDiv, el('div', { class: 'cartao' }, el('h2', {}, 'Sinônimos (aliases)'), aliasesDiv));
  conteudo.append(montarDistribuicao());
}

/* Os links apontam para os arquivos DENTRO da pasta do projeto sincronizada com o Drive
   (Aplicativo CCIH online/miniapps), e não para cópias avulsas: assim, toda vez que os
   miniapps são reconstruídos aqui, a sincronização publica a versão nova sozinha e o
   mesmo QR code continua valendo. Nada de subir arquivo à mão. */
const APPS_DISTRIBUICAO = [
  { titulo: 'Visita à UTI (celular)',
    url: 'https://drive.usercontent.google.com/download?id=1pFiQ82NVNAKbPMlX7uCp-5gilLqQEc2q&export=download',
    mensagem: 'CCIH HNSC — aplicativo de visita à UTI.\n\n1) Toque no link e BAIXE o arquivo.\n2) Abra-o pela pasta Downloads (ou ⋮ → Abrir com → Chrome).\n\nNão funciona na pré-visualização do Google Drive — precisa abrir no navegador. Depois de aberto funciona sem internet.' },
  { titulo: 'Higiene das mãos (celular)',
    url: 'https://drive.usercontent.google.com/download?id=1ImY8epQS2Iqp1rxF_hxHw41Ff6bx4bzo&export=download',
    mensagem: 'CCIH HNSC — aplicativo de auditoria de higiene das mãos.\n\n1) Toque no link e BAIXE o arquivo.\n2) Abra-o pela pasta Downloads (ou ⋮ → Abrir com → Chrome).\n\nNão funciona na pré-visualização do Google Drive — precisa abrir no navegador. Depois de aberto funciona sem internet.' },
  { titulo: 'Avaliação de antimicrobianos (médicos)', arquivo: false,
    url: 'https://drive.google.com/drive/folders/1dZuoG2xjoRwTGNedTp2PQfciG8wyAE2Z',
    mensagem: 'CCIH HNSC — pasta com a avaliação de antimicrobianos do dia. Baixe o arquivo mais recente e abra no navegador (a senha é fornecida pela CCIH):' }
];

/* Endereço que o Android resolve abrindo o Chrome, e não o aplicativo do Drive — é o que
   tira a página da pré-visualização, onde o JavaScript não roda. Fora do Android o
   endereço não significa nada, por isso continua sendo uma opção e não o padrão. */
function linkForcandoChrome(url) {
  return 'intent://' + url.replace(/^https:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
}

function qrDe(url, rotulo) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return el('img', { src: qr.createDataURL(4, 8), alt: 'QR ' + rotulo,
      style: 'width:160px;height:160px;image-rendering:pixelated' });
  } catch (e) {
    return el('p', { class: 'aviso-erro-texto' }, 'QR indisponível: ' + e.message);
  }
}

function montarDistribuicao() {
  const cartao = el('div', { class: 'cartao' }, el('h2', {}, 'Distribuição dos aplicativos'),
    el('p', { class: 'texto-suave' }, 'Aponte a câmera do celular para o QR code, ou envie o link pelo WhatsApp. Os arquivos ficam na pasta do projeto sincronizada com o Drive: quando os miniapps são reconstruídos, a versão nova sobe sozinha e o mesmo QR continua valendo.'),
    el('div', { class: 'cartao aviso-alerta' },
      el('strong', {}, 'No celular, o arquivo precisa ser BAIXADO e aberto no navegador.'),
      el('p', { class: 'texto-suave' }, 'A pré-visualização do Google Drive mostra a tela do aplicativo mas não executa nada — os campos não respondem. '
        + 'Depois de baixado (⋮ → Abrir com → Chrome, ou abrir pela pasta Downloads), funciona offline. O próprio miniapp avisa isso na tela se for aberto do jeito errado.')));
  const grade = el('div', { style: 'display:flex;flex-wrap:wrap;gap:16px' });
  for (const item of APPS_DISTRIBUICAO) {
    const aviso = el('span', { class: 'texto-suave' });
    const caixaQR = el('div', {}, qrDe(item.url, item.titulo));
    const legenda = el('p', { class: 'texto-suave', style: 'margin:2px 0' }, 'abre a página de download');
    let forcando = false;
    const alternarChrome = el('button', { class: 'botao-secundario', style: 'margin:4px;font-size:13px',
      onclick: e => {
        forcando = !forcando;
        caixaQR.replaceChildren(qrDe(forcando ? linkForcandoChrome(item.url) : item.url, item.titulo));
        legenda.textContent = forcando ? 'abre direto no Chrome (só Android)' : 'abre a página de download';
        e.target.textContent = forcando ? 'Usar QR comum' : 'QR que abre no Chrome';
      } }, 'QR que abre no Chrome');
    grade.append(el('div', { style: 'text-align:center;max-width:200px' },
      el('h3', { style: 'margin:4px 0' }, item.titulo),
      caixaQR, legenda,
      el('div', {},
        el('button', { class: 'botao-secundario', style: 'margin:4px', onclick: () =>
          window.open('https://wa.me/?text=' + encodeURIComponent(item.mensagem + '\n' + item.url), '_blank') }, 'Enviar pelo WhatsApp'),
        item.arquivo === false ? null : alternarChrome,
        el('button', { class: 'botao-secundario', style: 'margin:4px', onclick: async () => {
          try { await navigator.clipboard.writeText(item.url); aviso.textContent = 'Link copiado.'; }
          catch (e) { aviso.textContent = item.url; }
        } }, 'Copiar link'), aviso)));
  }
  cartao.append(grade);
  return cartao;
}

window.addEventListener('DOMContentLoaded', iniciar);
