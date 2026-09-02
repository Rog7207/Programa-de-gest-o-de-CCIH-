/* Aba Antibióticos: alertas, fila de avaliação (como a de culturas) e indicadores de uso.

   A unidade de trabalho é o CURSO (janelas de prescrição contíguas do mesmo paciente com o
   mesmo antibiótico, fundidas por cursosDeAntibiotico) — o extrato do hospital renova a
   prescrição a cada 1-3 dias, e avaliar linha a linha pediria a mesma avaliação de novo a
   cada renovação. A avaliação vale para o curso: só volta à fila se ele seguir correndo
   uma semana depois dela. */

const AVALIACOES_ATB = ['Correto', 'Parcialmente correto', 'Incorreto'];
const RECOMENDACOES_ATB = ['Manter', 'Ajustar dose', 'Descalonar', 'Modificar', 'Suspender'];
const DIAS_REVALIDAR_AVALIACAO = 7;

async function montarAntibioticosNovo(conteudo) {
  conteudo.append(el('h1', {}, 'Antibióticos'));
  let banco, bancoPacientes, bancoCulturas, bancoUti;
  try {
    [banco, bancoPacientes, bancoCulturas, bancoUti] = await Promise.all([
      lerBanco('antibioticos'), lerBanco('pacientes'), lerBanco('culturas'),
      lerBanco('uti').catch(() => ({ avaliacoes_atb: [] }))]);
  } catch (e) { conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message)); return; }

  const hoje = hojeISO();
  const prescricoes = banco.prescricoes || [];
  /* As avaliações feitas na visita da UTI valem aqui também: as novas já entram copiadas
     pela importação; as antigas (de antes da integração) são somadas na leitura. */
  const avaliacoes = (banco.avaliacoes || []).concat(
    (bancoUti.avaliacoes_atb || []).map(a => ({
      Prontuario: a.Prontuario, Antibiotico: a.Antibiotico, Avaliacao: a.Avaliacao,
      Recomendacao: a.Recomendacao, DataDados: a.Data, CriadoEm: a.CriadoEm
    })));
  if (!prescricoes.length) {
    conteudo.append(el('div', { class: 'cartao' }, el('p', { class: 'texto-suave' },
      'Nenhuma prescrição importada. Na aba Importar, use o extrato de antibióticos do hospital.')));
    return;
  }
  const nomes = new Map(bancoPacientes.pacientes.map(p => [normalizarProntuario(p.Prontuario), p.Nome]));
  const nomeDe = pront => nomes.get(normalizarProntuario(pront)) || pront;
  const sensPorCultura = new Map();
  (bancoCulturas.sensibilidade || []).forEach(s => {
    if (!sensPorCultura.has(s.ID_Cultura)) sensPorCultura.set(s.ID_Cultura, []);
    sensPorCultura.get(s.ID_Cultura).push(s);
  });

  const cursos = cursosDeAntibiotico(prescricoes);
  const ativos = cursos.filter(c => String(c.fim) >= hoje)
    .sort((a, b) => b.dias - a.dias);
  const alertas = alertasDeAntibioticos({ antibioticos: banco, culturas: bancoCulturas }, hoje);
  /* Por chave, não por referência: alertasDeAntibioticos monta os próprios cursos. */
  const chaveCurso = c => normalizarProntuario(c.Prontuario) + '|' + normalizarTexto(c.Antibiotico) + '|' + c.inicio;
  const alertasDoCurso = curso => alertas.filter(a => chaveCurso(a.curso) === chaveCurso(curso));

  /* Avaliação recente do curso: qualquer uma dos IDs dele, ou do par paciente+droga,
     nos últimos DIAS_REVALIDAR dias. */
  const avaliacaoRecente = curso => avaliacoes.some(a => {
    if (normalizarProntuario(a.Prontuario) !== normalizarProntuario(curso.Prontuario)) return false;
    if (normalizarTexto(a.Antibiotico) !== normalizarTexto(curso.Antibiotico)) return false;
    const dias = diasDesde(a.DataDados || a.CriadoEm, hoje);
    return dias !== null && dias <= DIAS_REVALIDAR_AVALIACAO;
  });
  /* Rotina da instituição: só entram na fila os antibióticos avaliados rotineiramente
     (Configurações → Rotina). Lista vazia = todos. Os demais seguem nos indicadores. */
  const foraDaRotina = ativos.filter(c => !config.ehAtbAvaliado(c.Antibiotico)).length;
  const pendentes = ativos.filter(c => config.ehAtbAvaliado(c.Antibiotico) && !avaliacaoRecente(c));
  const pacientesEmATB = new Set(ativos.map(c => normalizarProntuario(c.Prontuario))).size;

  conteudo.append(el('div', { class: 'grade-cartoes' }, ...[
    ['cursos ativos hoje', ativos.length],
    ['pacientes em antibiótico', pacientesEmATB],
    ['pendentes de avaliação', pendentes.length],
    ['alertas', alertas.length],
    ['avaliações registradas', avaliacoes.length]
  ].map(([r, n]) => el('div', { class: 'cartao cartao-numero' },
    el('div', { class: 'numero-grande' }, fmtInt(n)), el('div', { class: 'texto-suave' }, r)))));

  /* ---- Alertas ---- */
  if (alertas.length) {
    const ICONE = { resistencia: '🦠', dose: '💊', duracao: '⏱' };
    conteudo.append(el('div', { class: 'aviso-erro' },
      el('div', { class: 'alerta-titulo' }, `Alertas de antimicrobianos (${alertas.length})`),
      alertas.slice(0, 12).map(a => el('div', { class: 'alerta-item linha-clicavel',
        onclick: () => abrirPaciente(a.curso.Prontuario) },
        `${ICONE[a.tipo]} ${nomeDe(a.curso.Prontuario)} (${a.curso.Setor || 'sem setor'}): ${a.detalhe}`)),
      alertas.length > 12 ? el('div', { class: 'texto-suave' }, `… e mais ${alertas.length - 12}.`) : null));
  }

  /* ---- Fila de avaliação ---- */
  const areaFila = el('div', {});
  conteudo.append(el('div', { class: 'cartao' },
    el('h2', {}, `Fila de avaliação — ${fmtInt(pendentes.length)} cursos ativos`),
    el('p', { class: 'texto-suave' },
      'Como na revisão de culturas: clique no curso, avalie embaixo da própria linha. '
      + `A avaliação vale pelo curso — se ele continuar correndo, volta à fila em ${DIAS_REVALIDAR_AVALIACAO} dias.`
      + (foraDaRotina ? ` ${fmtInt(foraDaRotina)} curso(s) de antibióticos fora da rotina de avaliação não aparecem aqui (Configurações → Rotina).` : '')),
    areaFila));

  function desenharFila() {
    const mostrados = pendentes.slice(0, 150);
    areaFila.replaceChildren(el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Paciente', 'Antibiótico', 'Dose atual', 'Início', 'Dias', 'Setor', 'Alertas'].map(c => el('th', {}, c)))),
      el('tbody', {}, mostrados.map(curso => {
        const doCurso = alertasDoCurso(curso);
        return el('tr', { class: 'linha-clicavel', onclick: e => detalharCurso(curso, e.currentTarget) },
          el('td', {}, nomeDe(curso.Prontuario)),
          el('td', {}, curso.Antibiotico),
          el('td', {}, String(curso.ultima.Dose || '')),
          el('td', {}, curso.inicio),
          el('td', { class: curso.dias >= DIAS_CURSO_PROLONGADO ? 'aviso-erro-texto' : '' }, String(curso.dias)),
          el('td', {}, String(curso.Setor || '')),
          el('td', {}, doCurso.map(a => ({ resistencia: '🦠', dose: '💊', duracao: '⏱' })[a.tipo]).join(' ')));
      }))));
  }

  function detalharCurso(curso, tr) {
    const chavePaciente = normalizarProntuario(curso.Prontuario);
    const culturasRecentes = (bancoCulturas.culturas || [])
      .filter(c => normalizarProntuario(c.Prontuario) === chavePaciente
        && c.Microrganismo && c.StatusRevisao !== 'descartada'
        && (diasDesde(c.DataColeta, hoje) || 99) <= 30)
      .sort((a, b) => String(b.DataColeta).localeCompare(String(a.DataColeta)));
    const doCurso = alertasDoCurso(curso);
    const dose = analisarDose(curso.ultima.Dose);

    const selAval = el('select', {}, AVALIACOES_ATB.map(o => el('option', { value: o }, o)));
    const selRec = el('select', {}, RECOMENDACOES_ATB.map(o => el('option', { value: o }, o)));
    const campoParecer = el('textarea', { rows: 2, style: 'width:100%', placeholder: 'parecer (opcional)' });
    const msg = el('p', { class: 'aviso-erro-texto' });

    const cartao = el('div', { class: 'cartao cartao-detalhe' },
      el('h2', {}, `${curso.Antibiotico} — ${nomeDe(curso.Prontuario)}`),
      el('p', { class: 'texto-suave' },
        `${curso.Setor || ''} · curso desde ${curso.inicio} (${curso.dias} dias, ${curso.ids.length} renovações)`
        + (dose && dose.mgDia ? ` · ${(dose.mgDia / 1000).toFixed(1)} g/dia calculados` : '')),
      doCurso.length ? el('div', { class: 'aviso-alerta' },
        doCurso.map(a => el('div', {}, a.detalhe))) : null,
      culturasRecentes.length ? el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Coleta', 'Material', 'Microrganismo', 'Este ATB'].map(c => el('th', {}, c)))),
        el('tbody', {}, culturasRecentes.slice(0, 5).map(c => {
          const resultado = (sensPorCultura.get(c.ID_Cultura) || [])
            .find(s => normalizarTexto(s.Antibiotico) === normalizarTexto(curso.Antibiotico));
          return el('tr', {},
            el('td', {}, c.DataColeta), el('td', {}, c.Material), el('td', {}, c.Microrganismo),
            el('td', { class: resultado && resultado.Resultado === 'R' ? 'aviso-erro-texto' : '' },
              resultado ? resultado.Resultado : '—'));
        })))
        : el('p', { class: 'texto-suave' }, 'Sem cultura positiva nos últimos 30 dias.'),
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-secundario', onclick: e => { e.stopPropagation(); abrirPaciente(curso.Prontuario); } },
          'Ver ficha do paciente')),
      el('div', { class: 'linha-campos' },
        el('label', {}, 'Avaliação: ', selAval),
        el('label', {}, 'Recomendação: ', selRec)),
      campoParecer,
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-primario', onclick: async () => {
          try {
            await comTrava(['antibioticos'], async () => {
              const atual = await lerBanco('antibioticos');
              atual.avaliacoes = atual.avaliacoes || [];
              atual.avaliacoes.push({
                ID_Prescricao: curso.ultima.ID_Prescricao, Prontuario: curso.Prontuario,
                Antibiotico: curso.Antibiotico, Indicacao: curso.ultima.Indicacao || '',
                Avaliacao: selAval.value, Recomendacao: selRec.value, ParecerTexto: campoParecer.value,
                Avaliador: app.usuario, DataDados: hoje, CriadoEm: agoraCurto()
              });
              await gravarBanco('antibioticos', atual);
            });
            navegar('antibioticos', { historico: 'substituir' });
          } catch (e) { msg.textContent = e.message; }
        } }, 'Salvar avaliação')), msg);
    detalharNaLinha(tr, cartao);
  }

  desenharFila();

  /* ---- Indicadores de uso ---- */
  const datas = prescricoes.map(p => String(p.DataInicio).slice(0, 10)).filter(d => /^\d{4}/.test(d)).sort();
  const areaIndicadores = el('div', {});
  const selSerie = el('select', {}, [['semana', 'por semana'], ['mes', 'por mês']].map(([v, r]) => el('option', { value: v }, r)));
  selSerie.addEventListener('change', desenharIndicadores);
  conteudo.append(el('div', { class: 'cartao' },
    el('h2', {}, 'Indicadores de uso'),
    el('p', { class: 'texto-suave' },
      `Período do extrato: ${datas[0] || '—'} a ${datas[datas.length - 1] || '—'}. `
      + 'DOT = dias de terapia (cada dia de cada antibiótico em uso conta 1). '
      + 'Os gráficos crescem conforme os extratos diários forem importados.'),
    el('div', { class: 'linha-campos' },
      el('label', {}, 'Série: ', selSerie),
      el('button', { class: 'botao-secundario', onclick: exportar }, 'Exportar (Excel)')),
    areaIndicadores));

  /* Um dia-antibiótico por dia corrido de cada curso: base de todos os agrupamentos. */
  function diasDeTerapia() {
    const dias = [];
    for (const curso of cursos) {
      const inicio = Date.parse(curso.inicio + 'T00:00:00Z');
      for (let i = 0; i < curso.dias && i < 366; i++) {
        const data = new Date(inicio + i * 86400000).toISOString().slice(0, 10);
        dias.push({ data, curso });
      }
    }
    return dias;
  }

  function desenharIndicadores() {
    const dot = diasDeTerapia();
    const porPeriodo = new Map();
    for (const d of dot) {
      const chave = chavePeriodo(d.data, selSerie.value === 'semana' ? 'semana' : 'mes');
      if (chave) porPeriodo.set(chave, (porPeriodo.get(chave) || 0) + 1);
    }
    const periodos = [...porPeriodo.keys()].sort();
    const serie = new Map([['DOT', periodos.map(p => porPeriodo.get(p))]]);

    const contarDOT = extrator => {
      const m = new Map();
      dot.forEach(d => { const k = extrator(d.curso) || '(sem)'; m.set(k, (m.get(k) || 0) + 1); });
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const porATB = contarDOT(c => c.Antibiotico).slice(0, 12);
    const porSetor = contarDOT(c => String(c.Setor || '').trim()).slice(0, 12);
    const porClasse = contarDOT(c => config.classeDoAntimicrobiano(c.Antibiotico)).slice(0, 10);
    const temClasse = porClasse.some(([k]) => k !== '(sem)');

    const encerrados = cursos.filter(c => String(c.fim) < hoje);
    const duracaoMedia = encerrados.length
      ? (encerrados.reduce((s, c) => s + c.dias, 0) / encerrados.length).toFixed(1) : null;

    areaIndicadores.replaceChildren(
      periodos.length > 1 ? el('div', {}, grafLinhas(periodos, serie),
        el('p', { class: 'texto-suave' }, 'Dias de terapia por período.')) : null,
      el('div', { class: 'grade-graficos' },
        grafBarras('DOT por antibiótico', porATB),
        grafBarras('DOT por setor', porSetor)),
      temClasse ? grafBarras('DOT por classe (catálogo da farmácia)', porClasse) : el('p', { class: 'texto-suave' },
        'Importe o catálogo de antimicrobianos da farmácia para ver o uso agrupado por classe.'),
      duracaoMedia ? el('p', {}, el('strong', {}, 'Duração média dos cursos encerrados: '),
        duracaoMedia + ' dias (' + fmtInt(encerrados.length) + ' cursos)') : null);
  }
  desenharIndicadores();

  montarCartaoPublicacaoRemota(conteudo, banco, bancoPacientes, bancoCulturas);

  function exportar() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cursos.map(c => ({
      Prontuario: c.Prontuario, Paciente: nomeDe(c.Prontuario), Antibiotico: c.Antibiotico,
      Setor: c.Setor, Inicio: c.inicio, Fim: c.fim, Dias: c.dias, Renovacoes: c.ids.length,
      DoseAtual: c.ultima.Dose, Ativo: String(c.fim) >= hoje ? 'S' : 'N',
      Classe: config.classeDoAntimicrobiano(c.Antibiotico)
    }))), 'cursos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(alertas.map(a => ({
      Tipo: a.tipo, Paciente: nomeDe(a.curso.Prontuario), Antibiotico: a.curso.Antibiotico,
      Setor: a.curso.Setor, Detalhe: a.detalhe
    }))), 'alertas');
    XLSX.writeFile(wb, 'antibioticos-' + hoje + '.xlsx');
  }
}
