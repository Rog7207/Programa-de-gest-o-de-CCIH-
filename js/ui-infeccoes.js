/* Aba Infecções (IRAS).

   Duas fontes, com pesos diferentes:
   - as culturas que a CCIH classificou como IRAS ou bacteremia secundária — é onde está
     hoje quase toda a informação (mais de mil), com setor, data, germe e resistência;
   - o banco `iras`, onde entram os casos investigados com topografia, critério e
     dispositivo associado. Um caso lá vale mais (é diagnóstico, não só isolado), mas hoje
     ele quase não tem nada.

   O painel mostra as duas e nunca soma uma na outra: uma cultura de IRAS é um isolado, um
   caso de IRAS é um diagnóstico, e o mesmo episódio pode aparecer nos dois. */

/* Um episódio de infecção rende várias culturas: hemocultura em dois frascos, urocultura de
   controle, secreção da mesma ferida. Contar isolados infla o numerador. Episódio = culturas
   do mesmo paciente dentro de uma janela — 14 dias, o mesmo corte que se usa para dizer que
   uma nova cultura já é outro episódio, e não a mesma infecção ainda em curso. */
const JANELA_EPISODIO_DIAS = 14;
function episodiosDeInfeccao(culturas, janelaDias) {
  const janela = (janelaDias === undefined ? JANELA_EPISODIO_DIAS : janelaDias) * 86400000;
  const porPaciente = new Map();
  for (const c of culturas) {
    const chave = normalizarProntuario(c.Prontuario);
    const data = Date.parse(String(c.DataColeta || '').slice(0, 10) + 'T00:00:00Z');
    if (!chave || !isFinite(data)) continue;
    if (!porPaciente.has(chave)) porPaciente.set(chave, []);
    porPaciente.get(chave).push({ data, cultura: c });
  }
  const episodios = [];
  for (const lista of porPaciente.values()) {
    lista.sort((a, b) => a.data - b.data);
    let atual = null;
    for (const item of lista) {
      if (atual && item.data - atual.ultima <= janela) {
        atual.ultima = item.data;
        atual.culturas.push(item.cultura);
      } else {
        atual = { ultima: item.data, culturas: [item.cultura], inicio: item.cultura };
        episodios.push(atual);
      }
    }
  }
  return episodios;
}

/* pacientesDia (denominador da densidade) vive em relatorios.js — os relatórios padrão
   usam o mesmo cálculo, e denominador de indicador não pode ter duas versões. */

function densidade(casos, diasPaciente) {
  if (!diasPaciente) return null;
  return Math.round(casos / diasPaciente * 1000 * 100) / 100;
}

