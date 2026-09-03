/* Motor de alertas: suspeitas de surto e multirresistentes (declarados ou inferidos do antibiograma).
   Funções puras — usáveis no navegador e nos testes em Node. */

const SURTO_JANELA_DIAS = 14;
const SURTO_MINIMO_PACIENTES = 3;
const MDR_JANELA_DIAS = 30;
/* O painel mostra uma janela mais curta: ali interessa o que ainda está acontecendo e
   pede conduta hoje. A janela de 30 dias continua valendo para as pendências de
   isolamento, onde a pergunta é outra — se o paciente segue internado sem precaução. */
const MDR_JANELA_PAINEL_DIAS = 10;

const GENEROS_GRAM_NEGATIVOS = ['klebsiella', 'escherichia', 'enterobacter', 'serratia', 'proteus',
  'morganella', 'citrobacter', 'providencia', 'salmonella', 'pseudomonas', 'acinetobacter', 'stenotrophomonas', 'burkholderia'];

function diasEntre(dataA, dataB) {
  return Math.abs(new Date(dataB) - new Date(dataA)) / 86400000;
}

/* Infere mecanismo de resistência pelo antibiograma; devolve rótulo ou ''. */
function inferirMecanismo(microrganismo, itensSensibilidade) {
  const micro = normalizarTexto(microrganismo);
  const resistentes = new Set(itensSensibilidade.filter(s => s.Resultado === 'R').map(s => normalizarTexto(s.Antibiotico)));
  if (micro.includes('aureus') && resistentes.has('oxacilina')) return 'MRSA';
  if (micro.includes('enterococcus') && (resistentes.has('vancomicina') || resistentes.has('teicoplanina'))) return 'VRE';
  if (GENEROS_GRAM_NEGATIVOS.some(g => micro.includes(g))
    && ['meropenem', 'imipenem', 'ertapenem'].some(a => resistentes.has(a))) return 'Resistente a carbapenêmicos';
  return '';
}

/* Multirresistentes na janela recente: mecanismo declarado no laudo ou inferido do antibiograma. */
function detectarMultirresistentes(culturas, sensibilidade, hoje, janelaDias, mecanismosMonitorados) {
  janelaDias = janelaDias || MDR_JANELA_DIAS;
  /* Rotina da instituição: lista vazia/ausente = monitora tudo. A comparação é por
     inclusão nos dois sentidos ("ERC" casa com "Enterobactéria resistente a carbapenêmicos"
     não — mas "Resistente a carbapenêmicos" casa com "carbapenemicos" da lista). */
  const monitorados = (mecanismosMonitorados || []).map(normalizarTexto).filter(Boolean);
  const monitorado = mecanismo => {
    if (!monitorados.length) return true;
    const n = normalizarTexto(mecanismo);
    return monitorados.some(m => n.includes(m) || m.includes(n));
  };
  const porCultura = {};
  for (const s of sensibilidade || []) {
    (porCultura[s.ID_Cultura] = porCultura[s.ID_Cultura] || []).push(s);
  }
  const alertas = [];
  for (const c of culturas) {
    if (!c.Microrganismo || !c.DataColeta || c.StatusRevisao === 'descartada') continue;
    /* Água e leite não são pacientes: uma pseudomonas na osmose não pede isolamento.
       Colonização FICA — portador de ERC em swab precisa de precaução de contato. */
    if (c.AvaliacaoCCIH === 'Água' || c.AvaliacaoCCIH === 'Leite') continue;
    if (hoje && diasEntre(c.DataColeta, hoje) > janelaDias) continue;
    const declarado = String(c.MecanismoResistencia || '').trim();
    const inferido = inferirMecanismo(c.Microrganismo, porCultura[c.ID_Cultura] || []);
    const mecanismo = declarado || inferido;
    if (!mecanismo || !monitorado(mecanismo)) continue;
    alertas.push({
      ID_Cultura: c.ID_Cultura, Prontuario: c.Prontuario, Setor: c.Setor,
      DataColeta: c.DataColeta, Microrganismo: c.Microrganismo,
      Mecanismo: mecanismo, Origem: declarado ? 'laudo' : 'antibiograma'
    });
  }
  return alertas.sort((a, b) => b.DataColeta.localeCompare(a.DataColeta));
}

