/* Vigilância de colonização (swabs de vigilância) — núcleo puro, testável em Node.
   Decisões da CCIH (03/11/2026):
   - O laudo diz o sítio (retal, orofaringe, nasal, axilar; perianal/vaginal = pesquisa de
     SGB). A importação guarda em SitioSwab; o histórico sem sítio cai em "outros".
   - Quatro grupos: nasal em adulto (rastreio de MRSA pré-operatório), retal/orofaringe em
     adulto FORA da UTI (admissão/transferidos), retal/orofaringe na UTI adulto (vigilância
     semanal: 4º dia e depois a cada 7) e outros (neo/pediátrica, SGB, sem sítio).
   - Positivo de vigilância = carbapenem-resistente, MRSA ou VRE (ESBL NÃO entra). SGB
     (Streptococcus agalactiae) tem alerta próprio: não é isolamento, é possível profilaxia
     intraparto se gestante.
   - UTI: acusa paciente há mais de 9 dias sem swab (resultado sai em 48 h; coleta a cada 7).
   - Descolonização do MRSA nasal é registrada aqui (DescolonizacaoEm/DescolonizacaoObs). */

const SITIOS_SWAB = { retal: 'Retal', orofaringe: 'Orofaringe', nasal: 'Nasal', axilar: 'Axilar/inguinal',
  perianal: 'Perianal (SGB)', vaginal: 'Vaginal (SGB)' };
const COLONIZACAO_DIAS_SEM_SWAB_UTI = 9;
const COLONIZACAO_JANELA_AQUISICAO_DIAS = 45;
const COLONIZACAO_MECANISMO_POSITIVO = /carbapen|kpc|ndm|oxa\s*-?\s*48|mrsa|vre|vancomicina/;
const COLONIZACAO_SGB = /agalactiae|grupob|estreptococodogrupob|sgb/;
const COLONIZACAO_CIRURGIA_CARDIACA = ['Cirurgia cardíaca', 'Revascularização do miocárdio'];

/* Sítio a partir do material CRU do laudo ("Swab retal", "SWR - CULTURA DE VIGILANCIA -
   SWAB RETAL", "WBO", "Swab Nasal", "CAMPP - SWAB PERIANAL"…). Testado contra
   normalizarTexto (sem espaços/acentos). Genérico ("Swab", "SW") devolve ''. */
function sitioDoSwab(material) {
  const t = normalizarTexto(material);
  if (!t) return '';
  if (/vaginal|campv/.test(t)) return 'vaginal';
  if (/perianal|campp/.test(t)) return 'perianal';
  if (/nasal|^wbn$|swn$/.test(t)) return 'nasal';
  if (/orofaring|oral|^wbo$|^swo$|^swbo$|^swabo$/.test(t)) return 'orofaringe';
  if (/retal|anal|^swr$|^swbr$|^swabr$|^swar$/.test(t)) return 'retal';
  if (/axilar|inguinal/.test(t)) return 'axilar';
  return '';
}

function ehSwabVigilancia(cultura) {
  return /swab|vigilancia|rastreio|pesquisadesgb|streptococcusdogrupob/.test(normalizarTexto(cultura.Material));
}
function _setorUTIAdultoCol(setor) { const s = String(setor || ''); return /\bcti\b|\buti\b/i.test(s) && !/neonat|pedi|bercario/i.test(s); }
function _setorPediatricoCol(setor) { return /neonat|pedi|bercario|rn\b/i.test(String(setor || '')); }

/* Grupo (aba) de um swab. */
function grupoDoSwab(cultura) {
  const sitio = String(cultura.SitioSwab || '').trim();
  const ped = _setorPediatricoCol(cultura.Setor);
  if (ped || !sitio || sitio === 'perianal' || sitio === 'vaginal') return 'outros';
  if (sitio === 'nasal') return 'nasal_adulto';
  return _setorUTIAdultoCol(cultura.Setor) ? 'uti_adulto' : 'admissao_adulto';
}

/* Resultado do swab: mecanismo (declarado ou inferido do antibiograma), positivo de
   vigilância (MDR que pede precaução), SGB e "cresceu sem MDR". */
function resultadoDoSwab(cultura, sens) {
  const micro = String(cultura.Microrganismo || '').trim();
  const mecanismo = String(cultura.MecanismoResistencia || '').trim()
    || (typeof inferirMecanismo === 'function' ? inferirMecanismo(micro, sens || []) : '');
  const sgb = COLONIZACAO_SGB.test(normalizarTexto(micro));
  const positivo = !!micro && COLONIZACAO_MECANISMO_POSITIVO.test(normalizarTexto(mecanismo));
  return { micro, mecanismo, positivo, sgb, cresceu: !!micro && !/negativ|ausencia|semcrescimento/.test(normalizarTexto(micro)) };
}

