/* Aba Sepse: indicadores do protocolo institucional a partir da ficha de investigação
   preenchida pelos enfermeiros. Tudo é recalculado dos horários brutos — a planilha de
   origem tem colunas de tempo em parte digitadas à mão e em parte com fórmula, então
   reproduzir os cálculos aqui é o que torna o indicador auditável. */

/* Etapas do bundle da 1ª hora, na ordem em que acontecem à beira do leito. */
const ETAPAS_SEPSE = [
  { campo: 'SBAR', rotulo: 'Comunicação SBAR aberta' },
  { campo: 'HemoculturaAntesATB', rotulo: 'Hemoculturas antes do antibiótico' },
  { campo: 'AntibioticoAte1h', rotulo: 'Antibiótico em até 1 hora' },
  { campo: 'Lactato1h', rotulo: 'Lactato na 1ª hora' },
  { campo: 'SoroFisiologico1h', rotulo: 'Expansão volêmica na 1ª hora' },
  { campo: 'DebitoUrinario1h', rotulo: 'Débito urinário na 1ª hora' },
  { campo: 'O2ConformeProtocolo', rotulo: 'Oxigênio conforme protocolo' },
  { campo: 'Reavaliado1h', rotulo: 'Reavaliado na 1ª hora' },
  { campo: 'Reavaliado3h', rotulo: 'Reavaliado na 3ª hora' },
  { campo: 'BundleCompleto', rotulo: 'Bundle completo' }
];

const TEMPOS_SEPSE = [
  { campo: 'MinutosReavaliacaoNEWS', rotulo: 'NEWS → reavaliação do enfermeiro' },
  { campo: 'MinutosPrescricao', rotulo: 'Reavaliação do enfermeiro → prescrição' },
  { campo: 'MinutosChegadaMedico', rotulo: 'NEWS → chegada do médico' },
  { campo: 'MinutosAntibiotico', rotulo: 'NEWS → antibiótico' }
];

/* Proporção de "sim" entre as respostas preenchidas. Caso sem resposta não entra no
   denominador: contá-lo como falha puniria o serviço por falha de registro, e contá-lo
   como acerto esconderia o problema — os dois estariam errados, então fica de fora e o
   número de não respondidos aparece na tela. */
function conformidade(casos, campo) {
  const respondidos = casos.filter(c => c[campo] === 'S' || c[campo] === 'N');
  const sim = respondidos.filter(c => c[campo] === 'S').length;
  return {
    sim, respondidos: respondidos.length, semResposta: casos.length - respondidos.length,
    percentual: respondidos.length ? Math.round(sim / respondidos.length * 100) : null
  };
}

function mediana(numeros) {
  if (!numeros.length) return null;
  const ordenados = numeros.slice().sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : Math.round((ordenados[meio - 1] + ordenados[meio]) / 2);
}

/* Origem da infecção, do ponto de vista da terapia empírica: o que a CCIH classificou como
   IRAS (ou bacteremia secundária a ela) tem flora hospitalar; o que estava presente na
   admissão tem flora comunitária. Colonização e contaminação não são infecção e ficam de
   fora do perfil — entram apenas na contagem, para o total fechar. */
function origemDaCultura(cultura) {
  const classificacao = String(cultura.AvaliacaoCCIH || '').trim();
  if (/^IRAS/i.test(classificacao) || classificacao === 'Bacteremia secundária') return 'IRAS';
  if (classificacao === 'Presente na admissão') return 'Admissão';
  if (!classificacao || cultura.StatusRevisao === 'pendente') return 'Não classificada';
  return 'Outra classificação';
}

/* Culturas do mesmo paciente colhidas em torno da abertura do protocolo. A janela é curta
   de propósito: cultura de duas semanas depois já é outro episódio, não a sepse investigada. */
function culturasDoCaso(caso, culturasPorProntuario, diasAntes, diasDepois) {
  const lista = culturasPorProntuario.get(normalizarProntuario(caso.Prontuario)) || [];
  const protocolo = Date.parse(String(caso.DataProtocolo).slice(0, 10) + 'T00:00:00Z');
  if (!isFinite(protocolo)) return [];
  return lista.filter(c => {
    const coleta = Date.parse(String(c.DataColeta).slice(0, 10) + 'T00:00:00Z');
    if (!isFinite(coleta)) return false;
    const dias = (coleta - protocolo) / 86400000;
    return dias >= -diasAntes && dias <= diasDepois;
  });
}