/* Identidade estável de uma suspeita. A detecção roda de novo a cada abertura e a janela
   escorrega alguns dias quando chegam culturas novas, então setor + germe + período próximo
   é o que reconhece "é o mesmo surto que eu já estava investigando". */
function mesmaSuspeita(surto, investigacao, toleranciaDias) {
  if (normalizarTexto(surto.Setor) !== normalizarTexto(investigacao.Setor)) return false;
  if (normalizarTexto(surto.Microrganismo) !== normalizarTexto(investigacao.Microrganismo)) return false;
  const tolerancia = toleranciaDias === undefined ? 30 : toleranciaDias;
  const inicioA = Date.parse(String(surto.Inicio) + 'T00:00:00Z');
  const fimA = Date.parse(String(surto.Fim) + 'T00:00:00Z');
  const inicioB = Date.parse(String(investigacao.DataInicio) + 'T00:00:00Z');
  const fimB = Date.parse(String(investigacao.DataFim) + 'T00:00:00Z');
  /* Investigação com datas ilegíveis (campo é texto livre): enquanto aberta, vale como
     "é a mesma"; encerrada, não pode engolir para sempre toda suspeita futura do mesmo
     setor+germe — antes deste ajuste, uma investigação sem data silenciava anos de alertas. */
  if (![inicioA, fimA].every(isFinite)) return true;
  if (![inicioB, fimB].every(isFinite)) return !String(investigacao.DataEncerramento || '').trim();
  const folga = tolerancia * 86400000;
  return inicioA <= fimB + folga && inicioB <= fimA + folga;
}

/* Cruza o que o banco já sabe sobre os pacientes de uma suspeita, procurando o que eles têm
   em comum. Não conclui nada — levanta as coincidências que merecem investigação. */
function correlacionarSurto(prontuarios, bancos) {
  const alvo = new Set(prontuarios.map(normalizarProntuario));
  const doSurto = lista => (lista || []).filter(l => alvo.has(normalizarProntuario(l.Prontuario)));
  /* Só interessa o que é COMPARTILHADO: valor presente em mais de um paciente. */
  const contarPor = (lista, campo) => {
    const contagem = new Map();
    for (const item of lista) {
      const valor = String(item[campo] || '').trim();
      if (!valor) continue;
      if (!contagem.has(valor)) contagem.set(valor, new Set());
      contagem.get(valor).add(normalizarProntuario(item.Prontuario));
    }
    return [...contagem.entries()]
      .map(([valor, pacientes]) => ({ valor, pacientes: pacientes.size }))
      .filter(x => x.pacientes > 1)
      .sort((a, b) => b.pacientes - a.pacientes);
  };

  const internacoes = doSurto(bancos.internacoes);
  const cirurgias = doSurto(bancos.cirurgias);
  const dispositivos = doSurto(bancos.dispositivos);
  const culturas = doSurto(bancos.culturas);

  /* Internações que se sobrepõem no tempo: sem coincidir no tempo não há transmissão cruzada. */
  const sobreposicoes = [];
  for (let i = 0; i < internacoes.length; i++) {
    for (let j = i + 1; j < internacoes.length; j++) {
      const a = internacoes[i], b = internacoes[j];
      if (normalizarProntuario(a.Prontuario) === normalizarProntuario(b.Prontuario)) continue;
      const inicioA = Date.parse(String(a.DataInternacao) + 'T00:00:00Z');
      const fimA = Date.parse(String(a.DataAlta || '2099-12-31') + 'T00:00:00Z');
      const inicioB = Date.parse(String(b.DataInternacao) + 'T00:00:00Z');
      const fimB = Date.parse(String(b.DataAlta || '2099-12-31') + 'T00:00:00Z');
      if (![inicioA, fimA, inicioB, fimB].every(isFinite)) continue;
      if (inicioA <= fimB && inicioB <= fimA) {
        sobreposicoes.push({
          a: normalizarProntuario(a.Prontuario), b: normalizarProntuario(b.Prontuario),
          setorA: a.SetorAtual || '', setorB: b.SetorAtual || '',
          dias: Math.round((Math.min(fimA, fimB) - Math.max(inicioA, inicioB)) / 86400000) + 1,
          mesmoSetor: normalizarTexto(a.SetorAtual) === normalizarTexto(b.SetorAtual)
        });
      }
    }
  }

  return {
    pacientes: [...alvo],
    leitos: contarPor(internacoes.filter(i => i.Leito), 'Leito'),
    setores: contarPor(internacoes, 'SetorAtual'),
    sobreposicoes: sobreposicoes.sort((x, y) => y.dias - x.dias).slice(0, 20),
    procedimentos: contarPor(cirurgias, 'ProcedimentoNHSN'),
    cirurgioes: contarPor(cirurgias, 'Cirurgiao'),
    dispositivos: contarPor(dispositivos, 'Categoria'),
    mecanismos: contarPor(culturas.filter(c => c.MecanismoResistencia), 'MecanismoResistencia'),
    materiais: contarPor(culturas, 'Material'),
    totais: {
      internacoes: internacoes.length, cirurgias: cirurgias.length,
      dispositivos: dispositivos.length, culturas: culturas.length
    }
  };
}