async function montarInfeccoes(conteudo) {
  conteudo.append(el('h1', {}, 'Infecções relacionadas à assistência'));
  let bancoIras, bancoCulturas, bancoPacientes;
  try {
    [bancoIras, bancoCulturas, bancoPacientes] = await Promise.all([
      lerBanco('iras'), lerBanco('culturas'), lerBanco('pacientes')
    ]);
  } catch (e) { conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message)); return; }

  const culturas = bancoCulturas.culturas || [];
  const casos = bancoIras.casos || [];
  const internacoes = bancoPacientes.internacoes || [];
  const nomes = new Map((bancoPacientes.pacientes || []).map(p => [normalizarProntuario(p.Prontuario), p.Nome]));

  const ehInfeccao = c => /^IRAS/i.test(String(c.AvaliacaoCCIH || '')) || c.AvaliacaoCCIH === 'Bacteremia secundária';
  const ehAdmissao = c => c.AvaliacaoCCIH === 'Presente na admissão';
  const infeccoes = culturas.filter(ehInfeccao);
  if (!infeccoes.length && !casos.length) {
    conteudo.append(el('div', { class: 'cartao' }, el('p', { class: 'texto-suave' },
      'Nenhuma cultura classificada como IRAS e nenhum caso registrado. Classifique culturas na aba Culturas.')));
    return;
  }

  const datas = culturas.map(c => String(c.DataColeta || '').slice(0, 10)).filter(d => /^\d{4}-/.test(d)).sort();
  /* Abre nos últimos 12 meses: o histórico inteiro tem cinco anos e mistura períodos com
     critérios de classificação diferentes. */
  const ultimo = datas[datas.length - 1] || hojeISO();
  const umAnoAntes = new Date(Date.parse(ultimo + 'T00:00:00Z') - 365 * 86400000).toISOString().slice(0, 10);
  const campoDe = el('input', { type: 'date', value: umAnoAntes < (datas[0] || '') ? datas[0] : umAnoAntes });
  const campoAte = el('input', { type: 'date', value: ultimo });
  const setores = [...new Set(culturas.filter(ehInfeccao).map(c => String(c.Setor || '').trim()).filter(Boolean))].sort();
  const selSetor = el('select', {}, el('option', { value: '' }, 'todos os setores'),
    setores.map(s => el('option', { value: s }, s)));
  const selSerie = el('select', {}, [['mes', 'por mês'], ['semestre', 'por semestre'], ['ano', 'por ano']]
    .map(([v, r]) => el('option', { value: v }, r)));
  const area = el('div', {});

  [campoDe, campoAte, selSetor, selSerie].forEach(c => c.addEventListener('change', desenhar));
  conteudo.append(el('div', { class: 'cartao' },
    el('div', { class: 'linha-campos' },
      el('label', {}, 'De: ', campoDe), el('label', {}, 'Até: ', campoAte),
      el('label', {}, 'Setor: ', selSetor), el('label', {}, 'Série: ', selSerie)),
    el('div', { class: 'linha-botoes' },
      el('button', { class: 'botao-secundario', onclick: () => exportar() }, 'Exportar (Excel)'))),
    area);

  let filtradasAtuais = [];

  function noPeriodo(lista, campoData) {
    return lista.filter(x => {
      const data = String(x[campoData] || '').slice(0, 10);
      if (campoDe.value && data < campoDe.value) return false;
      if (campoAte.value && data > campoAte.value) return false;
      if (selSetor.value && String(x.Setor || '').trim() !== selSetor.value) return false;
      return true;
    });
  }

  /* ---- Confirmação de suspeitas: a segunda assinatura ----
     Toda tela que levanta suspeita de IRAS (revisão de culturas, avaliação remota, visita
     da UTI, pós-alta) abre o caso como "em investigação". A notificação oficial nasce
     AQUI, quando um segundo profissional confirma — ou morre como descartada, com o rastro
     de quem decidiu. */
  const areaSuspeitas = el('div', {});
  conteudo.insertBefore(areaSuspeitas, area);

  function desenharSuspeitas() {
    const suspeitas = casos.filter(k => k.StatusInvestigacao === 'em investigação')
      .sort((a, b) => String(b.DataInfeccao).localeCompare(String(a.DataInfeccao)));
    if (!suspeitas.length) { areaSuspeitas.replaceChildren(); return; }
    const tabela = el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Data', 'Paciente', 'Topografia', 'Setor', 'Origem', 'Notificou'].map(c => el('th', {}, c)))),
      el('tbody', {}, suspeitas.map(k => el('tr', { class: 'linha-clicavel', onclick: e => detalharSuspeita(k, e.currentTarget) },
        [k.DataInfeccao, nomes.get(normalizarProntuario(k.Prontuario)) || k.Prontuario, k.Topografia,
         k.Setor, k.CriterioDiagnostico, k.CriadoPor].map(v => el('td', {}, String(v || '')))))));
    areaSuspeitas.replaceChildren(el('div', { class: 'aviso-alerta' },
      el('div', { class: 'alerta-titulo' }, `${fmtInt(suspeitas.length)} suspeita(s) de IRAS aguardando confirmação`),
      el('div', { class: 'texto-suave' },
        'A notificação oficial só existe depois da segunda análise. Clique na linha para confirmar ou descartar.'),
      tabela));
  }

  function detalharSuspeita(caso, tr) {
    const topografias = (config.vocabulario.topografias || []);
    const selTopo = el('select', {},
      topografias.map(t => el('option', { value: t, selected: t === caso.Topografia ? '' : null }, t)),
      topografias.includes(caso.Topografia) ? null : el('option', { value: caso.Topografia, selected: '' }, caso.Topografia));
    const selDisp = el('select', {}, ['', 'CVC', 'VM', 'SVD', 'Nenhum'].map(d =>
      el('option', { value: d, selected: d === (caso.DispositivoAssociado || '') ? '' : null }, d || '—')));
    const campoMicro = el('input', { type: 'text', value: caso.Microrganismo || '', placeholder: 'microrganismo (opcional)' });
    const campoCriterio = el('input', { type: 'text', value: caso.CriterioDiagnostico || '', style: 'width:320px' });
    const campoNovaObs = el('textarea', { rows: 2, style: 'width:100%',
      placeholder: 'observação da segunda análise (opcional) — entra no diário do caso' });
    const msg = el('p', { class: 'aviso-erro-texto' });
    const mesmaPessoa = normalizarTexto(caso.CriadoPor) === normalizarTexto(app.usuario);

    async function decidir(statusNovo) {
      try {
        await comTrava(['iras', 'cirurgias'], async () => {
          const atualIras = await lerBanco('iras');
          const alvo = atualIras.casos.find(k => k.ID_IRAS === caso.ID_IRAS);
          if (!alvo) throw new Error('Caso não encontrado no banco.');
          alvo.Topografia = selTopo.value;
          alvo.DispositivoAssociado = selDisp.value;
          alvo.Microrganismo = campoMicro.value;
          alvo.CriterioDiagnostico = campoCriterio.value;
          alvo.Observacoes = acrescentarObservacao(alvo.Observacoes,
            'Segunda análise', campoNovaObs.value, app.usuario, agoraCurto());
          alvo.StatusInvestigacao = statusNovo;
          alvo.ConfirmadoPor = app.usuario;
          alvo.ConfirmadoEm = hojeISO();
          await gravarBanco('iras', atualIras);
          /* Suspeita que veio da vigilância pós-alta fecha o ciclo lá também. */
          const atualCir = await lerBanco('cirurgias');
          const cirurgia = atualCir.cirurgias.find(c => c.ID_IRAS === caso.ID_IRAS);
          if (cirurgia) {
            if (statusNovo === 'confirmado') {
              cirurgia.StatusVigilancia = 'infecção confirmada';
              cirurgia.ValidadoPor = app.usuario;
              cirurgia.ValidadoEm = hojeISO();
            } else {
              cirurgia.StatusVigilancia = 'sem infecção';
              cirurgia.ISC = ''; cirurgia.TipoISC = '';
            }
            await gravarBanco('cirurgias', atualCir);
          }
        });
        navegar('iras', { historico: 'substituir' });
      } catch (e) { msg.textContent = e.message; }
    }

    const cartao = el('div', { class: 'cartao cartao-detalhe' },
      el('h2', {}, 'Segunda análise — ' + (nomes.get(normalizarProntuario(caso.Prontuario)) || caso.Prontuario)),
      el('p', { class: 'texto-suave' },
        `Notificado por ${caso.CriadoPor || '?'} em ${String(caso.CriadoEm || '').slice(0, 10)} · ${caso.CriterioDiagnostico || ''}`),
      mesmaPessoa ? el('p', { class: 'aviso-erro-texto' },
        '⚠ Você mesmo abriu esta suspeita — o ideal é que outro profissional faça a confirmação.') : null,
      el('div', { class: 'linha-campos' },
        el('label', {}, 'Topografia: ', selTopo),
        el('label', {}, 'Dispositivo: ', selDisp)),
      el('div', { class: 'linha-campos' },
        el('label', {}, 'Microrganismo: ', campoMicro),
        el('label', {}, 'Critério: ', campoCriterio)),
      String(caso.Observacoes || '').trim()
        ? el('p', { class: 'texto-suave', style: 'white-space:pre-line;border-left:3px solid #ccc;padding-left:8px' },
            caso.Observacoes)
        : null,
      campoNovaObs,
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-secundario', onclick: e => { e.stopPropagation(); abrirPaciente(caso.Prontuario); } },
          'Ver ficha do paciente'),
        el('button', { class: 'botao-primario', onclick: () => decidir('confirmado') }, '✓ Confirmar notificação'),
        el('button', { class: 'botao-secundario', onclick: () => decidir('descartado') }, 'Descartar suspeita')),
      msg);
    detalharNaLinha(tr, cartao);
  }
  desenharSuspeitas();

  function desenhar() {
    const doPeriodo = noPeriodo(culturas, 'DataColeta');
    const inf = doPeriodo.filter(ehInfeccao);
    const adm = doPeriodo.filter(ehAdmissao);
    const pendentes = doPeriodo.filter(c => c.StatusRevisao === 'pendente' && c.Microrganismo);
    const casosPeriodo = noPeriodo(casos, 'DataInfeccao');
    filtradasAtuais = inf;

    const dias = pacientesDia(internacoes, campoDe.value, campoAte.value);
    const comMecanismo = inf.filter(c => String(c.MecanismoResistencia || '').trim());
    const episodios = episodiosDeInfeccao(inf);

    const cartaoNumero = (valor, rotulo, dica, acao) => el('div', {
      class: 'cartao cartao-numero' + (acao ? ' linha-clicavel' : ''), title: dica || '', onclick: acao || null
    }, el('div', { class: 'numero-grande' }, valor), el('div', { class: 'texto-suave' }, rotulo));

    /* A fila de revisão é parte do resultado, não um detalhe: um mês com muita cultura por
       classificar parece um mês sem infecção. Sem este aviso o gráfico mente. */
    const avisoPendentes = pendentes.length ? el('div', { class: 'aviso-alerta' },
      el('div', { class: 'alerta-titulo' },
        `${fmtInt(pendentes.length)} culturas positivas do período ainda não foram classificadas`),
      el('div', { class: 'texto-suave' },
        'Enquanto elas estiverem pendentes, os meses recentes aparecem com menos infecções do que realmente tiveram.'),
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-secundario', onclick: () => { app.filtroCulturas = { status: 'pendente' }; navegar('culturas'); } },
          'Ir para a revisão'))) : null;

    /* A densidade usa episódios, não isolados: duas hemoculturas do mesmo dia são uma
       infecção, e contá-las duas vezes inflaria a taxa. */
    const densidadeGlobal = densidade(episodios.length, dias);

    /* Série: IRAS × presentes na admissão. A comparação é o que separa "o hospital está
       infectando" de "a cidade está mandando gente infectada". */
    const chaves = new Map();
    const registrar = (lista, grupo) => {
      for (const c of lista) {
        const chave = chavePeriodo(String(c.DataColeta || '').slice(0, 10), selSerie.value);
        if (!chave) continue;
        if (!chaves.has(chave)) chaves.set(chave, { IRAS: 0, Admissão: 0 });
        chaves.get(chave)[grupo]++;
      }
    };
    registrar(inf, 'IRAS');
    registrar(adm, 'Admissão');
    const periodos = [...chaves.keys()].sort();
    const series = new Map([
      ['IRAS', periodos.map(p => chaves.get(p).IRAS)],
      ['Presente na admissão', periodos.map(p => chaves.get(p).Admissão)]
    ]);

    /* Densidade por setor: só dos setores que têm pacientes-dia no período. Setor sem
       denominador entra na contagem mas fica sem taxa, em vez de virar uma taxa inventada. */
    const porSetor = new Map();
    for (const c of inf) {
      const s = String(c.Setor || '').trim() || '(não informado)';
      porSetor.set(s, (porSetor.get(s) || 0) + 1);
    }
    const episodiosPorSetor = new Map();
    for (const e of episodios) {
      const s = String(e.inicio.Setor || '').trim() || '(não informado)';
      episodiosPorSetor.set(s, (episodiosPorSetor.get(s) || 0) + 1);
    }
    const linhasSetor = [...porSetor.entries()].sort((a, b) => b[1] - a[1])
      .map(([setor, n]) => ({ setor, n, episodios: episodiosPorSetor.get(setor) || 0 }));

    /* replaceChildren nativo transforma null no TEXTO "null" — filtrar antes. */
    area.replaceChildren(...[
      avisoPendentes,
      el('div', { class: 'grade-cartoes' },
        cartaoNumero(fmtInt(episodios.length), 'episódios de IRAS',
          `Culturas do mesmo paciente em até ${JANELA_EPISODIO_DIAS} dias contam como um episódio`),
        cartaoNumero(fmtInt(inf.length), 'isolados classificados como IRAS',
          'Culturas classificadas como IRAS ou bacteremia secundária'),
        cartaoNumero(fmtInt(adm.length), 'isolados presentes na admissão', 'Para comparação — não são IRAS'),
        cartaoNumero(densidadeGlobal === null ? '—' : densidadeGlobal.toFixed(2),
          'episódios por 1.000 pacientes-dia',
          dias ? `Denominador: ${fmtInt(Math.round(dias))} pacientes-dia no período`
            : 'Sem internações importadas cobrindo este período'),
        cartaoNumero(fmtInt(comMecanismo.length), 'com mecanismo de resistência',
          'IRAS por germe multirresistente'),
        cartaoNumero(fmtInt(casosPeriodo.filter(k => k.StatusInvestigacao === 'confirmado').length),
          'notificações confirmadas',
          'Casos de IRAS com as duas assinaturas (quem notificou e quem confirmou)'),
        cartaoNumero(fmtInt(casos.filter(k => k.StatusInvestigacao === 'em investigação').length),
          'suspeitas aguardando confirmação', 'Ver o quadro no topo desta aba')),

      dias ? null : el('div', { class: 'aviso-alerta' },
        el('div', { class: 'alerta-titulo' }, 'Sem denominador para este período'),
        el('div', { class: 'texto-suave' },
          'As internações importadas não cobrem o intervalo escolhido, então só dá para contar '
          + 'infecções — não medir risco. Importe o censo de internações do período para ter as densidades.')),

      el('div', { class: 'cartao' },
        el('h2', {}, 'IRAS × presentes na admissão'),
        periodos.length ? el('div', {}, grafLinhas(periodos, series), legendaSeries(series),
          el('p', { class: 'texto-suave' },
            'Contagem de isolados. A linha da admissão é o pano de fundo: quando as duas sobem juntas, '
            + 'costuma ser mudança no volume de exames, não no risco do hospital.'))
          : el('p', { class: 'texto-suave' }, 'sem dados no período')),

      el('div', { class: 'cartao' },
        el('h2', {}, 'Por setor'),
        el('p', { class: 'texto-suave' },
          'Contagem, não taxa. O censo de internações registra o setor por onde o paciente entrou '
          + '(a maioria cai em "Emergência"), não onde ele ficou — então não há pacientes-dia por '
          + 'setor para servir de denominador. Quando o censo trouxer as passagens de setor, as '
          + 'densidades por unidade entram aqui.'),
        linhasSetor.length ? el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['Setor', 'Episódios', 'Isolados'].map(c => el('th', {}, c)))),
          el('tbody', {}, linhasSetor.map(l => el('tr', {
            /* "(não informado)" não existe como opção do seletor: clicar nele fazia o
               select voltar calado para "todos", parecendo filtrar sem filtrar. */
            class: l.setor === '(não informado)' ? '' : 'linha-clicavel',
            onclick: l.setor === '(não informado)' ? null : () => { selSetor.value = l.setor; desenhar(); }
          },
            el('td', {}, l.setor), el('td', {}, fmtInt(l.episodios)), el('td', {}, fmtInt(l.n))))))
          : el('p', { class: 'texto-suave' }, 'sem dados no período')),

      el('div', { class: 'grade-graficos' },
        grafBarras('Microrganismos nas IRAS', contarPor(inf, 'Microrganismo', 10)),
        grafBarras('Mecanismos de resistência', contarPor(comMecanismo, 'MecanismoResistencia', 10))),

      el('div', { class: 'cartao' },
        el('h2', {}, 'Casos investigados'),
        casosPeriodo.length ? el('div', {},
          el('p', { class: 'texto-suave' }, 'Do banco IRAS — com topografia, dispositivo e critério.'),
          el('table', { class: 'tabela' },
            el('thead', {}, el('tr', {}, ['Data', 'Paciente', 'Setor', 'Topografia', 'Microrganismo', 'Situação', 'Notificou / Confirmou'].map(c => el('th', {}, c)))),
            el('tbody', {}, casosPeriodo.slice(0, 200).map(k => el('tr', { class: 'linha-clicavel', onclick: () => abrirPaciente(k.Prontuario) },
              [k.DataInfeccao, nomes.get(normalizarProntuario(k.Prontuario)) || k.Prontuario, k.Setor,
               k.Topografia, k.Microrganismo, k.StatusInvestigacao,
               [k.CriadoPor, k.ConfirmadoPor].filter(Boolean).join(' / ')].map(v => el('td', {}, String(v || ''))))))))
          : el('p', { class: 'texto-suave' },
              'Nenhum caso investigado registrado neste período. Os casos entram ao classificar uma cultura '
              + 'como IRAS na aba Culturas (que pede a topografia) ou importando um relatório de IRAS.')),

      el('div', { class: 'cartao' },
        el('h2', {}, 'Isolados classificados como IRAS'),
        el('p', { class: 'texto-suave' }, fmtInt(inf.length) + ' isolados' + (inf.length > 300 ? ' (mostrando 300)' : '')),
        el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['Coleta', 'Paciente', 'Setor', 'Material', 'Microrganismo', 'Mecanismo', 'Classificação'].map(c => el('th', {}, c)))),
          el('tbody', {}, inf.slice().sort((a, b) => String(b.DataColeta).localeCompare(String(a.DataColeta)))
            .slice(0, 300).map(c => el('tr', { class: 'linha-clicavel', onclick: () => abrirPaciente(c.Prontuario) },
              [c.DataColeta, nomes.get(normalizarProntuario(c.Prontuario)) || c.Prontuario, c.Setor, c.Material,
               c.Microrganismo, c.MecanismoResistencia, c.AvaliacaoCCIH].map(v => el('td', {}, String(v || ''))))))))
    ].filter(Boolean));
  }

  function exportar() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtradasAtuais.map(c => ({
      Coleta: c.DataColeta, Prontuario: c.Prontuario,
      Paciente: nomes.get(normalizarProntuario(c.Prontuario)) || '', Setor: c.Setor,
      Material: c.Material, Microrganismo: c.Microrganismo, Mecanismo: c.MecanismoResistencia,
      Classificacao: c.AvaliacaoCCIH
    }))), 'iras_isolados');
    const porSetor = new Map();
    filtradasAtuais.forEach(c => {
      const s = String(c.Setor || '').trim() || '(não informado)';
      porSetor.set(s, (porSetor.get(s) || 0) + 1);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...porSetor.entries()].map(([setor, n]) => ({
      Setor: setor, Isolados: n
    }))), 'por_setor');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(noPeriodo(casos, 'DataInfeccao')), 'casos_investigados');
    XLSX.writeFile(wb, 'infeccoes-' + hojeISO() + '.xlsx');
  }

  desenhar();
}
