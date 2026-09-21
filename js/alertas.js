/* Motor de alertas: suspeitas de surto e multirresistentes (declarados ou inferidos do antibiograma).
   Funções puras — usáveis no navegador e nos testes em Node. */

const SURTO_JANELA_DIAS = 14;
const SURTO_MINIMO_PACIENTES = 3;
/* Comparação de antibiogramas na detecção de surto: mínimo de antibióticos testados em
   comum para a comparação valer e concordância exigida entre os resultados. Só S e R
   contam — intermediário não separa clones. */
const SURTO_MIN_ATB_COMUNS = 3;
const SURTO_CONCORDANCIA_MINIMA = 0.8;
/* Eixo "mesmo procedimento": cultura colhida até 90 dias depois da cirurgia (janela
   máxima de vigilância de ISC do NHSN) conta para o grupo daquele procedimento. */
const SURTO_CIRURGIA_DIAS = 90;
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
  /* Mesmo strip de spp/sp da detecção: a investigação de "Acinetobacter" precisa casar
     com a suspeita do grupo "Acinetobacter spp" — é o mesmo sinal. */
  const semSpp = m => normalizarTexto(m).replace(/spp?$/, '');
  if (semSpp(surto.Microrganismo) !== semSpp(investigacao.Microrganismo)) return false;
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
  /* Investigação DESCARTADA só cala o que aconteceu até o descarte: cultura nova depois
     do encerramento reacende a suspeita. Sem isto, o Acinetobacter do CTI descartado em
     12/06/2026 silenciou a continuação de julho (visto no banco real em 16/09/2026). */
  if (normalizarTexto(investigacao.Situacao) === 'descartado') {
    const encerramento = Date.parse(String(investigacao.DataEncerramento || investigacao.DataFim) + 'T00:00:00Z');
    if (isFinite(encerramento) && isFinite(inicioA) && inicioA > encerramento) return false;
  }
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

/* Portas de entrada (pronto atendimento, pronto-socorro, emergência, ambulatórios): flora da
   comunidade e giro enorme de pacientes — 3 com o mesmo germe em 14 dias ali é rotina, não
   transmissão cruzada. As UNIDADES DE ESPERA ficam DE FORA desta exclusão: conferido no banco
   real (21/09/2026), a Sala Vermelha e a Espera de Leitos-Emergência são >90% pacientes já
   internados (têm internação cobrindo a coleta), então excluí-las descartaria surto de
   verdade. Só o setor de entrada em si (sem "espera" no nome) é porta de entrada. */
function ehSetorPortaDeEntrada(setor) {
  const s = normalizarTexto(setor);
  if (s.includes('espera')) return false;
  return /prontoatendimento|prontosocorro|emergenc|ambulat/.test(s);
}

/* Perfil S/R de uma cultura a partir do antibiograma. 'I' fica de fora: intermediário
   não ajuda a separar clones. Devolve Map antibiótico→resultado, ou null sem itens. */
function perfilAntibiograma(itensSensibilidade) {
  const perfil = new Map();
  for (const s of itensSensibilidade || []) {
    const atb = normalizarTexto(s.Antibiotico);
    if (!atb || (s.Resultado !== 'S' && s.Resultado !== 'R')) continue;
    perfil.set(atb, s.Resultado);
  }
  return perfil.size ? perfil : null;
}

/* Dois antibiogramas são "semelhantes" quando testaram antibióticos suficientes em comum
   e quase não discordam. É triagem fenotípica, não tipagem molecular: serve para separar
   3 E. coli da comunidade de 3 isolados provavelmente clonais. */
function antibiogramasSemelhantes(a, b) {
  if (!a || !b) return false;
  let comuns = 0, concordantes = 0;
  for (const [atb, resultado] of a) {
    const outro = b.get(atb);
    if (!outro) continue;
    comuns++;
    if (outro === resultado) concordantes++;
  }
  return comuns >= SURTO_MIN_ATB_COMUNS && concordantes / comuns >= SURTO_CONCORDANCIA_MINIMA;
}

/* Maior subgrupo da janela cujos antibiogramas casam com o de alguma cultura-semente.
   Janela sem nenhum antibiograma comparável (fungos, germes sem painel, painéis muito
   curtos) mantém o comportamento antigo — a exigência só vale quando há o que comparar. */
function maiorGrupoSemelhante(itens) {
  const sementes = itens.filter(it => it.perfil && it.perfil.size >= SURTO_MIN_ATB_COMUNS);
  if (!sementes.length) return itens;
  let melhor = [];
  let melhorPacientes = 0;
  for (const semente of sementes) {
    const grupo = itens.filter(it => antibiogramasSemelhantes(semente.perfil, it.perfil));
    const pacientes = new Set(grupo.map(g => g.prontuario)).size;
    if (pacientes > melhorPacientes) { melhor = grupo; melhorPacientes = pacientes; }
  }
  return melhor;
}