/* Suspeita de surto: pacientes distintos com o mesmo microrganismo no mesmo setor dentro da janela. */
function detectarSurtos(culturas, janelaDias, minimoPacientes) {
  janelaDias = janelaDias || SURTO_JANELA_DIAS;
  minimoPacientes = minimoPacientes || SURTO_MINIMO_PACIENTES;
  const grupos = {};
  for (const c of culturas) {
    if (!c.Microrganismo || !c.DataColeta || !c.Setor || c.StatusRevisao === 'descartada') continue;
    if (c.AvaliacaoCCIH === 'Água' || c.AvaliacaoCCIH === 'Leite') continue;
    if (normalizarTexto(c.Material).includes('swab')) continue;
    const chave = normalizarTexto(c.Setor) + '|' + normalizarTexto(c.Microrganismo);
    (grupos[chave] = grupos[chave] || { setor: c.Setor, micro: c.Microrganismo, itens: [] })
      .itens.push({ data: c.DataColeta, prontuario: normalizarProntuario(c.Prontuario), cultura: c.ID_Cultura });
  }
  const alertas = [];
  for (const grupo of Object.values(grupos)) {
    const itens = grupo.itens.sort((a, b) => a.data.localeCompare(b.data));
    let melhor = null;
    for (let i = 0; i < itens.length; i++) {
      const pacientes = new Set();
      const culturas = [];
      let fim = itens[i].data;
      for (let j = i; j < itens.length && diasEntre(itens[i].data, itens[j].data) <= janelaDias; j++) {
        pacientes.add(itens[j].prontuario);
        culturas.push({ ID_Cultura: itens[j].cultura, Prontuario: itens[j].prontuario, DataColeta: itens[j].data });
        fim = itens[j].data;
      }
      if (pacientes.size >= minimoPacientes && (!melhor || pacientes.size > melhor.pacientes)) {
        melhor = { pacientes: [...pacientes], culturas, inicio: itens[i].data, fim };
      }
    }
    if (melhor) {
      /* Os prontuários vão junto: são eles que a tela de investigação cruza com internações,
         cirurgias e dispositivos para procurar o que os pacientes têm em comum. */
      alertas.push({
        Setor: grupo.setor, Microrganismo: grupo.micro, Pacientes: melhor.pacientes.length,
        Prontuarios: melhor.pacientes, Culturas: melhor.culturas,
        Inicio: melhor.inicio, Fim: melhor.fim
      });
    }
  }
  return alertas.sort((a, b) => b.Pacientes - a.Pacientes);
}

