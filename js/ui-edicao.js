/* Edição de registros já gravados (pedido de 28/10/2026): cultura classificada errada ou
   com sítio trocado, avaliação de antibiótico, caso de IRAS, cirurgia (ISC), isolamento,
   internação, protocolo de sepse. A edição acontece na FICHA DO PACIENTE (botão "✎" em cada
   evento da linha do tempo): é onde o registro aparece com o contexto inteiro.

   Regras: só os campos listados aqui são editáveis (identificadores e rastros de importação
   não); toda edição grava EditadoPor/EditadoEm e acrescenta uma linha "de → para" em
   HistoricoEdicao (núcleo puro: editarRegistro, em importacao.js). Nada é apagado — o que
   estava errado vira "descartado"/"Não é cultura" pelo campo de situação. Efeitos cruzados
   explícitos: cultura que deixa de ser IRAS oferece descartar o caso vinculado; caso de IRAS
   descartado oferece reclassificar as culturas vinculadas. */

const STATUS_REVISAO_CULTURA = ['pendente', 'triagem', 'avaliada', 'descartada'];
const STATUS_INVESTIGACAO_IRAS = ['em investigação', 'confirmado', 'digitado', 'descartado', 'indeterminado'];
const STATUS_VIGILANCIA_CIRURGIA = ['pendente', 'sob vigilância', 'mensagem enviada', 'sem infecção', 'em investigação',
  'infecção confirmada', 'encerrada sem contato', 'encerrada — óbito', 'encerrada — número incorreto', 'dispensada', 'descartada'];

/* Vocabulário vindo de Configurações (config.vocabulario) — com o valor atual sempre presente
   na lista, senão o select "perderia" um valor fora do vocabulário. */
function _opcoesVocab(nome, atual) {
  const lista = ((typeof config !== 'undefined' && config.vocabulario && config.vocabulario[nome]) || []).slice().sort();
  if (atual && !lista.includes(atual)) lista.unshift(atual);
  return lista;
}

