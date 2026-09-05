/* Ficha do paciente: tudo que o banco sabe sobre uma pessoa, numa tela só.
   O valor está na linha do tempo — ver a cultura positiva ao lado do dispositivo que
   estava instalado, do antibiótico em curso e da cirurgia da semana anterior é o que
   permite dizer se a infecção é relacionada à assistência. */

const CORES_EVENTO = {
  internacao: '#14532d', alta: '#61707f', obito: '#b03a2e',
  cultura: '#185fa5', mdr: '#b03a2e', cirurgia: '#7a4fb5',
  dispositivo: '#c77f0a', antibiotico: '#0a7d7d', sepse: '#b03a2e',
  iras: '#b03a2e', isolamento: '#c77f0a', uti: '#14532d'
};

function diasEntreDatas(a, b) {
  const ia = Date.parse(String(a).slice(0, 10) + 'T00:00:00Z');
  const ib = Date.parse(String(b || hojeISO()).slice(0, 10) + 'T00:00:00Z');
  if (!isFinite(ia) || !isFinite(ib)) return null;
  return Math.round((ib - ia) / 86400000);
}

/* Reúne os prontuários que são a mesma pessoa. O cadastro é indexado por atendimento —
   cada internação gera um número —, então a ficha precisa juntá-los para contar a
   história inteira, e não um pedaço. */
function atendimentosDaPessoa(prontuario, pacientes) {
  const alvo = normalizarProntuario(prontuario);
  const registro = (pacientes || []).find(p => normalizarProntuario(p.Prontuario) === alvo);
  const nome = normalizarTexto(registro && registro.Nome);
  if (!nome) return [alvo];
  return [...new Set((pacientes || [])
    .filter(p => normalizarTexto(p.Nome) === nome)
    .map(p => normalizarProntuario(p.Prontuario)))];
}

