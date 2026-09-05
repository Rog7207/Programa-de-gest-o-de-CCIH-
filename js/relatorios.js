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
  const sensPorCultura = indiceSensibilidade(bancos);
  const mecanismoDe = c => mecanismoDaCultura(c, sensPorCultura);
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
  const doPeriodo = ((bancos.cirurgias || {}).cirurgias || [])
    .filter(c => relPeriodo(c.DataCirurgia, inicio, fim));
  /* Cateter, bloqueio anestésico, endoscopia diagnóstica: passam pelo centro cirúrgico,
     mas não são cirurgia — fora da conta e da taxa (o total exclui-os declaradamente). */
  const naoCirurgicos = doPeriodo.filter(c => categoriaDeVigilancia(c) === 'nao_cirurgico');
  const cirurgias = doPeriodo.filter(c => categoriaDeVigilancia(c) !== 'nao_cirurgico');
  const st = c => String(c.StatusVigilancia || 'pendente');
  /* Resposta = alguém do outro lado atendeu e houve desfecho clínico. */
  const RESPOSTAS_VIGILANCIA = ['sem infecção', 'em investigação', 'infecção confirmada'];
  const ENTROU_NA_VIGILANCIA = RESPOSTAS_VIGILANCIA
    .concat(['sob vigilância', 'mensagem enviada', 'encerrada sem contato', 'encerrada — óbito',
      'encerrada — número incorreto']);
  const isc = cirurgias.filter(c => c.ISC === 'S');
  const semInfeccao = cirurgias.filter(c => normalizarTexto(c.StatusVigilancia) === 'seminfeccao');
  const comDesfecho = semInfeccao.length + isc.length;

  /* Contagem por tipo de cirurgia — o que a enfermeira contava à mão. */
  const porTipo = new Map();
  for (const c of cirurgias) {
    const tipo = String(c.ProcedimentoNHSN || c.Procedimento || '').trim() || '(sem tipo)';
    if (!porTipo.has(tipo)) porTipo.set(tipo, []);
    porTipo.get(tipo).push(c);
  }
  const linhaTipo = (rotulo, lista) => {
    const vigiadas = lista.filter(c => ENTROU_NA_VIGILANCIA.includes(st(c)));
    const respostas = lista.filter(c => RESPOSTAS_VIGILANCIA.includes(st(c)));
    const semInf = lista.filter(c => normalizarTexto(c.StatusVigilancia) === 'seminfeccao').length;
    const comIsc = lista.filter(c => c.ISC === 'S').length;
    return [rotulo, lista.length, vigiadas.length, respostas.length, semInf, comIsc,
      relPct(comIsc, semInf + comIsc)];
  };
  let linhasTipo = [...porTipo.entries()].sort((a, b) => b[1].length - a[1].length)
    .map(([tipo, lista]) => linhaTipo(tipo, lista));
  if (linhasTipo.length > 30) {
    const resto = [...porTipo.entries()].sort((a, b) => b[1].length - a[1].length).slice(30)
      .flatMap(([, lista]) => lista);
    linhasTipo = linhasTipo.slice(0, 30).concat([linhaTipo(`Outros (${linhasTipo.length - 30} tipos)`, resto)]);
  }
  if (porTipo.size > 1) linhasTipo.push(linhaTipo('TOTAL', cirurgias));

  /* Desempenho da operação de vigilância: quantas buscas deram certo. */
  const respostas = cirurgias.filter(c => RESPOSTAS_VIGILANCIA.includes(st(c)));
  const semContato = cirurgias.filter(c => st(c) === 'encerrada sem contato');
  const contatosTentados = respostas.length + semContato.length;

  const secoes = [
    { titulo: 'Panorama', tipo: 'numeros', itens: [
      ['Cirurgias no período', cirurgias.length],
      ['Procedimentos não cirúrgicos (fora da conta)', naoCirurgicos.length],
      ['Com desfecho conhecido', comDesfecho],
      ['ISC identificadas', isc.length],
      ['Taxa de ISC (entre desfechos conhecidos)', relPct(isc.length, comDesfecho)]
    ] },
    { titulo: 'Desempenho da vigilância', tipo: 'numeros', itens: [
      ['Entraram na vigilância', cirurgias.filter(c => ENTROU_NA_VIGILANCIA.includes(st(c))).length],
      ['Aguardando contato (sob vigilância)', cirurgias.filter(c => st(c) === 'sob vigilância').length],
      ['Mensagens aguardando resposta', cirurgias.filter(c => st(c) === 'mensagem enviada').length],
      ['Respostas obtidas', respostas.length],
      ['Sucesso do contato', `${relPct(respostas.length, contatosTentados)} (${respostas.length} de ${contatosTentados} buscas concluídas)`],
      ['Encerradas sem contato', semContato.length],
      /* Erro de cadastro, não falha da busca: fora do denominador do sucesso do contato. */
      ['Descartadas por número incorreto/inexistente', cirurgias.filter(c => st(c) === 'encerrada — número incorreto').length],
      ['Encerradas por óbito', cirurgias.filter(c => st(c) === 'encerrada — óbito').length],
      ['Dispensadas na triagem', cirurgias.filter(c => st(c) === 'dispensada').length],
      ['Ainda pendentes de triagem', cirurgias.filter(c => st(c) === 'pendente').length]
    ] },
    { titulo: 'Por tipo de cirurgia', tipo: 'tabela',
      colunas: ['Tipo de cirurgia', 'Cirurgias', 'Vigiadas', 'Respostas', 'Sem infecção', 'ISC', 'Taxa ISC'],
      linhas: linhasTipo },
    { titulo: 'Situação da vigilância', tipo: 'tabela', colunas: ['Situação', 'Cirurgias'],
      linhas: relContar(cirurgias, c => c.StatusVigilancia || 'pendente') },
    { titulo: 'ISC por tipo', tipo: 'tabela', colunas: ['Tipo de ISC', 'Casos'],
      linhas: relContar(isc, c => c.TipoISC) }
  ];
  if (setoresEscopo && setoresEscopo.length) {
    secoes.push({ titulo: 'Nota', tipo: 'texto',
      corpo: 'O relatório do centro cirúrgico não traz setor de internação — este relatório sempre cobre o hospital inteiro.' });
  }
  return { titulo: 'ISC e vigilância pós-alta', secoes,
    resumo: [['Cirurgias', cirurgias.length], ['ISC', isc.length],
      ['Sucesso do contato pós-alta', relPct(respostas.length, contatosTentados)],
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

/* ---- Perfil microbiológico das IRAS (anual/semestral) ----
   Reproduz o relatório consolidado que a CCIH entrega à direção: panorama das IRAS por
   setor e período, agentes isolados nas IRAS, agentes por sítio, cepas multirresistentes
   de importância epidemiológica e o perfil de resistência das enterobactérias (%R por
   espécie × antibiótico, em duas versões: só IRAS e todos os isolados). */

function colunasDoPerfil(anoInicial, anoFinal, porSemestre) {
  const colunas = [];
  for (let ano = anoInicial; ano <= anoFinal; ano++) {
    if (porSemestre) {
      colunas.push({ rotulo: `${ano} 1ºsem`, inicio: `${ano}-01-01`, fim: `${ano}-06-30` });
      colunas.push({ rotulo: `${ano} 2ºsem`, inicio: `${ano}-07-01`, fim: `${ano}-12-31` });
    } else {
      colunas.push({ rotulo: String(ano), inicio: `${ano}-01-01`, fim: `${ano}-12-31` });
    }
  }
  return colunas;
}

/* Gram pelo gênero — para o texto "X% Gram-negativos, Y% Gram-positivos, Z% fungos". */
const GENEROS_GRAM_POSITIVOS = ['staphylococcus', 'streptococcus', 'enterococcus',
  'corynebacterium', 'listeria', 'bacillus', 'clostrid'];
const GENEROS_FUNGOS = ['candida', 'aspergillus', 'cryptococcus', 'fusarium', 'trichosporon'];
function classificarGram(microrganismo) {
  const n = normalizarTexto(microrganismo);
  if (!n) return '';
  if (GENEROS_FUNGOS.some(g => n.includes(g)) || n.includes('levedura') || n.includes('fungo')) return 'fungos';
  if (GENEROS_GRAM_POSITIVOS.some(g => n.includes(g)) || n.includes('grampositivo')) return 'Gram-positivos';
  if (GENEROS_GRAM_NEGATIVOS.some(g => n.includes(g)) || n.includes('gramnegativo')
    || n.includes('enterobacteria') || n.includes('haemophilus') || n.includes('moraxella')) return 'Gram-negativos';
  return 'não classificados';
}

/* Espécie canônica para as tabelas de %R. Devolve null quando não é enterobactéria.
   "Enterobactéria (não identificada)" contém "enterobacter" no normalizado — o teste de
   'enterobacteria' vem ANTES para ela não virar Enterobacter spp. */
function especieEnterobacteria(microrganismo) {
  const n = normalizarTexto(microrganismo);
  if (!n) return null;
  if (n.includes('enterobacteria')) return 'Enterobactéria (não identificada)';
  if (n.includes('escherichia')) return 'Escherichia coli';
  if (n.includes('klebsiella')) {
    if (n.includes('pneumoniae')) return 'Klebsiella pneumoniae';
    if (n.includes('oxytoca')) return 'Klebsiella oxytoca';
    return 'Klebsiella spp';
  }
  if (n.includes('enterobacter')) return 'Enterobacter spp';
  if (n.includes('proteus')) return 'Proteus spp';
  if (n.includes('citrobacter')) return 'Citrobacter spp';
  if (n.includes('serratia')) return 'Serratia spp';
  if (n.includes('morganella')) return 'Morganella morganii';
  if (n.includes('providencia') || n.includes('salmonella') || n.includes('shigella')
    || n.includes('hafnia') || n.includes('raoultella')) return 'Outras enterobactérias';
  return null;
}

/* Antibióticos-chave do perfil de resistência; sinônimos já normalizados. */
const ATB_PERFIL = [
  ['Ceftriaxona', ['ceftriaxona']],
  ['Ciprofloxacino', ['ciprofloxacino', 'ciprofloxacina']],
  ['Sulfa/TMP', ['sulfametoxazoltrimetoprima', 'trimetoprimasulfametoxazol', 'sulfametoxazolacidotrimetoprima']],
  ['Amicacina', ['amicacina']],
  ['Pip/Tazo', ['piperacilinatazobactam', 'piperacilinaacidotazobactam']],
  ['Meropenem', ['meropenem']]
];

function corDeResistencia(pct) {
  return pct < 20 ? 'verde' : pct < 50 ? 'laranja' : 'vermelho';
}

function indiceSensibilidade(bancos) {
  const indice = new Map();
  for (const s of ((bancos.culturas || {}).sensibilidade || [])) {
    if (!indice.has(s.ID_Cultura)) indice.set(s.ID_Cultura, []);
    indice.get(s.ID_Cultura).push(s);
  }
  return indice;
}

function mecanismoDaCultura(cultura, sensPorCultura) {
  return String(cultura.MecanismoResistencia || '').trim()
    || inferirMecanismo(cultura.Microrganismo, sensPorCultura.get(cultura.ID_Cultura) || []);
}

/* Tabela %R: espécies de enterobactérias × antibióticos-chave. Cada célula é
   { t: '38% (n=16)', cor } — verde <20%, laranja 20–49%, vermelho ≥50%. */
function tabelaResistenciaEnterobacterias(culturas, sensPorCultura) {
  const porEspecie = new Map();
  for (const c of culturas) {
    const especie = especieEnterobacteria(c.Microrganismo);
    if (!especie) continue;
    if (!porEspecie.has(especie)) porEspecie.set(especie, []);
    porEspecie.get(especie).push(c);
  }
  const linhaDe = (rotulo, lista) => {
    const linha = [rotulo, lista.length];
    for (const [, sinonimos] of ATB_PERFIL) {
      let testados = 0, resistentes = 0;
      for (const c of lista) {
        const itens = (sensPorCultura.get(c.ID_Cultura) || [])
          .filter(s => sinonimos.includes(normalizarTexto(s.Antibiotico)) && ['R', 'S', 'I'].includes(s.Resultado));
        if (!itens.length) continue;
        testados++;
        if (itens.some(s => s.Resultado === 'R')) resistentes++;
      }
      if (!testados) { linha.push('—'); continue; }
      const pct = Math.round(resistentes / testados * 100);
      linha.push({ t: `${pct}% (n=${testados})`, cor: corDeResistencia(pct) });
    }
    return linha;
  };
  const linhas = [...porEspecie.entries()].sort((a, b) => b[1].length - a[1].length)
    .map(([especie, lista]) => linhaDe(especie, lista));
  const todas = [...porEspecie.values()].flat();
  if (todas.length) linhas.push(linhaDe('TODAS as enterobactérias', todas));
  return { colunas: ['Espécie', 'n', ...ATB_PERFIL.map(([rotulo]) => rotulo)], linhas };
}

function perfilMicrobiologico(bancos, anoInicial, anoFinal, porSemestre) {
  const colunas = colunasDoPerfil(anoInicial, anoFinal, porSemestre);
  const inicio = colunas[0].inicio, fim = colunas[colunas.length - 1].fim;
  const naColuna = (data, col) => relPeriodo(data, col.inicio, col.fim);
  const sensPorCultura = indiceSensibilidade(bancos);

  /* Linhas "rótulo × colunas (+Total)" a partir de uma lista com data e chave. */
  const tabelaCruzada = (itens, dataDe, chaveDe, cabecalho, limite) => {
    const porChave = new Map();
    for (const item of itens) {
      const chave = String(chaveDe(item) || '').trim() || '(não informado)';
      if (!porChave.has(chave)) porChave.set(chave, []);
      porChave.get(chave).push(item);
    }
    let linhas = [...porChave.entries()]
      .map(([chave, lista]) => [chave, ...colunas.map(col => lista.filter(i => naColuna(dataDe(i), col)).length), lista.length])
      .sort((a, b) => b[b.length - 1] - a[a.length - 1]);
    if (limite && linhas.length > limite) {
      const resto = linhas.slice(limite);
      const somas = colunas.map((_, i) => resto.reduce((acc, l) => acc + l[i + 1], 0));
      linhas = linhas.slice(0, limite)
        .concat([[`Outros (${resto.length})`, ...somas, somas.reduce((a, b) => a + b, 0)]]);
    }
    if (linhas.length > 1) {
      linhas.push(['TOTAL', ...colunas.map((col, i) => linhas.reduce((acc, l) => acc + l[i + 1], 0)),
        linhas.reduce((acc, l) => acc + l[l.length - 1], 0)]);
    }
    return { colunas: [cabecalho, ...colunas.map(c => c.rotulo), 'Total'], linhas };
  };

  /* 1. Panorama das IRAS. */
  const casos = ((bancos.iras || {}).casos || []).filter(k => relPeriodo(k.DataInfeccao, inicio, fim));
  const internacoes = ((bancos.pacientes || {}).internacoes || []);
  const panorama = tabelaCruzada(casos, k => k.DataInfeccao, k => k.Setor, 'Setor');
  const linhaInternacoes = ['Internações iniciadas', ...colunas.map(col =>
    internacoes.filter(i => naColuna(i.DataInternacao, col)).length)];
  linhaInternacoes.push(linhaInternacoes.slice(1).reduce((a, b) => a + b, 0));
  if (linhaInternacoes[linhaInternacoes.length - 1] > 0) {
    panorama.linhas.push(linhaInternacoes);
    panorama.linhas.push(['IRAS por 100 internações', ...colunas.map((col, i) => {
      const n = casos.filter(k => naColuna(k.DataInfeccao, col)).length;
      const d = linhaInternacoes[i + 1];
      return d ? (n / d * 100).toFixed(2) : '—';
    }), (casos.length / linhaInternacoes[linhaInternacoes.length - 1] * 100).toFixed(2)]);
  }
  const comAgente = casos.filter(k => String(k.Microrganismo || '').trim());
  const textoPositividade = `Foram ${casos.length} IRAS no período. Positividade microbiológica: `
    + `${comAgente.length} de ${casos.length} IRAS com agente identificado (${relPct(comAgente.length, casos.length)}) — `
    + 'o restante é de diagnóstico clínico, sem cultura positiva vinculada.';

  /* 2. Agentes isolados nas IRAS (culturas classificadas como IRAS pela CCIH). */
  const culturasIRAS = ((bancos.culturas || {}).culturas || [])
    .filter(c => String(c.AvaliacaoCCIH || '').startsWith('IRAS') && relPeriodo(c.DataColeta, inicio, fim));
  const agentes = tabelaCruzada(culturasIRAS, c => c.DataColeta, c => c.Microrganismo, 'Agente', 20);
  const porGram = relContar(culturasIRAS, c => classificarGram(c.Microrganismo));
  const textoGram = culturasIRAS.length
    ? 'Dos ' + culturasIRAS.length + ' isolados em IRAS no período: '
      + porGram.map(([g, n]) => `${n} ${g} (${relPct(n, culturasIRAS.length)})`).join(', ') + '.'
    : 'Nenhuma cultura classificada como IRAS no período.';

  /* 3. Agentes por sítio de infecção (a partir dos casos notificados). */
  const porSitio = relContar(casos, k => k.Topografia).map(([topografia, n]) => {
    const doSitio = casos.filter(k => String(k.Topografia || '').trim() === topografia);
    const top = relContar(doSitio, k => k.Microrganismo).slice(0, 3)
      .map(([g, q]) => `${g} (${q})`).join(', ');
    return [topografia, n, top || '—'];
  });

  /* 4. Cepas multirresistentes de importância epidemiológica (entre as IRAS). */
  const mdrIRAS = culturasIRAS
    .map(c => ({ c, mecanismo: mecanismoDaCultura(c, sensPorCultura) }))
    .filter(x => x.mecanismo)
    .sort((a, b) => String(a.c.DataColeta).localeCompare(String(b.c.DataColeta)));
  const criterioDe = c => {
    const sufixo = String(c.AvaliacaoCCIH || '').replace(/^IRAS\s*[—-]?\s*/, '').trim();
    return sufixo || 'IRAS';
  };
  const linhasMDR = mdrIRAS.slice(0, 40).map(({ c, mecanismo }) => [
    (colunas.find(col => naColuna(c.DataColeta, col)) || {}).rotulo || String(c.DataColeta).slice(0, 10),
    c.Microrganismo, criterioDe(c), c.Setor, mecanismo]);

  /* 5. %R das enterobactérias: só IRAS × todos os isolados (fora água/leite/não-cultura). */
  const todasComGerme = ((bancos.culturas || {}).culturas || [])
    .filter(c => relPeriodo(c.DataColeta, inicio, fim) && String(c.Microrganismo || '').trim()
      && !['Água', 'Leite', 'Não é cultura'].includes(String(c.AvaliacaoCCIH || '').trim()));
  const tabelaIRAS = tabelaResistenciaEnterobacterias(culturasIRAS, sensPorCultura);
  const tabelaTodas = tabelaResistenciaEnterobacterias(todasComGerme, sensPorCultura);
  /* Cobertura de antibiograma nos isolados de IRAS — sem isso as células vazias da
     tabela 6 parecem erro, quando são falta de antibiograma vinculado à cultura. */
  const enteroIRAS = culturasIRAS.filter(c => especieEnterobacteria(c.Microrganismo));
  const enteroIRASComATB = enteroIRAS.filter(c => (sensPorCultura.get(c.ID_Cultura) || []).length);
  const textoCoberturaIRAS = enteroIRAS.length
    ? `Dos ${enteroIRAS.length} isolados de enterobactérias em IRAS, ${enteroIRASComATB.length} `
      + `(${relPct(enteroIRASComATB.length, enteroIRAS.length)}) têm antibiograma vinculado — células vazias `
      + 'refletem essa cobertura, não sensibilidade desconhecida no laboratório.'
    : 'Nenhum isolado de enterobactéria em IRAS no período.';
  const legendaCores = 'Célula = % de isolados resistentes (n = testados para o antibiótico). '
    + 'Cores: verde <20%, laranja 20–49%, vermelho ≥50% de resistência. '
    + 'Linhas com n<10 são exploratórias — amostra pequena.';

  const rotuloPeriodo = anoInicial === anoFinal ? String(anoInicial) : `${anoInicial}–${anoFinal}`;
  return {
    titulo: `Perfil microbiológico das IRAS — ${rotuloPeriodo}`,
    secoes: [
      { titulo: '1. Escopo e fontes', tipo: 'texto',
        corpo: 'Consolidado a partir do banco da CCIH: casos de IRAS notificados (dupla assinatura), '
          + 'culturas do laboratório classificadas pela CCIH e antibiogramas importados. '
          + `Período: ${inicio.split('-').reverse().join('/')} a ${fim.split('-').reverse().join('/')}.` },
      { titulo: '2. Panorama das IRAS por setor', tipo: 'tabela', colunas: panorama.colunas, linhas: panorama.linhas },
      { titulo: 'Positividade microbiológica', tipo: 'texto', corpo: textoPositividade },
      { titulo: '3. Agentes isolados nas IRAS', tipo: 'tabela', colunas: agentes.colunas, linhas: agentes.linhas },
      { titulo: 'Distribuição por Gram', tipo: 'texto', corpo: textoGram },
      { titulo: '4. Agentes por sítio de infecção', tipo: 'tabela',
        colunas: ['Sítio (topografia)', 'Casos', 'Agentes principais'], linhas: porSitio },
      { titulo: '5. Cepas multirresistentes nas IRAS', tipo: 'tabela',
        colunas: ['Período', 'Microrganismo', 'Critério', 'Setor', 'Resistência'], linhas: linhasMDR },
      ...(mdrIRAS.length > 40 ? [{ titulo: 'Nota', tipo: 'texto',
        corpo: `Mostrando as 40 primeiras de ${mdrIRAS.length} cepas multirresistentes do período.` }] : []),
      { titulo: '6. Resistência das enterobactérias — isolados de IRAS', tipo: 'tabela',
        colunas: tabelaIRAS.colunas, linhas: tabelaIRAS.linhas },
      { titulo: 'Cobertura de antibiograma nas IRAS', tipo: 'texto', corpo: textoCoberturaIRAS },
      { titulo: '7. Resistência das enterobactérias — todos os isolados', tipo: 'tabela',
        colunas: tabelaTodas.colunas, linhas: tabelaTodas.linhas },
      { titulo: 'Como ler as tabelas de resistência', tipo: 'texto', corpo: legendaCores },
      { titulo: '8. Considerações e limitações', tipo: 'texto',
        corpo: 'Grafias de microrganismos e antibióticos são unificadas pela auditoria de vocabulário e pelos '
          + 'sinônimos registrados nas importações. O %R conta isolados (não pacientes): repetições do mesmo '
          + 'paciente podem inflar espécies com poucas culturas. IRAS sem cultura vinculada entram no panorama, '
          + 'mas não nas tabelas de agentes.' }
    ],
    resumo: []
  };
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
    relMediana, relDiasEntre, mesAnteriorIntervalo,
    perfilMicrobiologico, colunasDoPerfil, classificarGram, especieEnterobacteria,
    tabelaResistenciaEnterobacterias, corDeResistencia, indiceSensibilidade, mecanismoDaCultura };
}