function _addDias(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
function _diasEntre(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
function _segundaDaSemana(iso) { const d = new Date(iso + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; return _addDias(iso, -dow); }

/* Painel completo. opcoes: { dias (janela, padrão 90), semanas (UTI, padrão 8) }. */
function painelColonizacao(bancos, hoje, opcoes) {
  const op = opcoes || {};
  const fim = String(hoje).slice(0, 10);
  const inicio = _addDias(fim, -(op.dias || 90));
  const culturas = (((bancos.culturas || {}).culturas) || []);
  const sensPorCultura = new Map();
  for (const s of (((bancos.culturas || {}).sensibilidade) || [])) {
    if (!sensPorCultura.has(s.ID_Cultura)) sensPorCultura.set(s.ID_Cultura, []);
    sensPorCultura.get(s.ID_Cultura).push(s);
  }
  const nomes = new Map((((bancos.pacientes || {}).pacientes) || []).map(p => [normalizarProntuario(p.Prontuario), p.Nome]));
  const precaucoesAtivas = new Set((((bancos.isolamentos || {}).precaucoes) || [])
    .filter(p => !String(p.DataFim || '').trim()).map(p => normalizarProntuario(p.Prontuario)));
  const cirurgiasCardiacas = (((bancos.cirurgias || {}).cirurgias) || [])
    .filter(c => COLONIZACAO_CIRURGIA_CARDIACA.includes(String(c.ProcedimentoNHSN || '').trim()) && /^\d{4}-/.test(String(c.DataCirurgia || '')));

  /* Todos os swabs (com janela maior para a UTI: aquisição olha para trás). */
  const swabs = culturas.filter(c => ehSwabVigilancia(c) && c.StatusRevisao !== 'descartada' && /^\d{4}-/.test(String(c.DataColeta || '')))
    .map(c => {
      const r = resultadoDoSwab(c, sensPorCultura.get(c.ID_Cultura));
      const pront = normalizarProntuario(c.Prontuario);
      const data = String(c.DataColeta).slice(0, 10);
      return { cultura: c, prontuario: pront, nome: nomes.get(pront) || c.Prontuario, data, setor: String(c.Setor || '').trim(),
        sitio: String(c.SitioSwab || '').trim(), grupo: grupoDoSwab(c), ...r,
        emPrecaucao: precaucoesAtivas.has(pront),
        cirurgiaCardiaca: cirurgiasCardiacas.find(k => normalizarProntuario(k.Prontuario) === pront && Math.abs(_diasEntre(data, String(k.DataCirurgia).slice(0, 10))) <= 60) || null,
        visto: !!String(c.VigilanciaVistoEm || '').trim(), descolonizacao: String(c.DescolonizacaoEm || '').trim() };
    })
    .sort((a, b) => b.data.localeCompare(a.data));
  const naJanela = swabs.filter(s => s.data >= inicio && s.data <= fim);

  /* Aquisição na UTI: positivo cuja coleta anterior (≤45 d) na UTI foi negativa e sem
     positivo prévio no período. */
  const utiTodos = swabs.filter(s => s.grupo === 'uti_adulto');
  const porPaciente = new Map();
  for (const s of utiTodos) { if (!porPaciente.has(s.prontuario)) porPaciente.set(s.prontuario, []); porPaciente.get(s.prontuario).push(s); }
  for (const lista of porPaciente.values()) {
    lista.sort((a, b) => a.data.localeCompare(b.data));
    for (let i = 0; i < lista.length; i++) {
      const s = lista[i];
      if (!s.positivo) continue;
      const anteriores = lista.slice(0, i).filter(x => _diasEntre(x.data, s.data) <= COLONIZACAO_JANELA_AQUISICAO_DIAS);
      s.aquisicao = anteriores.length > 0 && anteriores.every(x => !x.positivo || normalizarTexto(x.mecanismo) !== normalizarTexto(s.mecanismo));
    }
  }

  const abas = {};
  for (const g of ['nasal_adulto', 'admissao_adulto', 'uti_adulto', 'outros']) {
    const linhas = naJanela.filter(s => s.grupo === g);
    const pacientes = new Set(linhas.map(s => s.prontuario));
    const positivos = linhas.filter(s => s.positivo);
    abas[g] = { linhas, resumo: {
      swabs: linhas.length, pacientes: pacientes.size,
      positivos: positivos.length, pacientesPositivos: new Set(positivos.map(s => s.prontuario)).size,
      sgb: linhas.filter(s => s.sgb).length,
      semPrecaucao: positivos.filter(s => !s.emPrecaucao).length,
      naoVistos: linhas.filter(s => (s.positivo || s.sgb) && !s.visto).length,
      ...(g === 'nasal_adulto' ? { mrsa: positivos.filter(s => /mrsa/i.test(s.mecanismo)).length,
        mrsaSemDescolonizacao: positivos.filter(s => /mrsa/i.test(s.mecanismo) && !s.descolonizacao).length } : {})
    } };
  }

  /* UTI por semana (últimas N semanas, segunda a domingo). */
  const nSemanas = op.semanas || 8;
  const semanas = [];
  let seg = _segundaDaSemana(fim);
  for (let i = 0; i < nSemanas; i++) { semanas.unshift(seg); seg = _addDias(seg, -7); }
  const utiSemanas = semanas.map(s => {
    const ate = _addDias(s, 6);
    const doPeriodo = utiTodos.filter(x => x.data >= s && x.data <= ate);
    const positivos = doPeriodo.filter(x => x.positivo);
    const aquisicoes = positivos.filter(x => x.aquisicao);
    const porMecanismo = {};
    aquisicoes.forEach(x => { const k = x.mecanismo || '?'; porMecanismo[k] = (porMecanismo[k] || 0) + 1; });
    return { semana: s, ate, swabs: doPeriodo.length, pacientes: new Set(doPeriodo.map(x => x.prontuario)).size,
      positivos: new Set(positivos.map(x => x.prontuario)).size, aquisicoes: aquisicoes.length,
      cluster: Object.entries(porMecanismo).filter(([, n]) => n >= 2).map(([m, n]) => `${n}× ${m}`) };
  });

  /* Internados na UTI adulto há mais de 9 dias sem swab de vigilância. */
  const internados = (typeof internadosAgora === 'function' ? internadosAgora(bancos) : []).filter(i => _setorUTIAdultoCol(i.SetorAtual));
  const semSwab = [];
  for (const i of internados) {
    const pront = normalizarProntuario(i.Prontuario);
    const ultimo = swabs.find(s => s.prontuario === pront && s.grupo !== 'nasal_adulto' && s.data <= fim);
    const desde = ultimo ? ultimo.data : String(i.DataInternacao || '').slice(0, 10);
    if (!/^\d{4}-/.test(desde)) continue;
    const dias = _diasEntre(desde, fim);
    if (dias > COLONIZACAO_DIAS_SEM_SWAB_UTI) semSwab.push({ prontuario: pront, nome: nomes.get(pront) || i.Prontuario, setor: i.SetorAtual, leito: i.Leito || '', dias, ultimoSwab: ultimo ? ultimo.data : '', internadoDesde: String(i.DataInternacao || '').slice(0, 10) });
  }
  semSwab.sort((a, b) => b.dias - a.dias);

  const alertas = [];
  naJanela.filter(s => s.positivo && !s.emPrecaucao && !s.visto).forEach(s => alertas.push({ tipo: 'sem_precaucao', swab: s, texto: `${s.nome} (${s.setor}): ${s.mecanismo} em swab ${SITIOS_SWAB[s.sitio] || ''} de ${s.data} — sem precaução de contato ativa` }));
  naJanela.filter(s => s.sgb && !s.visto).forEach(s => alertas.push({ tipo: 'sgb', swab: s, texto: `${s.nome} (${s.setor}): Streptococcus do grupo B em swab ${SITIOS_SWAB[s.sitio] || ''} de ${s.data} — se gestante, avaliar profilaxia intraparto` }));
  utiSemanas.filter(w => w.cluster.length).forEach(w => alertas.push({ tipo: 'cluster', texto: `UTI, semana de ${w.semana}: ${w.cluster.join(', ')} aquisições do mesmo mecanismo — possível transmissão cruzada` }));
  semSwab.forEach(p => alertas.push({ tipo: 'sem_swab', texto: `${p.nome} (${p.setor}${p.leito ? ', leito ' + p.leito : ''}): ${p.dias} dias sem swab de vigilância` }));

  return { inicio, fim, abas, uti: { semanas: utiSemanas, semSwab }, alertas, semSitio: naJanela.filter(s => !s.sitio).length };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SITIOS_SWAB, sitioDoSwab, ehSwabVigilancia, grupoDoSwab, resultadoDoSwab, painelColonizacao,
    COLONIZACAO_DIAS_SEM_SWAB_UTI, COLONIZACAO_CIRURGIA_CARDIACA };
}
