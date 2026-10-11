/* Aba Notificáveis — radar de doenças de notificação compulsória nos internados.
   O app SÓ SINALIZA e documenta: nunca notifica o SINAN. Duas filas:
   - A notificar: internado com sinal de agravo notificável SEM registro no SINAN.
   - Isolamento indicado: agravo transmissível SEM precaução ativa.
   O cruzamento usa as notificações importadas do SINAN (quando houver). */

function _precaucaoAtivaDe(precaucoes) {
  const ativos = new Set();
  for (const p of (precaucoes || [])) {
    const st = normalizarTexto(p.Status);
    const encerrada = p.DataFim || st === 'encerrado' || st === 'suspenso' || st === 'alta';
    if (!encerrada) ativos.add(normalizarProntuario(p.Prontuario));
  }
  return ativos;
}

async function montarNotificaveis(container) {
  const [culturasB, evolucoesB, pacientesB, isolamentosB, sinanB] = await Promise.all([
    lerBanco('culturas').catch(() => ({ culturas: [] })),
    lerBanco('evolucoes').catch(() => ({ evolucoes: [] })),
    lerBanco('pacientes').catch(() => ({ pacientes: [], internacoes: [] })),
    lerBanco('isolamentos').catch(() => ({ precaucoes: [] })),
    lerBanco('sinan').catch(() => ({ notificacoes: [] }))
  ]);

  const nomePorPront = new Map((pacientesB.pacientes || []).map(p => [normalizarProntuario(p.Prontuario), p.Nome || '']));
  /* Internados agora: internação sem data de alta. Guarda setor/leito do registro mais recente. */
  const internado = new Map();
  for (const i of (pacientesB.internacoes || [])) {
    if (String(i.DataAlta || '').trim()) continue;
    internado.set(normalizarProntuario(i.Prontuario), { setor: i.SetorAtual || '', leito: i.Leito || '' });
  }
  const precaucaoAtiva = _precaucaoAtivaDe(isolamentosB.precaucoes);

  /* Notificado no SINAN: por (prontuário | agravo). */
  const notificado = new Set();
  for (const n of (sinanB.notificacoes || [])) {
    const pront = normalizarProntuario(n.Prontuario);
    if (pront && n.Agravo) notificado.add(pront + '|' + normalizarTexto(n.Agravo));
  }

  const achados = detectarNotificaveis({ culturas: culturasB.culturas, evolucoes: evolucoesB.evolucoes })
    .filter(a => internado.has(a.prontuario));

  const aNotificar = achados.filter(a => !notificado.has(a.prontuario + '|' + normalizarTexto(a.agravo)));
  const jaNotificados = achados.length - aNotificar.length;
  const isolamentoIndicado = achados.filter(a => a.precaucao && !precaucaoAtiva.has(a.prontuario));

  const ordemPrazo = a => (a.prazo === 'imediata' ? 0 : 1);
  aNotificar.sort((x, y) => ordemPrazo(x) - ordemPrazo(y) || String(y.data).localeCompare(String(x.data)));

  const temSinan = (sinanB.notificacoes || []).length > 0;

  const fonteRotulo = a => a.fonte === 'cultura' ? 'cultura' : (a.fonte === 'evolucao_forte' ? 'evolução (nomeada)' : 'evolução (sugestiva)');
  const rotuloPaciente = pront => {
    const nome = nomePorPront.get(pront);
    const loc = internado.get(pront) || {};
    return `Prontuário ${pront}${nome ? ' — ' + nome : ''}${loc.setor ? ' · ' + loc.setor : ''}${loc.leito ? ' leito ' + loc.leito : ''}`;
  };

  const marcarNotificado = async (a) => {
    try {
      await comTrava(['sinan'], async () => {
        const bSin = await lerBanco('sinan').catch(() => ({}));
        bSin.notificacoes = bSin.notificacoes || [];
        const gerar = proximoID(bSin.notificacoes, 'ID_Notificacao', 'SIN');
        bSin.notificacoes.push({ ID_Notificacao: gerar(), NumeroSinan: '', Prontuario: a.prontuario,
          Agravo: a.agravo, CID: a.cid, Prazo: a.prazo, DataNotificacao: hojeISO(), DataSintomas: '',
          Municipio: '', Unidade: '', Classificacao: '', Evolucao: '', Identificado: 'sim',
          NotificadoPor: app.usuario, CriadoPor: app.usuario, CriadoEm: agoraCurto() });
        await gravarBanco('sinan', bSin);
      });
      await montarNotificaveis(container);
    } catch (e) { alert('Não foi possível registrar: ' + e.message); }
  };

  const cartaoAchado = (a, comIsolamento) => el('div', { class: 'cartao-detalhe' },
    el('p', {}, el('strong', {}, a.agravo),
      a.prazo === 'imediata' ? el('span', { class: 'selo-mdr', style: 'margin-left:.5em' }, 'notificação imediata') : null,
      a.cid ? el('span', { class: 'texto-suave' }, '  ' + a.cid) : null),
    el('p', { class: 'texto-suave' }, rotuloPaciente(a.prontuario)),
    el('p', { class: 'texto-suave' }, `Sinal: ${fonteRotulo(a)}${a.data ? ' · ' + a.data : ''}${a.detalhe ? ' · ' + a.detalhe : ''}`),
    /* Evolução inteira recolhida: o trecho acima identifica; aqui dá para ler o contexto e
       descartar erro de detecção (ex.: "vacina meningocócica" não é doença meningocócica). */
    a.textoCompleto ? el('details', {}, el('summary', {}, 'Ver evolução completa'),
      el('p', { class: 'texto-suave', style: 'white-space:pre-wrap' }, a.textoCompleto)) : null,
    comIsolamento && a.precaucao ? el('p', {}, '🛡 ', el('strong', {}, PRECAUCAO_ROTULO[a.precaucao] || a.precaucao), ' indicada') : null,
    el('div', { class: 'linha-botoes' },
      comIsolamento
        ? el('button', { onclick: () => navegar('isolamentos') }, 'Abrir Isolamentos')
        : el('button', { class: 'botao-primario', onclick: () => marcarNotificado(a) }, 'Marcar como notificado'),
      ' ',
      el('button', { onclick: () => abrirPaciente(a.prontuario) }, 'Abrir ficha')));

  container.replaceChildren(
    el('h1', {}, 'Notificáveis'),
    el('p', { class: 'texto-suave' }, 'O aplicativo COMPLEMENTA o Tasy e o SINAN: aponta internados que parecem ter agravo de '
      + 'notificação compulsória e cruza com o que já foi notificado. Não é diagnóstico nem substitui a notificação — '
      + 'a CCIH decide, notifica no SINAN e registra aqui o que foi feito.'),
    el('div', { class: 'grade-cartoes' },
      el('div', { class: 'cartao' }, el('div', { class: 'numero-grande' }, fmtInt(aNotificar.length)), el('div', {}, 'A notificar')),
      el('div', { class: 'cartao' }, el('div', { class: 'numero-grande' }, fmtInt(isolamentoIndicado.length)), el('div', {}, 'Isolamento indicado')),
      el('div', { class: 'cartao' }, el('div', { class: 'numero-grande' }, fmtInt(jaNotificados)), el('div', {}, 'Já notificados ✓'))),
    !temSinan ? el('p', { class: 'aviso' }, '⚠ Nenhuma notificação do SINAN importada ainda — importe o NINDINET (.dbf) na aba Importar '
      + 'para o app saber o que já foi notificado. Sem isso, tudo aparece como "a notificar".') : null,

    el('h2', {}, `A notificar (${fmtInt(aNotificar.length)})`),
    aNotificar.length ? el('div', {}, aNotificar.map(a => cartaoAchado(a, false)))
      : el('p', { class: 'texto-suave' }, 'Nenhum internado com sinal de agravo notificável pendente de notificação.'),

    el('h2', {}, `Isolamento indicado (${fmtInt(isolamentoIndicado.length)})`),
    isolamentoIndicado.length ? el('div', {}, isolamentoIndicado.map(a => cartaoAchado(a, true)))
      : el('p', { class: 'texto-suave' }, 'Nenhum internado com agravo transmissível sem precaução ativa.'),

    el('p', { class: 'texto-suave', style: 'margin-top:1.5em' }, 'A lista de agravos segue a LNC (Portaria GM/MS 420/2022) — semente para a CCIH validar. '
      + 'A detecção é determinística: microrganismo em cultura ou doença nomeada na evolução (negações tratadas).')
  );
}