/* Definição dos campos editáveis por tipo de registro. `chaveDe(r)` identifica a linha. */
const EDICAO_TIPOS = {
  cultura: { banco: 'culturas', aba: 'culturas', rotulo: 'Cultura',
    chaveDe: r => ({ ID_Cultura: r.ID_Cultura }),
    campos: r => [
      { id: 'DataColeta', rotulo: 'Data da coleta', tipo: 'date' },
      { id: 'Setor', rotulo: 'Setor', tipo: 'select', opcoes: ['', ..._opcoesVocab('setores', r.Setor)] },
      { id: 'Material', rotulo: 'Material', tipo: 'select', opcoes: _opcoesVocab('materiais', r.Material) },
      { id: 'Sitio', rotulo: 'Sítio', tipo: 'text' },
      { id: 'Microrganismo', rotulo: 'Microrganismo', tipo: 'select', opcoes: ['', ..._opcoesVocab('microrganismos', r.Microrganismo)] },
      { id: 'MecanismoResistencia', rotulo: 'Mecanismo de resistência', tipo: 'text' },
      /* "IRAS" sozinha e "IRAS — <topografia>" para cada topografia do vocabulário. */
      { id: 'AvaliacaoCCIH', rotulo: 'Avaliação da CCIH', tipo: 'select',
        opcoes: ['', ...(typeof CLASSIFICACOES_CULTURA !== 'undefined' ? CLASSIFICACOES_CULTURA : []).flatMap(c =>
          c === 'IRAS' ? ['IRAS', ..._opcoesVocab('topografias', '').map(t => 'IRAS — ' + t)] : [c])
          .filter((v, i, a) => a.indexOf(v) === i)] },
      { id: 'StatusRevisao', rotulo: 'Situação da revisão', tipo: 'select', opcoes: STATUS_REVISAO_CULTURA }
    ],
    /* Deixou de ser IRAS com caso vinculado → oferece descartar o caso. */
    efeitos: (antes, depois) => (antes.ID_IRAS && /^iras/i.test(String(antes.AvaliacaoCCIH || '')) && !/^iras/i.test(String(depois.AvaliacaoCCIH || '')))
      ? [{ id: 'descartarIras', rotulo: `Descartar também o caso de IRAS vinculado (${antes.ID_IRAS}) e desvincular esta cultura`, padrao: true,
          aplicar: async (usuario, agora) => {
            await comTrava(['iras'], async () => {
              const b = await lerBanco('iras');
              editarRegistro(b.casos || [], { ID_IRAS: antes.ID_IRAS }, { StatusInvestigacao: 'descartado' }, { quem: usuario, quando: agora, nota: 'cultura ' + antes.ID_Cultura + ' reclassificada' });
              await gravarBanco('iras', b);
            });
            return { ID_IRAS: '' };
          } }] : [] },
  iras: { banco: 'iras', aba: 'casos', rotulo: 'Caso de IRAS',
    chaveDe: r => ({ ID_IRAS: r.ID_IRAS }),
    campos: r => [
      { id: 'DataInfeccao', rotulo: 'Data da infecção', tipo: 'date' },
      { id: 'Topografia', rotulo: 'Topografia (sítio)', tipo: 'select', opcoes: _opcoesVocab('topografias', r.Topografia) },
      { id: 'Setor', rotulo: 'Setor', tipo: 'select', opcoes: ['', ..._opcoesVocab('setores', r.Setor)] },
      { id: 'DispositivoAssociado', rotulo: 'Dispositivo associado', tipo: 'select', opcoes: ['', 'CVC', 'VM', 'SVD', 'Nenhum'] },
      { id: 'Microrganismo', rotulo: 'Microrganismo', tipo: 'select', opcoes: ['', ..._opcoesVocab('microrganismos', r.Microrganismo)] },
      { id: 'CriterioDiagnostico', rotulo: 'Critério diagnóstico', tipo: 'text' },
      { id: 'StatusInvestigacao', rotulo: 'Situação', tipo: 'select', opcoes: STATUS_INVESTIGACAO_IRAS },
      { id: 'Observacoes', rotulo: 'Observações', tipo: 'textarea' }
    ],
    efeitos: (antes, depois) => (String(depois.StatusInvestigacao) === 'descartado' && String(antes.StatusInvestigacao) !== 'descartado')
      ? [{ id: 'reclassificarCulturas', rotulo: 'Nas culturas vinculadas a este caso, trocar a avaliação para "Colonização" e desvinculá-las', padrao: false,
          aplicar: async (usuario, agora) => {
            await comTrava(['culturas'], async () => {
              const b = await lerBanco('culturas');
              for (const c of (b.culturas || []).filter(c => String(c.ID_IRAS || '').trim() === String(antes.ID_IRAS).trim())) {
                editarRegistro(b.culturas, { ID_Cultura: c.ID_Cultura }, { AvaliacaoCCIH: 'Colonização', ID_IRAS: '' }, { quem: usuario, quando: agora, nota: 'caso ' + antes.ID_IRAS + ' descartado' });
              }
              await gravarBanco('culturas', b);
            });
            return {};
          } }] : [] },
  avaliacao_atb: { banco: 'antibioticos', aba: 'avaliacoes', rotulo: 'Avaliação de antibiótico (stewardship)',
    chaveDe: r => ({ Prontuario: r.Prontuario, Antibiotico: r.Antibiotico, CriadoEm: r.CriadoEm }),
    campos: () => [
      { id: 'DataDados', rotulo: 'Data', tipo: 'date' },
      { id: 'Avaliacao', rotulo: 'Avaliação', tipo: 'select', opcoes: typeof AVALIACOES_ATB !== 'undefined' ? AVALIACOES_ATB : ['Correto', 'Parcialmente correto', 'Incorreto'] },
      { id: 'Recomendacao', rotulo: 'Recomendação', tipo: 'select', opcoes: typeof RECOMENDACOES_ATB !== 'undefined' ? RECOMENDACOES_ATB : ['Manter', 'Ajustar dose', 'Descalonar', 'Modificar', 'Suspender'] },
      { id: 'Indicacao', rotulo: 'Indicação', tipo: 'text' },
      { id: 'Topografia', rotulo: 'Topografia', tipo: 'text' },
      { id: 'ParecerTexto', rotulo: 'Parecer', tipo: 'textarea' }
    ] },
  avaliacao_uti: { banco: 'uti', aba: 'avaliacoes_atb', rotulo: 'Avaliação de antibiótico (visita à UTI)',
    chaveDe: r => ({ Prontuario: r.Prontuario, Antibiotico: r.Antibiotico, CriadoEm: r.CriadoEm }),
    campos: () => [
      { id: 'Data', rotulo: 'Data', tipo: 'date' },
      { id: 'Avaliacao', rotulo: 'Avaliação', tipo: 'select', opcoes: ['Correto', 'Parcialmente correto', 'Incorreto'] },
      { id: 'Recomendacao', rotulo: 'Recomendação', tipo: 'select', opcoes: ['Manter', 'Suspender', 'Modificar', 'Ajustar dose'] },
      { id: 'Indicacao', rotulo: 'Indicação', tipo: 'text' }
    ] },
  cirurgia: { banco: 'cirurgias', aba: 'cirurgias', rotulo: 'Cirurgia',
    chaveDe: r => ({ ID_Cirurgia: r.ID_Cirurgia }),
    campos: r => [
      { id: 'DataCirurgia', rotulo: 'Data da cirurgia', tipo: 'date' },
      { id: 'ProcedimentoNHSN', rotulo: 'Categoria (NHSN)', tipo: 'select', opcoes: ['', ..._opcoesVocab('procedimentos_nhsn', r.ProcedimentoNHSN)] },
      { id: 'PotencialContaminacao', rotulo: 'Potencial de contaminação', tipo: 'text' },
      { id: 'ISC', rotulo: 'Teve ISC?', tipo: 'select', opcoes: ['', 'S', 'N'] },
      { id: 'TipoISC', rotulo: 'Tipo de ISC', tipo: 'select', opcoes: ['', ...(typeof TIPOS_ISC !== 'undefined' ? Object.keys(TIPOS_ISC) : [])] },
      { id: 'StatusVigilancia', rotulo: 'Situação da vigilância', tipo: 'select', opcoes: STATUS_VIGILANCIA_CIRURGIA },
      { id: 'ObservacoesVigilancia', rotulo: 'Observações', tipo: 'textarea' }
    ] },
  isolamento: { banco: 'isolamentos', aba: 'precaucoes', rotulo: 'Precaução / isolamento',
    chaveDe: r => ({ ID_Precaucao: r.ID_Precaucao }),
    campos: r => [
      { id: 'TipoPrecaucao', rotulo: 'Tipo de precaução', tipo: 'text' },
      { id: 'Motivo', rotulo: 'Motivo', tipo: 'text' },
      { id: 'Setor', rotulo: 'Setor', tipo: 'select', opcoes: ['', ..._opcoesVocab('setores', r.Setor)] },
      { id: 'DataInicio', rotulo: 'Início', tipo: 'date' },
      { id: 'DataFim', rotulo: 'Fim', tipo: 'date' },
      { id: 'Observacoes', rotulo: 'Observações', tipo: 'textarea' }
    ] },
  internacao: { banco: 'pacientes', aba: 'internacoes', rotulo: 'Internação',
    chaveDe: r => (String(r.Atendimento || '').trim() ? { Atendimento: r.Atendimento } : { Prontuario: r.Prontuario, DataInternacao: r.DataInternacao }),
    campos: r => [
      { id: 'DataInternacao', rotulo: 'Data da internação', tipo: 'date' },
      { id: 'DataAlta', rotulo: 'Data da alta', tipo: 'date' },
      { id: 'Desfecho', rotulo: 'Desfecho', tipo: 'text' },
      { id: 'SetorAtual', rotulo: 'Setor', tipo: 'select', opcoes: ['', ..._opcoesVocab('setores', r.SetorAtual)] }
    ] },
  sepse: { banco: 'sepse', aba: 'casos', rotulo: 'Protocolo de sepse',
    chaveDe: r => ({ ID_Caso: r.ID_Caso }),
    campos: () => [
      { id: 'DataProtocolo', rotulo: 'Data do protocolo', tipo: 'date' },
      { id: 'SepseConfirmada', rotulo: 'Sepse confirmada?', tipo: 'select', opcoes: ['', 'S', 'N'] },
      { id: 'FocoInfeccioso', rotulo: 'Foco', tipo: 'text' },
      { id: 'Desfecho', rotulo: 'Desfecho', tipo: 'text' }
    ] }
};

