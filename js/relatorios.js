/* Relatórios padrão: núcleo puro (roda em Node, testável). Cada relatório recebe
   (bancos, setoresEscopo, inicio, fim) e devolve { titulo, secoes, resumo }:
   - secoes: [{ titulo, tipo: 'numeros'|'tabela'|'texto', itens|colunas+linhas|corpo }]
   - resumo: [[rotulo, valor]] — os números-chave que o Resumo executivo reaproveita.
   `setoresEscopo` é uma lista de nomes de setor (vinda de um setor único ou de um grupo
   configurado) ou null para o hospital inteiro. A UI desenha as seções na tela e gera a
   impressão a partir da MESMA estrutura — relatório e papel nunca divergem. */

function relPeriodo(data, inicio, fim) {
  const d = String(data || '').slice(0, 10);
  return /^\d{4}-/.test(d) && d >= inicio && d <= fim;
}

function relEscopo(setor, setoresEscopo) {
  if (!setoresEscopo || !setoresEscopo.length) return true;
  return setoresEscopo.includes(String(setor || '').trim());
}

function relContar(lista, chaveDe) {
  const mapa = new Map();
  for (const item of lista) {
    const chave = String(chaveDe(item) || '').trim();
    if (!chave) continue;
    mapa.set(chave, (mapa.get(chave) || 0) + 1);
  }
  return [...mapa.entries()].sort((a, b) => b[1] - a[1]);
}

function relPct(parte, todo) {
  return todo ? Math.round(parte / todo * 100) + '%' : '—';
}