/* Descarta o vazio ANTES de converter: Number('') é 0, e um caso sem horário registrado
   entraria como "zero minuto", derrubando a mediana para perto de zero. */
function minutosDe(casos, campo) {
  return casos
    .filter(c => c[campo] !== '' && c[campo] !== null && c[campo] !== undefined)
    .map(c => Number(c[campo]))
    .filter(v => isFinite(v) && v >= 0);
}

async function montarSepse(conteudo) {
  conteudo.append(el('h1', {}, 'Protocolo de sepse'));
  let banco, bancoPacientes, bancoCulturas;
  try {
    [banco, bancoPacientes, bancoCulturas] = await Promise.all([
      lerBanco('sepse'), lerBanco('pacientes'), lerBanco('culturas').catch(() => ({ culturas: [], sensibilidade: [] }))
    ]);
  } catch (e) {
    conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message));
    return;
  }
  const casos = banco.casos || [];
  if (!casos.length) {
    conteudo.append(el('div', { class: 'cartao' },
      el('p', { class: 'texto-suave' }, 'Nenhum caso importado ainda. Na aba Importar, escolha a planilha '
        + '"Ficha de investigação — Sepse" e o tipo "Protocolo de sepse".')));
    return;
  }
  const nomes = new Map(bancoPacientes.pacientes.map(p => [normalizarProntuario(p.Prontuario), p.Nome]));

  /* Culturas indexadas por paciente, para cruzar com os casos sem varrer o banco inteiro
     a cada caso — são dezenas de milhares de linhas. */
  const culturasPorProntuario = new Map();
  for (const c of (bancoCulturas.culturas || [])) {
    if (c.StatusRevisao === 'descartada') continue;
    const chave = normalizarProntuario(c.Prontuario);
    if (!culturasPorProntuario.has(chave)) culturasPorProntuario.set(chave, []);
    culturasPorProntuario.get(chave).push(c);
  }
  const mecanismoPorCultura = new Map((bancoCulturas.culturas || [])
    .filter(c => c.MecanismoResistencia).map(c => [c.ID_Cultura, c.MecanismoResistencia]));

  const datas = casos.map(c => String(c.DataProtocolo || '').slice(0, 10)).filter(d => /^\d{4}-/.test(d)).sort();
  const setores = [...new Set(casos.map(c => c.Setor).filter(Boolean))].sort();
  const campoDe = el('input', { type: 'date', value: datas[0] || hojeISO() });
  const campoAte = el('input', { type: 'date', value: datas[datas.length - 1] || hojeISO() });
  const selSetor = el('select', {}, el('option', { value: '' }, 'todos os setores'),
    setores.map(s => el('option', { value: s }, s)));
  const selPopulacao = el('select', {},
    el('option', { value: 'todos' }, 'todos os protocolos abertos'),
    el('option', { value: 'confirmados' }, 'apenas sepse confirmada'),
    el('option', { value: 'descartados' }, 'apenas sepse descartada'));
  const selGranularidade = el('select', {},
    [['mes', 'por mês'], ['semestre', 'por semestre'], ['ano', 'por ano']]
      .map(([v, r]) => el('option', { value: v }, r)));
  const selJanela = el('select', {},
    [['3', '3 dias'], ['2', '2 dias'], ['7', '7 dias'], ['14', '14 dias']]
      .map(([v, r]) => el('option', { value: v }, '± ' + r)));
  const area = el('div', {});

  [campoDe, campoAte, selSetor, selPopulacao, selGranularidade, selJanela].forEach(c => c.addEventListener('change', desenhar));
  conteudo.append(el('div', { class: 'cartao' },
    el('div', { class: 'linha-campos' },
      el('label', {}, 'De: ', campoDe), el('label', {}, 'Até: ', campoAte),
      el('label', {}, 'Setor: ', selSetor), el('label', {}, 'População: ', selPopulacao),
      el('label', {}, 'Série: ', selGranularidade),
      el('label', { title: 'Janela em torno da abertura do protocolo para vincular as culturas do paciente' },
        'Culturas em: ', selJanela)),
    el('div', { class: 'linha-botoes' },
      el('button', { class: 'botao-secundario', onclick: () => exportar() }, 'Exportar indicadores (Excel)'))),
    area);

  let filtradosAtuais = [];

  function filtrar() {
    return casos.filter(c => {
      if (c.ExcluidoIndicadores === 'S') return false;
      const data = String(c.DataProtocolo || '').slice(0, 10);
      if (!data) return false;
      if (campoDe.value && data < campoDe.value) return false;
      if (campoAte.value && data > campoAte.value) return false;
      if (selSetor.value && c.Setor !== selSetor.value) return false;
      if (selPopulacao.value === 'confirmados' && c.SepseConfirmada !== 'S') return false;
      if (selPopulacao.value === 'descartados' && c.SepseConfirmada !== 'N') return false;
      return true;
    });
  }

  /* Série temporal de um indicador: devolve os períodos e o valor de cada um. */
  function serie(lista, granularidade, calcular) {
    const porPeriodo = new Map();
    for (const c of lista) {
      const chave = chavePeriodo(String(c.DataProtocolo).slice(0, 10), granularidade);
      if (!chave) continue;
      if (!porPeriodo.has(chave)) porPeriodo.set(chave, []);
      porPeriodo.get(chave).push(c);
    }
    const periodos = [...porPeriodo.keys()].sort();
    return { periodos, valores: periodos.map(p => calcular(porPeriodo.get(p))) };
  }

  function barraPercentual(rotulo, r) {
    const cor = r.percentual === null ? '#c3ccd6' : r.percentual >= 80 ? '#14532d' : r.percentual >= 60 ? '#e5b95c' : '#b03a2e';
    return el('div', { class: 'barra-linha' },
      el('span', { class: 'barra-rotulo', title: rotulo }, rotulo),
      el('div', { class: 'barra-trilho' },
        el('div', { class: 'barra', style: `width:${r.percentual || 0}%;background:${cor}` })),
      el('span', { class: 'barra-num' },
        r.percentual === null ? '—' : r.percentual + '%'),
      el('span', { class: 'texto-suave', style: 'min-width:130px;text-align:right' },
        `${fmtInt(r.sim)}/${fmtInt(r.respondidos)}` + (r.semResposta ? ` · ${fmtInt(r.semResposta)} sem registro` : '')));
  }

  function desenhar() {
    const f = filtrar();
    filtradosAtuais = f;
    const granularidade = selGranularidade.value;
    const confirmados = f.filter(c => c.SepseConfirmada === 'S');
    const obitos = f.filter(c => c.Desfecho === 'Óbito');
    const obitosConfirmados = confirmados.filter(c => c.Desfecho === 'Óbito');
    const pct = (n, d) => d ? Math.round(n / d * 100) + '%' : '—';

    const cartoes = [
      ['Protocolos abertos', fmtInt(f.length)],
      ['Sepse confirmada', `${fmtInt(confirmados.length)} (${pct(confirmados.length, f.length)})`],
      ['Bundle completo', conformidade(f, 'BundleCompleto').percentual === null ? '—' : conformidade(f, 'BundleCompleto').percentual + '%'],
      ['Antibiótico ≤ 1 h', conformidade(f, 'AntibioticoAte1h').percentual === null ? '—' : conformidade(f, 'AntibioticoAte1h').percentual + '%'],
      ['Letalidade (confirmados)', pct(obitosConfirmados.length, confirmados.length)],
      ['Óbitos no período', fmtInt(obitos.length)]
    ];

    /* Séries temporais: uma linha por etapa do protocolo, em % de conformidade. */
    const serieBundle = serie(f, granularidade, lista => conformidade(lista, 'BundleCompleto').percentual || 0);
    const seriesEtapas = new Map();
    for (const etapa of ETAPAS_SEPSE.slice(0, 6)) {
      seriesEtapas.set(etapa.rotulo, serie(f, granularidade, lista => conformidade(lista, etapa.campo).percentual || 0).valores);
    }
    const serieTempos = new Map();
    for (const t of TEMPOS_SEPSE) {
      serieTempos.set(t.rotulo, serie(f, granularidade, lista => mediana(minutosDe(lista, t.campo)) || 0).valores);
    }
    const serieVolume = serie(f, granularidade, lista => lista.length);
    const serieLetalidade = serie(f, granularidade, lista => {
      const conf = lista.filter(c => c.SepseConfirmada === 'S');
      return conf.length ? Math.round(conf.filter(c => c.Desfecho === 'Óbito').length / conf.length * 100) : 0;
    });

    /* Comparação entre setores — onde o protocolo trava. */
    const porSetor = [...new Set(f.map(c => c.Setor).filter(Boolean))].sort().map(setor => {
      const lista = f.filter(c => c.Setor === setor);
      const conf = lista.filter(c => c.SepseConfirmada === 'S');
      return {
        setor, casos: lista.length,
        bundle: conformidade(lista, 'BundleCompleto').percentual,
        atb1h: conformidade(lista, 'AntibioticoAte1h').percentual,
        letalidade: conf.length ? Math.round(conf.filter(c => c.Desfecho === 'Óbito').length / conf.length * 100) : null,
        medianaATB: mediana(minutosDe(lista, 'MinutosAntibiotico'))
      };
    }).sort((a, b) => b.casos - a.casos);

    const contarPorCampo = (lista, campo, limite) => {
      const contagem = {};
      lista.forEach(c => { const v = String(c[campo] || '').trim(); if (v) contagem[v] = (contagem[v] || 0) + 1; });
      return Object.entries(contagem).sort((a, b) => b[1] - a[1]).slice(0, limite || 10);
    };

    area.replaceChildren(
      el('div', { class: 'grade-cartoes' }, ...cartoes.map(([r, v]) =>
        el('div', { class: 'cartao cartao-numero' },
          el('div', { class: 'numero-grande' }, String(v)), el('div', { class: 'texto-suave' }, r)))),

      el('div', { class: 'cartao' },
        el('h2', {}, 'Indicadores de processo — bundle da 1ª hora'),
        el('p', { class: 'texto-suave' }, 'Percentual entre os casos com resposta registrada. '
          + 'Verde ≥ 80%, amarelo 60–79%, vermelho abaixo de 60%.'),
        ETAPAS_SEPSE.map(e => barraPercentual(e.rotulo, conformidade(f, e.campo)))),

      el('div', { class: 'cartao' },
        el('h2', {}, 'Antibiótico: o que foi registrado'),
        el('p', { class: 'texto-suave' }, 'O campo do horário do antibiótico costuma receber a conduta em vez da hora. '
          + 'Só dá para medir o tempo até o antibiótico nos casos com horário registrado — os demais aparecem aqui para que o denominador fique claro.'),
        (() => {
          const situacoes = {};
          f.forEach(c => {
            const v = c.SituacaoAntibiotico || 'Horário registrado';
            situacoes[v] = (situacoes[v] || 0) + 1;
          });
          const pares = Object.entries(situacoes).sort((a, b) => b[1] - a[1]);
          return el('table', { class: 'tabela' },
            el('thead', {}, el('tr', {}, ['Registro no campo do horário', 'Casos', '% dos protocolos'].map(c => el('th', {}, c)))),
            el('tbody', {}, pares.map(([nome, n]) => el('tr', {},
              el('td', { class: nome === 'Horário registrado' ? '' : 'texto-suave' }, nome),
              el('td', {}, fmtInt(n)), el('td', {}, pct(n, f.length))))));
        })()),

      el('div', { class: 'cartao' },
        el('h2', {}, 'Tempos do protocolo (mediana e média, em minutos)'),
        el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['Etapa', 'Casos com horário', 'Mediana', 'Média', 'Máximo'].map(c => el('th', {}, c)))),
          el('tbody', {}, TEMPOS_SEPSE.map(t => {
            const v = minutosDe(f, t.campo);
            const media = v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
            return el('tr', {},
              el('td', {}, t.rotulo), el('td', {}, fmtInt(v.length)),
              el('td', {}, el('strong', {}, v.length ? mediana(v) + ' min' : '—')),
              el('td', {}, media === null ? '—' : media + ' min'),
              el('td', {}, v.length ? Math.max(...v) + ' min' : '—'));
          })))),

      el('div', { class: 'grade-graficos' },
        el('div', { class: 'cartao' }, el('h2', {}, 'Protocolos abertos'),
          grafLinhas(serieVolume.periodos, new Map([['protocolos', serieVolume.valores]]))),
        el('div', { class: 'cartao' }, el('h2', {}, 'Bundle completo (%)'),
          grafLinhas(serieBundle.periodos, new Map([['bundle completo', serieBundle.valores]]))),
        el('div', { class: 'cartao' }, el('h2', {}, 'Etapas do protocolo (% de conformidade)'),
          grafLinhas(serieBundle.periodos, seriesEtapas)),
        el('div', { class: 'cartao' }, el('h2', {}, 'Tempos medianos (minutos)'),
          grafLinhas(serieBundle.periodos, serieTempos)),
        el('div', { class: 'cartao' }, el('h2', {}, 'Letalidade da sepse confirmada (%)'),
          grafLinhas(serieLetalidade.periodos, new Map([['letalidade', serieLetalidade.valores]]))),
        grafBarras('Foco infeccioso', contarPorCampo(f, 'FocoInfeccioso'))),

      montarPerfilMicrobiologico(f),

      el('div', { class: 'cartao' },
        el('h2', {}, 'Comparação entre setores'),
        el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['Setor', 'Protocolos', 'Bundle completo', 'ATB ≤ 1 h', 'Mediana NEWS→ATB', 'Letalidade'].map(c => el('th', {}, c)))),
          el('tbody', {}, porSetor.map(s => el('tr', {},
            el('td', {}, s.setor), el('td', {}, fmtInt(s.casos)),
            el('td', { class: s.bundle !== null && s.bundle < 60 ? 'aviso-erro-texto' : '' }, s.bundle === null ? '—' : s.bundle + '%'),
            el('td', { class: s.atb1h !== null && s.atb1h < 60 ? 'aviso-erro-texto' : '' }, s.atb1h === null ? '—' : s.atb1h + '%'),
            el('td', {}, s.medianaATB === null ? '—' : s.medianaATB + ' min'),
            el('td', {}, s.letalidade === null ? '—' : s.letalidade + '%')))))),

      el('div', { class: 'cartao' },
        el('h2', {}, 'Casos'),
        el('p', { class: 'texto-suave' }, fmtInt(f.length) + ' protocolos' + (f.length > 200 ? ' (mostrando 200)' : '')),
        el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['Data', 'Setor', 'Prontuário', 'Paciente', 'NEWS', 'Foco', 'Sepse', 'Bundle', 'ATB ≤1h', 'NEWS→ATB', 'Desfecho', 'Não conformidade'].map(c => el('th', {}, c)))),
          el('tbody', {}, f.slice().sort((a, b) => String(b.DataProtocolo).localeCompare(String(a.DataProtocolo)))
            .slice(0, 200).map(c => el('tr', {},
              el('td', {}, String(c.DataProtocolo || '')), el('td', {}, String(c.Setor || '')),
              el('td', {}, String(c.Prontuario || '')), el('td', {}, nomes.get(normalizarProntuario(c.Prontuario)) || ''),
              el('td', {}, String(c.ClassificacaoNEWS || '')), el('td', {}, String(c.FocoInfeccioso || '')),
              el('td', {}, c.SepseConfirmada === 'S' ? 'confirmada' : c.SepseConfirmada === 'N' ? 'descartada' : '—'),
              el('td', { class: c.BundleCompleto === 'N' ? 'aviso-erro-texto' : '' }, c.BundleCompleto || '—'),
              el('td', { class: c.AntibioticoAte1h === 'N' ? 'aviso-erro-texto' : '' }, c.AntibioticoAte1h || '—'),
              el('td', {}, c.MinutosAntibiotico === '' || c.MinutosAntibiotico == null ? '—' : c.MinutosAntibiotico + ' min'),
              el('td', { class: c.Desfecho === 'Óbito' ? 'aviso-erro-texto' : '' }, String(c.Desfecho || '')),
              el('td', { class: 'texto-suave' }, String(c.MotivoNaoConformidade || '')))))))
    );
  }

  /* Vincula as culturas do período de cada caso e monta o perfil por sítio, separando o
     que a CCIH classificou como IRAS do que já estava presente na admissão — é essa
     separação que orienta o antibiótico empírico de cada foco. */
  function perfilPorSitio(lista) {
    const janela = Number(selJanela.value);
    const porSitio = new Map();
    const totais = { casos: lista.length, comCultura: 0, positivas: 0, IRAS: 0, 'Admissão': 0, 'Não classificada': 0, 'Outra classificação': 0 };
    const mecanismos = new Map();
    for (const caso of lista) {
      const culturas = culturasDoCaso(caso, culturasPorProntuario, janela, janela);
      if (culturas.length) totais.comCultura++;
      for (const cultura of culturas) {
        if (!String(cultura.Microrganismo || '').trim()) continue;
        totais.positivas++;
        const origem = origemDaCultura(cultura);
        totais[origem] = (totais[origem] || 0) + 1;
        /* O sítio é o do próprio exame quando existe; senão, o foco anotado na ficha. */
        const sitio = String(cultura.Sitio || '').trim() || String(caso.FocoInfeccioso || '').trim() || 'Não informado';
        if (!porSitio.has(sitio)) porSitio.set(sitio, new Map());
        const germes = porSitio.get(sitio);
        const germe = cultura.Microrganismo;
        if (!germes.has(germe)) germes.set(germe, { IRAS: 0, 'Admissão': 0, outras: 0, mecanismos: new Set() });
        const registro = germes.get(germe);
        if (origem === 'IRAS' || origem === 'Admissão') registro[origem]++;
        else registro.outras++;
        const mecanismo = mecanismoPorCultura.get(cultura.ID_Cultura);
        if (mecanismo) {
          registro.mecanismos.add(mecanismo);
          const chave = origem + '|' + mecanismo;
          mecanismos.set(chave, (mecanismos.get(chave) || 0) + 1);
        }
      }
    }
    return { porSitio, totais, mecanismos };
  }

  function montarPerfilMicrobiologico(lista) {
    const { porSitio, totais, mecanismos } = perfilPorSitio(lista);
    const cartao = el('div', { class: 'cartao' },
      el('h2', {}, 'Perfil microbiológico por sítio — IRAS × presente na admissão'),
      el('p', { class: 'texto-suave' },
        `Culturas do mesmo paciente colhidas até ${selJanela.value} dias antes ou depois da abertura do protocolo. `
        + `${fmtInt(totais.comCultura)} dos ${fmtInt(totais.casos)} protocolos têm cultura vinculada; `
        + `${fmtInt(totais.positivas)} isolados — ${fmtInt(totais.IRAS)} IRAS, ${fmtInt(totais['Admissão'])} presentes na admissão, `
        + `${fmtInt(totais['Não classificada'])} ainda sem classificação da CCIH.`));

    if (!totais.positivas) {
      cartao.append(el('p', { class: 'texto-suave' },
        'Nenhuma cultura positiva vinculada no filtro atual. Se o banco de culturas ainda não foi importado, '
        + 'ou se a janela está curta demais, esta seção fica vazia.'));
      return cartao;
    }

    const sitios = [...porSitio.entries()]
      .map(([sitio, germes]) => {
        const linhas = [...germes.entries()]
          .map(([germe, r]) => ({ germe, ...r, total: r.IRAS + r['Admissão'] + r.outras }))
          .sort((a, b) => b.total - a.total);
        return { sitio, linhas, total: linhas.reduce((s, l) => s + l.total, 0) };
      })
      .sort((a, b) => b.total - a.total);

    for (const s of sitios) {
      const iras = s.linhas.reduce((t, l) => t + l.IRAS, 0);
      const adm = s.linhas.reduce((t, l) => t + l['Admissão'], 0);
      cartao.append(el('details', { open: s === sitios[0] ? '' : null },
        el('summary', {}, `${s.sitio} — ${fmtInt(s.total)} isolados `
          + `(${fmtInt(iras)} IRAS · ${fmtInt(adm)} admissão)`),
        el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['Microrganismo', 'IRAS', 'Admissão', 'Outras', 'Total', '% IRAS', 'Mecanismos'].map(c => el('th', {}, c)))),
          el('tbody', {}, s.linhas.map(l => {
            const classificadas = l.IRAS + l['Admissão'];
            return el('tr', {},
              el('td', {}, l.germe),
              el('td', { class: l.IRAS ? 'aviso-erro-texto' : '' }, fmtInt(l.IRAS)),
              el('td', {}, fmtInt(l['Admissão'])),
              el('td', { class: 'texto-suave' }, fmtInt(l.outras)),
              el('td', {}, el('strong', {}, fmtInt(l.total))),
              el('td', {}, classificadas ? Math.round(l.IRAS / classificadas * 100) + '%' : '—'),
              el('td', { class: 'texto-suave' }, [...l.mecanismos].join(', ')));
          })))));
    }

    const porOrigem = { IRAS: [], 'Admissão': [] };
    for (const [chave, n] of mecanismos) {
      const [origem, mecanismo] = chave.split('|');
      if (porOrigem[origem]) porOrigem[origem].push([mecanismo, n]);
    }
    if (porOrigem.IRAS.length || porOrigem['Admissão'].length) {
      cartao.append(el('h3', {}, 'Mecanismos de resistência nos isolados vinculados'),
        el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['Origem', 'Mecanismos'].map(c => el('th', {}, c)))),
          el('tbody', {}, ['IRAS', 'Admissão'].map(origem => el('tr', {},
            el('td', {}, origem),
            el('td', { class: origem === 'IRAS' ? 'aviso-erro-texto' : '' },
              porOrigem[origem].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} (${n})`).join(' · ') || '—'))))));
    }
    return cartao;
  }

  function exportar() {
    const wb = XLSX.utils.book_new();
    const f = filtradosAtuais;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      ETAPAS_SEPSE.map(e => {
        const r = conformidade(f, e.campo);
        return { Indicador: e.rotulo, Sim: r.sim, Respondidos: r.respondidos, SemRegistro: r.semResposta, Percentual: r.percentual };
      })), 'processo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      TEMPOS_SEPSE.map(t => {
        const v = minutosDe(f, t.campo);
        return {
          Etapa: t.rotulo, Casos: v.length, MedianaMin: mediana(v),
          MediaMin: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null
        };
      })), 'tempos');
    const perfil = perfilPorSitio(f);
    const linhasPerfil = [];
    for (const [sitio, germes] of perfil.porSitio) {
      for (const [germe, r] of germes) {
        linhasPerfil.push({
          Sitio: sitio, Microrganismo: germe, IRAS: r.IRAS, Admissao: r['Admissão'],
          OutrasClassificacoes: r.outras, Total: r.IRAS + r['Admissão'] + r.outras,
          Mecanismos: [...r.mecanismos].join(', ')
        });
      }
    }
    if (linhasPerfil.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        linhasPerfil.sort((a, b) => b.Total - a.Total)), 'perfil_microbiologico');
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(f.map(c => ({
      Data: c.DataProtocolo, Setor: c.Setor, Prontuario: c.Prontuario,
      Paciente: nomes.get(normalizarProntuario(c.Prontuario)) || '', NEWS: c.ClassificacaoNEWS,
      Foco: c.FocoInfeccioso, SepseConfirmada: c.SepseConfirmada, BundleCompleto: c.BundleCompleto,
      AntibioticoAte1h: c.AntibioticoAte1h, MinutosAntibiotico: c.MinutosAntibiotico,
      Desfecho: c.Desfecho, NaoConformidade: c.MotivoNaoConformidade
    }))), 'casos');
    XLSX.writeFile(wb, 'indicadores-sepse-' + hojeISO() + '.xlsx');
  }

  desenhar();
}
