/* Formulários compartilhados de decisão (10/11/2026, fase 1 da tela "Pendências por paciente").

   A classificação de uma cultura e a avaliação de um curso de antibiótico eram montadas
   dentro das abas Culturas e Antibióticos. Aqui elas viram funções reutilizáveis para que a
   aba de origem e a tela por paciente gravem o MESMO registro pelo mesmo código — a regra
   que impede a mesma pendência decidida por dois caminhos de virar dois registros.

   Cada formulário devolve { no, temDecisao, valores, salvar }: `no` é o bloco de campos
   (sem botão — quem chama decide se há um botão por bloco ou um "salvar tudo"); `salvar`
   grava com trava e devolve o que gravou. */

const AVALIACOES_ATB = ['Correto', 'Parcialmente correto', 'Incorreto'];
const RECOMENDACOES_ATB = ['Manter', 'Ajustar dose', 'Descalonar', 'Modificar', 'Suspender'];

/* ---- Cultura ---- */

/* amostras: uma cultura ou o grupo de amostras repetidas (todas recebem a mesma classificação).
   opcoes.permitirVazio: primeira opção "— sem decisão —" (tela por paciente, onde o bloco
   pode ficar em branco); opcoes.topografias: lista (padrão: vocabulário). */
function formularioClassificacaoCultura(amostras, opcoes) {
  opcoes = opcoes || {};
  const topografias = opcoes.topografias || (config.vocabulario.topografias || []);
  const selAval = el('select', {},
    opcoes.permitirVazio ? el('option', { value: '' }, '— sem decisão —') : null,
    CLASSIFICACOES_CULTURA.filter(o => o !== 'Negativa')
      .map(o => el('option', { value: o }, o === 'Não é cultura' ? 'Não é cultura (descartar)' : o)));
  const selTopo = el('select', {}, topografias.map(t => el('option', { value: t }, t)));
  const selDisp = el('select', {}, ['Nenhum', 'CVC', 'VM', 'SVD'].map(d => el('option', { value: d }, d)));
  const linhaIras = el('span', { style: 'display:none' },
    el('label', {}, ' Topografia: ', selTopo), el('label', {}, ' Dispositivo: ', selDisp));
  /* Recado para quem vai confirmar a IRAS na aba Infecções (pedido de 09/11/2026): fica na
     cultura e, quando abre caso, entra no diário do caso com data e autor. */
  const campoObs = el('textarea', { rows: 2, style: 'width:100%',
    placeholder: 'observação para quem vai validar (opcional) — ex.: "febre desde D3, CVC em jugular, discutido com a UTI"' });
  const ajustar = () => {
    linhaIras.style.display = selAval.value === 'IRAS' ? '' : 'none';
    campoObs.placeholder = selAval.value === 'IRAS'
      ? 'observação para quem vai confirmar a IRAS (opcional) — ex.: "febre desde D3, CVC em jugular, discutido com a UTI"'
      : 'observação sobre a classificação (opcional) — fica registrada na cultura';
  };
  selAval.addEventListener('change', ajustar);
  const no = el('div', { class: 'form-decisao form-decisao-cultura' },
    el('div', { class: 'linha-campos' }, el('label', {}, 'Classificação: ', selAval), linhaIras),
    campoObs);
  const valores = () => ({ avaliacao: selAval.value, topografia: selTopo.value, dispositivo: selDisp.value, observacao: campoObs.value });
  return {
    no, selAval, selTopo, selDisp, campoObs, valores,
    temDecisao: () => !!selAval.value,
    salvar: async extra => {
      const v = valores();
      if (!v.avaliacao) return null;
      return salvarAvaliacaoCultura(amostras, v.avaliacao, v.topografia, v.dispositivo, v.observacao, extra || {});
    }
  };
}

/* culturas: uma ou várias (grupo de amostras repetidas) — todas recebem a mesma
   classificação; o caso de IRAS nasce UMA vez, na coleta mais antiga. Idempotente: a
   classificação é um campo da própria cultura, e o caso só é criado se o episódio não
   existir (registrarCasoIras completa o existente). opcoes.pacientes = cadastro para a
   identidade (lido do banco quando ausente). */
