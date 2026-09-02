/* Telas de análise: Relatório microbiológico (filtros + agregados + antibiograma
   acumulado + exportação) e Eventos temporais (séries por dia/semana/mês/semestre/ano). */

/* ---- agrupamento temporal (puro, testável em Node) ---- */

function chavePeriodo(dataISO, granularidade) {
  const [ano, mes, dia] = String(dataISO).slice(0, 10).split('-').map(Number);
  if (!ano || !mes || !dia) return null;
  if (granularidade === 'dia') return String(dataISO).slice(0, 10);
  if (granularidade === 'semana') {
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    data.setUTCDate(data.getUTCDate() - (data.getUTCDay() + 6) % 7);
    return data.toISOString().slice(0, 10);
  }
  if (granularidade === 'mes') return String(dataISO).slice(0, 7);
  if (granularidade === 'semestre') return ano + '-S' + (mes <= 6 ? 1 : 2);
  return String(ano);
}

function proximoPeriodo(chave, granularidade) {
  if (granularidade === 'dia' || granularidade === 'semana') {
    const data = new Date(chave + 'T00:00:00Z');
    data.setUTCDate(data.getUTCDate() + (granularidade === 'dia' ? 1 : 7));
    return data.toISOString().slice(0, 10);
  }
  if (granularidade === 'mes') {
    let [ano, mes] = chave.split('-').map(Number);
    mes++; if (mes > 12) { mes = 1; ano++; }
    return ano + '-' + String(mes).padStart(2, '0');
  }
  if (granularidade === 'semestre') {
    const [ano, semestre] = chave.split('-S');
    return semestre === '1' ? ano + '-S2' : (Number(ano) + 1) + '-S1';
  }
  return String(Number(chave) + 1);
}

/* Agrupa eventos [{data, grupo}] em períodos contínuos. Retorna null se estourar o limite. */
function agruparEventos(eventos, granularidade, limite) {
  limite = limite || 500;
  const chaves = eventos.map(e => chavePeriodo(e.data, granularidade)).filter(Boolean);
  if (!chaves.length) return { periodos: [], series: new Map() };
  let inicio = chaves[0], fim = chaves[0];
  for (const c of chaves) { if (c < inicio) inicio = c; if (c > fim) fim = c; }
  const periodos = [];
  for (let atual = inicio; atual <= fim; atual = proximoPeriodo(atual, granularidade)) {
    periodos.push(atual);
    if (periodos.length > limite) return null;
  }
  const indice = new Map(periodos.map((p, i) => [p, i]));
  const series = new Map();
  eventos.forEach(e => {
    const chave = chavePeriodo(e.data, granularidade);
    if (!indice.has(chave)) return;
    const grupo = e.grupo || 'Total';
    if (!series.has(grupo)) series.set(grupo, new Array(periodos.length).fill(0));
    series.get(grupo)[indice.get(chave)]++;
  });
  return { periodos, series };
}

/* ---- gráfico de linhas em SVG puro ---- */

const CORES_SERIES = ['#14532d', '#185fa5', '#b03a2e', '#854f0b', '#533ab7', '#0f6e56'];