/* Pendências de isolamento: multirresistente recente sem precaução ativa e sem decisão registrada. */
function pendenciasIsolamento(culturas, sensibilidade, precaucoes, decisoes, hoje, janelaDias, mecanismosMonitorados) {
  const mdr = detectarMultirresistentes(culturas, sensibilidade, hoje, janelaDias || 30, mecanismosMonitorados);
  const isolados = new Set((precaucoes || [])
    .filter(p => !String(p.DataFim || '').trim())
    .map(p => normalizarProntuario(p.Prontuario)));
  const decididas = new Set((decisoes || []).map(d => d.ID_Cultura));
  return mdr
    .filter(m => !isolados.has(normalizarProntuario(m.Prontuario)) && !decididas.has(m.ID_Cultura))
    .map(m => ({
      ...m,
      Sugestao: normalizarTexto(m.Microrganismo).includes('tubercul') ? 'Aerossol' : 'Contato'
    }));
}

/* Isolamentos de um dia que precisam ser digitados no sistema do hospital. Só os
   registrados NO APP (ID PRC-, nascidos na revisão de culturas): os importados da lista
   do hospital (PRE-) vieram DE lá — já estão notificados por definição. */
function isolamentosParaNotificar(precaucoes, dia) {
  return (precaucoes || []).filter(p => String(p.ID_Precaucao || '').startsWith('PRC-')
    && String(p.DataInicio).slice(0, 10) === dia);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectarSurtos, detectarMultirresistentes, inferirMecanismo, pendenciasIsolamento,
    mesmaSuspeita, correlacionarSurto, resumoParaVisitaUTI, ehSetorDeUTI, iniciaisDe, isolamentosParaNotificar,
    GENEROS_GRAM_NEGATIVOS };
}

/* ---- Resumo para a visita técnica da UTI ----
   Texto curto que vai pelo WhatsApp para o celular de quem fará a visita: o que aconteceu
   no setor no último mês e o que está ativo agora, para a conversa com a equipe da UTI já
   chegar com os pontos críticos na mão. Pacientes aparecem como iniciais + leito — o texto
   viaja num aplicativo de mensagens, não carrega nome inteiro nem prontuário. */

function ehSetorDeUTI(setor) {
  return /\b(uti|cti)\b/i.test(String(setor || ''));
}

function iniciaisDe(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '';
  return partes.map(p => p[0].toUpperCase() + '.').join('');
}

