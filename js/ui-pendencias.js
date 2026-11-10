/* Aba "Pendências por paciente" (10/11/2026) — FASE 3 da migração: gravação habilitada.

   Mostra tudo que está aberto para a equipe decidir agrupado por paciente, com o contexto
   que hoje se repete em cada aba (internação, antibióticos em curso, culturas recentes,
   última evolução médica). Cultura e antibiótico são decididos AQUI pelos formulários
   compartilhados de ui-formularios.js (mesmo código e mesmo registro das abas de origem, que
   continuam existindo); suspeita de IRAS e isolamento ainda levam à aba de origem. "Salvar e
   próximo" grava só os blocos com decisão marcada e abre o paciente seguinte da lista. */

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
    el('div', { class: 'alerta-titulo' }, 'Em teste (fase 3 da migração)'),
    el('div', { class: 'texto-suave' }, 'Culturas e antibióticos podem ser decididos aqui: marque a decisão nos blocos que quiser e clique "Salvar e próximo paciente" — grava exatamente o mesmo registro das abas Culturas e Antibióticos, que continuam funcionando. Suspeita de IRAS e isolamento ainda são decididos nas abas de origem (botão no bloco). Pacientes internados vêm antes dos que já tiveram alta.')));
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

  /* Paciente aberto sobrevive à regravação da tela (app.pendenciaAberta = chave de identidade). */
  let escolhido = (app.pendenciaAberta && lista.find(p => p.chave === app.pendenciaAberta)) || null;
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
        el('div', { class: 'texto-suave' }, `${p.prontuarios.join(' / ')} · ${p.setor || 'sem setor'}${p.leito ? ' · leito ' + p.leito : ''}${p.diaInternacao ? ' · D' + p.diaInternacao : ''}${p.internado ? '' : ' · já teve alta'}`),
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
    const irCulturas = pront => el('button', { class: 'botao-link', onclick: () => { app.filtroCulturas = { status: 'pendente', setor: '', busca: pront, de: '', ate: '' }; navegar('culturas'); } }, 'abrir na aba Culturas →');
    const irAtb = chave => el('button', { class: 'botao-link', onclick: () => { app.cursoAberto = chave; navegar('antibioticos'); } }, 'abrir na aba Antibióticos →');
    /* Formulários compartilhados, com "— sem decisão —" como primeira opção: só o que for
       marcado é gravado. */
    const forms = [];
    const formCultura = c => { const f = formularioClassificacaoCultura(c.amostras, { permitirVazio: true }); forms.push({ tipo: 'cultura', f, rotulo: c.rotulo }); return f.no; };
    const formAtb = a => { const f = formularioAvaliacaoAntibiotico(a.curso, { permitirVazio: true, hoje }); forms.push({ tipo: 'atb', f, rotulo: a.rotulo }); return f.no; };
    const msg = el('p', { class: 'aviso-erro-texto' });
    async function salvarDecisoes(irParaProximo) {
      const marcados = forms.filter(x => x.f.temDecisao());
      if (!marcados.length) { msg.textContent = 'Nenhuma decisão marcada — escolha a classificação ou a avaliação nos blocos.'; return; }
      msg.textContent = '';
      try {
        for (const x of marcados) {
          if (x.tipo === 'cultura') await x.f.salvar({ pacientes: bancos.pacientes.pacientes });
          else await x.f.salvar();
        }
      } catch (e) { msg.textContent = 'Erro ao gravar: ' + e.message; return; }
      const itens = filtrados();
      const pos = itens.indexOf(p);
      const proximo = irParaProximo ? (itens[pos + 1] || itens[pos - 1] || null) : p;
      app.pendenciaAberta = proximo ? proximo.chave : null;
      navegar('pendencias', { historico: 'substituir' });
    }

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
          (sensPorCultura.get(c.cultura.ID_Cultura) || []).length ? gradeSIR(sensPorCultura.get(c.cultura.ID_Cultura)) : null,
          formCultura(c)),
        irCulturas(c.cultura.Prontuario))),
      ...p.pendencias.antibioticos.map(a => bloco('💊 Antibiótico a avaliar: ' + a.rotulo,
        el('div', {}, el('p', { class: 'texto-suave' }, `desde ${a.curso.inicio} · dose ${a.curso.ultima.Dose || '—'} · ${a.curso.Setor || ''}`
          + (culturas30.some(c => (sensPorCultura.get(c.ID_Cultura) || []).some(s => normalizarTexto(s.Antibiotico) === normalizarTexto(a.curso.Antibiotico) && s.Resultado === 'R')) ? ' · 🦠 germe recente resistente a este antibiótico' : '')),
          formAtb(a)),
        irAtb(a.chave))),
      ...p.pendencias.iras.map(k => bloco('⚠ Suspeita de IRAS a confirmar: ' + k.rotulo,
        el('p', { class: 'texto-suave', style: 'white-space:pre-line' }, [k.caso.Setor, k.caso.DispositivoAssociado && k.caso.DispositivoAssociado !== 'Nenhum' ? k.caso.DispositivoAssociado : '', k.caso.Microrganismo, k.caso.Observacoes].filter(Boolean).join(' · ')),
        el('button', { class: 'botao-secundario', onclick: () => { app.abaInfeccoes = 'confirmar'; navegar('iras'); } }, 'Confirmar na aba Infecções →'))),
      ...p.pendencias.isolamentos.map(m => bloco('🚪 Isolamento a decidir: ' + m.rotulo,
        el('p', { class: 'texto-suave' }, `coleta ${m.item.DataColeta} · sugestão: ${m.item.Sugestao || 'Contato'}`),
        el('button', { class: 'botao-secundario', onclick: () => navegar('isolamentos') }, 'Decidir na aba Isolamentos →'))),
      forms.length ? el('div', { class: 'linha-botoes', style: 'margin-top:10px' },
        el('button', { class: 'botao-primario', onclick: () => salvarDecisoes(true) }, 'Salvar e próximo paciente'),
        el('button', { class: 'botao-secundario', onclick: () => salvarDecisoes(false) }, 'Salvar e ficar neste paciente'),
        el('span', { class: 'texto-suave' }, 'só os blocos com decisão marcada são gravados')) : null,
      msg);
  }

  desenharLista();
}
