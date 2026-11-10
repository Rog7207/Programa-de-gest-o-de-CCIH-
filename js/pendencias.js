/* Pendências por paciente (10/11/2026) — motor puro, testável em Node.

   Junta tudo que está aberto para a equipe decidir e agrupa por PACIENTE (pela identidade do
   cadastro, não pelo prontuário: a mesma pessoa sob dois prontuários é um paciente só):
   culturas pendentes de revisão, cursos de antibiótico na fila de avaliação, suspeitas de
   IRAS em investigação e pendências de isolamento. Cada paciente recebe uma prioridade
   simples para ordenar a lista: UTI, multirresistente, quantas pendências e há quantos dias
   a mais antiga espera. É a entrada unificada; a aba Infecções é a saída unificada. */

const PENDENCIAS_DIAS_REVALIDAR_ATB = 7;

/* bancos: { culturas: {culturas, sensibilidade}, antibioticos: {prescricoes, avaliacoes},
            uti: {avaliacoes_atb}, iras: {casos}, pacientes: {pacientes, internacoes},
            isolamentos: {precaucoes, decisoes} }
   opcoes: { hoje, ehAtbAvaliado(nome) → bool, mdrMonitorados, diasRevalidar } */
function pendenciasPorPaciente(bancos, opcoes) {
  opcoes = opcoes || {};
  const hoje = opcoes.hoje || new Date().toISOString().slice(0, 10);
  const pacientes = (bancos.pacientes || {}).pacientes || [];
  const internacoes = (bancos.pacientes || {}).internacoes || [];
  const culturas = (bancos.culturas || {}).culturas || [];
  const sensibilidade = (bancos.culturas || {}).sensibilidade || [];
  const prescricoes = (bancos.antibioticos || {}).prescricoes || [];
  const casos = (bancos.iras || {}).casos || [];
  const precaucoes = (bancos.isolamentos || {}).precaucoes || [];
  const decisoes = (bancos.isolamentos || {}).decisoes || [];
  const ehAtbAvaliado = typeof opcoes.ehAtbAvaliado === 'function' ? opcoes.ehAtbAvaliado : () => true;
  const diasRevalidar = opcoes.diasRevalidar || PENDENCIAS_DIAS_REVALIDAR_ATB;

  const identidadeDe = identidadePorNome(pacientes);
  const chaveDe = pront => { const p = normalizarProntuario(pront); return p ? (identidadeDe(p) || p) : ''; };
  const nomes = new Map(pacientes.map(p => [normalizarProntuario(p.Prontuario), p.Nome]));

  const porChave = new Map();
  const paciente = pront => {
    const chave = chaveDe(pront);
    if (!chave) return null;
    if (!porChave.has(chave)) {
      porChave.set(chave, { chave, prontuarios: [], nome: '', setor: '', leito: '', internadoDesde: '', diaInternacao: null,
        emUTI: false, temMDR: false, pendencias: { culturas: [], antibioticos: [], iras: [], isolamentos: [] },
        total: 0, maisAntigaDias: 0, prioridade: 0 });
    }
    const p = porChave.get(chave);
    const np = normalizarProntuario(pront);
    if (np && !p.prontuarios.includes(np)) p.prontuarios.push(np);
    if (!p.nome && nomes.get(np)) p.nome = nomes.get(np);
    return p;
  };
  const idade = data => { const d = diasDesde(data, hoje); return d === null ? 0 : Math.max(0, d); };
  const anotar = (p, data) => { p.total++; const d = idade(data); if (d > p.maisAntigaDias) p.maisAntigaDias = d; };

  /* Culturas pendentes com germe, uma pendência por grupo de amostras repetidas. */
  const pendentes = culturas.filter(c => normalizarTexto(c.StatusRevisao) === 'pendente' && String(c.Microrganismo || '').trim());
  const idsPendentes = new Set(pendentes.map(c => c.ID_Cultura));
  const grupos = agruparCulturasRepetidas(culturas, { identidadeDe });
  const vistos = new Set();
  for (const g of grupos) {
    if (g.Quantidade < 2) continue;
    const amostrasPend = g.Amostras.filter(a => idsPendentes.has(a.ID_Cultura));
    if (!amostrasPend.length) continue;
    g.IDs.forEach(id => vistos.add(id));
    const p = paciente(g.Prontuario);
    if (!p) continue;
    const ultima = amostrasPend[amostrasPend.length - 1];
    p.pendencias.culturas.push({ tipo: 'grupo', grupo: g, amostras: g.Amostras, cultura: ultima,
      rotulo: `${ultima.Material} (${g.Quantidade} amostras) — ${ultima.Microrganismo}`, data: g.Fim });
    if (String(ultima.MecanismoResistencia || '').trim()) p.temMDR = true;
    anotar(p, g.Inicio);
  }
  for (const c of pendentes) {
    if (vistos.has(c.ID_Cultura)) continue;
    const p = paciente(c.Prontuario);
    if (!p) continue;
    p.pendencias.culturas.push({ tipo: 'cultura', grupo: null, amostras: [c], cultura: c,
      rotulo: `${c.Material} — ${c.Microrganismo}${c.MecanismoResistencia ? ' · ' + c.MecanismoResistencia : ''}`, data: c.DataColeta });
    if (String(c.MecanismoResistencia || '').trim()) p.temMDR = true;
    anotar(p, c.DataColeta);
  }

  /* Cursos ativos na fila: antibiótico da rotina, com prontuário, sem avaliação recente. */
  const avaliacoes = ((bancos.antibioticos || {}).avaliacoes || []).concat(
    (((bancos.uti || {}).avaliacoes_atb) || []).map(a => ({ Prontuario: a.Prontuario, Antibiotico: a.Antibiotico, DataDados: a.Data, CriadoEm: a.CriadoEm })));
  const avaliadoRecente = curso => avaliacoes.some(a => chaveDe(a.Prontuario) === chaveDe(curso.Prontuario)
    && normalizarTexto(a.Antibiotico) === normalizarTexto(curso.Antibiotico)
    && (() => { const d = diasDesde(a.DataDados || a.CriadoEm, hoje); return d !== null && d <= diasRevalidar; })());
  const cursos = cursosDeAntibiotico(prescricoes, hoje);
  for (const curso of cursos) {
    if (String(curso.fim) < hoje || !String(curso.Prontuario || '').trim()) continue;
    if (!ehAtbAvaliado(curso.Antibiotico) || avaliadoRecente(curso)) continue;
    const p = paciente(curso.Prontuario);
    if (!p) continue;
    p.pendencias.antibioticos.push({ curso, rotulo: `${curso.Antibiotico} — D${curso.dias}`, data: curso.inicio,
      chave: normalizarProntuario(curso.Prontuario) + '|' + normalizarTexto(curso.Antibiotico) + '|' + curso.inicio });
    anotar(p, curso.inicio);
  }

  /* Suspeitas de IRAS aguardando a segunda assinatura. */
  for (const k of casos) {
    if (normalizarTexto(k.StatusInvestigacao) !== 'eminvestigacao') continue;
    const p = paciente(k.Prontuario);
    if (!p) continue;
    p.pendencias.iras.push({ caso: k, rotulo: `${k.Topografia || 'sem topografia'} — ${String(k.DataInfeccao || '').slice(0, 10)} (${k.CriterioDiagnostico || 'origem não informada'})`,
      data: String(k.DataInfeccao || k.CriadoEm || '').slice(0, 10) });
    anotar(p, String(k.DataInfeccao || k.CriadoEm || '').slice(0, 10));
  }

  /* Multirresistente novo sem precaução nem decisão — amostras repetidas do mesmo germe no
     mesmo paciente são UMA pendência (agruparPendenciasIsolamento, como na aba Isolamentos). */
  const brutas = pendenciasIsolamento(culturas, sensibilidade, precaucoes, decisoes, hoje, null, opcoes.mdrMonitorados);
  const isolPend = typeof agruparPendenciasIsolamento === 'function' ? agruparPendenciasIsolamento(brutas, identidadeDe) : brutas;
  for (const m of isolPend) {
    const p = paciente(m.Prontuario);
    if (!p) continue;
    p.temMDR = true;
    p.pendencias.isolamentos.push({ item: m, rotulo: `${m.Microrganismo || ''}${m.Mecanismo ? ' · ' + m.Mecanismo : ''} — sem precaução`, data: m.DataColeta });
    anotar(p, m.DataColeta);
  }

  /* Situação atual do paciente: internação aberta mais recente de qualquer prontuário dele. */
  const abertasPorChave = new Map();
  for (const i of internacoes) {
    if (String(i.DataAlta || '').trim()) continue;
    const chave = chaveDe(i.Prontuario);
    if (!chave || !porChave.has(chave)) continue;
    const atual = abertasPorChave.get(chave);
    if (!atual || String(i.DataInternacao) > String(atual.DataInternacao)) abertasPorChave.set(chave, i);
  }
  for (const [chave, i] of abertasPorChave) {
    const p = porChave.get(chave);
    p.setor = String(i.SetorAtual || '').trim();
    p.leito = String(i.Leito || '').trim();
    p.internadoDesde = String(i.DataInternacao || '').slice(0, 10);
    const d = diasDesde(p.internadoDesde, hoje);
    p.diaInternacao = d === null ? null : d + 1;
    p.emUTI = ehSetorDeUTI(p.setor);
    p.atendimento = String(i.Atendimento || '').trim();
  }

  const lista = [...porChave.values()];
  for (const p of lista) {
    if (!p.setor) {
      /* Sem internação aberta: o setor da pendência mais recente. */
      const c = p.pendencias.culturas[0] || null;
      p.setor = String((c && c.cultura.Setor) || (p.pendencias.antibioticos[0] && p.pendencias.antibioticos[0].curso.Setor) || '').trim();
      p.emUTI = ehSetorDeUTI(p.setor);
    }
    p.prontuarios.sort();
    p.prioridade = (p.emUTI ? 40 : 0) + (p.temMDR ? 30 : 0) + (p.pendencias.iras.length ? 10 : 0)
      + p.total * 5 + Math.min(30, p.maisAntigaDias) * 2;
  }
  return lista.sort((a, b) => b.prioridade - a.prioridade || b.maisAntigaDias - a.maisAntigaDias || a.nome.localeCompare(b.nome));
}

/* Resumo dos tipos de pendência de um paciente, para a lista (ex.: "2 culturas · 1 ATB"). */
function resumoPendencias(p) {
  const n = p.pendencias;
  return [
    n.culturas.length ? `${n.culturas.length} cultura${n.culturas.length > 1 ? 's' : ''}` : '',
    n.antibioticos.length ? `${n.antibioticos.length} ATB` : '',
    n.iras.length ? `${n.iras.length} suspeita${n.iras.length > 1 ? 's' : ''} de IRAS` : '',
    n.isolamentos.length ? `${n.isolamentos.length} isolamento${n.isolamentos.length > 1 ? 's' : ''}` : ''
  ].filter(Boolean).join(' · ');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pendenciasPorPaciente, resumoPendencias, PENDENCIAS_DIAS_REVALIDAR_ATB };
}
