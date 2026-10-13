/* Aba Notificáveis — radar de doenças de notificação compulsória nos internados.
   O app SÓ SINALIZA e documenta: nunca notifica o SINAN. Para cada suspeita, a CCIH decide:
   "não é de notificação" (descartado), "notificar" (vai para a lista de digitação) ou registra
   uma observação (log de ações). Ao importar o SINAN, a dedup marca os digitados e eles saem da
   lista. Tudo reversível. */

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
    lerBanco('sinan').catch(() => ({ notificacoes: [], casos: [] }))
  ]);

  const nomePorPront = new Map((pacientesB.pacientes || []).map(p => [normalizarProntuario(p.Prontuario), p.Nome || '']));
  const internado = new Map();
  for (const i of (pacientesB.internacoes || [])) {
    if (String(i.DataAlta || '').trim()) continue;
    internado.set(normalizarProntuario(i.Prontuario), { setor: i.SetorAtual || '', leito: i.Leito || '' });
  }
  const precaucaoAtiva = _precaucaoAtivaDe(isolamentosB.precaucoes);
  const internacoesPorPront = new Map();
  for (const i of (pacientesB.internacoes || [])) {
    const p = normalizarProntuario(i.Prontuario);
    if (!internacoesPorPront.has(p)) internacoesPorPront.set(p, []);
    internacoesPorPront.get(p).push(i);
  }
  const notifPorPront = new Map();
  for (const n of (sinanB.notificacoes || [])) {
    const p = normalizarProntuario(n.Prontuario);
    if (!p) continue;
    if (!notifPorPront.has(p)) notifPorPront.set(p, []);
    notifPorPront.get(p).push(n);
  }
  const casos = sinanB.casos || [];
  /* Status são tokens exatos (a_digitar, descartado, digitado, excluido, suspeita). NÃO usar
     normalizarTexto (ela remove o "_" e "a_digitar" viraria "adigitar"). */
  const statusDe = c => String((c && c.Status) || '').trim().toLowerCase();

  /* Dedup automática: caso "a_digitar" que agora casa com uma notificação do SINAN vira
     "digitado" e sai da lista — como nas IH. Grava uma vez, se houver mudança. */
  const agora = agoraCurto();
  let mudouDedup = false;
  for (const c of casos) {
    if (statusDe(c) !== 'a_digitar') continue;
    const jaNotif = episodioJaNotificado({ agravo: c.Agravo, data: c.DataSinal },
      internacoesPorPront.get(normalizarProntuario(c.Prontuario)) || [], notifPorPront.get(normalizarProntuario(c.Prontuario)) || [], hojeISO());
    if (jaNotif) { c.Status = 'digitado'; c.DigitadoPor = '(SINAN)'; c.DigitadoEm = hojeISO(); c.AtualizadoPor = '(dedup)'; c.AtualizadoEm = agora; mudouDedup = true; }
  }
  if (mudouDedup) {
    try { await comTrava(['sinan'], async () => { const b = await lerBanco('sinan'); b.casos = casos; await gravarBanco('sinan', b); }); } catch (e) { /* segue mostrando */ }
  }

  const casosIdx = indexarCasosNotif(casos);
  const hoje = hojeISO();
  const achados = detectarNotificaveis({ culturas: culturasB.culturas, evolucoes: evolucoesB.evolucoes })
    .filter(a => internado.has(a.prontuario));
  for (const a of achados) {
    a._int = internacoesPorPront.get(a.prontuario) || [];
    a._epi = inicioDoEpisodio(a.data, a._int, hoje);
    a._key = chaveCasoNotif(a.prontuario, a.agravo, a._epi);
    a._caso = casosIdx.get(a._key) || null;
    a._notificadoSinan = episodioJaNotificado(a, a._int, notifPorPront.get(a.prontuario) || [], hoje);
  }
  const st = a => a._caso ? statusDe(a._caso) : '';

  const aNotificar = achados.filter(a => !a._notificadoSinan && (st(a) === '' || st(a) === 'suspeita'));
  const jaNotificados = achados.filter(a => a._notificadoSinan || st(a) === 'digitado').length;
  const isolamentoIndicado = achados.filter(a => a.precaucao && !precaucaoAtiva.has(a.prontuario) && st(a) !== 'descartado' && st(a) !== 'excluido');
  const paraDigitar = casos.filter(c => statusDe(c) === 'a_digitar');
  const encerrados = casos.filter(c => ['descartado', 'excluido'].includes(statusDe(c)));

  const ordemPrazo = a => (a.prazo === 'imediata' ? 0 : 1);
  aNotificar.sort((x, y) => ordemPrazo(x) - ordemPrazo(y) || String(y.data).localeCompare(String(x.data)));

  const temSinan = (sinanB.notificacoes || []).length > 0;
  const fonteRotulo = a => a.fonte === 'cultura' ? 'cultura' : (a.fonte === 'evolucao_forte' ? 'evolução (nomeada)' : 'evolução (sugestiva)');
  const rotuloPaciente = pront => {
    const nome = nomePorPront.get(pront); const loc = internado.get(pront) || {};
    return `Prontuário ${pront}${nome ? ' — ' + nome : ''}${loc.setor ? ' · ' + loc.setor : ''}${loc.leito ? ' leito ' + loc.leito : ''}`;
  };

  /* Cria/atualiza o caso da suspeita e grava. mutador recebe o registro. */
  const salvarCaso = async (a, mutador) => {
    try {
      await comTrava(['sinan'], async () => {
        const b = await lerBanco('sinan').catch(() => ({})); b.casos = b.casos || [];
        const idx = indexarCasosNotif(b.casos);
        let c = idx.get(a._key);
        if (!c) {
          const gerar = proximoID(b.casos, 'ID_Caso', 'CSN');
          c = { ID_Caso: gerar(), Prontuario: a.prontuario, Agravo: a.agravo, CID: a.cid, Prazo: a.prazo,
            EpisodioInicio: a._epi, Fonte: a.fonte, DataSinal: a.data, Status: 'suspeita', Observacoes: '',
            CriadoPor: app.usuario, CriadoEm: agoraCurto() };
          b.casos.push(c);
        }
        mutador(c);
        c.AtualizadoPor = app.usuario; c.AtualizadoEm = agoraCurto();
        await gravarBanco('sinan', b);
      });
      await montarNotificaveis(container);
    } catch (e) { alert('Não foi possível salvar: ' + e.message); }
  };
  /* Mutação de um caso JÁ existente (listas de digitação/encerrados), por ID. */
  const mudarCasoPorId = async (idCaso, mutador) => {
    try {
      await comTrava(['sinan'], async () => {
        const b = await lerBanco('sinan'); b.casos = b.casos || [];
        const c = b.casos.find(x => x.ID_Caso === idCaso);
        if (c) { mutador(c); c.AtualizadoPor = app.usuario; c.AtualizadoEm = agoraCurto(); await gravarBanco('sinan', b); }
      });
      await montarNotificaveis(container);
    } catch (e) { alert('Não foi possível salvar: ' + e.message); }
  };

  const cartaoSuspeita = a => {
    const campoObs = el('textarea', { rows: '2', placeholder: 'Ex.: coletado exame X, aguarda resultado…', style: 'width:100%;margin:.3em 0' });
    const logAtual = a._caso && String(a._caso.Observacoes || '').trim();
    return el('div', { class: 'cartao-detalhe' },
      el('p', {}, el('strong', {}, a.agravo),
        a.prazo === 'imediata' ? el('span', { class: 'selo-mdr', style: 'margin-left:.5em' }, 'notificação imediata') : null,
        a.cid ? el('span', { class: 'texto-suave' }, '  ' + a.cid) : null),
      el('p', { class: 'texto-suave' }, rotuloPaciente(a.prontuario)),
      el('p', { class: 'texto-suave' }, `Sinal: ${fonteRotulo(a)}${a.data ? ' · ' + a.data : ''}${a.detalhe ? ' · ' + a.detalhe : ''}`),
      a.textoCompleto ? el('details', {}, el('summary', {}, 'Ver evolução completa'),
        el('p', { class: 'texto-suave', style: 'white-space:pre-wrap' }, a.textoCompleto)) : null,
      a.precaucao ? el('p', {}, '🛡 ', el('strong', {}, PRECAUCAO_ROTULO[a.precaucao] || a.precaucao), ' indicada') : null,
      logAtual ? el('details', { open: '' }, el('summary', {}, 'Observações'),
        el('p', { class: 'texto-suave', style: 'white-space:pre-wrap' }, logAtual)) : null,
      campoObs,
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-primario', onclick: () => salvarCaso(a, c => { c.Status = 'a_digitar'; c.NotificarPor = app.usuario; c.NotificarEm = hojeISO(); }) }, 'Notificar'),
        ' ',
        el('button', { onclick: () => { const t = String(campoObs.value || '').trim(); if (!t) { campoObs.focus(); return; } return salvarCaso(a, c => { c.Observacoes = anexarObservacao(c.Observacoes, t, app.usuario, agoraCurto()); }); } }, 'Incluir observação'),
        ' ',
        el('button', { onclick: () => salvarCaso(a, c => { c.Status = 'descartado'; c.DescartadoPor = app.usuario; c.DescartadoEm = hojeISO(); }) }, 'Não é de notificação'),
        ' ',
        el('button', { onclick: () => abrirPaciente(a.prontuario) }, 'Abrir ficha')));
  };

  const cartaoIsolamento = a => el('div', { class: 'cartao-detalhe' },
    el('p', {}, el('strong', {}, a.agravo), a.cid ? el('span', { class: 'texto-suave' }, '  ' + a.cid) : null),
    el('p', { class: 'texto-suave' }, rotuloPaciente(a.prontuario)),
    el('p', {}, '🛡 ', el('strong', {}, PRECAUCAO_ROTULO[a.precaucao] || a.precaucao), ' indicada'),
    el('div', { class: 'linha-botoes' },
      el('button', { onclick: () => navegar('isolamentos') }, 'Abrir Isolamentos'), ' ',
      el('button', { onclick: () => abrirPaciente(a.prontuario) }, 'Abrir ficha')));

  const linhaDigitacao = c => el('div', { class: 'cartao-detalhe' },
    el('p', {}, el('strong', {}, c.Agravo),
      normalizarTexto(c.Prazo) === 'imediata' ? el('span', { class: 'selo-mdr', style: 'margin-left:.5em' }, 'imediata') : null,
      c.CID ? el('span', { class: 'texto-suave' }, '  ' + c.CID) : null),
    el('p', { class: 'texto-suave' }, rotuloPaciente(normalizarProntuario(c.Prontuario)) + (c.NotificarEm ? ' · a notificar desde ' + c.NotificarEm : '')),
    String(c.Observacoes || '').trim() ? el('details', {}, el('summary', {}, 'Observações'), el('p', { class: 'texto-suave', style: 'white-space:pre-wrap' }, c.Observacoes)) : null,
    el('div', { class: 'linha-botoes' },
      el('button', { onclick: () => abrirPaciente(normalizarProntuario(c.Prontuario)) }, 'Abrir ficha'), ' ',
      el('button', { onclick: () => mudarCasoPorId(c.ID_Caso, x => { x.Status = 'excluido'; x.ExcluidoPor = app.usuario; x.ExcluidoEm = hojeISO(); }) }, 'Excluir manualmente')));

  const linhaEncerrado = c => el('div', { class: 'cartao-detalhe' },
    el('p', {}, el('strong', {}, c.Agravo), el('span', { class: 'texto-suave' }, '  ' + (statusDe(c) === 'descartado' ? 'não é de notificação' : 'excluído da digitação')),
      ' · ', el('span', { class: 'texto-suave' }, rotuloPaciente(normalizarProntuario(c.Prontuario)))),
    el('div', { class: 'linha-botoes' },
      el('button', { onclick: () => mudarCasoPorId(c.ID_Caso, x => { x.Status = 'suspeita'; }) }, 'Reabrir')));

  container.replaceChildren(
    el('h1', {}, 'Notificáveis'),
    el('p', { class: 'texto-suave' }, 'O aplicativo COMPLEMENTA o Tasy e o SINAN: aponta internados que parecem ter agravo de '
      + 'notificação compulsória e cruza com o que já foi notificado. Não é diagnóstico nem substitui a notificação — '
      + 'a CCIH decide, notifica no SINAN e registra aqui o que foi feito.'),
    el('div', { class: 'grade-cartoes' },
      el('div', { class: 'cartao' }, el('div', { class: 'numero-grande' }, fmtInt(aNotificar.length)), el('div', {}, 'A avaliar')),
      el('div', { class: 'cartao' }, el('div', { class: 'numero-grande' }, fmtInt(paraDigitar.length)), el('div', {}, 'Para digitação')),
      el('div', { class: 'cartao' }, el('div', { class: 'numero-grande' }, fmtInt(isolamentoIndicado.length)), el('div', {}, 'Isolamento indicado')),
      el('div', { class: 'cartao' }, el('div', { class: 'numero-grande' }, fmtInt(jaNotificados)), el('div', {}, 'Já notificados ✓'))),
    !temSinan ? el('p', { class: 'aviso' }, '⚠ Nenhuma notificação do SINAN importada ainda — importe o NINDINET (.dbf) na aba Importar '
      + 'para o app saber o que já foi notificado e tirar os digitados da lista.') : null,

    el('h2', {}, `A avaliar (${fmtInt(aNotificar.length)})`),
    el('p', { class: 'texto-suave' }, 'Para cada suspeita: Notificar (vai para a digitação), Incluir observação (registra ação) ou "Não é de notificação".'),
    aNotificar.length ? el('div', {}, aNotificar.map(cartaoSuspeita))
      : el('p', { class: 'texto-suave' }, 'Nenhum internado com sinal de agravo notificável a avaliar.'),

    el('h2', {}, `Para digitação no SINAN (${fmtInt(paraDigitar.length)})`),
    el('p', { class: 'texto-suave' }, 'Lista separada das IH. Ao importar o NINDINET, os que já foram notificados saem daqui sozinhos.'),
    paraDigitar.length ? el('div', {}, paraDigitar.map(linhaDigitacao))
      : el('p', { class: 'texto-suave' }, 'Nada aguardando digitação.'),

    el('h2', {}, `Isolamento indicado (${fmtInt(isolamentoIndicado.length)})`),
    isolamentoIndicado.length ? el('div', {}, isolamentoIndicado.map(cartaoIsolamento))
      : el('p', { class: 'texto-suave' }, 'Nenhum internado com agravo transmissível sem precaução ativa.'),

    encerrados.length ? el('details', { style: 'margin-top:1em' },
      el('summary', {}, `Descartados / excluídos (${fmtInt(encerrados.length)}) — reversível`),
      el('div', {}, encerrados.map(linhaEncerrado))) : null,

    el('p', { class: 'texto-suave', style: 'margin-top:1.5em' }, 'A lista de agravos segue a LNC (Portaria GM/MS 420/2022) — semente para a CCIH validar. '
      + 'Detecção determinística: microrganismo em cultura ou doença nomeada na evolução (negações e vacina tratadas).')
  );
}