function resumoParaVisitaUTI(bancos, setor, hoje, mecanismosMonitorados) {
  const corte = new Date(Date.parse(hoje + 'T00:00:00Z') - 30 * 86400000).toISOString().slice(0, 10);
  const doSetor = s => setor ? String(s || '').trim() === setor : ehSetorDeUTI(s);
  /* O miniapp de higiene usa rótulos próprios de setor ("Uti") que não batem com os nomes
     vindos do laboratório; além da igualdade exata, casa pela família — ambos UTI/CTI e
     mesma clientela (adulto × neonatal/pediátrica). */
  const ehNeoPed = s => /neonat|pedi[aá]tr|\bneo\b/i.test(String(s || ''));
  const doSetorFamilia = s => doSetor(s)
    || (Boolean(setor) && ehSetorDeUTI(s) && ehSetorDeUTI(setor) && ehNeoPed(s) === ehNeoPed(setor));
  const nomes = new Map(((bancos.pacientes || {}).pacientes || [])
    .map(p => [normalizarProntuario(p.Prontuario), p.Nome]));
  const rotuloPaciente = (prontuario, leito) => {
    const iniciais = iniciaisDe(nomes.get(normalizarProntuario(prontuario)));
    const posicao = leito ? `leito ${leito}` : '';
    return [iniciais, posicao].filter(Boolean).join(' ') || `reg. ${prontuario}`;
  };

  const blocos = [];

  /* MDR do mês: mecanismo declarado ou inferido do antibiograma. */
  const culturas = ((bancos.culturas || {}).culturas || []).filter(c => doSetor(c.Setor));
  const mdr = detectarMultirresistentes(
    culturas.filter(c => String(c.DataColeta) >= corte),
    (bancos.culturas || {}).sensibilidade || [], hoje, 30, mecanismosMonitorados);
  if (mdr.length) {
    blocos.push({ titulo: `🦠 Multirresistentes (${mdr.length} no mês)`, linhas: mdr.slice(0, 8).map(a =>
      `${a.Microrganismo} (${a.Mecanismo}) — ${rotuloPaciente(a.Prontuario)} — coleta ${String(a.DataColeta).slice(0, 10)}`) });
  }

  /* Isolamentos valendo agora. */
  const isolados = ((bancos.isolamentos || {}).precaucoes || [])
    .filter(p => doSetor(p.Setor) && p.Status === 'ativo' && !String(p.DataFim || '').trim());
  if (isolados.length) {
    blocos.push({ titulo: `🚧 Em isolamento agora (${isolados.length})`, linhas: isolados.map(p =>
      `${p.TipoPrecaucao} — ${String(p.Motivo || '').slice(0, 48)} — ${rotuloPaciente(p.Prontuario, p.Leito)}`) });
  }

  /* IRAS confirmadas no mês. */
  const iras = ((bancos.iras || {}).casos || [])
    .filter(k => doSetor(k.Setor) && String(k.DataInfeccao) >= corte);
  if (iras.length) {
    const porTopografia = {};
    iras.forEach(k => { const t = k.Topografia || '(sem topografia)'; porTopografia[t] = (porTopografia[t] || 0) + 1; });
    blocos.push({ titulo: `🩺 IRAS no mês (${iras.length})`, linhas: Object.entries(porTopografia)
      .sort((a, b) => b[1] - a[1]).map(([t, qtd]) => `${qtd}× ${t}`) });
  }

  /* Sepse do mês: volume e o indicador que a equipe consegue mudar na hora. */
  const sepse = ((bancos.sepse || {}).casos || [])
    .filter(s => doSetor(s.Setor) && String(s.DataProtocolo) >= corte);
  if (sepse.length) {
    const atb1h = sepse.filter(s => s.AntibioticoAte1h === 'S').length;
    blocos.push({ titulo: `🩸 Protocolos de sepse no mês (${sepse.length})`,
      linhas: [`antibiótico em até 1h: ${atb1h} de ${sepse.length}`] });
  }

  /* Higiene das mãos do mês: adesão e o momento mais fraco. */
  const higiene = ((bancos.higiene_maos || {}).observacoes || [])
    .filter(o => doSetorFamilia(o.Setor) && String(o.Data) >= corte);
  if (higiene.length) {
    const sim = higiene.filter(o => o.Acao === 'Higienizou').length;
    const porMomento = new Map();
    higiene.forEach(o => {
      const m = o.Momento || '(sem momento)';
      if (!porMomento.has(m)) porMomento.set(m, { sim: 0, total: 0 });
      porMomento.get(m).total++;
      if (o.Acao === 'Higienizou') porMomento.get(m).sim++;
    });
    const pior = [...porMomento.entries()].filter(([, g]) => g.total >= 5)
      .sort((a, b) => (a[1].sim / a[1].total) - (b[1].sim / b[1].total))[0];
    const linhas = [`adesão: ${Math.round(sim / higiene.length * 100)}% (${higiene.length} oportunidades)`];
    if (pior) linhas.push(`momento mais fraco: ${pior[0]} (${Math.round(pior[1].sim / pior[1].total * 100)}%)`);
    blocos.push({ titulo: '🧤 Higiene das mãos no mês', linhas });
  }

  /* Utilização de dispositivos invasivos: fotografia das avaliações leito a leito das
     visitas do mês. O censo não dá paciente-dia por setor (o setor registrado é o de
     entrada), então a taxa honesta é a prevalência pontual nos dias de visita. Visita sem
     setor gravado conta — o miniapp é da UTI por natureza. */
  const avaliacoes = ((bancos.uti || {}).visitas || [])
    .filter(v => String(v.Data) >= corte && (!String(v.Setor || '').trim() || doSetorFamilia(v.Setor)));
  if (avaliacoes.length) {
    const uso = [['CVC', 'CVC'], ['VM', 'ventilação mecânica'], ['SVD', 'sonda vesical']]
      .map(([campo, rotulo]) => {
        const n = avaliacoes.filter(v => v[campo] === 'S').length;
        return `${rotulo}: ${n}/${avaliacoes.length} (${Math.round(n / avaliacoes.length * 100)}%)`;
      });
    const diasDeVisita = new Set(avaliacoes.map(v => String(v.Data).slice(0, 10))).size;
    blocos.push({ titulo: '🧰 Uso de dispositivos invasivos',
      linhas: [uso.join(' · '),
        `fotografia de ${avaliacoes.length} avaliações em ${diasDeVisita} dia(s) de visita`] });
  }

  /* Pendências da última visita: retirada sugerida e o dispositivo segue em uso. */
  const visitas = ((bancos.uti || {}).visitas || []).slice()
    .sort((a, b) => String(b.Data).localeCompare(String(a.Data)));
  const dispositivos = ((bancos.dispositivos || {}).dispositivos || []);
  if (visitas.length) {
    const ultimaData = visitas[0].Data;
    const marcas = [['CVC_Retirar', 'CVC'], ['VM_Retirar', 'VM'], ['SVD_Retirar', 'SVD']];
    const pendentes = [];
    for (const v of visitas.filter(x => x.Data === ultimaData)) {
      for (const [campo, categoria] of marcas) {
        if (v[campo] !== 'S') continue;
        const aberto = dispositivos.some(d =>
          normalizarProntuario(d.Prontuario) === normalizarProntuario(v.Prontuario)
          && d.Categoria === categoria && !String(d.DataRetirada || '').trim());
        if (aberto) pendentes.push(`${categoria} — retirada sugerida em ${String(v.Data).slice(0, 10)}, segue em uso — ${rotuloPaciente(v.Prontuario, v.Leito)}`);
      }
    }
    if (pendentes.length) {
      blocos.push({ titulo: `⚠ Pendências da visita de ${String(ultimaData).slice(0, 10)}`, linhas: pendentes });
    }
  }

  /* Surto em investigação envolvendo o setor. */
  const surtos = ((bancos.surtos || {}).investigacoes || [])
    .filter(s => doSetor(s.Setor) && s.Situacao && s.Situacao !== 'descartado' && !String(s.DataEncerramento || '').trim());
  if (surtos.length) {
    blocos.push({ titulo: `🔬 Surto em investigação (${surtos.length})`, linhas: surtos.map(s =>
      `${s.Microrganismo} — desde ${String(s.DataInicio).slice(0, 10)} — situação: ${s.Situacao}`) });
  }

  const cabecalho = `*Resumo CCIH — ${setor || 'UTI/CTI'} — ${String(hoje).slice(0, 10).split('-').reverse().join('/')}*`
    + '\n_Último mês e situação atual, para a visita técnica._';
  const corpo = blocos.length
    ? blocos.map(b => `\n\n*${b.titulo}*\n` + b.linhas.map(l => '• ' + l).join('\n')).join('')
    : '\n\nSem ocorrências registradas no período. 🎉';
  return { blocos, texto: cabecalho + corpo };
}
