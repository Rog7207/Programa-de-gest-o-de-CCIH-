/* Aba "Pendências por paciente" (10/11/2026) — FASE 2 da migração: modo de leitura.

   Mostra tudo que está aberto para a equipe decidir agrupado por paciente, com o contexto
   que hoje se repete em cada aba (internação, antibióticos em curso, culturas recentes,
   última evolução médica). As decisões ainda são tomadas nas abas de origem — cada bloco tem
   o botão que leva direto à pendência lá. A fase 3 troca esses botões pelos formulários
   compartilhados de ui-formularios.js, sem mudar o que é gravado. */

async function montarPendencias(conteudo) {
  conteudo.append(el('h1', {}, 'Pendências por paciente'));
  let bancos;
  try {
    const [culturas, antibioticos, uti, iras, pacientes, isolamentos, evolucoes] = await Promise.all([
      lerBanco('culturas'), lerBanco('antibioticos').catch(() => ({ prescricoes: [], avaliacoes: [] })),
      lerBanco('uti').catch(() => ({ avaliacoes_atb: [] })), lerBanco('iras').catch(() => ({ casos: [] })),
      lerBanco('pacientes'), lerBanco('isolamentos').catch(() => ({ precaucoes: [], decisoes: [] })),
      lerBanco('evolucoes').catch(() => ({ evolucoes: [] }))]);
    bancos = { culturas, antibioticos, uti, iras, pacientes, isolamentos, evolucoes };
  } catch (e) { conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message)); return; }

  const hoje = hojeISO();
  const lista = pendenciasPorPaciente(bancos, { hoje, ehAtbAvaliado: n => config.ehAtbAvaliado(n), mdrMonitorados: config.rotina.mdrMonitorados });
  const sensPorCultura = new Map();
  (bancos.culturas.sensibilidade || []).forEach(s => { if (!sensPorCultura.has(s.ID_Cultura)) sensPorCultura.set(s.ID_Cultura, []); sensPorCultura.get(s.ID_Cultura).push(s); });
  const cursosTodos = cursosDeAntibiotico(bancos.antibioticos.prescricoes || [], hoje);
  const totais = lista.reduce((t, p) => { t.culturas += p.pendencias.culturas.length; t.antibioticos += p.pendencias.antibioticos.length;
    t.iras += p.pendencias.iras.length; t.isolamentos += p.pendencias.isolamentos.length; return t; }, { culturas: 0, antibioticos: 0, iras: 0, isolamentos: 0 });

  conteudo.append(el('div', { class: 'aviso-alerta' },
    el('div', { class: 'alerta-titulo' }, 'Modo de leitura (fase 2 da migração)'),
    el('div', { class: 'texto-suave' }, 'Esta tela junta as pendências de cada paciente para a revisão ser feita de uma vez. As decisões continuam sendo registradas nas abas de origem — cada bloco tem o botão que leva direto à pendência. Quando a equipe estiver treinada, os formulários passam a ficar aqui, gravando os mesmos registros.')));
  conteudo.append(el('div', { class: 'grade-cartoes' }, ...[
    ['pacientes com pendência', lista.length], ['culturas a revisar', totais.culturas], ['cursos de ATB a avaliar', totais.antibioticos],
    ['suspeitas de IRAS a confirmar', totais.iras], ['isolamentos a decidir', totais.isolamentos]
  ].map(([r, n]) => el('div', { class: 'cartao cartao-numero' }, el('div', { class: 'numero-grande' }, fmtInt(n)), el('div', { class: 'texto-suave' }, r)))));

  if (!lista.length) { conteudo.append(el('div', { class: 'cartao' }, el('p', { class: 'texto-suave' }, 'Nenhuma pendência aberta.'))); return; }

  /* Filtros: setor, tipo de pendência, busca por nome/prontuário. */
  const setores = [...new Set(lista.map(p => p.setor).filter(Boolean))].sort();
  const selSetor = el('select', {}, el('option', { value: '' }, 'todos os setores'), el('option', { value: '__uti' }, 'só UTI/CTI'),
    setores.map(s => el('option', { value: s }, s)));
  const selTipo = el('select', {}, [['', 'todas as pendências'], ['culturas', 'com cultura a revisar'], ['antibioticos', 'com antibiótico a avaliar'],
    ['iras', 'com suspeita de IRAS'], ['isolamentos', 'com isolamento a decidir']].map(([v, r]) => el('option', { value: v }, r)));
  const campoBusca = el('input', { type: 'text', placeholder: 'nome ou prontuário' });
  const areaLista = el('div', { class: 'pend-lista' });
  const areaDetalhe = el('div', { class: 'pend-detalhe' }, el('p', { class: 'texto-suave' }, 'Escolha um paciente à esquerda.'));
  [selSetor, selTipo].forEach(s => s.addEventListener('change', desenharLista));
  campoBusca.addEventListener('input', aoPararDeDigitar(desenharLista));
  conteudo.append(el('div', { class: 'cartao' },
    el('div', { class: 'linha-campos' }, el('label', {}, 'Setor: ', selSetor), el('label', {}, 'Mostrar: ', selTipo), el('label', {}, 'Buscar: ', campoBusca)),
    el('div', { class: 'pend-grade' }, areaLista, areaDetalhe)));

  let escolhido = null;
  function filtrados() {
    const b = normalizarTexto(campoBusca.value);
    return lista.filter(p => (!selSetor.value || (selSetor.value === '__uti' ? p.emUTI : p.setor === selSetor.value))
      && (!selTipo.value || p.pendencias[selTipo.value].length)
      && (!b || normalizarTexto(p.nome).includes(b) || p.prontuarios.some(x => x.includes(b))));
  }
  function desenharLista() {
    const itens = filtrados();
    areaLista.replaceChildren(
      el('p', { class: 'texto-suave' }, `${fmtInt(itens.length)} paciente(s), do mais prioritário para o menos`),
      ...itens.slice(0, 200).map(p => el('div', { class: 'pend-item linha-clicavel' + (escolhido === p ? ' pend-item-atual' : ''), onclick: () => { escolhido = p; desenharLista(); desenharDetalhe(p); } },
        el('div', { class: 'pend-item-nome' }, (p.nome || '(sem nome)') + (p.emUTI ? ' 🛏' : '') + (p.temMDR ? ' 🦠' : '')),
        el('div', { class: 'texto-suave' }, `${p.prontuarios.join(' / ')} · ${p.setor || 'sem setor'}${p.leito ? ' · leito ' + p.leito : ''}${p.diaInternacao ? ' · D' + p.diaInternacao : ''}`),
        el('div', { class: 'pend-chips' }, resumoPendencias(p), p.maisAntigaDias ? el('span', { class: 'texto-suave' }, ` · mais antiga há ${fmtInt(p.maisAntigaDias)} d`) : null))));
    if (escolhido && !itens.includes(escolhido) && itens.length) { escolhido = itens[0]; desenharDetalhe(escolhido); }
    else if (!escolhido && itens.length) { escolhido = itens[0]; desenharLista(); desenharDetalhe(escolhido); }
  }

  const chavePaciente = p => new Set(p.prontuarios);
  const corSIR = r => ({ R: '#b00020', S: '#1b7a2f', I: '#9a6a00' }[r] || '#555');
  const gradeSIR = sens => el('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin:4px 0' },
    sens.slice().sort((a, b) => ({ R: 0, I: 1, S: 2 }[a.Resultado] ?? 3) - ({ R: 0, I: 1, S: 2 }[b.Resultado] ?? 3) || String(a.Antibiotico).localeCompare(String(b.Antibiotico)))
      .map(s => el('span', { style: `padding:1px 7px;border-radius:4px;border:1px solid ${corSIR(s.Resultado)};color:${corSIR(s.Resultado)};font-size:0.85em` }, `${s.Antibiotico}: ${s.Resultado}`)));

  function desenharDetalhe(p) {
    const pronts = chavePaciente(p);
    const ehDele = pront => pronts.has(normalizarProntuario(pront));
    const atds = new Set((bancos.pacientes.internacoes || []).filter(i => ehDele(i.Prontuario)).map(i => normalizarProntuario(i.Atendimento)).filter(Boolean));
    const cursosAtivos = cursosTodos.filter(c => ehDele(c.Prontuario) && String(c.fim) >= hoje).sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));
    const culturas30 = (bancos.culturas.culturas || []).filter(c => ehDele(c.Prontuario) && c.Microrganismo && c.StatusRevisao !== 'descartada' && (diasDesde(c.DataColeta, hoje) || 99) <= 30)
      .sort((a, b) => String(b.DataColeta).localeCompare(String(a.DataColeta)));
    const evoMedica = (bancos.evolucoes.evolucoes || []).filter(e => e.Categoria === 'E' && (ehDele(e.Prontuario) || atds.has(normalizarProntuario(e.Atendimento))))
      .sort((a, b) => String(b.DataEvolucao).localeCompare(String(a.DataEvolucao)))[0];
    const precaucaoAtiva = (bancos.isolamentos.precaucoes || []).find(x => ehDele(x.Prontuario) && !String(x.DataFim || '').trim());
    const pendAtb = p.pendencias.antibioticos.map(a => a.chave);
    const chaveCurso = c => normalizarProntuario(c.Prontuario) + '|' + normalizarTexto(c.Antibiotico) + '|' + c.inicio;

    const bloco = (titulo, corpo, botao) => el('div', { class: 'pend-bloco' },
      el('div', { class: 'pend-bloco-cab' }, el('strong', {}, titulo), botao || null), corpo);
    const irCulturas = pront => el('button', { class: 'botao-secundario', onclick: () => { app.filtroCulturas = { status: 'pendente', setor: '', busca: pront, de: '', ate: '' }; navegar('culturas'); } }, 'Classificar na aba Culturas →');
    const irAtb = chave => el('button', { class: 'botao-secundario', onclick: () => { app.cursoAberto = chave; navegar('antibioticos'); } }, 'Avaliar na aba Antibióticos →');

    areaDetalhe.replaceChildren(
      el('h2', {}, (p.nome || '(sem nome)') + ' ', el('span', { class: 'texto-suave', style: 'font-size:0.7em' }, p.prontuarios.join(' / '))),
      el('p', { class: 'texto-suave' }, [p.setor || 'sem setor', p.leito ? 'leito ' + p.leito : '', p.internadoDesde ? `internado em ${p.internadoDesde.split('-').reverse().join('/')} (D${p.diaInternacao})` : 'sem internação aberta',
        precaucaoAtiva ? `precaução ${precaucaoAtiva.TipoPrecaucao || ''} ativa` : ''].filter(Boolean).join(' · ')),
      el('div', { class: 'linha-botoes' }, el('button', { class: 'botao-secundario', onclick: () => abrirPaciente(p.prontuarios[0]) }, 'Ver ficha do paciente')),

      /* ---- Contexto compartilhado ---- */
      el('h3', {}, 'Contexto'),
      cursosAtivos.length ? el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Antibiótico', 'Dose', 'Início', 'Dia', 'Fila'].map(c => el('th', {}, c)))),
        el('tbody', {}, cursosAtivos.map(c => el('tr', {}, el('td', {}, c.Antibiotico), el('td', {}, String(c.ultima.Dose || '')), el('td', {}, c.inicio),
          el('td', { class: c.dias >= DIAS_CURSO_PROLONGADO ? 'aviso-erro-texto' : '' }, 'D' + c.dias), el('td', {}, pendAtb.includes(chaveCurso(c)) ? 'a avaliar' : '—')))))
        : el('p', { class: 'texto-suave' }, 'Sem antibiótico em curso.'),
      culturas30.length ? el('div', {}, el('p', { class: 'texto-suave' }, 'Culturas positivas dos últimos 30 dias (clique para o antibiograma):'),
        el('table', { class: 'tabela' }, el('thead', {}, el('tr', {}, ['Coleta', 'Material', 'Microrganismo', 'Mecanismo', 'Classificação'].map(c => el('th', {}, c)))),
          el('tbody', {}, culturas30.slice(0, 10).flatMap(c => {
            const sens = sensPorCultura.get(c.ID_Cultura) || [];
            const det = el('tr', { style: 'display:none' }, el('td', { colspan: '5' }, sens.length ? gradeSIR(sens) : el('span', { class: 'texto-suave' }, c.Antibiograma ? 'Laudo: ' + c.Antibiograma : 'Sem antibiograma.')));
            const tr = el('tr', { class: 'linha-clicavel', onclick: () => { det.style.display = det.style.display === 'none' ? '' : 'none'; } },
              el('td', {}, c.DataColeta), el('td', {}, c.Material), el('td', {}, c.Microrganismo), el('td', {}, c.MecanismoResistencia || ''),
              el('td', { class: c.StatusRevisao === 'pendente' ? 'aviso-erro-texto' : '' }, c.StatusRevisao === 'pendente' ? 'pendente' : (c.AvaliacaoCCIH || c.StatusRevisao)));
            return [tr, det];
          }))))
        : el('p', { class: 'texto-suave' }, 'Sem cultura positiva nos últimos 30 dias.'),
      evoMedica ? el('details', {}, el('summary', {}, `🩺 Última evolução médica (${String(evoMedica.DataEvolucao || '').slice(0, 10)}${evoMedica.Autor ? ' — ' + evoMedica.Autor : ''})`),
        evoMedica.SinaisInfeccao ? el('p', { class: 'aviso-erro-texto' }, `⚠ Sinais sugestivos de infecção: ${evoMedica.SinaisInfeccao}`) : null,
        el('p', { class: 'texto-suave', style: 'white-space:pre-wrap' }, evoMedica.Texto || '')) : el('p', { class: 'texto-suave' }, 'Sem evolução médica registrada.'),

      /* ---- Blocos de pendência ---- */
      el('h3', {}, `Pendências (${fmtInt(p.total)})`),
      ...p.pendencias.culturas.map(c => bloco('🧫 Cultura a revisar: ' + c.rotulo,
        el('div', {}, el('p', { class: 'texto-suave' }, `coleta ${c.cultura.DataColeta} · ${c.cultura.Setor || ''}` + (c.grupo ? ` · ${c.grupo.Quantidade} amostras (${c.grupo.Inicio} a ${c.grupo.Fim})` : '')
          + (c.cultura.TriagemRegra ? ` · ${c.cultura.TriagemRegra}` : '')),
          (sensPorCultura.get(c.cultura.ID_Cultura) || []).length ? gradeSIR(sensPorCultura.get(c.cultura.ID_Cultura)) : null),
        irCulturas(c.cultura.Prontuario))),
      ...p.pendencias.antibioticos.map(a => bloco('💊 Antibiótico a avaliar: ' + a.rotulo,
        el('p', { class: 'texto-suave' }, `desde ${a.curso.inicio} · dose ${a.curso.ultima.Dose || '—'} · ${a.curso.Setor || ''}`
          + (culturas30.some(c => (sensPorCultura.get(c.ID_Cultura) || []).some(s => normalizarTexto(s.Antibiotico) === normalizarTexto(a.curso.Antibiotico) && s.Resultado === 'R')) ? ' · 🦠 germe recente resistente a este antibiótico' : '')),
        irAtb(a.chave))),
      ...p.pendencias.iras.map(k => bloco('⚠ Suspeita de IRAS a confirmar: ' + k.rotulo,
        el('p', { class: 'texto-suave', style: 'white-space:pre-line' }, [k.caso.Setor, k.caso.DispositivoAssociado && k.caso.DispositivoAssociado !== 'Nenhum' ? k.caso.DispositivoAssociado : '', k.caso.Microrganismo, k.caso.Observacoes].filter(Boolean).join(' · ')),
        el('button', { class: 'botao-secundario', onclick: () => { app.abaInfeccoes = 'confirmar'; navegar('iras'); } }, 'Confirmar na aba Infecções →'))),
      ...p.pendencias.isolamentos.map(m => bloco('🚪 Isolamento a decidir: ' + m.rotulo,
        el('p', { class: 'texto-suave' }, `coleta ${m.item.DataColeta} · sugestão: ${m.item.Sugestao || 'Contato'}`),
        el('button', { class: 'botao-secundario', onclick: () => navegar('isolamentos') }, 'Decidir na aba Isolamentos →'))));
  }

  desenharLista();
}