/* Suspeita de surto: pacientes distintos com o mesmo microrganismo E antibiograma
   semelhante, no mesmo setor OU depois do mesmo procedimento cirúrgico, dentro da janela.
   opcoes: { janelaDias, minimoPacientes, sensibilidade, cirurgias } — sem sensibilidade
   a comparação de antibiogramas não roda; sem cirurgias o eixo procedimento não roda. */
function detectarSurtos(culturas, opcoes) {
  opcoes = opcoes || {};
  const janelaDias = opcoes.janelaDias || SURTO_JANELA_DIAS;
  const minimoPacientes = opcoes.minimoPacientes || SURTO_MINIMO_PACIENTES;
  const sensibilidadePorCultura = {};
  for (const s of opcoes.sensibilidade || []) {
    (sensibilidadePorCultura[s.ID_Cultura] = sensibilidadePorCultura[s.ID_Cultura] || []).push(s);
  }
  const cirurgiasPorPaciente = {};
  for (const cir of opcoes.cirurgias || []) {
    if (!cir.DataCirurgia || !String(cir.ProcedimentoNHSN || cir.Procedimento || '').trim()) continue;
    const pront = normalizarProntuario(cir.Prontuario);
    (cirurgiasPorPaciente[pront] = cirurgiasPorPaciente[pront] || []).push(cir);
  }

  const grupos = {};
  const juntar = (chave, rotulo, criterio, c) => {
    (grupos[chave] = grupos[chave] || { rotulo, criterio, micro: c.Microrganismo, itens: [] })
      .itens.push({
        data: c.DataColeta, prontuario: normalizarProntuario(c.Prontuario), cultura: c.ID_Cultura,
        perfil: perfilAntibiograma(sensibilidadePorCultura[c.ID_Cultura])
      });
  };
  for (const c of culturas) {
    if (!c.Microrganismo || !c.DataColeta || c.StatusRevisao === 'descartada') continue;
    if (c.AvaliacaoCCIH === 'Água' || c.AvaliacaoCCIH === 'Leite') continue;
    if (normalizarTexto(c.Material).includes('swab')) continue;
    /* "Acinetobacter" e "Acinetobacter spp" são o MESMO sinal: o sufixo spp/sp sai da
       chave — no banco real as duas grafias dividiram o surto do CTI em grupos menores. */
    const micro = normalizarTexto(c.Microrganismo).replace(/spp?$/, '');
    if (c.Setor && !ehSetorPortaDeEntrada(c.Setor)) {
      juntar('setor|' + normalizarTexto(c.Setor) + '|' + micro, c.Setor, 'setor', c);
    }
    /* Eixo procedimento: a ISC de um mesmo time cirúrgico aparece espalhada pelos setores
       (e volta pela emergência) — o que liga os pacientes é a cirurgia, não o leito. */
    const coleta = Date.parse(String(c.DataColeta).slice(0, 10) + 'T00:00:00Z');
    const vistos = new Set();
    for (const cir of cirurgiasPorPaciente[normalizarProntuario(c.Prontuario)] || []) {
      const dia = Date.parse(String(cir.DataCirurgia).slice(0, 10) + 'T00:00:00Z');
      if (!isFinite(dia) || !isFinite(coleta)) continue;
      const dias = (coleta - dia) / 86400000;
      if (dias < 0 || dias > SURTO_CIRURGIA_DIAS) continue;
      const procedimento = String(cir.ProcedimentoNHSN || cir.Procedimento).trim();
      const chave = 'proc|' + normalizarTexto(procedimento) + '|' + micro;
      if (vistos.has(chave)) continue;   /* paciente reoperado não duplica a cultura no grupo */
      vistos.add(chave);
      juntar(chave, 'Procedimento: ' + procedimento, 'procedimento', c);
    }
  }

  const alertas = [];
  for (const grupo of Object.values(grupos)) {
    const itens = grupo.itens.sort((a, b) => a.data.localeCompare(b.data));
    /* TODAS as janelas que atingem o mínimo, não só a melhor: um surto que continua
       depois de uma investigação descartada precisa virar alerta NOVO — com uma janela
       única por grupo, a continuação ficava invisível para sempre. */
    let i = 0;
    while (i < itens.length) {
      const janela = [];
      let j = i;
      for (; j < itens.length && diasEntre(itens[i].data, itens[j].data) <= janelaDias; j++) {
        janela.push(itens[j]);
      }
      /* Dentro da janela só conta o subgrupo de antibiograma semelhante: 3 pacientes com
         perfis discordantes são flora de hospital grande, não suspeita de clone. */
      const semelhantes = maiorGrupoSemelhante(janela);
      const pacientes = new Set(semelhantes.map(s => s.prontuario));
      if (pacientes.size >= minimoPacientes) {
        /* Os prontuários vão junto: são eles que a tela de investigação cruza com internações,
           cirurgias e dispositivos para procurar o que os pacientes têm em comum. */
        alertas.push({
          Setor: grupo.rotulo, Criterio: grupo.criterio, Microrganismo: grupo.micro,
          Pacientes: pacientes.size, Prontuarios: [...pacientes],
          Culturas: semelhantes.map(s => ({ ID_Cultura: s.cultura, Prontuario: s.prontuario, DataColeta: s.data })),
          Inicio: semelhantes[0].data, Fim: semelhantes[semelhantes.length - 1].data
        });
        i = j;   /* janela emitida: a próxima começa depois dela */
      } else {
        i++;
      }
    }
  }
  /* O mesmo grupo de pacientes alertando pelo setor E pelo procedimento é UM sinal: fica
     o alerta do setor — o cruzamento da investigação mostra o procedimento em comum. */
  const chaveMicro = m => normalizarTexto(m).replace(/spp?$/, '');
  const porSetor = alertas.filter(a => a.Criterio === 'setor');
  return alertas
    .filter(a => a.Criterio !== 'procedimento'
      || !porSetor.some(s => chaveMicro(s.Microrganismo) === chaveMicro(a.Microrganismo)
        && a.Prontuarios.every(p => s.Prontuarios.includes(p))))
    .sort((a, b) => b.Pacientes - a.Pacientes);
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

/* ---- Rotina da equipe ----
   Consome o cadastro de Equipe e funções (Configurações): cada função da CCIH tem uma
   FILA que se enche sozinha (culturas a revisar, suspeitas a validar, cirurgias a contatar…)
   e uma PERIODICIDADE — o "a cada N dias" com que quem a exerce deve zerá-la. Aqui a
   periodicidade vira o prazo: a fila está "atrasada" quando o item mais antigo já passou dele.

   Duas escolhas da CCIH do HNSC moldam a conta (decididas em 21/09/2026):
   - o relógio é a DATA DA ÚLTIMA CARGA semanal, não o calendário: os dados entram uma vez
     por semana (segunda) e o trabalho de processo é feito nesse dia; entre cargas o painel
     "congela" e mostra a semana vigente. Só vira atraso o que sobrou de semanas anteriores.
   - conta-se em DIAS ÚTEIS: fim de semana é sobreaviso, não envelhece fila.

   Duas naturezas de medidor:
   - fila: backlog de itens pendentes; o atraso é a idade (em dias úteis) do mais antigo;
   - cadência: atividade que se repete (visita, auditoria, avaliação semanal de ATB); o
     atraso é o tempo (em dias úteis) desde a última, até a data de referência. */

function diasCorridos(dataISO, hoje) {
  const a = Date.parse(String(dataISO).slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(String(hoje).slice(0, 10) + 'T00:00:00Z');
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/* Dias ÚTEIS (seg–sex) de `inicio` (exclusive) até `fim` (inclusive). Fim de semana é
   sobreaviso: não conta. Cálculo O(1) — não varre datas antigas item a item. */
function diasUteis(inicioISO, fimISO) {
  const a = Date.parse(String(inicioISO).slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(String(fimISO).slice(0, 10) + 'T00:00:00Z');
  if (!isFinite(a) || !isFinite(b) || b <= a) return 0;
  const totalDias = Math.round((b - a) / 86400000);
  const semanas = Math.floor(totalDias / 7);
  let count = semanas * 5;
  const resto = totalDias - semanas * 7;
  const dowInicio = new Date(a).getUTCDay();   /* 0=dom … 6=sáb */
  for (let i = 1; i <= resto; i++) {
    const d = (dowInicio + i) % 7;
    if (d !== 0 && d !== 6) count++;
  }
  return count;
}

/* Data da última carga semanal: o carimbo de importação (CriadoEm) mais recente dos dados.
   É o relógio dos indicadores de processo — o painel congela nela entre cargas. */
function dataDaUltimaCarga(carimbos) {
  let max = '';
  for (const c of carimbos || []) {
    const d = String(c || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > max) max = d;
  }
  return max || null;
}

function rotinaDaEquipe(profissionais, bancos, referencia, opcoes) {
  opcoes = opcoes || {};
  bancos = bancos || {};

  /* Idade da fila: quantos itens pendentes e há quantos dias úteis está o mais antigo. */
  const idadeDaFila = (itens, dataDe, naveg) => {
    let atraso = 0;
    for (const it of itens) {
      const d = diasUteis(dataDe(it), referencia);
      if (d > atraso) atraso = d;
    }
    return { tipo: 'fila', pendentes: itens.length, atrasoDias: atraso, naveg };
  };
  /* Cadência: há quantos dias úteis foi a última vez. Sem nenhum registro = sem dados. */
  const cadencia = (itens, dataDe, naveg) => {
    let ultima = '';
    for (const it of itens) {
      const dt = String(dataDe(it) || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dt) && dt > ultima) ultima = dt;
    }
    if (!ultima) return { tipo: 'cadencia', semDados: true, naveg };
    return { tipo: 'cadencia', ultima, atrasoDias: diasUteis(ultima, referencia), naveg };
  };

  const medidores = {
    gestor: () => ({ tipo: 'informativo', naveg: null }),
    /* Entrada dos relatórios do Tasy: é a própria carga semanal. Exceção ao relógio
       congelado — mede em dias úteis da última carga até HOJE (opcoes.hoje), porque a
       pergunta é "está na hora de alimentar de novo?". */
    importacao_tasy: () => {
      const ultima = /^\d{4}-\d{2}-\d{2}$/.test(String(referencia)) ? String(referencia).slice(0, 10) : '';
      if (!ultima) return { tipo: 'cadencia', semDados: true, naveg: 'importar' };
      return { tipo: 'cadencia', ultima, atrasoDias: diasUteis(ultima, opcoes.hoje || ultima), naveg: 'importar' };
    },
    deteccao_iras: () => idadeDaFila(
      (bancos.culturas || []).filter(c => normalizarTexto(c.StatusRevisao) === 'pendente' && c.Microrganismo),
      c => c.DataColeta, 'culturas'),
    validacao_iras: () => idadeDaFila(
      (bancos.casosIras || []).filter(k => normalizarTexto(k.StatusInvestigacao) === 'eminvestigacao'),
      k => k.DataInfeccao || k.CriadoEm, 'iras'),
    isolamentos: () => idadeDaFila(
      pendenciasIsolamento(bancos.culturas || [], bancos.sensibilidade || [], bancos.precaucoes || [],
        bancos.decisoes || [], referencia, null, opcoes.mdrMonitorados),
      m => m.DataColeta, 'isolamentos'),
    investigacao_surtos: () => {
      const suspeitas = detectarSurtos(bancos.culturas || [],
        { sensibilidade: bancos.sensibilidade, cirurgias: bancos.cirurgias });
      const ativas = suspeitas.filter(s => {
        const inv = (bancos.investigacoesSurto || []).find(i => mesmaSuspeita(s, i));
        return !inv || normalizarTexto(inv.Situacao) !== 'descartado';
      });
      return idadeDaFila(ativas, s => s.Fim, 'surtos');
    },
    /* Pós-alta: a fila é a cirurgia dentro da janela de contato (30–120 dias corridos,
       JANELA_VIGILANCIA) ainda pendente; o atraso conta em dias úteis a partir da ABERTURA
       da janela (data da cirurgia + 30 dias), não da cirurgia. */
    vigilancia_pos_alta: () => {
      const naJanela = (bancos.cirurgias || []).filter(c => {
        if (normalizarTexto(c.StatusVigilancia) !== 'pendente') return false;
        const d = diasCorridos(c.DataCirurgia, referencia);
        return d !== null && d >= 30 && d <= 120;
      });
      let atraso = 0;
      for (const c of naJanela) {
        const inicio = Date.parse(String(c.DataCirurgia).slice(0, 10) + 'T00:00:00Z');
        const abertura = new Date(inicio + 30 * 86400000).toISOString().slice(0, 10);
        const d = diasUteis(abertura, referencia);
        if (d > atraso) atraso = d;
      }
      return { tipo: 'fila', pendentes: naJanela.length, atrasoDias: atraso, naveg: 'vigilancia' };
    },
    visita_uti: () => cadencia(bancos.visitasUti || [], v => v.Data, 'uti'),
    higiene_maos: () => cadencia(bancos.observacoesHigiene || [], o => o.Data, 'higiene'),
    /* Perfis de cadastro sem medidor automático ainda — a fila entra ao chegarmos na tela:
       validação de isolamentos = só os casos DUVIDOSOS encaminhados ao infectologista;
       procedimentos invasivos = dispositivos a revisar (infectologista + enfermeiro). */
    isolamento_validacao: () => ({ tipo: 'sem_medidor', naveg: 'isolamentos' }),
    controle_procedimentos_invasivos: () => ({ tipo: 'sem_medidor', naveg: 'uti' }),
    /* Controle de antibióticos: a lista sobe uma vez por semana e é avaliada na carga.
       O medidor é a cadência da última avaliação registrada — em dia enquanto a avaliação
       acompanha a carga semanal. */
    controle_antibioticos: () => cadencia(bancos.avaliacoesAtb || [], a => a.DataDados || a.CriadoEm, 'antibioticos')
  };

  const porFuncao = new Map();
  for (const p of profissionais || []) {
    const funcao = String(p.Funcao || '').trim();
    if (!funcao) continue;
    if (!porFuncao.has(funcao)) porFuncao.set(funcao, { responsaveis: new Set(), dias: [] });
    const g = porFuncao.get(funcao);
    const nome = String(p.Nome || '').trim();
    if (nome) g.responsaveis.add(nome);
    const n = parseInt(p.CadaDias, 10);
    if (Number.isFinite(n) && n > 0) g.dias.push(n);
  }

  const linhas = [];
  for (const [funcao, g] of porFuncao) {
    /* Duas pessoas na mesma função podem ter prazos diferentes; vale o mais curto — é o
       prazo em que a fila DEVE estar zerada para todo mundo estar em dia. */
    const cadaDias = g.dias.length ? Math.min(...g.dias) : null;
    const medida = medidores[funcao] ? medidores[funcao]() : { tipo: 'sem_medidor', naveg: null };
    let status;
    if (medida.tipo === 'informativo') status = 'informativo';
    else if (medida.tipo === 'sem_medidor') status = 'sem medidor';
    else if (cadaDias == null) status = 'sem periodicidade';
    else if (medida.semDados) status = 'sem dados';
    else if (medida.tipo === 'fila') status = (medida.pendentes > 0 && medida.atrasoDias > cadaDias) ? 'atrasado' : 'em dia';
    else status = medida.atrasoDias > cadaDias ? 'atrasado' : 'em dia';
    linhas.push({ funcao, responsaveis: [...g.responsaveis], cadaDias, status, ...medida });
  }

  /* Atrasado primeiro: o painel é para agir. */
  const ordem = { atrasado: 0, 'sem dados': 1, 'em dia': 2, 'sem periodicidade': 3, 'sem medidor': 4, informativo: 5 };
  return linhas.sort((a, b) => (ordem[a.status] - ordem[b.status]) || a.funcao.localeCompare(b.funcao));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectarSurtos, detectarMultirresistentes, inferirMecanismo, pendenciasIsolamento,
    mesmaSuspeita, correlacionarSurto, resumoParaVisitaUTI, ehSetorDeUTI, iniciaisDe, isolamentosParaNotificar,
    ehSetorPortaDeEntrada, perfilAntibiograma, antibiogramasSemelhantes,
    rotinaDaEquipe, diasCorridos, diasUteis, dataDaUltimaCarga,
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

  /* MDR do mês: mecanismo declarado ou inferido do antibiograma. A lista de "MDR
     monitorados" da config vale para os ALERTAS de precaução do painel; no resumo da
     visita entram TODOS os mecanismos — um MRSA fora da lista sumia daqui (visto no
     banco real em 16/09/2026). */
  const culturas = ((bancos.culturas || {}).culturas || []).filter(c => doSetor(c.Setor));
  const mdr = detectarMultirresistentes(
    culturas.filter(c => String(c.DataColeta) >= corte),
    (bancos.culturas || {}).sensibilidade || [], hoje, 30, null);
  if (mdr.length) {
    blocos.push({ titulo: `🦠 Multirresistentes (${mdr.length} no mês)`, linhas: mdr.slice(0, 8).map(a =>
      `${a.Microrganismo} (${a.Mecanismo}) — ${rotuloPaciente(a.Prontuario)} — coleta ${String(a.DataColeta).slice(0, 10)}`) });
  }

  /* Isolamentos valendo agora: ativo = SEM data de fim (e não marcado encerrado). O
     Status vem vazio em metade das precauções importadas — exigir Status === 'ativo'
     escondia 32 de 38 ativas no banco real (visto em 16/09/2026). */
  const isolados = ((bancos.isolamentos || {}).precaucoes || [])
    .filter(p => doSetor(p.Setor) && !String(p.DataFim || '').trim()
      && normalizarTexto(p.Status) !== 'encerrado');
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
