/* Aba "Colonização": controle das culturas de vigilância (swabs) em 4 abas internas —
   nasal em adulto, retal/orofaringe fora da UTI, UTI adulto (semanal) e outros. O cálculo
   vive em js/colonizacao.js (puro); aqui é apresentação e as ações "visto" e
   "descolonização" (gravadas na própria cultura, com rastro de edição). */

const COLONIZACAO_ABAS = [
  ['nasal_adulto', 'Nasal — adultos', 'Rastreio de MRSA (pré-operatório de cirurgia cardíaca).'],
  ['admissao_adulto', 'Retal/orofaringe — fora da UTI', 'Admissão e transferidos de outras instituições: gram-negativos resistentes.'],
  ['uti_adulto', 'Retal/orofaringe — UTI adulto', 'Vigilância semanal da UTI (4º dia e a cada 7): aquisições e clusters.'],
  ['outros', 'Outros', 'Neonatal/pediátrica, pesquisa de SGB e swabs sem sítio identificado no laudo.']
];

async function montarColonizacao(conteudo) {
  conteudo.append(el('h1', {}, 'Vigilância de colonização (swabs)'));
  const bancos = {};
  for (const n of ['culturas', 'pacientes', 'isolamentos', 'cirurgias', 'denominadores']) {
    try { bancos[n] = await lerBanco(n); } catch (e) { bancos[n] = {}; }
  }
  const estado = { aba: app.colonizacaoAba || 'uti_adulto', dias: app.colonizacaoDias || 90 };
  const area = el('div', {});
  conteudo.append(area);

  function desenhar() {
    let painel;
    try { painel = painelColonizacao(bancos, hojeISO(), { dias: estado.dias }); }
    catch (e) { area.replaceChildren(el('div', { class: 'cartao aviso-erro' }, 'Erro ao montar o painel: ' + e.message)); return; }
    const selDias = el('select', {}, [30, 90, 180, 365].map(d => el('option', { value: d, selected: d === estado.dias ? '' : null }, `últimos ${d} dias`)));
    selDias.addEventListener('change', () => { estado.dias = Number(selDias.value); app.colonizacaoDias = estado.dias; desenhar(); });

    const alertasPorTipo = t => painel.alertas.filter(a => a.tipo === t);
    const cartaoAlertas = painel.alertas.length ? el('div', { class: 'aviso-erro' },
      el('div', { class: 'alerta-titulo' }, `Alertas (${painel.alertas.length})`),
      ...[['sem_precaucao', '🦠 MDR em swab sem precaução de contato'], ['sgb', '🤰 Streptococcus do grupo B'], ['sem_swab', '⏱ UTI: sem swab há mais de ' + COLONIZACAO_DIAS_SEM_SWAB_UTI + ' dias'], ['cluster', '⚠ Possível transmissão cruzada na UTI']]
        .filter(([t]) => alertasPorTipo(t).length)
        .map(([t, rotulo]) => el('details', { open: t === 'sem_precaucao' ? '' : null },
          el('summary', {}, `${rotulo} (${alertasPorTipo(t).length})`),
          ...alertasPorTipo(t).slice(0, 25).map(a => el('div', { class: 'alerta-item' + (a.swab ? ' linha-clicavel' : ''),
            onclick: a.swab ? () => abrirPaciente(a.swab.prontuario) : null }, a.texto)),
          alertasPorTipo(t).length > 25 ? el('div', { class: 'texto-suave' }, `… e mais ${alertasPorTipo(t).length - 25}.`) : null)))
      : el('div', { class: 'cartao' }, el('p', { class: 'texto-suave' }, 'Nenhum alerta no período.'));

    const abasEl = el('div', { class: 'abas-tela' }, ...COLONIZACAO_ABAS.map(([id, rotulo]) => {
      const r = painel.abas[id].resumo;
      return el('button', { class: 'aba-tela' + (estado.aba === id ? ' aba-tela-atual' : ''),
        onclick: () => { estado.aba = id; app.colonizacaoAba = id; desenhar(); } },
        `${rotulo} (${r.swabs}${r.positivos ? ' · ' + r.positivos + ' MDR' : ''})`);
    }));

    const [, rotuloAba, descricao] = COLONIZACAO_ABAS.find(([id]) => id === estado.aba);
    const dadosAba = painel.abas[estado.aba];
    const r = dadosAba.resumo;
    const numeros = [['Swabs', r.swabs], ['Pacientes', r.pacientes], ['Positivos MDR', r.positivos], ['Pacientes com MDR', r.pacientesPositivos],
      ['MDR sem precaução', r.semPrecaucao], ['SGB', r.sgb], ['Positivos não vistos', r.naoVistos]];
    if (estado.aba === 'nasal_adulto') numeros.push(['MRSA', r.mrsa], ['MRSA sem descolonização', r.mrsaSemDescolonizacao]);

    const partes = [
      el('div', { class: 'linha-campos' }, el('label', {}, 'Período: ', selDias),
        painel.semSitio ? el('span', { class: 'texto-suave' }, `${fmtInt(painel.semSitio)} swab(s) do período sem sítio no laudo (ficam em "Outros").`) : null),
      cartaoAlertas, abasEl,
      el('div', { class: 'cartao' },
        el('p', { class: 'texto-suave' }, descricao),
        el('div', { class: 'grade-cartoes' }, ...numeros.map(([rot, n]) => el('div', { class: 'cartao cartao-numero' },
          el('div', { class: 'numero-grande' }, fmtInt(n || 0)), el('div', { class: 'texto-suave' }, rot)))),
        estado.aba === 'uti_adulto' ? blocoUti(painel) : null,
        tabelaSwabs(dadosAba.linhas, estado.aba))
    ];
    area.replaceChildren(...partes);
  }

  function blocoUti(painel) {
    const sem = painel.uti.semSwab;
    return el('div', {},
      el('h3', {}, 'Semana a semana (segunda a domingo)'),
      el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Semana', 'Swabs', 'Pacientes rastreados', 'Pacientes com MDR', 'Aquisições na UTI', 'Cluster'].map(c => el('th', {}, c)))),
        el('tbody', {}, painel.uti.semanas.map(w => el('tr', {},
          el('td', {}, w.semana.split('-').reverse().join('/') + ' a ' + w.ate.split('-').reverse().join('/')),
          el('td', {}, String(w.swabs)), el('td', {}, String(w.pacientes)), el('td', {}, String(w.positivos)),
          el('td', { class: w.aquisicoes ? 'aviso-erro-texto' : '' }, String(w.aquisicoes)),
          el('td', { class: w.cluster.length ? 'aviso-erro-texto' : '' }, w.cluster.join(', ') || '—'))))),
      el('p', { class: 'texto-suave' }, 'Aquisição = positivo para MDR com swab anterior negativo (até 45 dias) na UTI — colonização adquirida aqui. Cluster = 2 ou mais aquisições do mesmo mecanismo na semana.'),
      el('h3', {}, `Internados na UTI sem swab há mais de ${COLONIZACAO_DIAS_SEM_SWAB_UTI} dias (${sem.length})`),
      sem.length ? el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Paciente', 'Leito', 'Internado desde', 'Último swab', 'Dias sem swab'].map(c => el('th', {}, c)))),
        el('tbody', {}, sem.map(p => el('tr', { class: 'linha-clicavel', onclick: () => abrirPaciente(p.prontuario) },
          el('td', {}, p.nome), el('td', {}, p.leito), el('td', {}, p.internadoDesde), el('td', {}, p.ultimoSwab || 'nenhum'),
          el('td', { class: 'aviso-erro-texto' }, String(p.dias))))))
        : el('p', { class: 'texto-suave' }, 'Todos os internados na UTI têm swab recente (ou a foto dos internados não foi importada).'));
  }

  function tabelaSwabs(linhas, aba) {
    if (!linhas.length) return el('p', { class: 'texto-suave' }, 'Nenhum swab neste grupo no período.');
    const nasal = aba === 'nasal_adulto';
    const colunas = ['Coleta', 'Paciente', 'Setor', 'Sítio', 'Resultado', 'Precaução'].concat(nasal ? ['Cirurgia cardíaca', 'Descolonização'] : []).concat(['Visto', '']);
    return el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, colunas.map(c => el('th', {}, c)))),
      el('tbody', {}, linhas.slice(0, 300).map(s => {
        const resultado = s.positivo ? el('span', { class: 'bench-chip bench-nivel-4' }, (s.micro + ' · ' + s.mecanismo).trim())
          : s.sgb ? el('span', { class: 'bench-chip bench-nivel-2' }, 'SGB — ' + s.micro)
          : s.cresceu ? el('span', {}, s.micro + (s.mecanismo ? ' · ' + s.mecanismo : '')) : el('span', { class: 'texto-suave' }, 'negativo');
        return el('tr', { class: s.positivo && !s.emPrecaucao ? 'linha-alerta' : '' },
          el('td', {}, s.data), el('td', { class: 'linha-clicavel', onclick: () => abrirPaciente(s.prontuario) }, s.nome),
          el('td', {}, s.setor), el('td', {}, SITIOS_SWAB[s.sitio] || '—'), el('td', {}, resultado),
          el('td', {}, s.positivo ? (s.emPrecaucao ? '✓ contato' : el('span', { class: 'aviso-erro-texto' }, 'sem precaução')) : '—'),
          ...(nasal ? [
            el('td', {}, s.cirurgiaCardiaca ? `${s.cirurgiaCardiaca.ProcedimentoNHSN} em ${String(s.cirurgiaCardiaca.DataCirurgia).slice(0, 10)}` : '—'),
            el('td', {}, s.descolonizacao ? `✓ ${s.descolonizacao}${s.cultura.DescolonizacaoObs ? ' · ' + s.cultura.DescolonizacaoObs : ''}`
              : (/mrsa/i.test(s.mecanismo) ? el('button', { class: 'botao-secundario', onclick: e => formDescolonizacao(s, e.currentTarget.closest('tr')) }, 'registrar') : '—'))] : []),
          el('td', {}, s.visto ? `✓ ${s.cultura.VigilanciaVistoPor || ''}` : ((s.positivo || s.sgb)
            ? el('button', { class: 'botao-secundario', onclick: () => marcar(s, { VigilanciaVistoPor: app.usuario, VigilanciaVistoEm: agoraCurto() }, 'visto na vigilância de colonização') }, 'marcar visto') : '—')),
          el('td', {}, el('button', { class: 'botao-secundario', title: 'Ficha do paciente', onclick: () => abrirPaciente(s.prontuario) }, 'ficha')));
      })));
  }

  function formDescolonizacao(s, tr) {
    const data = el('input', { type: 'date', value: hojeISO() });
    const obs = el('input', { type: 'text', placeholder: 'esquema (ex.: mupirocina 5 d + clorexidina)', style: 'min-width:260px' });
    const msg = el('span', { class: 'aviso-erro-texto' });
    const cartao = el('div', { class: 'cartao cartao-detalhe' },
      el('h3', {}, 'Descolonização — ' + s.nome),
      el('div', { class: 'linha-campos' }, el('label', {}, 'Data: ', data), el('label', {}, 'Esquema: ', obs)),
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-primario', onclick: () => marcar(s, { DescolonizacaoEm: data.value, DescolonizacaoObs: obs.value.trim() }, 'descolonização registrada').catch(e => { msg.textContent = e.message; }) }, 'Salvar'),
        el('button', { class: 'botao-secundario', onclick: () => cartao.remove() }, 'Cancelar'), msg));
    detalharNaLinha(tr, cartao);
  }

  async function marcar(s, mudancas, nota) {
    await comTrava(['culturas'], async () => {
      const b = await lerBanco('culturas');
      const r = editarRegistro(b.culturas || [], { ID_Cultura: s.cultura.ID_Cultura }, mudancas, { quem: app.usuario, quando: agoraCurto(), nota });
      if (!r.registro) throw new Error('cultura não encontrada no banco');
      if (r.alteracoes.length) await gravarBanco('culturas', b);
    });
    bancos.culturas = await lerBanco('culturas');
    desenhar();
  }

  desenhar();
}