/* Botão "✎" para a linha do tempo; abre o formulário logo abaixo do evento. */
function botaoEditarRegistro(tipo, registro, aoSalvar) {
  if (!EDICAO_TIPOS[tipo] || !registro) return null;
  return el('button', { class: 'botao-secundario evento-editar', title: 'Corrigir este registro',
    onclick: e => { e.stopPropagation(); abrirEdicaoRegistro(tipo, registro, e.currentTarget.closest('.evento') || e.currentTarget.parentElement, aoSalvar); } }, '✎ editar');
}

function abrirEdicaoRegistro(tipo, registro, ancora, aoSalvar) {
  const def = EDICAO_TIPOS[tipo];
  const existente = ancora.parentElement && ancora.parentElement.querySelector('.cartao-edicao[data-ancora="' + (ancora.dataset.edicaoId || '') + '"]');
  if (existente) { existente.remove(); return; }
  if (!ancora.dataset.edicaoId) ancora.dataset.edicaoId = String(Math.random()).slice(2);
  const campos = def.campos(registro);
  const entradas = {};
  const grade = el('div', { class: 'edicao-campos' }, ...campos.map(c => {
    const atual = String(registro[c.id] == null ? '' : registro[c.id]);
    let campo;
    if (c.tipo === 'select') {
      const opcoes = c.opcoes.slice();
      if (atual && !opcoes.includes(atual)) opcoes.unshift(atual);
      campo = el('select', {}, opcoes.map(o => el('option', { value: o, selected: o === atual ? '' : null }, o === '' ? '—' : o)));
    } else if (c.tipo === 'textarea') campo = el('textarea', { rows: 2 }, atual);
    else campo = el('input', { type: c.tipo, value: c.tipo === 'date' ? atual.slice(0, 10) : atual });
    entradas[c.id] = campo;
    return el('label', {}, c.rotulo, campo);
  }));
  const campoNota = el('input', { type: 'text', placeholder: 'motivo da correção (opcional, fica no histórico)', style: 'width:100%' });
  const areaEfeitos = el('div', {});
  const msg = el('p', { class: 'aviso-erro-texto' });
  const lerForm = () => { const d = {}; campos.forEach(c => { d[c.id] = entradas[c.id].value; }); return d; };
  /* Efeitos cruzados aparecem só quando a mudança os justifica. */
  const atualizarEfeitos = () => {
    const efeitos = (def.efeitos ? def.efeitos(registro, { ...registro, ...lerForm() }) : []);
    areaEfeitos.replaceChildren(...efeitos.map(ef => el('label', { style: 'display:block;margin:6px 0' },
      el('input', { type: 'checkbox', 'data-efeito': ef.id, checked: ef.padrao ? '' : null }), ' ' + ef.rotulo)));
    areaEfeitos._efeitos = efeitos;
  };
  Object.values(entradas).forEach(e => e.addEventListener('change', atualizarEfeitos));
  atualizarEfeitos();
  const cartao = el('div', { class: 'cartao cartao-detalhe cartao-edicao', 'data-ancora': ancora.dataset.edicaoId },
    el('h3', {}, 'Corrigir — ' + def.rotulo),
    grade, campoNota, areaEfeitos,
    el('div', { class: 'linha-botoes' },
      el('button', { class: 'botao-primario', onclick: async () => {
        try {
          const usuario = app.usuario || '', agora = agoraCurto();
          const mudancas = lerForm();
          const marcados = (areaEfeitos._efeitos || []).filter(ef => { const cb = areaEfeitos.querySelector('input[data-efeito="' + ef.id + '"]'); return cb && cb.checked; });
          for (const ef of marcados) Object.assign(mudancas, await ef.aplicar(usuario, agora));
          let resultado;
          await comTrava([def.banco], async () => {
            const b = await lerBanco(def.banco);
            resultado = editarRegistro(b[def.aba] || [], def.chaveDe(registro), mudancas, { quem: usuario, quando: agora, nota: campoNota.value.trim() });
            if (!resultado.registro) throw new Error('registro não encontrado no banco (foi alterado por outra pessoa?)');
            if (resultado.alteracoes.length) await gravarBanco(def.banco, b);
          });
          if (!resultado.alteracoes.length && !marcados.length) { msg.textContent = 'Nada mudou.'; return; }
          if (typeof aoSalvar === 'function') aoSalvar(resultado);
        } catch (e) { msg.textContent = e.message; }
      } }, 'Salvar correção'),
      el('button', { class: 'botao-secundario', onclick: () => cartao.remove() }, 'Cancelar')),
    msg,
    String(registro.HistoricoEdicao || '').trim() ? el('div', { class: 'edicao-historico' }, 'Histórico de correções:\n' + registro.HistoricoEdicao) : null);
  ancora.after(cartao);
  cartao.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