function grafLinhas(periodos, series) {
  const largura = 820, altura = 280, mx = 46, my = 24;
  const maximo = Math.max(1, ...[...series.values()].flat());
  const nx = Math.max(periodos.length - 1, 1);
  const px = i => mx + i * (largura - mx - 10) / nx;
  const py = v => altura - my - v * (altura - my - 14) / maximo;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${largura} ${altura}`);
  svg.setAttribute('width', '100%');
  const criar = (tag, attrs, texto) => {
    const e = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (texto != null) e.textContent = texto;
    svg.appendChild(e);
    return e;
  };
  for (let g = 0; g <= 4; g++) {
    const valor = Math.round(maximo * g / 4);
    const y = py(valor);
    criar('line', { x1: mx, y1: y, x2: largura - 10, y2: y, stroke: '#e4e9ef', 'stroke-width': 1 });
    criar('text', { x: mx - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#61707f' }, valor);
  }
  const salto = Math.max(1, Math.ceil(periodos.length / 12));
  periodos.forEach((p, i) => {
    if (i % salto !== 0 && i !== periodos.length - 1) return;
    criar('text', { x: px(i), y: altura - 6, 'text-anchor': 'middle', 'font-size': 10, fill: '#61707f' }, p);
  });
  let corIndice = 0;
  for (const [, valores] of series) {
    const cor = CORES_SERIES[corIndice++ % CORES_SERIES.length];
    if (periodos.length === 1) {
      criar('circle', { cx: px(0), cy: py(valores[0]), r: 4, fill: cor });
      continue;
    }
    criar('polyline', {
      points: valores.map((v, i) => px(i) + ',' + py(v)).join(' '),
      fill: 'none', stroke: cor, 'stroke-width': 2
    });
    valores.forEach((v, i) => { if (v > 0) criar('circle', { cx: px(i), cy: py(v), r: 2.5, fill: cor }); });
  }
  return svg;
}

function legendaSeries(series) {
  let i = 0;
  return el('div', { class: 'linha-campos' }, [...series.keys()].map(nome =>
    el('span', { class: 'texto-suave' },
      el('span', { style: `display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:4px;vertical-align:-1px;background:${CORES_SERIES[i++ % CORES_SERIES.length]}` }),
      `${nome} (${series.get(nome).reduce((a, b) => a + b, 0)})`)));
}

/* ---- Aba Relatórios (microbiológico) ---- */

async function montarRelatorioMicro(conteudo) {
  conteudo.append(el('h1', {}, 'Relatório microbiológico'));
  let banco, bancoPacientes;
  try {
    [banco, bancoPacientes] = await Promise.all([lerBanco('culturas'), lerBanco('pacientes'), carregarIndiceSepse()]);
  } catch (e) { conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message)); return; }
  const nomes = new Map(bancoPacientes.pacientes.map(p => [normalizarProntuario(p.Prontuario), p.Nome]));
  const deSepse = c => culturaDeProtocoloSepse(c, indiceSepseUI);
  const sensPorCultura = {};
  banco.sensibilidade.forEach(s => { (sensPorCultura[s.ID_Cultura] = sensPorCultura[s.ID_Cultura] || []).push(s); });
  /* Memoizado: inferirMecanismo roda regras sobre o antibiograma e era chamado para as
     38 mil culturas a cada redesenho do filtro. */
  const _mecanismos = new Map();
  const mecanismoDe = c => {
    if (!_mecanismos.has(c.ID_Cultura)) {
      _mecanismos.set(c.ID_Cultura, c.MecanismoResistencia || inferirMecanismo(c.Microrganismo, sensPorCultura[c.ID_Cultura] || []));
    }
    return _mecanismos.get(c.ID_Cultura);
  };

  const distintos = campo => [...new Set(banco.culturas.map(c => String(c[campo] || '').trim()).filter(Boolean))].sort();
  const classificacoes = [...new Set(banco.culturas.map(c =>
    String(c.AvaliacaoCCIH || '').startsWith('IRAS') ? 'IRAS (qualquer)' : String(c.AvaliacaoCCIH || '').trim()).filter(Boolean))].sort();

  const seletor = (opcoes, primeira) => el('select', {}, el('option', { value: '' }, primeira),
    opcoes.map(o => el('option', { value: o }, o)));
  /* Começa mostrando todo o período existente no banco — filtrar por um ano por padrão
     escondia mais da metade das culturas sem dizer. */
  const datas = banco.culturas.map(c => String(c.DataColeta || '').slice(0, 10)).filter(d => /^\d{4}-/.test(d)).sort();
  const campoDe = el('input', { type: 'date', value: datas[0] || hojeISO() });
  const campoAte = el('input', { type: 'date', value: hojeISO() });
  const selSetor = seletor(distintos('Setor'), 'todos os setores');
  const selMicro = seletor(distintos('Microrganismo'), 'todos os microrganismos');
  const selMaterial = seletor(distintos('Material'), 'todos os materiais');
  const selSitio = seletor(distintos('Sitio'), 'todos os sítios');
  const selMecanismo = el('select', {},
    el('option', { value: '' }, 'com ou sem resistência'),
    el('option', { value: '@mdr' }, 'apenas multirresistentes'),
    [...new Set(banco.culturas.map(c => c.MecanismoResistencia).filter(Boolean))].sort().map(m => el('option', { value: m }, m)));
  const selClasse = el('select', {},
    el('option', { value: '' }, 'qualquer classificação'),
    el('option', { value: '@pendente' }, 'pendentes de revisão'),
    classificacoes.map(c => el('option', { value: c }, c)));
  /* Por padrão o relatório mostra só o que pode ser infecção. Negativas, swabs de
     vigilância e controles de água/leite são a maior parte do banco e afogariam o perfil
     microbiológico — ficam a um clique de distância, não escondidos de vez. */
  const selResultado = el('select', { title: 'Negativas, colonização e controles de água/leite só entram quando pedido' },
    el('option', { value: 'positivas' }, 'só o que pode ser infecção'),
    el('option', { value: '' }, 'incluir negativas, colonização e controles'));
  const campoBusca = el('input', { type: 'text', placeholder: 'prontuário ou nome' });
  const area = el('div', {});

  [campoDe, campoAte, selSetor, selMicro, selMaterial, selSitio, selMecanismo, selClasse, selResultado].forEach(c =>
    c.addEventListener('change', desenhar));
  campoBusca.addEventListener('input', aoPararDeDigitar(desenhar));
  conteudo.append(el('div', { class: 'cartao' },
    el('div', { class: 'linha-campos' },
      el('label', {}, 'De: ', campoDe), el('label', {}, 'Até: ', campoAte),
      el('label', {}, 'Setor: ', selSetor), el('label', {}, 'Material: ', selMaterial),
      el('label', {}, 'Sítio: ', selSitio)),
    el('div', { class: 'linha-campos' },
      el('label', {}, 'Microrganismo: ', selMicro), el('label', {}, 'Resistência: ', selMecanismo),
      el('label', {}, 'Classificação: ', selClasse), el('label', {}, 'Resultado: ', selResultado),
      el('label', {}, 'Buscar: ', campoBusca)),
    el('div', { class: 'linha-botoes' },
      el('button', { class: 'botao-secundario', onclick: () => exportar() }, 'Exportar resultado (Excel)'))),
    area);

  let filtradasAtuais = [];

  function filtrar() {
    const busca = normalizarTexto(campoBusca.value);
    return banco.culturas.filter(c => {
      if (c.StatusRevisao === 'descartada') return false;
      const data = String(c.DataColeta).slice(0, 10);
      if (campoDe.value && data < campoDe.value) return false;
      if (campoAte.value && data > campoAte.value) return false;
      /* As opções dos seletores vêm aparadas (trim); o dado bruto pode ter espaços do
         relatório de origem. Comparar sem aparar sumia com essas linhas do resultado. */
      if (selSetor.value && String(c.Setor || '').trim() !== selSetor.value) return false;
      if (selMicro.value && String(c.Microrganismo || '').trim() !== selMicro.value) return false;
      if (selMaterial.value && String(c.Material || '').trim() !== selMaterial.value) return false;
      if (selSitio.value && String(c.Sitio || '').trim() !== selSitio.value) return false;
      /* Escolher uma classificação é um pedido explícito e passa por cima da triagem —
         senão filtrar por "Colonização" devolveria lista vazia. Cultura de protocolo de
         sepse também passa: hemocultura negativa do protocolo é resultado, não ruído. */
      if (selResultado.value === 'positivas' && !selClasse.value && !culturaDoPainel(c) && !deSepse(c)) return false;
      if (selMecanismo.value === '@mdr' && !mecanismoDe(c)) return false;
      if (selMecanismo.value && selMecanismo.value !== '@mdr' && c.MecanismoResistencia !== selMecanismo.value) return false;
      if (selClasse.value === '@pendente' && c.StatusRevisao !== 'pendente') return false;
      if (selClasse.value && selClasse.value !== '@pendente') {
        const classe = String(c.AvaliacaoCCIH || '').startsWith('IRAS') ? 'IRAS (qualquer)' : String(c.AvaliacaoCCIH || '').trim();
        if (classe !== selClasse.value) return false;
      }
      if (busca && ![c.Prontuario, nomes.get(normalizarProntuario(c.Prontuario))].some(v => normalizarTexto(v).includes(busca))) return false;
      return true;
    });
  }

  /* Antibiograma acumulado. No cálculo de %S só entram as culturas com painel completo
     (pelo menos um antibiótico sensível registrado): laudo que lista apenas as resistências
     daria 0% de sensibilidade para tudo e inverteria a leitura do perfil. As resistências
     desses laudos parciais são contadas à parte. */
  function acumulado(culturas) {
    const porAntibiotico = new Map();
    const soResistencias = new Map();
    let comPainel = 0, parciais = 0;
    for (const c of culturas) {
      const sens = sensPorCultura[c.ID_Cultura] || [];
      if (!sens.length) continue;
      if (sens.some(s => s.Resultado === 'S')) {
        comPainel++;
        for (const s of sens) {
          if (!porAntibiotico.has(s.Antibiotico)) porAntibiotico.set(s.Antibiotico, { S: 0, I: 0, R: 0 });
          const registro = porAntibiotico.get(s.Antibiotico);
          if (registro[s.Resultado] !== undefined) registro[s.Resultado]++;
        }
      } else {
        parciais++;
        for (const s of sens) {
          if (s.Resultado === 'R') soResistencias.set(s.Antibiotico, (soResistencias.get(s.Antibiotico) || 0) + 1);
        }
      }
    }
    const linhas = [...porAntibiotico.entries()]
      .map(([antibiotico, r]) => ({ antibiotico, ...r, total: r.S + r.I + r.R }))
      .filter(r => r.total > 0)
      .map(r => ({ ...r, percS: Math.round(r.S / r.total * 100) }))
      .sort((a, b) => b.total - a.total);
    return { linhas, resistencias: [...soResistencias.entries()].sort((a, b) => b[1] - a[1]), comPainel, parciais };
  }

  /* Antibiograma para caber numa célula: prefere as linhas de sensibilidade e cai
     no texto original quando o laudo não pôde ser desmembrado. */
  function resumoAntibiograma(c) {
    const sens = sensPorCultura[c.ID_Cultura] || [];
    if (sens.length) {
      const resistentes = sens.filter(s => s.Resultado === 'R').map(s => s.Antibiotico);
      return `${sens.length} antibióticos` + (resistentes.length ? ` · R: ${resistentes.join(', ')}` : '');
    }
    return String(c.Antibiograma || '');
  }

  function contarPorCampo(culturas, campo, limite) {
    const contagem = {};
    culturas.forEach(c => { const v = String(c[campo] || '').trim(); if (v) contagem[v] = (contagem[v] || 0) + 1; });
    return Object.entries(contagem).sort((a, b) => b[1] - a[1]).slice(0, limite || 12);
  }

  function desenhar() {
    const filtradas = filtrar();
    filtradasAtuais = filtradas;
    const positivas = filtradas.filter(c => c.Microrganismo);
    const pacientes = new Set(positivas.map(c => normalizarProntuario(c.Prontuario))).size;
    const mdr = filtradas.filter(c => mecanismoDe(c)).length;
    const acu = acumulado(positivas);

    area.replaceChildren(
      el('div', { class: 'grade-cartoes' }, ...[
        ['Culturas no filtro', filtradas.length], ['Positivas', positivas.length],
        ['Pacientes distintos', pacientes], ['Multirresistentes', mdr]
      ].map(([r, n]) => el('div', { class: 'cartao cartao-numero' },
        el('div', { class: 'numero-grande' }, fmtInt(n)), el('div', { class: 'texto-suave' }, r)))),
      el('div', { class: 'grade-graficos' },
        grafBarras('Microrganismos', contarPorCampo(positivas, 'Microrganismo')),
        grafBarras('Materiais', contarPorCampo(positivas, 'Material')),
        grafBarras('Sítios', contarPorCampo(positivas, 'Sitio')),
        grafBarras('Setores', contarPorCampo(positivas, 'Setor')),
        el('div', { class: 'cartao' }, el('h2', {}, 'Antibiograma acumulado do filtro'),
          acu.linhas.length ? el('div', {},
            el('p', { class: 'texto-suave' }, `Calculado sobre ${fmtInt(acu.comPainel)} culturas com painel completo.`),
            el('table', { class: 'tabela' },
              el('thead', {}, el('tr', {}, ['Antibiótico', 'Testados', 'S', 'I', 'R', '%S'].map(c => el('th', {}, c)))),
              el('tbody', {}, acu.linhas.map(r => el('tr', {},
                el('td', {}, r.antibiotico), el('td', {}, String(r.total)), el('td', {}, String(r.S)),
                el('td', {}, String(r.I)), el('td', { class: r.R ? 'aviso-erro-texto' : '' }, String(r.R)),
                el('td', {}, el('strong', {}, r.percS + '%')))))))
            : el('p', { class: 'texto-suave' }, 'Nenhuma cultura do filtro tem painel completo de sensibilidade.'),
          acu.parciais ? el('details', {},
            el('summary', {}, `Resistências registradas em ${fmtInt(acu.parciais)} laudos sem painel completo`),
            el('p', { class: 'texto-suave' }, 'Esses laudos trazem apenas a lista de antibióticos resistentes, então não entram no cálculo de %S acima.'),
            el('table', { class: 'tabela' },
              el('thead', {}, el('tr', {}, ['Antibiótico', 'Vezes resistente'].map(c => el('th', {}, c)))),
              el('tbody', {}, acu.resistencias.map(([atb, n]) => el('tr', {},
                el('td', {}, atb), el('td', { class: 'aviso-erro-texto' }, String(n))))))) : null)),
      el('div', { class: 'cartao' },
        el('h2', {}, 'Isolados'),
        el('p', { class: 'texto-suave' }, fmtInt(filtradas.length) + ' culturas' + (filtradas.length > 300 ? ' (mostrando 300)' : '')),
        el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['Coleta', 'Prontuário', 'Paciente', 'Setor', 'Material', 'Sítio', 'Microrganismo', 'Mecanismo', 'Antibiograma', 'Classificação'].map(c => el('th', {}, c)))),
          el('tbody', {}, filtradas.slice(0, 300).map(c => el('tr', { class: 'linha-clicavel', onclick: () => {
            app.filtroCulturas = { status: 'todas', busca: c.Prontuario };
            navegar('culturas');
          } },
            [c.DataColeta, c.Prontuario, nomes.get(normalizarProntuario(c.Prontuario)) || '', c.Setor, c.Material, c.Sitio,
             c.Microrganismo || '(negativa)', mecanismoDe(c), resumoAntibiograma(c)]
              .map(v => el('td', {}, String(v || ''))),
            el('td', {}, String(c.AvaliacaoCCIH || c.StatusRevisao || ''), marcaSepse(c))))))));
  }

  function exportar() {
    const wb = XLSX.utils.book_new();
    const linhas = filtradasAtuais.map(c => ({
      Coleta: c.DataColeta, Prontuario: c.Prontuario,
      Paciente: nomes.get(normalizarProntuario(c.Prontuario)) || '', Setor: c.Setor,
      Material: c.Material, Sitio: c.Sitio, Microrganismo: c.Microrganismo, Mecanismo: mecanismoDe(c),
      Antibiograma: c.Antibiograma || '', Classificacao: c.AvaliacaoCCIH || c.StatusRevisao
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'isolados');
    const acu = acumulado(filtradasAtuais.filter(c => c.Microrganismo));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      acu.linhas.map(r => ({ Antibiotico: r.antibiotico, Testados: r.total, S: r.S, I: r.I, R: r.R, PercentualS: r.percS }))), 'acumulado');
    if (acu.resistencias.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        acu.resistencias.map(([atb, n]) => ({ Antibiotico: atb, VezesResistente: n }))), 'so_resistencias');
    }
    XLSX.writeFile(wb, 'relatorio-microbiologico-' + hojeISO() + '.xlsx');
  }

  desenhar();
}

/* ---- Aba Eventos temporais ---- */

const FONTES_EVENTOS = {
  culturas_positivas: { rotulo: 'Culturas positivas', banco: 'culturas', aba: 'culturas', data: 'DataColeta', setor: 'Setor', variavel: 'Microrganismo', filtro: c => culturaDoPainel(c) },
  mdr: { rotulo: 'Multirresistentes', banco: 'culturas', especial: 'mdr', variavel: 'Mecanismo' },
  iras: { rotulo: 'Casos de IRAS', banco: 'iras', aba: 'casos', data: 'DataInfeccao', setor: 'Setor', variavel: 'Topografia' },
  internacoes: { rotulo: 'Internações (admissões)', banco: 'pacientes', aba: 'internacoes', data: 'DataInternacao', setor: 'SetorAtual', variavel: 'Clinica' },
  obitos: { rotulo: 'Óbitos', banco: 'pacientes', aba: 'internacoes', data: 'DataAlta', setor: 'SetorAtual', variavel: 'Clinica', filtro: i => i.Obito === 'S' && i.DataAlta },
  cirurgias: { rotulo: 'Cirurgias', banco: 'cirurgias', aba: 'cirurgias', data: 'DataCirurgia', setor: '', variavel: 'ProcedimentoNHSN' },
  isc: { rotulo: 'ISC (infecção de sítio cirúrgico)', banco: 'cirurgias', aba: 'cirurgias', data: 'DataCirurgia', setor: '', variavel: 'TipoISC', filtro: c => c.ISC === 'S' },
  dispositivos: { rotulo: 'Dispositivos instalados', banco: 'dispositivos', aba: 'dispositivos', data: 'DataInstalacao', setor: '', variavel: 'Categoria' },
  prescricoes: { rotulo: 'Antibióticos iniciados', banco: 'antibioticos', aba: 'prescricoes', data: 'DataInicio', setor: 'Setor', variavel: 'Antibiotico' },
  precaucoes: { rotulo: 'Precauções iniciadas', banco: 'isolamentos', aba: 'precaucoes', data: 'DataInicio', setor: 'Setor', variavel: 'TipoPrecaucao' },
  higiene: { rotulo: 'Higiene de mãos (observações)', banco: 'higiene_maos', aba: 'observacoes', data: 'Data', setor: 'Setor', variavel: 'Acao' }
};

async function carregarEventos(idFonte) {
  const fonte = FONTES_EVENTOS[idFonte];
  const banco = await lerBanco(fonte.banco);
  if (fonte.especial === 'mdr') {
    const mdr = detectarMultirresistentes(banco.culturas, banco.sensibilidade, null, null, config.rotina.mdrMonitorados);
    return mdr.map(m => ({ data: String(m.DataColeta).slice(0, 10), setor: m.Setor || '', valor: m.Mecanismo }));
  }
  return (banco[fonte.aba] || [])
    .filter(l => (!fonte.filtro || fonte.filtro(l)) && /^\d{4}-\d{2}-\d{2}/.test(String(l[fonte.data] || '')))
    .map(l => ({
      data: String(l[fonte.data]).slice(0, 10),
      setor: fonte.setor ? String(l[fonte.setor] || '').trim() : '',
      valor: String(l[fonte.variavel] || '').trim() || '(sem valor)'
    }));
}

async function montarEventos(conteudo) {
  conteudo.append(el('h1', {}, 'Eventos temporais'));
  const selEvento = el('select', {}, Object.entries(FONTES_EVENTOS).map(([id, f]) => el('option', { value: id }, f.rotulo)));
  const selGranularidade = el('select', {}, [['dia', 'por dia'], ['semana', 'por semana'], ['mes', 'por mês'], ['semestre', 'por semestre'], ['ano', 'por ano']]
    .map(([v, r]) => el('option', { value: v, selected: v === 'mes' ? '' : null }, r)));
  const umAnoAtras = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const campoDe = el('input', { type: 'date', value: umAnoAtras });
  const campoAte = el('input', { type: 'date', value: hojeISO() });
  const selSetor = el('select', {}, el('option', { value: '' }, 'todos os setores'));
  const selValor = el('select', {}, el('option', { value: '' }, 'todos'));
  const caixaDetalhar = el('input', { type: 'checkbox' });
  const rotuloVariavel = el('span', {}, 'Variável');
  const area = el('div', {});
  conteudo.append(el('div', { class: 'cartao' },
    el('div', { class: 'linha-campos' },
      el('label', {}, 'Evento: ', selEvento), el('label', {}, 'Escala: ', selGranularidade),
      el('label', {}, 'De: ', campoDe), el('label', {}, 'Até: ', campoAte)),
    el('div', { class: 'linha-campos' },
      el('label', {}, 'Setor: ', selSetor),
      el('label', {}, rotuloVariavel, ': ', selValor),
      el('label', { style: 'display:flex;align-items:center;gap:6px' }, caixaDetalhar, ' uma linha por valor (top 6)'))),
    area);

  let eventos = [];
  let geracao = 0;

  async function carregar() {
    /* Duas trocas rápidas de fonte disparam duas cargas; sem o token, a mais lenta
       (culturas, 38 mil linhas) terminava por último e desenhava a fonte errada. */
    const minha = ++geracao;
    area.replaceChildren(el('p', { class: 'texto-suave' }, 'Carregando…'));
    try {
      const carregados = await carregarEventos(selEvento.value);
      if (minha !== geracao) return;
      eventos = carregados;
    }
    catch (e) {
      if (minha !== geracao) return;
      area.replaceChildren(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message));
      return;
    }
    rotuloVariavel.textContent = FONTES_EVENTOS[selEvento.value].variavel || 'Variável';
    const setores = [...new Set(eventos.map(e => e.setor).filter(Boolean))].sort();
    /* replaceChildren nativo não desempacota arrays (o el() do app desempacota). */
    selSetor.replaceChildren(el('option', { value: '' }, 'todos os setores'), ...setores.map(s => el('option', { value: s }, s)));
    const valores = [...new Set(eventos.map(e => e.valor).filter(Boolean))].sort();
    selValor.replaceChildren(el('option', { value: '' }, 'todos'), ...valores.map(v => el('option', { value: v }, v)));
    desenhar();
  }

  function desenhar() {
    const filtrados = eventos.filter(e =>
      (!campoDe.value || e.data >= campoDe.value) && (!campoAte.value || e.data <= campoAte.value)
      && (!selSetor.value || e.setor === selSetor.value)
      && (!selValor.value || e.valor === selValor.value));

    let comGrupo;
    if (caixaDetalhar.checked && !selValor.value) {
      const contagem = {};
      filtrados.forEach(e => contagem[e.valor] = (contagem[e.valor] || 0) + 1);
      const top = new Set(Object.entries(contagem).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v]) => v));
      comGrupo = filtrados.map(e => ({ data: e.data, grupo: top.has(e.valor) ? e.valor : 'outros' }));
    } else {
      comGrupo = filtrados.map(e => ({ data: e.data, grupo: 'Total' }));
    }

    const agrupado = agruparEventos(comGrupo, selGranularidade.value);
    if (agrupado === null) {
      area.replaceChildren(el('div', { class: 'cartao aviso-alerta' },
        'Período longo demais para esta escala — aumente a escala (ex.: mês) ou reduza o intervalo.'));
      return;
    }
    const { periodos, series } = agrupado;
    if (!periodos.length) {
      area.replaceChildren(el('div', { class: 'cartao' }, el('p', { class: 'texto-suave' }, 'Nenhum evento no filtro.')));
      return;
    }
    const total = filtrados.length;
    const totaisPorPeriodo = periodos.map((p, i) => [...series.values()].reduce((soma, v) => soma + v[i], 0));
    const pico = Math.max(...totaisPorPeriodo);
    const cartaoGrafico = el('div', { class: 'cartao' },
      el('h2', {}, FONTES_EVENTOS[selEvento.value].rotulo),
      el('p', { class: 'texto-suave' },
        `${fmtInt(total)} eventos em ${periodos.length} períodos · média ${(total / periodos.length).toFixed(1)} · pico ${pico} (${periodos[totaisPorPeriodo.indexOf(pico)]})`),
      grafLinhas(periodos, series),
      series.size > 1 ? legendaSeries(series) : null,
      el('details', {}, el('summary', {}, 'Tabela de valores'),
        el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Período'), [...series.keys()].map(s => el('th', {}, s)))),
          el('tbody', {}, periodos.map((p, i) => el('tr', {},
            el('td', {}, p), [...series.values()].map(v => el('td', {}, String(v[i])))))))));
    area.replaceChildren(cartaoGrafico);
  }

  selEvento.addEventListener('change', carregar);
  [selGranularidade, campoDe, campoAte, selSetor, selValor, caixaDetalhar].forEach(c => c.addEventListener('change', desenhar));
  carregar();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { chavePeriodo, proximoPeriodo, agruparEventos };
}