function relMediana(valores) {
  const v = valores.filter(x => isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

function relDiasEntre(de, ate) {
  const a = Date.parse(String(de || '').slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(String(ate || '').slice(0, 10) + 'T00:00:00Z');
  return isFinite(a) && isFinite(b) ? Math.round((b - a) / 86400000) : null;
}

const TEXTO_SEM_DENSIDADE_SETOR = 'Densidade e DOT por setor indisponíveis: o censo registra o '
  + 'setor de ENTRADA do paciente, não onde ele ficou. As taxas por 1.000 pacientes-dia só valem '
  + 'para o hospital inteiro; com escopo de setor/grupo o relatório traz contagens.';

/* Pacientes-dia no intervalo: para cada internação, quantos dias dela caem dentro do
   período. Internação sem alta é contada até o fim do período. É o denominador da
   densidade — sem ele só dá para contar infecções, não medir risco.

   Só o total. Repartir por setor daria número errado: o censo traz em `SetorAtual` o setor
   por onde o paciente ENTROU (62% das internações caem em "Emergência"), não onde ele ficou.
   Dividir as infecções do CTI pelos poucos pacientes-dia que sobram no CTI produzia taxas
   como 1.870 por mil — trezentas vezes o real. Enquanto o censo não trouxer as passagens de
   setor, os relatórios mostram contagem por setor e não fingem uma taxa. */
function pacientesDia(internacoes, de, ate) {
  const inicio = Date.parse(de + 'T00:00:00Z');
  const fim = Date.parse(ate + 'T00:00:00Z');
  if (!isFinite(inicio) || !isFinite(fim) || fim < inicio) return 0;
  let total = 0;
  for (const i of (internacoes || [])) {
    const entrada = Date.parse(String(i.DataInternacao || '').slice(0, 10) + 'T00:00:00Z');
    if (!isFinite(entrada)) continue;
    const altaBruta = String(i.DataAlta || '').slice(0, 10);
    const saida = /^\d{4}-/.test(altaBruta) ? Date.parse(altaBruta + 'T00:00:00Z') : fim;
    if (!isFinite(saida)) continue;
    const a = Math.max(entrada, inicio), b = Math.min(saida, fim);
    if (b < a) continue;
    total += (b - a) / 86400000 + 1;
  }
  return total;
}

/* ---- 1. IRAS do período ---- */
function relatorioIRAS(bancos, setoresEscopo, inicio, fim) {
  const casos = ((bancos.iras || {}).casos || [])
    .filter(k => relPeriodo(k.DataInfeccao, inicio, fim) && relEscopo(k.Setor, setoresEscopo));
  const confirmadas = casos.filter(k => String(k.ConfirmadoPor || '').trim()
    || normalizarTexto(k.StatusInvestigacao) === 'confirmado');
  const comDispositivo = casos.filter(k => String(k.DispositivoAssociado || '').trim());
  const pd = setoresEscopo ? 0 : pacientesDia((bancos.pacientes || {}).internacoes, inicio, fim);
  const densidade = pd ? (casos.length / pd * 1000).toFixed(2) : null;

  const secoes = [
    { titulo: 'Panorama', tipo: 'numeros', itens: [
      ['IRAS no período', casos.length],
      ['Confirmadas (dupla assinatura)', confirmadas.length],
      ['Em investigação', casos.length - confirmadas.length],
      ['Associadas a dispositivo', `${comDispositivo.length} (${relPct(comDispositivo.length, casos.length)})`],
      ['Densidade por 1.000 pacientes-dia', densidade || '—'],
      ...(densidade ? [['Pacientes-dia no período', Math.round(pd)]] : [])
    ] },
    { titulo: 'Por topografia', tipo: 'tabela', colunas: ['Topografia', 'Casos'],
      linhas: relContar(casos, k => k.Topografia) },
    { titulo: 'Por setor', tipo: 'tabela', colunas: ['Setor', 'Casos'],
      linhas: relContar(casos, k => k.Setor) },
    { titulo: 'Microrganismos (top 10)', tipo: 'tabela', colunas: ['Microrganismo', 'Casos'],
      linhas: relContar(casos, k => k.Microrganismo).slice(0, 10) }
  ];
  if (setoresEscopo) secoes.push({ titulo: 'Nota', tipo: 'texto', corpo: TEXTO_SEM_DENSIDADE_SETOR });
  return { titulo: 'IRAS do período', secoes,
    resumo: [['IRAS', casos.length], ['IRAS confirmadas', confirmadas.length],
      ['Densidade IRAS/1.000 pac-dia', densidade || '—']] };
}

/* ---- 2. Perfil microbiológico e resistência ---- */
function relatorioMicrobiologico(bancos, setoresEscopo, inicio, fim) {
  const todas = ((bancos.culturas || {}).culturas || [])
    .filter(c => relPeriodo(c.DataColeta, inicio, fim) && relEscopo(c.Setor, setoresEscopo));
  /* Perfil só com o que a CCIH olha: fora negativas, colonização e controles (água/leite). */
  const comGerme = todas.filter(culturaDoPainel);
  /* O laboratório raramente preenche o mecanismo — quase todos são inferidos do
     antibiograma (mesma regra dos alertas de MDR do painel). */
  const sensPorCultura = new Map();
  for (const s of ((bancos.culturas || {}).sensibilidade || [])) {
    if (!sensPorCultura.has(s.ID_Cultura)) sensPorCultura.set(s.ID_Cultura, []);
    sensPorCultura.get(s.ID_Cultura).push(s);
  }
  const mecanismoDe = c => String(c.MecanismoResistencia || '').trim()
    || inferirMecanismo(c.Microrganismo, sensPorCultura.get(c.ID_Cultura) || []);
  const mdr = comGerme.filter(mecanismoDe);
  const porMes = relContar(mdr, c => String(c.DataColeta).slice(0, 7));
  porMes.sort((a, b) => a[0].localeCompare(b[0]));

  return { titulo: 'Perfil microbiológico e resistência', secoes: [
    { titulo: 'Panorama', tipo: 'numeros', itens: [
      ['Culturas coletadas', todas.length],
      ['Com microrganismo (painel)', `${comGerme.length} (${relPct(comGerme.length, todas.length)})`],
      ['Com mecanismo de resistência', `${mdr.length} (${relPct(mdr.length, comGerme.length)} do painel)`]
    ] },
    { titulo: 'Microrganismos mais frequentes', tipo: 'tabela', colunas: ['Microrganismo', 'Culturas', '%'],
      linhas: relContar(comGerme, c => c.Microrganismo).slice(0, 10)
        .map(([g, n]) => [g, n, relPct(n, comGerme.length)]) },
    { titulo: 'Por material', tipo: 'tabela', colunas: ['Material', 'Culturas com germe'],
      linhas: relContar(comGerme, c => c.Material).slice(0, 8) },
    { titulo: 'Multirresistentes por mecanismo', tipo: 'tabela', colunas: ['Mecanismo', 'Culturas'],
      linhas: relContar(mdr, mecanismoDe) },
    { titulo: 'Multirresistentes por mês', tipo: 'tabela', colunas: ['Mês', 'Culturas MDR'],
      linhas: porMes }
  ], resumo: [['Culturas com germe', comGerme.length], ['Culturas MDR', mdr.length]] };
}

/* ---- 3. Higiene das mãos ---- */
function relatorioHigiene(bancos, setoresEscopo, inicio, fim) {
  const obs = ((bancos.higiene_maos || {}).observacoes || [])
    .filter(o => relPeriodo(o.Data, inicio, fim) && relEscopo(o.Setor, setoresEscopo)
      && (o.Acao === 'Higienizou' || o.Acao === 'Não higienizou'));
  const adesaoDe = lista => {
    const sim = lista.filter(o => o.Acao === 'Higienizou').length;
    return relPct(sim, lista.length);
  };
  const porGrupo = chaveDe => relContar(obs, chaveDe).map(([chave, total]) =>
    [chave, total, adesaoDe(obs.filter(o => String(chaveDe(o) || '').trim() === chave))]);
  const porMomento = porGrupo(o => o.Momento);
  const maisFraco = porMomento.filter(([, total]) => total >= 10)
    .sort((a, b) => parseInt(a[2]) - parseInt(b[2]))[0];

  return { titulo: 'Higiene das mãos', secoes: [
    { titulo: 'Panorama', tipo: 'numeros', itens: [
      ['Oportunidades observadas', obs.length],
      ['Adesão geral', adesaoDe(obs)],
      ['Momento mais fraco', maisFraco ? `${maisFraco[0]} (${maisFraco[2]})` : '—']
    ] },
    { titulo: 'Por setor', tipo: 'tabela', colunas: ['Setor', 'Oportunidades', 'Adesão'],
      linhas: porGrupo(o => o.Setor) },
    { titulo: 'Por categoria profissional', tipo: 'tabela', colunas: ['Categoria', 'Oportunidades', 'Adesão'],
      linhas: porGrupo(o => o.Categoria) },
    { titulo: 'Pelos 5 momentos da OMS', tipo: 'tabela', colunas: ['Momento', 'Oportunidades', 'Adesão'],
      linhas: porMomento }
  ], resumo: [['Oportunidades de higiene', obs.length], ['Adesão à higiene', adesaoDe(obs)]] };
}

/* ---- 4. Antibióticos (stewardship) ---- */
function relatorioAntibioticos(bancos, setoresEscopo, inicio, fim) {
  const prescricoes = ((bancos.antibioticos || {}).prescricoes || [])
    .filter(p => relEscopo(p.Setor, setoresEscopo));
  const cursos = cursosDeAntibiotico(prescricoes);
  /* DOT = dias de terapia dentro do período; cursos emendados não contam dia duplicado. */
  let dot = 0;
  const dotPorDroga = new Map();
  const pacientes = new Set();
  const noPeriodo = [];
  for (const c of cursos) {
    const a = c.inicio > inicio ? c.inicio : inicio;
    const b = c.fim < fim ? c.fim : fim;
    const dias = relDiasEntre(a, b);
    if (dias === null || dias < 0) continue;
    noPeriodo.push(c);
    dot += dias + 1;
    dotPorDroga.set(c.Antibiotico, (dotPorDroga.get(c.Antibiotico) || 0) + dias + 1);
    pacientes.add(normalizarProntuario(c.Prontuario));
  }
  /* Mesmo corte de alertasDeAntibioticos: curso com 10+ dias é prolongado. */
  const prolongados = noPeriodo.filter(c => (relDiasEntre(c.inicio, c.fim) || 0) + 1 >= 10);
  const pd = setoresEscopo ? 0 : pacientesDia((bancos.pacientes || {}).internacoes, inicio, fim);
  const dotMil = pd ? (dot / pd * 1000).toFixed(0) : null;
  const avaliacoes = ((bancos.antibioticos || {}).avaliacoes || [])
    .filter(a => relPeriodo(a.DataDados || a.CriadoEm, inicio, fim));
  const corretas = avaliacoes.filter(a => normalizarTexto(a.Avaliacao) === 'correto');

  const secoes = [
    { titulo: 'Panorama', tipo: 'numeros', itens: [
      ['Dias de terapia (DOT) no período', dot],
      ['DOT por 1.000 pacientes-dia', dotMil || '—'],
      ['Cursos em andamento no período', noPeriodo.length],
      ['Cursos prolongados (10+ dias)', `${prolongados.length} (${relPct(prolongados.length, noPeriodo.length)})`],
      ['Pacientes em antibiótico', pacientes.size],
      ['Avaliações de stewardship', avaliacoes.length],
      ['Avaliadas como "Correto"', `${corretas.length} (${relPct(corretas.length, avaliacoes.length)})`]
    ] },
    { titulo: 'Antibióticos por DOT', tipo: 'tabela', colunas: ['Antibiótico', 'DOT', '% do total'],
      linhas: [...dotPorDroga.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([droga, n]) => [droga, n, relPct(n, dot)]) },
    { titulo: 'Resultado das avaliações', tipo: 'tabela', colunas: ['Avaliação', 'Quantidade'],
      linhas: relContar(avaliacoes, a => a.Avaliacao) },
    { titulo: 'Recomendações dadas', tipo: 'tabela', colunas: ['Recomendação', 'Quantidade'],
      linhas: relContar(avaliacoes, a => a.Recomendacao) }
  ];
  if (setoresEscopo) secoes.push({ titulo: 'Nota', tipo: 'texto', corpo: TEXTO_SEM_DENSIDADE_SETOR });
  return { titulo: 'Antibióticos (stewardship)', secoes,
    resumo: [['DOT', dot], ['DOT/1.000 pac-dia', dotMil || '—'],
      ['Cursos prolongados', prolongados.length], ['Avaliações "Correto"', relPct(corretas.length, avaliacoes.length)]] };
}

/* ---- 5. Isolamentos ---- */
function relatorioIsolamentos(bancos, setoresEscopo, inicio, fim) {
  const precaucoes = ((bancos.isolamentos || {}).precaucoes || [])
    .filter(p => relEscopo(p.Setor, setoresEscopo));
  const novos = precaucoes.filter(p => relPeriodo(p.DataInicio, inicio, fim));
  const ativosNoFim = precaucoes.filter(p => String(p.DataInicio).slice(0, 10) <= fim
    && (!String(p.DataFim || '').trim() || String(p.DataFim).slice(0, 10) > fim));

  /* Oportunidade de isolamento: da coleta da cultura MDR até a decisão de isolar,
     registrada na revisão de pendências. Indicador que só existe porque a decisão
     fica gravada com a cultura que a motivou. */
  const culturasPorID = new Map((((bancos.culturas || {}).culturas) || []).map(c => [c.ID_Cultura, c]));
  const decisoes = ((bancos.isolamentos || {}).decisoes || [])
    .filter(d => relPeriodo(d.CriadoEm, inicio, fim));
  const temposAteIsolar = [];
  for (const d of decisoes) {
    if (normalizarTexto(d.Decisao) !== 'isolado') continue;
    const cultura = culturasPorID.get(d.ID_Cultura);
    if (!cultura || !relEscopo(cultura.Setor, setoresEscopo)) continue;
    const dias = relDiasEntre(cultura.DataColeta, d.CriadoEm);
    if (dias !== null && dias >= 0) temposAteIsolar.push(dias);
  }
  const naoIndicados = decisoes.filter(d => normalizarTexto(d.Decisao) !== 'isolado').length;
  const mediana = relMediana(temposAteIsolar);

  return { titulo: 'Isolamentos e precauções', secoes: [
    { titulo: 'Panorama', tipo: 'numeros', itens: [
      ['Precauções iniciadas no período', novos.length],
      ['Ativas no fim do período', ativosNoFim.length],
      ['Decisões "isolamento não indicado"', naoIndicados],
      ['Tempo coleta → isolamento (mediana)', mediana === null ? '—' : `${mediana} dia(s), em ${temposAteIsolar.length} decisão(ões)`]
    ] },
    { titulo: 'Por tipo de precaução', tipo: 'tabela', colunas: ['Tipo', 'Iniciadas'],
      linhas: relContar(novos, p => p.TipoPrecaucao) },
    { titulo: 'Por motivo', tipo: 'tabela', colunas: ['Motivo', 'Iniciadas'],
      linhas: relContar(novos, p => p.Motivo).slice(0, 8) }
  ], resumo: [['Precauções iniciadas', novos.length], ['Ativas no fim do período', ativosNoFim.length],
    ['Mediana coleta→isolamento', mediana === null ? '—' : mediana + ' d']] };
}

/* ---- 6. Sepse ---- */
function relatorioSepse(bancos, setoresEscopo, inicio, fim) {
  const todos = ((bancos.sepse || {}).casos || [])
    .filter(s => relPeriodo(s.DataProtocolo, inicio, fim) && relEscopo(s.Setor, setoresEscopo));
  /* Indicadores só com os casos válidos; os excluídos aparecem na contagem, não nas taxas. */
  const casos = todos.filter(s => s.ExcluidoIndicadores !== 'S');
  const sim = campo => casos.filter(s => s[campo] === 'S');
  const minutosATB = relMediana(casos.map(s => Number(s.MinutosAntibiotico)).filter(n => isFinite(n) && n >= 0));

  return { titulo: 'Protocolo de sepse', secoes: [
    { titulo: 'Panorama', tipo: 'numeros', itens: [
      ['Protocolos abertos', todos.length],
      ['Excluídos dos indicadores', todos.length - casos.length],
      ['Sepse confirmada', `${sim('SepseConfirmada').length} (${relPct(sim('SepseConfirmada').length, casos.length)})`],
      ['Antibiótico em até 1h', `${sim('AntibioticoAte1h').length} (${relPct(sim('AntibioticoAte1h').length, casos.length)})`],
      ['Hemocultura antes do ATB', `${sim('HemoculturaAntesATB').length} (${relPct(sim('HemoculturaAntesATB').length, casos.length)})`],
      ['Bundle completo', `${sim('BundleCompleto').length} (${relPct(sim('BundleCompleto').length, casos.length)})`],
      ['Minutos até o antibiótico (mediana)', minutosATB === null ? '—' : minutosATB + ' min']
    ] },
    { titulo: 'Por setor', tipo: 'tabela', colunas: ['Setor', 'Protocolos'],
      linhas: relContar(casos, s => s.Setor) },
    { titulo: 'Por foco infeccioso', tipo: 'tabela', colunas: ['Foco', 'Protocolos'],
      linhas: relContar(casos, s => s.FocoInfeccioso) },
    { titulo: 'Desfecho', tipo: 'tabela', colunas: ['Desfecho', 'Casos'],
      linhas: relContar(casos, s => s.Desfecho) }
  ], resumo: [['Protocolos de sepse', todos.length],
    ['ATB ≤ 1h na sepse', relPct(sim('AntibioticoAte1h').length, casos.length)]] };
}

/* ---- 7. ISC e vigilância pós-alta ---- */
function relatorioPosAlta(bancos, setoresEscopo, inicio, fim) {
  const cirurgias = ((bancos.cirurgias || {}).cirurgias || [])
    .filter(c => relPeriodo(c.DataCirurgia, inicio, fim));
  const isc = cirurgias.filter(c => c.ISC === 'S');
  const semInfeccao = cirurgias.filter(c => normalizarTexto(c.StatusVigilancia) === 'seminfeccao');
  const comDesfecho = semInfeccao.length + isc.length;

  const secoes = [
    { titulo: 'Panorama', tipo: 'numeros', itens: [
      ['Cirurgias no período', cirurgias.length],
      ['Com desfecho conhecido', comDesfecho],
      ['ISC identificadas', isc.length],
      ['Taxa de ISC (entre desfechos conhecidos)', relPct(isc.length, comDesfecho)]
    ] },
    { titulo: 'Situação da vigilância', tipo: 'tabela', colunas: ['Situação', 'Cirurgias'],
      linhas: relContar(cirurgias, c => c.StatusVigilancia || 'pendente') },
    { titulo: 'ISC por tipo', tipo: 'tabela', colunas: ['Tipo de ISC', 'Casos'],
      linhas: relContar(isc, c => c.TipoISC) },
    { titulo: 'ISC por procedimento', tipo: 'tabela', colunas: ['Procedimento', 'ISC'],
      linhas: relContar(isc, c => c.ProcedimentoNHSN || c.Procedimento).slice(0, 10) }
  ];
  if (setoresEscopo && setoresEscopo.length) {
    secoes.push({ titulo: 'Nota', tipo: 'texto',
      corpo: 'O relatório do centro cirúrgico não traz setor de internação — este relatório sempre cobre o hospital inteiro.' });
  }
  return { titulo: 'ISC e vigilância pós-alta', secoes,
    resumo: [['Cirurgias', cirurgias.length], ['ISC', isc.length],
      ['Taxa de ISC', relPct(isc.length, comDesfecho)]] };
}

/* ---- 8. Resumo executivo ---- */
function relatorioResumoExecutivo(bancos, setoresEscopo, inicio, fim) {
  const partes = [
    relatorioIRAS(bancos, setoresEscopo, inicio, fim),
    relatorioMicrobiologico(bancos, setoresEscopo, inicio, fim),
    relatorioHigiene(bancos, setoresEscopo, inicio, fim),
    relatorioAntibioticos(bancos, setoresEscopo, inicio, fim),
    relatorioIsolamentos(bancos, setoresEscopo, inicio, fim),
    relatorioSepse(bancos, setoresEscopo, inicio, fim),
    relatorioPosAlta(bancos, setoresEscopo, inicio, fim)
  ];
  return { titulo: 'Resumo executivo',
    secoes: partes.map(p => ({ titulo: p.titulo, tipo: 'numeros', itens: p.resumo })),
    resumo: [] };
}

/* Intervalo do mês anterior fechado — o período padrão dos relatórios. */
function mesAnteriorIntervalo(hoje) {
  const [ano, mes] = String(hoje).slice(0, 7).split('-').map(Number);
  const a = mes === 1 ? ano - 1 : ano, m = mes === 1 ? 12 : mes - 1;
  const ultimoDia = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return [`${a}-${mm}-01`, `${a}-${mm}-${String(ultimoDia).padStart(2, '0')}`];
}

/* Catálogo que a UI apresenta. As chaves são estáveis (entram em links e testes). */
const RELATORIOS_PADRAO = [
  ['iras', 'IRAS do período', relatorioIRAS],
  ['micro', 'Perfil microbiológico e resistência', relatorioMicrobiologico],
  ['higiene', 'Higiene das mãos', relatorioHigiene],
  ['antibioticos', 'Antibióticos (stewardship)', relatorioAntibioticos],
  ['isolamentos', 'Isolamentos e precauções', relatorioIsolamentos],
  ['sepse', 'Protocolo de sepse', relatorioSepse],
  ['pos_alta', 'ISC e vigilância pós-alta', relatorioPosAlta],
  ['executivo', 'Resumo executivo', relatorioResumoExecutivo]
];

/* Bancos que os relatórios leem — a UI carrega todos de uma vez. */
const BANCOS_RELATORIOS = ['iras', 'culturas', 'higiene_maos', 'antibioticos', 'isolamentos',
  'sepse', 'cirurgias', 'pacientes'];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { relatorioIRAS, relatorioMicrobiologico, relatorioHigiene,
    relatorioAntibioticos, relatorioIsolamentos, relatorioSepse, relatorioPosAlta,
    relatorioResumoExecutivo, RELATORIOS_PADRAO, BANCOS_RELATORIOS, pacientesDia,
    relMediana, relDiasEntre, mesAnteriorIntervalo };
}