async function salvarAvaliacaoCultura(culturas, avaliacao, topografia, dispositivo, observacao, opcoes) {
  opcoes = opcoes || {};
  const nota = String(observacao || '').trim();
  const lista = (Array.isArray(culturas) ? culturas : [culturas])
    .slice().sort((a, b) => String(a.DataColeta).localeCompare(String(b.DataColeta)));
  const c = lista[0];
  const arquivos = avaliacao === 'IRAS' ? ['culturas', 'iras'] : ['culturas'];
  let casoAberto = null;
  await comTrava(arquivos, async () => {
    const bancoAtual = await lerBanco('culturas');
    const ids = new Set(lista.map(x => x.ID_Cultura));
    const alvos = bancoAtual.culturas.filter(x => ids.has(x.ID_Cultura));
    if (!alvos.length) throw new Error('Cultura não encontrada no banco.');
    const descarte = avaliacao.startsWith('Não é cultura');
    for (const alvo of alvos) {
      alvo.StatusRevisao = descarte ? 'descartada' : 'avaliada';
      alvo.AvaliacaoCCIH = descarte ? 'Não é cultura' : (avaliacao === 'IRAS' ? `IRAS — ${topografia}` : avaliacao);
      if (nota) alvo.ObservacaoAvaliacao = acrescentarObservacao(alvo.ObservacaoAvaliacao, '', nota, app.usuario, agoraCurto());
    }
    if (avaliacao === 'IRAS') {
      const bancoIras = await lerBanco('iras');
      const pacientes = opcoes.pacientes || ((await lerBanco('pacientes')).pacientes || []);
      /* Nasce como suspeita: a notificação oficial só existe depois que um segundo
         profissional confirmar na aba Infecções. Se o MESMO episódio já tem caso
         aberto (outra cultura, pós-alta, visita da UTI), não duplica — só completa.
         A cultura que motivou a suspeita já entra como AGENTE (ID_CulturaAgente) e
         aponta de volta para o caso (ID_IRAS). */
      const { caso } = registrarCasoIras(bancoIras.casos, {
        Prontuario: c.Prontuario, DataInfeccao: c.DataColeta, Topografia: topografia,
        CriterioDiagnostico: 'Revisão de culturas', Setor: c.Setor, DispositivoAssociado: dispositivo,
        Microrganismo: c.Microrganismo, ID_CulturaAgente: c.ID_Cultura, Desfecho: '', StatusInvestigacao: 'em investigação',
        NotificadoANVISA: '', CriadoPor: app.usuario, CriadoEm: agoraCurto()
      }, () => proximoIDLista(bancoIras.casos, 'ID_IRAS', 'IRA'), identidadePorNome(pacientes));
      /* O recado vai para o diário do caso — é lá que quem confirma vai ler, inclusive
         quando o caso já existia (outra cultura, pós-alta, visita da UTI). */
      if (nota) caso.Observacoes = acrescentarObservacao(caso.Observacoes, `Cultura ${c.ID_Cultura}`, nota, app.usuario, agoraCurto());
      await gravarBanco('iras', bancoIras);
      for (const alvo of alvos) if (!alvo.ID_IRAS) alvo.ID_IRAS = caso.ID_IRAS;
      casoAberto = caso.ID_IRAS;
    }
    await gravarBanco('culturas', bancoAtual);
  });
  return { culturas: lista.map(x => x.ID_Cultura), avaliacao, casoIras: casoAberto };
}

/* ---- Antibiótico ---- */

/* curso: item de cursosDeAntibiotico. opcoes.permitirVazio como na cultura; opcoes.hoje. */
function formularioAvaliacaoAntibiotico(curso, opcoes) {
  opcoes = opcoes || {};
  const selAval = el('select', {},
    opcoes.permitirVazio ? el('option', { value: '' }, '— sem decisão —') : null,
    AVALIACOES_ATB.map(o => el('option', { value: o }, o)));
  const selRec = el('select', {}, RECOMENDACOES_ATB.map(o => el('option', { value: o }, o)));
  const campoParecer = el('textarea', { rows: 2, style: 'width:100%', placeholder: 'parecer (opcional)' });
  const no = el('div', { class: 'form-decisao form-decisao-atb' },
    el('div', { class: 'linha-campos' }, el('label', {}, 'Avaliação: ', selAval), el('label', {}, 'Recomendação: ', selRec)),
    campoParecer);
  const valores = () => ({ avaliacao: selAval.value, recomendacao: selRec.value, parecer: campoParecer.value });
  return {
    no, selAval, selRec, campoParecer, valores,
    temDecisao: () => !!selAval.value,
    salvar: async () => {
      const v = valores();
      if (!v.avaliacao) return null;
      return salvarAvaliacaoAntibiotico(curso, v.avaliacao, v.recomendacao, v.parecer, opcoes.hoje || hojeISO());
    }
  };
}

/* Grava a avaliação do curso. A mesma pessoa avaliando o mesmo curso no mesmo dia por outro
   caminho (aba Antibióticos × tela por paciente) ATUALIZA a avaliação do dia em vez de
   acrescentar outra — é a regra "uma pendência, um registro". */
async function salvarAvaliacaoAntibiotico(curso, avaliacao, recomendacao, parecer, hoje) {
  hoje = hoje || hojeISO();
  let resultado = null;
  await comTrava(['antibioticos'], async () => {
    const atual = await lerBanco('antibioticos');
    atual.avaliacoes = atual.avaliacoes || [];
    const mesma = atual.avaliacoes.find(a => normalizarProntuario(a.Prontuario) === normalizarProntuario(curso.Prontuario)
      && normalizarTexto(a.Antibiotico) === normalizarTexto(curso.Antibiotico)
      && String(a.DataDados || '').slice(0, 10) === hoje
      && normalizarTexto(a.Avaliador) === normalizarTexto(app.usuario));
    const linha = {
      ID_Prescricao: curso.ultima.ID_Prescricao, Prontuario: curso.Prontuario,
      Antibiotico: curso.Antibiotico, Indicacao: curso.ultima.Indicacao || '',
      Avaliacao: avaliacao, Recomendacao: recomendacao, ParecerTexto: parecer || '',
      Avaliador: app.usuario, DataDados: hoje, CriadoEm: agoraCurto()
    };
    if (mesma) { Object.assign(mesma, linha); resultado = { atualizada: true, avaliacao: mesma }; }
    else { atual.avaliacoes.push(linha); resultado = { atualizada: false, avaliacao: linha }; }
    await gravarBanco('antibioticos', atual);
  });
  return resultado;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AVALIACOES_ATB, RECOMENDACOES_ATB, formularioClassificacaoCultura, salvarAvaliacaoCultura,
    formularioAvaliacaoAntibiotico, salvarAvaliacaoAntibiotico };
}