async function montarPaciente(conteudo) {
  const alvo = normalizarProntuario(app.pacienteAberto || '');
  if (!alvo) {
    conteudo.append(el('h1', {}, 'Ficha do paciente'),
      el('div', { class: 'cartao' }, el('p', { class: 'texto-suave' },
        'Abra a ficha clicando num paciente na aba Pacientes, numa cultura ou numa investigação de surto.')));
    return;
  }
  let bancos;
  try {
    const nomes = ['pacientes', 'culturas', 'antibioticos', 'cirurgias', 'dispositivos',
      'uti', 'iras', 'isolamentos', 'sepse'];
    const lidos = await Promise.all(nomes.map(n => lerBanco(n).catch(() => ({}))));
    bancos = {};
    nomes.forEach((n, i) => { bancos[n] = lidos[i]; });
  } catch (e) {
    conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message));
    return;
  }

  const pacientes = bancos.pacientes.pacientes || [];
  const numeros = atendimentosDaPessoa(alvo, pacientes);
  const conjunto = new Set(numeros);
  const daPessoa = lista => (lista || []).filter(l => conjunto.has(normalizarProntuario(l.Prontuario)));
  const cadastro = pacientes.find(p => normalizarProntuario(p.Prontuario) === alvo) || { Prontuario: alvo };

  const internacoes = daPessoa(bancos.pacientes.internacoes).slice()
    .sort((a, b) => String(a.DataInternacao).localeCompare(String(b.DataInternacao)));
  /* O registro de óbitos é indexado por atendimento e cobre um período mais longo que o
     censo: um paciente com cultura de 2025 pode ter óbito conhecido sem ter internação no
     banco. Por isso é buscado tanto pelos números da pessoa quanto pelos atendimentos das
     internações dela. */
  const atendimentos = new Set(internacoes.map(i => normalizarProntuario(i.Atendimento)).filter(Boolean));
  const obitos = (bancos.pacientes.obitos || []).filter(o => {
    const n = normalizarProntuario(o.Atendimento);
    return conjunto.has(n) || atendimentos.has(n);
  });
  const culturas = daPessoa(bancos.culturas.culturas).slice()
    .sort((a, b) => String(b.DataColeta).localeCompare(String(a.DataColeta)));
  const sensPorCultura = new Map();
  (bancos.culturas.sensibilidade || []).forEach(s => {
    if (!sensPorCultura.has(s.ID_Cultura)) sensPorCultura.set(s.ID_Cultura, []);
    sensPorCultura.get(s.ID_Cultura).push(s);
  });
  const prescricoes = daPessoa(bancos.antibioticos.prescricoes);
  const cirurgias = daPessoa(bancos.cirurgias.cirurgias);
  const dispositivos = daPessoa(bancos.dispositivos.dispositivos);
  const visitasUti = daPessoa(bancos.uti.visitas);
  const avaliacoesAtb = daPessoa(bancos.uti.avaliacoes_atb);
  const casosIras = daPessoa(bancos.iras.casos);
  const precaucoes = daPessoa(bancos.isolamentos.precaucoes);
  const casosSepse = daPessoa(bancos.sepse.casos);

  const positivas = culturas.filter(c => c.Microrganismo && c.StatusRevisao !== 'descartada');
  const mdr = positivas.filter(c => c.MecanismoResistencia);
  const diasInternado = internacoes.reduce((soma, i) => {
    const d = diasEntreDatas(i.DataInternacao, i.DataAlta);
    return soma + (d === null ? 0 : Math.max(d, 1));
  }, 0);
  const obito = obitos.length
    || internacoes.some(i => i.Obito === 'S' || /obito/.test(normalizarTexto(i.Desfecho)));
  const ultima = internacoes[internacoes.length - 1];

  /* ---- cabeçalho ---- */
  conteudo.append(el('h1', {}, cadastro.Nome || 'Paciente ' + alvo));
  const identificacao = [
    numeros.length > 1 ? `${numeros.length} atendimentos: ${numeros.join(' · ')}` : `Prontuário ${alvo}`,
    cadastro.Sexo, cadastro.DataNascimento ? 'nascimento ' + cadastro.DataNascimento : '',
    cadastro.Telefone ? 'telefone ' + cadastro.Telefone : ''
  ].filter(Boolean).join(' · ');
  conteudo.append(el('div', { class: 'cartao' },
    el('p', { class: 'texto-suave' }, identificacao),
    obito ? el('p', {}, el('strong', { class: 'aviso-erro-texto' }, '⚑ Óbito registrado')) : null,
    ultima && !ultima.DataAlta ? el('p', {}, el('strong', {}, 'Internado desde ' + ultima.DataInternacao),
      ultima.SetorAtual ? ` · ${ultima.SetorAtual}` : '', ultima.Leito ? ` · leito ${ultima.Leito}` : '') : null));

  conteudo.append(el('div', { class: 'grade-cartoes' }, ...[
    ['Internações', internacoes.length], ['Dias internado', diasInternado],
    ['Culturas positivas', positivas.length], ['Multirresistentes', mdr.length],
    ['Cirurgias', cirurgias.length], ['Dispositivos', dispositivos.length],
    ['Protocolos de sepse', casosSepse.length], ['Casos de IRAS', casosIras.length]
  ].map(([r, n]) => el('div', { class: 'cartao cartao-numero' },
    el('div', { class: 'numero-grande' }, fmtInt(n)), el('div', { class: 'texto-suave' }, r)))));

  /* ---- linha do tempo ---- */
  const eventos = [];
  const juntar = (data, tipo, titulo, detalhe) => {
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(data || ''))) return;
    eventos.push({ data: String(data).slice(0, 10), tipo, titulo, detalhe: detalhe || '' });
  };
  internacoes.forEach(i => {
    juntar(i.DataInternacao, 'internacao', 'Internação',
      [i.SetorAtual, i.Leito ? 'leito ' + i.Leito : '', i.Clinica, i.Atendimento ? 'atendimento ' + i.Atendimento : '']
        .filter(Boolean).join(' · '));
    if (i.DataAlta) {
      const morreu = i.Obito === 'S' || /obito/.test(normalizarTexto(i.Desfecho));
      juntar(i.DataAlta, morreu ? 'obito' : 'alta', morreu ? 'Óbito' : 'Alta hospitalar',
        [i.Desfecho, diasEntreDatas(i.DataInternacao, i.DataAlta) + ' dias de internação'].filter(Boolean).join(' · '));
    }
  });
  /* Óbito do registro próprio — só quando a internação não o trouxe, para não duplicar o
     mesmo evento na linha do tempo. */
  const datasDeObito = new Set(eventos.filter(e => e.tipo === 'obito').map(e => e.data));
  obitos.forEach(o => {
    const data = String(o.DataObito || '').slice(0, 10);
    if (!data || datasDeObito.has(data)) return;
    datasDeObito.add(data);
    juntar(data, 'obito', 'Óbito',
      [o.Setor, o.Medico, o.Idade ? o.Idade + ' anos' : ''].filter(Boolean).join(' · '));
  });
  culturas.forEach(c => {
    const sens = sensPorCultura.get(c.ID_Cultura) || [];
    const resistentes = sens.filter(s => s.Resultado === 'R').map(s => s.Antibiotico);
    juntar(c.DataColeta, c.MecanismoResistencia ? 'mdr' : 'cultura',
      c.Microrganismo ? `Cultura: ${c.Microrganismo}` : 'Cultura negativa',
      [c.Material, c.Setor, c.MecanismoResistencia, c.AvaliacaoCCIH,
        resistentes.length ? 'R: ' + resistentes.join(', ') : ''].filter(Boolean).join(' · '));
  });
  /* Um evento por CURSO, não por renovação: o extrato traz janelas de prescrição
     renovadas a cada 1-3 dias, e mostrar cada uma faria parecer que o antibiótico foi
     prescrito várias vezes. O fim só entra quando o curso realmente acabou — curso em
     andamento fica só com o início e a marca "em curso". */
  const hojePaciente = new Date().toISOString().slice(0, 10);
  const cursosATB = cursosDeAntibiotico(prescricoes);
  cursosATB.forEach(curso => {
    const emCurso = String(curso.fim) >= hojePaciente;
    juntar(curso.inicio, 'antibiotico', 'Início de ' + curso.Antibiotico,
      [curso.ultima.Dose, curso.ultima.Via, curso.ultima.Indicacao, curso.Setor,
       emCurso ? 'em curso (' + curso.dias + ' dias)' : ''].filter(Boolean).join(' · '));
    if (!emCurso) {
      juntar(curso.fim, 'antibiotico', 'Fim de ' + curso.Antibiotico,
        curso.dias + ' dia(s) de tratamento' + (curso.ultima.ParecerInfecto ? ' · ' + curso.ultima.ParecerInfecto : ''));
    }
  });
  cirurgias.forEach(c => juntar(c.DataCirurgia, 'cirurgia', 'Cirurgia: ' + (c.ProcedimentoNHSN || c.Procedimento || ''),
    [c.Cirurgiao, c.PotencialContaminacao, c.ASA ? 'ASA ' + c.ASA : '',
      c.DuracaoMin ? c.DuracaoMin + ' min' : '', c.ISC === 'S' ? 'ISC: ' + (c.TipoISC || 'sim') : ''].filter(Boolean).join(' · ')));
  dispositivos.forEach(d => {
    juntar(d.DataInstalacao, 'dispositivo', 'Instalado: ' + (d.Dispositivo || d.Categoria || ''), d.Categoria || '');
    if (d.DataRetirada) juntar(d.DataRetirada, 'dispositivo', 'Retirado: ' + (d.Dispositivo || d.Categoria || ''),
      diasEntreDatas(d.DataInstalacao, d.DataRetirada) + ' dias de uso');
  });
  visitasUti.forEach(v => {
    const marcas = [];
    if (v.CVC === 'S') marcas.push('CVC' + (v.CVC_Indicacoes ? ' (' + v.CVC_Indicacoes + ')' : ''));
    if (v.VM === 'S') marcas.push('VM' + (v.VM_Indicacao ? ' (' + v.VM_Indicacao + ')' : ''));
    if (v.SVD === 'S') marcas.push('SVD' + (v.SVD_Indicacao ? ' (' + v.SVD_Indicacao + ')' : ''));
    if (v.NPT === 'S') marcas.push('NPT');
    if (v.SuspeitaIRAS === 'S') marcas.push('suspeita de IRAS: ' + (v.FocoSuspeito || 'foco não definido'));
    juntar(v.Data, 'uti', 'Visita da CCIH à UTI', [v.Setor, v.Leito ? 'leito ' + v.Leito : '', marcas.join(' · '), v.Observacoes].filter(Boolean).join(' · '));
  });
  avaliacoesAtb.forEach(a => juntar(a.Data, 'antibiotico', 'Avaliação de ' + a.Antibiotico,
    [a.Indicacao, a.Avaliacao, a.Recomendacao].filter(Boolean).join(' · ')));
  casosSepse.forEach(s => juntar(s.DataProtocolo, 'sepse', 'Protocolo de sepse aberto',
    [s.Setor, s.SepseConfirmada === 'S' ? 'confirmada' : s.SepseConfirmada === 'N' ? 'descartada' : '',
      s.FocoInfeccioso, s.ClassificacaoNEWS ? 'NEWS ' + s.ClassificacaoNEWS : '',
      s.BundleCompleto === 'S' ? 'bundle completo' : s.BundleCompleto === 'N' ? 'bundle incompleto' : '',
      s.MinutosAntibiotico !== '' && s.MinutosAntibiotico != null ? 'ATB em ' + s.MinutosAntibiotico + ' min' : ''
    ].filter(Boolean).join(' · ')));
  casosIras.forEach(i => juntar(i.DataInfeccao, 'iras', 'IRAS: ' + (i.Topografia || ''),
    [i.Setor, i.Microrganismo, i.DispositivoAssociado, i.CriterioDiagnostico,
     i.StatusInvestigacao && i.StatusInvestigacao !== 'confirmado' ? i.StatusInvestigacao : '']
      .filter(Boolean).join(' · ')));
  precaucoes.forEach(p => {
    juntar(p.DataInicio, 'isolamento', 'Precaução de ' + (p.TipoPrecaucao || 'contato'), p.Motivo || '');
    if (p.DataFim) juntar(p.DataFim, 'isolamento', 'Precaução encerrada', p.TipoPrecaucao || '');
  });

  eventos.sort((a, b) => b.data.localeCompare(a.data));
  const selTipo = el('select', {}, el('option', { value: '' }, 'todos os eventos'),
    [...new Set(eventos.map(e => e.tipo))].sort().map(t => el('option', { value: t }, t)));
  const areaLinha = el('div', {});
  selTipo.addEventListener('change', desenharLinha);

  function desenharLinha() {
    const filtrados = selTipo.value ? eventos.filter(e => e.tipo === selTipo.value) : eventos;
    areaLinha.replaceChildren(filtrados.length
      ? el('div', { class: 'linha-tempo' }, filtrados.map(e => el('div', { class: 'evento' },
          el('span', { class: 'evento-data' }, e.data),
          el('span', { class: 'evento-marca', style: 'background:' + (CORES_EVENTO[e.tipo] || '#61707f') }),
          el('div', {}, el('strong', {}, e.titulo),
            e.detalhe ? el('div', { class: 'texto-suave' }, e.detalhe) : null))))
      : el('p', { class: 'texto-suave' }, 'Nenhum evento deste tipo.'));
  }

  /* ---- Notificar suspeita de IRAS daqui mesmo ----
     A ficha é onde o caso aparece por inteiro (culturas + antibióticos + dispositivos),
     então é aqui que a suspeita costuma nascer. Nasce "em investigação": a notificação
     oficial continua dependendo da segunda assinatura, na aba Infecções. */
  {
    const topografias = (config.vocabulario.topografias || []);
    const setoresVocab = (config.vocabulario.setores || []).slice().sort();
    const internacaoAberta = internacoes.slice().reverse()
      .find(i => !String(i.DataAlta || '').trim()) || internacoes[internacoes.length - 1] || {};
    const selTopoNova = el('select', {}, topografias.map(t => el('option', { value: t }, t)));
    const selSetorNova = el('select', {}, el('option', { value: '' }, '—'),
      setoresVocab.map(s => el('option', { value: s, selected: s === internacaoAberta.SetorAtual ? '' : null }, s)));
    const campoDataNova = el('input', { type: 'date', value: hojeISO() });
    const selDispNova = el('select', {}, ['', 'CVC', 'VM', 'SVD', 'Nenhum'].map(d => el('option', { value: d }, d || '—')));
    const campoMicroNova = el('input', { type: 'text', placeholder: 'microrganismo (opcional)' });
    const campoObsNova = el('textarea', { rows: 2, style: 'width:100%',
      placeholder: 'observações: critério clínico, achados, contexto… (entram no diário do caso)' });
    const msgNova = el('p', { class: 'aviso-erro-texto' });
    const notificarIras = async () => {
      try {
        if (!selTopoNova.value) { msgNova.textContent = 'Escolha a topografia.'; return; }
        await comTrava(['iras'], async () => {
          const atual = await lerBanco('iras');
          atual.casos.push({
            ID_IRAS: proximoIDLista(atual.casos, 'ID_IRAS', 'IRA'),
            Prontuario: cadastro.Prontuario, DataInfeccao: campoDataNova.value,
            Topografia: selTopoNova.value, CriterioDiagnostico: 'Notificação manual (ficha do paciente)',
            Setor: selSetorNova.value, DispositivoAssociado: selDispNova.value,
            Microrganismo: campoMicroNova.value.trim(), Desfecho: '',
            StatusInvestigacao: 'em investigação', NotificadoANVISA: '',
            Observacoes: acrescentarObservacao('', '', campoObsNova.value, app.usuario, agoraCurto()),
            CriadoPor: app.usuario, CriadoEm: agoraCurto()
          });
          await gravarBanco('iras', atual);
        });
        abrirPaciente(cadastro.Prontuario);
      } catch (e) { msgNova.textContent = e.message; }
    };
    conteudo.append(el('div', { class: 'cartao' }, el('details', {},
      el('summary', {}, '➕ Notificar suspeita de IRAS'),
      el('p', { class: 'texto-suave' },
        'A suspeita entra na fila de confirmação da aba Infecções — a notificação oficial só existe '
        + 'depois da segunda assinatura.'),
      el('div', { class: 'linha-campos' },
        el('label', {}, 'Data da infecção: ', campoDataNova),
        el('label', {}, 'Topografia: ', selTopoNova),
        el('label', {}, 'Setor: ', selSetorNova),
        el('label', {}, 'Dispositivo: ', selDispNova)),
      el('div', { class: 'linha-campos' }, campoMicroNova),
      campoObsNova,
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-primario', onclick: notificarIras }, 'Notificar suspeita')),
      msgNova)));
  }

  conteudo.append(el('div', { class: 'cartao' },
    el('h2', {}, `Linha do tempo (${fmtInt(eventos.length)} eventos)`),
    el('div', { class: 'linha-campos' }, el('label', {}, 'Mostrar: ', selTipo),
      el('button', { class: 'botao-secundario', onclick: () => exportar() }, 'Exportar ficha (Excel)')),
    areaLinha));
  desenharLinha();

  /* ---- blocos detalhados ---- */
  const tabela = (titulo, colunas, linhas, montarLinha) => {
    if (!linhas.length) return null;
    return el('details', {}, el('summary', {}, `${titulo} (${fmtInt(linhas.length)})`),
      el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, colunas.map(c => el('th', {}, c)))),
        el('tbody', {}, linhas.map(l => el('tr', {}, montarLinha(l).map(v =>
          v && v.nodeType ? el('td', {}, v) : el('td', {}, String(v == null ? '' : v))))))));
  };

  const detalhes = el('div', { class: 'cartao' }, el('h2', {}, 'Detalhamento'));
  detalhes.append(
    tabela('Internações', ['Entrada', 'Alta', 'Dias', 'Setor', 'Leito', 'Clínica', 'Desfecho'], internacoes,
      i => [i.DataInternacao, i.DataAlta || 'em curso',
        diasEntreDatas(i.DataInternacao, i.DataAlta), i.SetorAtual, i.Leito, i.Clinica, i.Desfecho]),
    tabela('Culturas', ['Coleta', 'Material', 'Sítio', 'Setor', 'Microrganismo', 'Mecanismo', 'Antibiograma', 'Classificação'], culturas,
      c => {
        const sens = sensPorCultura.get(c.ID_Cultura) || [];
        return [c.DataColeta, c.Material, c.Sitio, c.Setor, c.Microrganismo || '(negativa)', c.MecanismoResistencia,
          sens.length ? sens.map(s => s.Antibiotico + '=' + s.Resultado).join(', ') : (c.Antibiograma || ''),
          c.AvaliacaoCCIH || c.StatusRevisao];
      }),
    tabela('Antibióticos (cursos de tratamento)', ['Início', 'Fim', 'Antibiótico', 'Dias', 'Dose atual', 'Renovações', 'Setor'],
      cursosATB.slice().sort((a, b) => String(b.inicio).localeCompare(String(a.inicio))),
      c => [c.inicio, String(c.fim) >= hojePaciente ? 'em curso' : c.fim, c.Antibiotico,
        String(c.dias), c.ultima.Dose, String(c.ids.length), c.Setor]),
    tabela('Avaliações de antimicrobiano na UTI', ['Data', 'Antibiótico', 'Indicação', 'Avaliação', 'Recomendação'], avaliacoesAtb,
      a => [a.Data, a.Antibiotico, a.Indicacao, a.Avaliacao, a.Recomendacao]),
    tabela('Cirurgias', ['Data', 'Procedimento', 'Cirurgião', 'Contaminação', 'ASA', 'Duração', 'NNIS', 'ISC'], cirurgias,
      c => [c.DataCirurgia, c.ProcedimentoNHSN || c.Procedimento, c.Cirurgiao, c.PotencialContaminacao,
        c.ASA, c.DuracaoMin, c.IndiceNNIS, c.ISC === 'S' ? (c.TipoISC || 'sim') : 'não']),
    tabela('Dispositivos invasivos', ['Instalação', 'Retirada', 'Dias', 'Dispositivo', 'Categoria'], dispositivos,
      d => [d.DataInstalacao, d.DataRetirada || 'em uso',
        diasEntreDatas(d.DataInstalacao, d.DataRetirada), d.Dispositivo, d.Categoria]),
    tabela('Visitas da CCIH à UTI', ['Data', 'Setor', 'Leito', 'CVC', 'VM', 'SVD', 'NPT', 'Suspeita', 'Observações'], visitasUti,
      v => [v.Data, v.Setor, v.Leito, v.CVC_Indicacoes || v.CVC, v.VM_Indicacao || v.VM,
        v.SVD_Indicacao || v.SVD, v.NPT, v.SuspeitaIRAS === 'S' ? (v.FocoSuspeito || 'sim') : 'não', v.Observacoes]),
    tabela('Protocolos de sepse', ['Data', 'Setor', 'Confirmada', 'Foco', 'NEWS', 'Bundle', 'ATB ≤1h', 'NEWS→ATB', 'Desfecho'], casosSepse,
      s => [s.DataProtocolo, s.Setor, s.SepseConfirmada, s.FocoInfeccioso, s.ClassificacaoNEWS,
        s.BundleCompleto, s.AntibioticoAte1h,
        s.MinutosAntibiotico === '' || s.MinutosAntibiotico == null ? '' : s.MinutosAntibiotico + ' min', s.Desfecho]),
    tabela('Casos de IRAS', ['Data', 'Topografia', 'Setor', 'Microrganismo', 'Dispositivo', 'Critério'], casosIras,
      i => [i.DataInfeccao, i.Topografia, i.Setor, i.Microrganismo, i.DispositivoAssociado, i.CriterioDiagnostico]),
    tabela('Precauções de isolamento', ['Início', 'Fim', 'Tipo', 'Motivo', 'Setor'], precaucoes,
      p => [p.DataInicio, p.DataFim || 'ativa', p.TipoPrecaucao, p.Motivo, p.Setor]));
  if (detalhes.querySelectorAll('details').length) conteudo.append(detalhes);

  function exportar() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      Prontuario: alvo, Atendimentos: numeros.join(' / '), Nome: cadastro.Nome || '',
      Sexo: cadastro.Sexo || '', Nascimento: cadastro.DataNascimento || '', Telefone: cadastro.Telefone || '',
      Internacoes: internacoes.length, DiasInternado: diasInternado, CulturasPositivas: positivas.length,
      Multirresistentes: mdr.length, Cirurgias: cirurgias.length, Dispositivos: dispositivos.length,
      ProtocolosSepse: casosSepse.length, CasosIRAS: casosIras.length, Obito: obito ? 'S' : 'N'
    }]), 'resumo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      eventos.map(e => ({ Data: e.data, Tipo: e.tipo, Evento: e.titulo, Detalhe: e.detalhe }))), 'linha_do_tempo');
    const cursosParaExcel = cursosATB.map(c => ({
      Antibiotico: c.Antibiotico, Inicio: c.inicio,
      Fim: String(c.fim) >= hojePaciente ? 'em curso' : c.fim, Dias: c.dias,
      Renovacoes: c.ids.length, DoseAtual: c.ultima.Dose, Setor: c.Setor
    }));
    const abas = [['internacoes', internacoes], ['culturas', culturas], ['antibioticos', cursosParaExcel],
      ['cirurgias', cirurgias], ['dispositivos', dispositivos], ['sepse', casosSepse],
      ['iras', casosIras], ['isolamentos', precaucoes]];
    abas.forEach(([nome, linhas]) => {
      if (linhas.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), nome);
    });
    XLSX.writeFile(wb, `ficha-${alvo}-${hojeISO()}.xlsx`);
  }
}

/* Atalho usado pelas outras telas. */
function abrirPaciente(prontuario) {
  app.pacienteAberto = normalizarProntuario(prontuario);
  navegar('paciente');
}
