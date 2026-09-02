/* Abas interativas: Culturas (revisão e classificação), Cirurgias (vigilância pós-alta) e UTI. */

const TIPOS_ISC = {
  'superficial': 'ISC incisional superficial',
  'profunda': 'ISC incisional profunda',
  'órgão/espaço': 'ISC de órgão/espaço'
};

async function comTrava(nomes, fn) {
  for (const n of nomes) {
    const situacao = await verificarTrava(n, app.usuario);
    if (situacao && situacao.ativa) {
      throw new Error(`${ESQUEMAS[n].arquivo} em edição por ${situacao.trava.usuario} — tente novamente em instantes.`);
    }
  }
  for (const n of nomes) await criarTrava(n, app.usuario);
  /* Duas sessões podem passar pela verificação juntas e ambas criarem a trava; a releitura
     decide quem venceu. Quem perdeu recua sem gravar nada. */
  for (const n of nomes) {
    if (!(await confirmarTrava(n))) {
      for (const m of nomes) await liberarTrava(m).catch(() => {});
      throw new Error(`${ESQUEMAS[n].arquivo} acabou de ser travado por outra sessão — tente novamente.`);
    }
  }
  try { return await fn(); }
  finally { for (const n of nomes) await liberarTrava(n).catch(() => {}); }
}

function agoraCurto() { return new Date().toISOString().slice(0, 16).replace('T', ' '); }

/* Espera a pessoa parar de digitar antes de refiltrar: as buscas varrem dezenas de milhares
   de linhas, e refazer tudo a cada tecla congela a digitação. */
function aoPararDeDigitar(fn, ms) {
  let alarme = null;
  return () => { clearTimeout(alarme); alarme = setTimeout(fn, ms || 250); };
}
function hojeISO() { return new Date().toISOString().slice(0, 10); }

function proximoIDLista(lista, campo, prefixo) {
  return proximoID(lista, campo, prefixo)();
}

/* Selo das culturas colhidas dentro de um protocolo de sepse. Vale para qualquer tela:
   essas culturas não podem sumir na triagem, porque a hemocultura negativa do protocolo
   é um resultado do protocolo — a ausência de germe é a informação. */
let indiceSepseUI = new Map();
function marcaSepse(cultura) {
  if (!culturaDeProtocoloSepse(cultura, indiceSepseUI)) return null;
  return el('span', { class: 'selo selo-sepse', title: 'Colhida em torno da abertura de um protocolo de sepse' }, ' 🩸 sepse');
}
async function carregarIndiceSepse() {
  try { indiceSepseUI = indiceSepse((await lerBanco('sepse')).casos || []); }
  catch (e) { indiceSepseUI = new Map(); }
}

/* ---- Aba Culturas ---- */

async function montarCulturas(conteudo) {
  conteudo.append(el('h1', {}, 'Culturas'));
  let banco, bancoPacientes;
  try {
    [banco, bancoPacientes] = await Promise.all([lerBanco('culturas'), lerBanco('pacientes'), carregarIndiceSepse()]);
  } catch (e) { conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message)); return; }
  const nomes = new Map(bancoPacientes.pacientes.map(p => [normalizarProntuario(p.Prontuario), p.Nome]));
  const sensPorCultura = {};
  banco.sensibilidade.forEach(s => { (sensPorCultura[s.ID_Cultura] = sensPorCultura[s.ID_Cultura] || []).push(s); });

  const filtro = Object.assign({ status: 'pendente', setor: '', busca: '' }, app.filtroCulturas || {});
  app.filtroCulturas = null;
  const setores = [...new Set(banco.culturas.map(c => c.Setor).filter(Boolean))].sort();

  const selStatus = el('select', { title: '"triagem" = classificada automaticamente pelo app (negativa, colonização, água, leite)' },
    ['pendente', 'avaliada', 'triagem', 'descartada', 'todas'].map(s =>
      el('option', { value: s, selected: filtro.status === s ? '' : null }, s)));
  const selSetor = el('select', {}, el('option', { value: '' }, 'todos os setores'),
    setores.map(s => el('option', { value: s, selected: filtro.setor === s ? '' : null }, s)));
  const campoBusca = el('input', { type: 'text', placeholder: 'prontuário, nome ou germe', value: filtro.busca });
  const areaTabela = el('div', {});
  [selStatus, selSetor].forEach(s => s.addEventListener('change', aplicar));
  campoBusca.addEventListener('input', aoPararDeDigitar(aplicar));
  conteudo.append(el('div', { class: 'cartao' },
    el('div', { class: 'linha-campos' },
      el('label', {}, 'Status: ', selStatus), el('label', {}, 'Setor: ', selSetor),
      el('label', {}, 'Buscar: ', campoBusca)),
    areaTabela));

  function aplicar() {
    const b = normalizarTexto(campoBusca.value);
    const linhas = banco.culturas.filter(c =>
      (selStatus.value === 'todas' || c.StatusRevisao === selStatus.value)
      && (!selSetor.value || c.Setor === selSetor.value)
      && (!b || [c.Prontuario, nomes.get(normalizarProntuario(c.Prontuario)), c.Microrganismo].some(v => normalizarTexto(v).includes(b))))
      .sort((x, y) => String(y.DataColeta).localeCompare(String(x.DataColeta)));
    const mostradas = linhas.slice(0, 200);
    areaTabela.replaceChildren(
      el('p', { class: 'texto-suave' }, `${fmtInt(linhas.length)} culturas` + (linhas.length > 200 ? ' (mostrando 200)' : '')),
      el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Coleta', 'Prontuário', 'Paciente', 'Setor', 'Material', 'Microrganismo', 'Mecanismo', 'Classificação'].map(c => el('th', {}, c)))),
        el('tbody', {}, mostradas.map(c => el('tr', { class: 'linha-clicavel', onclick: e => mostrarDetalhe(c, e.currentTarget) },
          [c.DataColeta, c.Prontuario, nomes.get(normalizarProntuario(c.Prontuario)) || '', c.Setor, c.Material,
           c.Microrganismo || '(negativa)', c.MecanismoResistencia].map(v => el('td', {}, String(v || ''))),
          el('td', {}, c.AvaliacaoCCIH || c.StatusRevisao, marcaSepse(c)))))));
  }

  function mostrarDetalhe(c, tr) {
    const sens = sensPorCultura[c.ID_Cultura] || [];
    const cartao = el('div', { class: 'cartao cartao-detalhe' },
      el('h2', {}, `${c.ID_Cultura} — ${c.Microrganismo || 'sem crescimento'}`),
      el('p', { class: 'texto-suave' },
        `${nomes.get(normalizarProntuario(c.Prontuario)) || ''} (${c.Prontuario}) · ${c.Setor} · ${c.Material} · coleta ${c.DataColeta}` +
        (c.MecanismoResistencia ? ` · ${c.MecanismoResistencia}` : '')),
      sens.length ? el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Antibiótico', 'Resultado'].map(x => el('th', {}, x)))),
        el('tbody', {}, sens.map(s => el('tr', {}, el('td', {}, s.Antibiotico),
          el('td', { class: s.Resultado === 'R' ? 'aviso-erro-texto' : '' }, s.Resultado)))))
        : el('p', { class: 'texto-suave' }, c.Antibiograma
            ? 'Antibiograma como veio do laboratório: ' + c.Antibiograma
            : 'Sem antibiograma.'),
      sens.length && c.Antibiograma ? el('p', { class: 'texto-suave' }, 'Laudo original: ' + c.Antibiograma) : null);

    cartao.append(el('div', { class: 'linha-botoes' },
      el('button', { class: 'botao-secundario', onclick: e => { e.stopPropagation(); abrirPaciente(c.Prontuario); } },
        'Ver ficha do paciente')));
    if (culturaDeProtocoloSepse(c, indiceSepseUI)) {
      cartao.append(el('p', { class: 'texto-suave' },
        '🩸 Colhida em torno da abertura de um protocolo de sepse — aparece no relatório mesmo se a triagem a classificar.'));
    }
    if (c.StatusRevisao === 'avaliada') {
      cartao.append(el('p', {}, el('strong', {}, 'Avaliação da CCIH: '), c.AvaliacaoCCIH || '—'));
    } else {
      if (c.StatusRevisao === 'triagem') {
        cartao.append(el('p', { class: 'texto-suave' },
          `Triagem automática: ${c.AvaliacaoCCIH}. Classifique abaixo se discordar.`));
      }
      const selAval = el('select', {}, CLASSIFICACOES_CULTURA.filter(o => o !== 'Negativa')
        .map(o => el('option', { value: o }, o === 'Não é cultura' ? 'Não é cultura (descartar)' : o)));
      const selTopo = el('select', {}, config.vocabulario.topografias.map(t => el('option', { value: t }, t)));
      const selDisp = el('select', {}, ['Nenhum', 'CVC', 'VM', 'SVD'].map(d => el('option', { value: d }, d)));
      const linhaIras = el('span', { style: 'display:none' },
        el('label', {}, ' Topografia: ', selTopo), el('label', {}, ' Dispositivo: ', selDisp));
      selAval.addEventListener('change', () => { linhaIras.style.display = selAval.value === 'IRAS' ? '' : 'none'; });
      const msg = el('p', { class: 'aviso-erro-texto' });
      cartao.append(el('div', { class: 'linha-campos' },
        el('label', {}, 'Classificação: ', selAval), linhaIras,
        el('button', { class: 'botao-primario', onclick: async () => {
          try {
            await salvarAvaliacao(c, selAval.value, selTopo.value, selDisp.value);
            /* Preserva onde a pessoa estava: sem isto, cada avaliação salva jogava o
               revisor de volta ao filtro padrão, perdendo setor e busca. */
            app.filtroCulturas = { status: selStatus.value, setor: selSetor.value, busca: campoBusca.value };
            navegar('culturas');
          } catch (e) { msg.textContent = e.message; }
        } }, 'Salvar avaliação')), msg);
    }
    detalharNaLinha(tr, cartao);
  }

  async function salvarAvaliacao(c, avaliacao, topografia, dispositivo) {
    const arquivos = avaliacao === 'IRAS' ? ['culturas', 'iras'] : ['culturas'];
    await comTrava(arquivos, async () => {
      const bancoAtual = await lerBanco('culturas');
      const alvo = bancoAtual.culturas.find(x => x.ID_Cultura === c.ID_Cultura);
      if (!alvo) throw new Error('Cultura não encontrada no banco.');
      const descarte = avaliacao.startsWith('Não é cultura');
      alvo.StatusRevisao = descarte ? 'descartada' : 'avaliada';
      alvo.AvaliacaoCCIH = descarte ? 'Não é cultura' : (avaliacao === 'IRAS' ? `IRAS — ${topografia}` : avaliacao);
      await gravarBanco('culturas', bancoAtual);
      if (avaliacao === 'IRAS') {
        const bancoIras = await lerBanco('iras');
        bancoIras.casos.push({
          ID_IRAS: proximoIDLista(bancoIras.casos, 'ID_IRAS', 'IRA'),
          Prontuario: c.Prontuario, DataInfeccao: c.DataColeta, Topografia: topografia,
          CriterioDiagnostico: '', Setor: c.Setor, DispositivoAssociado: dispositivo,
          /* Nasce como suspeita: a notificação oficial só existe depois que um segundo
             profissional confirmar na aba Infecções. */
          Microrganismo: c.Microrganismo, Desfecho: '', StatusInvestigacao: 'em investigação',
          NotificadoANVISA: '', CriadoPor: app.usuario, CriadoEm: agoraCurto()
        });
        await gravarBanco('iras', bancoIras);
      }
    });
  }

  aplicar();
}

/* ---- Unificação de termos de vocabulário (usada nas Configurações) ---- */

async function unificarVocabulario(vocab, de, para) {
  const aplicacoes = VOCAB_APLICACAO[vocab] || [];
  const esquemasAfetados = [...new Set(aplicacoes.map(([esq]) => esq))].concat(['config']);
  let linhasAlteradas = 0;
  await comTrava(esquemasAfetados, async () => {
    for (const esquemaNome of new Set(aplicacoes.map(([esq]) => esq))) {
      const banco = await lerBanco(esquemaNome);
      let mudou = false;
      for (const [esq, aba, campo] of aplicacoes) {
        if (esq !== esquemaNome) continue;
        for (const linha of banco[aba] || []) {
          if (String(linha[campo] || '').trim() === de) { linha[campo] = para; linhasAlteradas++; mudou = true; }
        }
      }
      if (mudou) await gravarBanco(esquemaNome, banco);
    }
    config.vocabulario[vocab] = (config.vocabulario[vocab] || []).filter(t => t !== de);
    if (!config.vocabulario[vocab].some(t => normalizarTexto(t) === normalizarTexto(para))) {
      config.acrescentarVocabulario(vocab, para);
    }
    if (vocab === 'procedimentos_nhsn') {
      config.procedimentosNHSN = config.procedimentosNHSN.filter(pr => pr.Nome !== de);
    }
    config.aliases.forEach(a => { if (a.Campo === vocab && a.Para === de) a.Para = para; });
    config.registrarAlias(vocab, de, para);
    await config.salvar();
  });
  return linhasAlteradas;
}

/* Abre o cartão de detalhe/validação logo ABAIXO da linha clicada, como uma linha nova
   da própria tabela. Antes o cartão ia para o fim da lista: com 200 culturas na tela,
   quem clicava na primeira não via nada acontecer. Clicar de novo na mesma linha fecha. */
function detalharNaLinha(tr, cartao) {
  const tabela = tr.closest('table');
  const jaAberta = tr.classList.contains('linha-aberta');
  tabela.querySelectorAll('tr.linha-detalhe').forEach(x => x.remove());
  tabela.querySelectorAll('tr.linha-aberta').forEach(x => x.classList.remove('linha-aberta'));
  if (jaAberta) return null;
  const linha = el('tr', { class: 'linha-detalhe' },
    el('td', { colspan: String(tr.children.length) }, cartao));
  tr.classList.add('linha-aberta');
  tr.after(linha);
  linha.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return linha;
}

/* ---- Aba Pacientes (busca e unificação de registros) ---- */

/* Unifica vários pseudo-registros de uma vez. Cada arquivo do banco é lido e gravado
   UMA vez para o lote inteiro — unificar um a um relia e regravava os 9 arquivos a cada
   clique (o culturas.xlsx sozinho tem 26 MB), o que inviabilizava as levas do laboratório.
   Devolve { unificados, linhasAlteradas, pacientesFundidos }. */
async function unificarProntuarios(pares) {
  const mapa = new Map();
  for (const par of pares) {
    const de = normalizarProntuario(par.de), para = normalizarProntuario(par.para);
    if (de && para && de !== para) mapa.set(de, para);
  }
  if (!mapa.size) throw new Error('Nenhum registro selecionado para unificar.');

  /* Se A→B e B→C foram marcados juntos, A tem que terminar em C. */
  const destinoDe = inicio => {
    let atual = mapa.get(inicio);
    const vistos = new Set([inicio]);
    while (mapa.has(atual) && !vistos.has(atual)) { vistos.add(atual); atual = mapa.get(atual); }
    return atual;
  };
  const alvos = new Set([...mapa.keys()].map(destinoDe));

  const esquemasComProntuario = Object.keys(ESQUEMAS).filter(nome =>
    nome !== 'config' && Object.values(ESQUEMAS[nome].abas).some(colunas => colunas.includes('Prontuario')));
  let linhasAlteradas = 0, pacientesFundidos = 0;

  await comTrava(esquemasComProntuario, async () => {
    for (const nome of esquemasComProntuario) {
      const banco = await lerBanco(nome);
      let mudou = false;
      for (const [aba, colunas] of Object.entries(ESQUEMAS[nome].abas)) {
        if (!colunas.includes('Prontuario')) continue;
        for (const linha of banco[aba] || []) {
          const atual = normalizarProntuario(linha.Prontuario);
          if (mapa.has(atual)) { linha.Prontuario = destinoDe(atual); linhasAlteradas++; mudou = true; }
        }
      }
      /* No cadastro, os registros que passaram a dividir o mesmo prontuário viram um só:
         fica o mais antigo, completado com o que faltava nele. */
      if (nome === 'pacientes') {
        const porProntuario = new Map();
        for (const p of banco.pacientes) {
          const chave = normalizarProntuario(p.Prontuario);
          if (!alvos.has(chave)) continue;
          if (!porProntuario.has(chave)) porProntuario.set(chave, []);
          porProntuario.get(chave).push(p);
        }
        const descartar = new Set();
        for (const linhas of porProntuario.values()) {
          if (linhas.length < 2) continue;
          const principal = linhas.slice().sort((a, b) =>
            String(a.CriadoEm || '').localeCompare(String(b.CriadoEm || '')))[0];
          for (const outro of linhas) {
            if (outro === principal) continue;
            for (const campo of ['Nome', 'Telefone', 'DataNascimento', 'Sexo']) {
              if (!principal[campo] && outro[campo]) principal[campo] = outro[campo];
            }
            descartar.add(outro);
            pacientesFundidos++;
          }
        }
        if (descartar.size) { banco.pacientes = banco.pacientes.filter(p => !descartar.has(p)); mudou = true; }
      }
      if (mudou) await gravarBanco(nome, banco);
    }
  });
  return { unificados: mapa.size, linhasAlteradas, pacientesFundidos };
}

async function unificarProntuario(de, para) {
  return unificarProntuarios([{ de, para }]);
}

async function montarPacientes(conteudo) {
  conteudo.append(el('h1', {}, 'Pacientes'));
  let banco;
  try { banco = await lerBanco('pacientes'); }
  catch (e) { conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message)); return; }
  const pseudos = banco.pacientes.filter(p => ehPseudoProntuario(p.Prontuario));
  const sugestoes = sugerirUnificacoes(banco.pacientes);
  const msg = el('p', { class: 'aviso-erro-texto' });
  if (app.avisoPacientes) {
    conteudo.append(el('div', { class: 'cartao aviso-sucesso' }, app.avisoPacientes));
    app.avisoPacientes = null;
  }

  conteudo.append(el('div', { class: 'grade-cartoes' }, ...[
    ['Pacientes', banco.pacientes.length],
    ['Com registro provisório (laboratório ou centro cirúrgico)', pseudos.length],
    ['Unificações sugeridas', sugestoes.length]
  ].map(([r, n]) => el('div', { class: 'cartao cartao-numero' },
    el('div', { class: 'numero-grande' }, fmtInt(n)), el('div', { class: 'texto-suave' }, r)))));

  async function executar(de, para) {
    try {
      await unificarProntuario(de, para);
      navegar('pacientes');
    } catch (e) { msg.textContent = e.message; }
  }

  if (sugestoes.length) {
    /* Uma caixa por linha e um botão só: as levas do laboratório chegam com dezenas de
       pseudo-registros, e confirmar um a um custava uma reescrita do banco inteiro em
       cada clique. Todas vêm marcadas — o trabalho vira desmarcar o que não serve. */
    const caixas = sugestoes.map(() => el('input', { type: 'checkbox', checked: '' }));
    const marcarTodas = el('input', { type: 'checkbox', checked: '' });
    const botao = el('button', { class: 'botao-primario' });
    const selecionadas = () => sugestoes.filter((s, i) => caixas[i].checked);
    const atualizarBotao = () => {
      const n = selecionadas().length;
      botao.textContent = n ? `Unificar ${fmtInt(n)} selecionado${n > 1 ? 's' : ''}` : 'Nenhum selecionado';
      botao.disabled = !n;
      marcarTodas.checked = n === sugestoes.length;
    };
    caixas.forEach(c => c.addEventListener('change', atualizarBotao));
    marcarTodas.addEventListener('change', () => {
      caixas.forEach(c => { c.checked = marcarTodas.checked; });
      atualizarBotao();
    });
    botao.addEventListener('click', async () => {
      const escolhidas = selecionadas();
      if (!escolhidas.length) return;
      botao.disabled = true;
      botao.textContent = `Unificando ${fmtInt(escolhidas.length)}…`;
      msg.className = 'texto-suave';
      msg.textContent = 'Reescrevendo os arquivos do banco — pode levar alguns segundos.';
      try {
        const r = await unificarProntuarios(escolhidas);
        app.avisoPacientes = `${fmtInt(r.unificados)} registros unificados · `
          + `${fmtInt(r.linhasAlteradas)} linhas atualizadas · ${fmtInt(r.pacientesFundidos)} cadastros fundidos.`;
        navegar('pacientes');
      } catch (e) {
        msg.className = 'aviso-erro-texto';
        msg.textContent = e.message;
        atualizarBotao();
      }
    });
    atualizarBotao();

    conteudo.append(el('div', { class: 'cartao' },
      el('h2', {}, `Unificações sugeridas — mesmo nome (${fmtInt(sugestoes.length)})`),
      el('p', { class: 'texto-suave' }, 'O pseudo-registro é substituído pelo prontuário verdadeiro em todos os arquivos do banco. '
        + 'Desmarque as linhas em que os nomes iguais forem pacientes diferentes.'),
      el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {},
          el('th', {}, marcarTodas),
          ['Paciente', 'Pseudo-registro', 'Prontuário verdadeiro'].map(c => el('th', {}, c)))),
        el('tbody', {}, sugestoes.map((s, i) => el('tr', {},
          el('td', {}, caixas[i]),
          el('td', { class: 'linha-clicavel', onclick: () => { caixas[i].checked = !caixas[i].checked; atualizarBotao(); } }, s.nome),
          el('td', {}, s.de), el('td', {}, s.para))))),
      el('div', { class: 'linha-botoes' }, botao)));
  }

  const selPseudo = el('select', {}, pseudos.map(p =>
    el('option', { value: p.Prontuario }, `${p.Prontuario} — ${p.Nome || 'sem nome'}`)));
  const campoReal = el('input', { type: 'text', placeholder: 'prontuário verdadeiro' });
  conteudo.append(el('div', { class: 'cartao' },
    el('h2', {}, 'Unificação manual'),
    pseudos.length ? el('div', { class: 'linha-campos' },
      el('label', {}, 'Pseudo-registro: ', selPseudo),
      el('label', {}, 'Prontuário verdadeiro: ', campoReal),
      el('button', { class: 'botao-secundario', onclick: () => {
        const para = normalizarProntuario(campoReal.value);
        if (!para) { msg.textContent = 'Informe o prontuário verdadeiro.'; return; }
        executar(selPseudo.value, para);
      } }, 'Unificar'))
      : el('p', { class: 'texto-suave' }, 'Nenhum pseudo-registro no banco.'),
    msg));

  const campoBusca = el('input', { type: 'text', placeholder: 'nome ou prontuário' });
  const areaLista = el('div', {});
  campoBusca.addEventListener("input", aoPararDeDigitar(listar));
  conteudo.append(el('div', { class: 'cartao' },
    el('div', { class: 'linha-campos' }, el('label', {}, 'Buscar: ', campoBusca)), areaLista));

  function listar() {
    const b = normalizarTexto(campoBusca.value);
    const achados = banco.pacientes.filter(p =>
      !b || normalizarTexto(p.Nome).includes(b) || normalizarTexto(p.Prontuario).includes(b)).slice(0, 50);
    areaLista.replaceChildren(el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Prontuário', 'Nome', 'Nascimento', 'Telefone'].map(c => el('th', {}, c)))),
      el('tbody', {}, achados.map(p => el('tr', { class: 'linha-clicavel', title: 'Abrir a ficha completa',
        onclick: () => abrirPaciente(p.Prontuario) },
        [p.Prontuario, p.Nome, p.DataNascimento, p.Telefone].map(v => el('td', {}, String(v || ''))))))));
  }
  listar();
}

/* ---- Aba Isolamentos (precauções e pendências de multirresistentes) ---- */

async function montarIsolamentos(conteudo) {
  conteudo.append(el('h1', {}, 'Isolamentos e precauções'));
  let banco, bancoCulturas, bancoPacientes;
  try {
    [banco, bancoCulturas, bancoPacientes] = await Promise.all([
      lerBanco('isolamentos'), lerBanco('culturas'), lerBanco('pacientes')]);
  } catch (e) { conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message)); return; }
  const nomes = new Map(bancoPacientes.pacientes.map(p => [normalizarProntuario(p.Prontuario), p.Nome]));
  const nomeDe = pr => nomes.get(normalizarProntuario(pr)) || '';
  const ativas = banco.precaucoes.filter(p => !String(p.DataFim || '').trim());
  const pendencias = pendenciasIsolamento(
    bancoCulturas.culturas, bancoCulturas.sensibilidade, banco.precaucoes, banco.decisoes, hojeISO(),
    null, config.rotina.mdrMonitorados);

  conteudo.append(el('div', { class: 'grade-cartoes' }, ...[
    ['Pendências de isolamento', pendencias.length],
    ['Precauções ativas', ativas.length]
  ].map(([r, n]) => el('div', { class: 'cartao cartao-numero' },
    el('div', { class: 'numero-grande' }, fmtInt(n)), el('div', { class: 'texto-suave' }, r)))));

  conteudo.append(el('div', { class: 'cartao' },
    el('h2', {}, 'Multirresistentes sem precaução registrada (últimos 30 dias)'),
    pendencias.length ? el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Coleta', 'Prontuário', 'Paciente', 'Setor', 'Microrganismo', 'Mecanismo', 'Sugestão'].map(c => el('th', {}, c)))),
      el('tbody', {}, pendencias.map(m => el('tr', { class: 'linha-clicavel', onclick: e => mostrarPendencia(m, e.currentTarget) },
        [m.DataColeta, m.Prontuario, nomeDe(m.Prontuario), m.Setor, m.Microrganismo, m.Mecanismo, m.Sugestao]
          .map(v => el('td', {}, String(v || '')))))))
      : el('p', { class: 'texto-suave' }, 'Nenhuma pendência — todos os multirresistentes recentes têm precaução ou decisão registrada.')),
    el('div', { class: 'cartao' },
      el('h2', {}, 'Precauções ativas'),
      ativas.length ? el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Início', 'Prontuário', 'Paciente', 'Setor', 'Tipo', 'Motivo', ''].map(c => el('th', {}, c)))),
        el('tbody', {}, ativas.map(p => el('tr', {},
          ...[p.DataInicio, p.Prontuario, nomeDe(p.Prontuario), p.Setor, p.TipoPrecaucao, p.Motivo].map(v => el('td', {}, String(v || ''))),
          el('td', {}, el('button', { class: 'botao-secundario', onclick: () => encerrar(p) }, 'Encerrar'))))))
        : el('p', { class: 'texto-suave' }, 'Nenhuma precaução ativa registrada.')));

  function mostrarPendencia(m, tr) {
    const selTipo = el('select', {}, ['Contato', 'Gotícula', 'Aerossol', 'Contato + Gotícula'].map(t =>
      el('option', { value: t, selected: t === m.Sugestao ? '' : null }, t)));
    const campoJustificativa = el('input', { type: 'text', placeholder: 'justificativa (se não indicado)' });
    const msg = el('p', { class: 'aviso-erro-texto' });
    detalharNaLinha(tr, el('div', { class: 'cartao cartao-detalhe' },
      el('h2', {}, `${m.Microrganismo} (${m.Mecanismo}) — ${nomeDe(m.Prontuario)} (${m.Prontuario})`),
      el('p', { class: 'texto-suave' }, `${m.Setor || 'setor não informado'} · cultura ${m.ID_Cultura} de ${m.DataColeta} · origem: ${m.Origem}`),
      el('div', { class: 'linha-campos' },
        el('label', {}, 'Tipo de precaução: ', selTipo),
        el('button', { class: 'botao-primario', onclick: () => decidir('isolado') }, 'Registrar precaução iniciada')),
      el('div', { class: 'linha-campos' }, campoJustificativa,
        el('button', { class: 'botao-secundario', onclick: () => decidir('não indicado') }, 'Isolamento não indicado')),
      msg));

    async function decidir(decisao) {
      try {
        await comTrava(['isolamentos'], async () => {
          const atual = await lerBanco('isolamentos');
          if (decisao === 'isolado') {
            atual.precaucoes.push({
              ID_Precaucao: proximoIDLista(atual.precaucoes, 'ID_Precaucao', 'PRC'),
              Prontuario: m.Prontuario, Setor: m.Setor, Leito: '',
              TipoPrecaucao: selTipo.value, Motivo: `${m.Mecanismo} — ${m.Microrganismo}`,
              DataInicio: hojeISO(), DataFim: '', CriadoPor: app.usuario, CriadoEm: agoraCurto()
            });
          }
          atual.decisoes.push({
            ID_Cultura: m.ID_Cultura, Prontuario: m.Prontuario, Decisao: decisao,
            Justificativa: decisao === 'isolado' ? '' : campoJustificativa.value.trim(),
            CriadoPor: app.usuario, CriadoEm: agoraCurto()
          });
          await gravarBanco('isolamentos', atual);
        });
        navegar('isolamentos');
      } catch (e) { msg.textContent = e.message; }
    }
  }

  async function encerrar(p) {
    try {
      await comTrava(['isolamentos'], async () => {
        const atual = await lerBanco('isolamentos');
        const alvo = atual.precaucoes.find(x => x.ID_Precaucao === p.ID_Precaucao);
        if (alvo) { alvo.DataFim = hojeISO(); alvo.Status = 'encerrado'; }
        await gravarBanco('isolamentos', atual);
      });
      navegar('isolamentos');
    } catch (e) {
      /* Trava de outro usuário: sem isto o botão falhava mudo e a precaução seguia ativa
         sem ninguém saber. */
      alert('Não foi possível encerrar: ' + e.message);
    }
  }
}

/* ---- Aba Antibióticos (stewardship e avaliação remota) ---- */

/* Cartão da página de avaliação remota (médicos) — usado pela aba Antibióticos. */
function montarCartaoPublicacaoRemota(conteudo, banco, bancoPacientes, bancoCulturas) {
  const hoje = hojeISO();
  const status = el('p', { class: 'texto-suave' });
  const infoPasta = el('span', { class: 'texto-suave' }, 'verificando…');
  publicacao.restaurar().then(h => { infoPasta.textContent = h ? `pasta: ${h.name}` : 'pasta ainda não definida'; });
  const campoSenha = el('input', { type: 'password', placeholder: 'senha da página (mín. 6)', autocomplete: 'new-password' });
  conteudo.append(el('div', { class: 'cartao' },
    el('h2', {}, 'Página de avaliação remota (médicos)'),
    el('p', { class: 'texto-suave' },
      'Gera um arquivo HTML único e cifrado com os pacientes pendentes, gravado com nome fixo na pasta de publicação '
      + '(use a pasta sincronizada do Google Drive — o link compartilhado permanece o mesmo a cada atualização).'),
    el('div', { class: 'linha-campos' },
      campoSenha,
      el('button', { class: 'botao-primario', onclick: () => gerarPublicarAvaliacao(campoSenha.value, status) }, 'Gerar e publicar'),
      el('button', { class: 'botao-secundario', onclick: async () => {
        try { const h = await publicacao.escolher(); infoPasta.textContent = 'pasta: ' + h.name; }
        catch (e) { /* cancelado */ }
      } }, 'Escolher pasta de publicação'),
      infoPasta),
    status));

  async function gerarPublicarAvaliacao(senha, statusEl) {
    statusEl.className = 'aviso-erro-texto';
    if ((senha || '').length < 6) { statusEl.textContent = 'Defina uma senha com pelo menos 6 caracteres.'; return; }
    const dados = montarDadosAvaliacao({
      prescricoes: banco.prescricoes, avaliacoes: banco.avaliacoes || [],
      culturas: bancoCulturas.culturas, sensibilidade: bancoCulturas.sensibilidade,
      pacientes: bancoPacientes.pacientes
    }, hoje);
    if (!dados.pacientes.length) { statusEl.textContent = 'Nenhum paciente pendente — nada a publicar.'; return; }
    try {
      if (!publicacao.handle) await publicacao.restaurar();
      if (!publicacao.handle) await publicacao.escolher();
      const geradoEm = new Date().toISOString();
      const cifrado = await criptografarDados(JSON.stringify(dados), senha);
      /* O e-mail de retorno é desta instalação, não do código: fica no config.xlsx
         (aba meta, chave email_ccih) — o repositório público não carrega e-mail de ninguém. */
      const metaConfig = (await lerBanco('config')).meta || [];
      const emailCCIH = (metaConfig.find(l => l.Chave === 'email_ccih') || {}).Valor || '';
      const html = gerarHTMLAvaliacao(cifrado, {
        geradoEm, emailDestino: emailCCIH,
        avisoHoras: AVALIACAO_AVISO_HORAS, bloqueioDias: AVALIACAO_BLOQUEIO_DIAS
      });
      await publicacao.gravar(AVALIACAO_ARQUIVO, html);
      statusEl.className = 'texto-suave';
      statusEl.textContent = `Publicado: ${dados.pacientes.length} pacientes (${fmtInt(dados.totalPrescricoes)} prescrições, ${fmtInt(dados.totalCulturas || 0)} culturas pendentes) em "${publicacao.handle.name}/${AVALIACAO_ARQUIVO}". Informe a senha aos médicos por outro canal.`;
    } catch (e) {
      if (e && e.name !== 'AbortError') statusEl.textContent = 'Erro ao publicar: ' + e.message;
    }
  }
}

/* ---- Aba Cirurgias (vigilância pós-alta) ---- */

async function montarCirurgias(conteudo) {
  conteudo.append(el('h1', {}, 'Cirurgias — vigilância pós-alta'));
  let banco, bancoPacientes;
  try {
    [banco, bancoPacientes] = await Promise.all([lerBanco('cirurgias'), lerBanco('pacientes')]);
  } catch (e) { conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message)); return; }
  const pacientes = new Map(bancoPacientes.pacientes.map(p => [normalizarProntuario(p.Prontuario), p]));
  const hoje = hojeISO();

  const total = banco.cirurgias.length;
  const pendentes = banco.cirurgias.filter(c => c.StatusVigilancia === 'pendente')
    .sort((a, b) => String(a.DataCirurgia).localeCompare(String(b.DataCirurgia)));
  const comISC = banco.cirurgias.filter(c => c.ISC === 'S').length;
  const resumo = [['Em vigilância', pendentes.length], ['Com ISC', comISC], ['Total de cirurgias', total]];
  conteudo.append(el('div', { class: 'grade-cartoes' }, ...resumo.map(([r, n]) =>
    el('div', { class: 'cartao cartao-numero' }, el('div', { class: 'numero-grande' }, fmtInt(n)), el('div', { class: 'texto-suave' }, r)))));

  conteudo.append(el('div', { class: 'cartao' },
    el('h2', {}, 'Pendentes de contato'),
    pendentes.length ? el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Cirurgia', 'Prontuário', 'Paciente', 'Telefone', 'Procedimento', 'Dias pós-op', 'Último contato'].map(c => el('th', {}, c)))),
      el('tbody', {}, pendentes.map(c => {
        const p = pacientes.get(normalizarProntuario(c.Prontuario)) || {};
        const dias = c.DataCirurgia ? Math.floor((new Date(hoje) - new Date(c.DataCirurgia)) / 86400000) : '';
        return el('tr', { class: 'linha-clicavel', onclick: e => mostrarDetalhe(c, p, dias, e.currentTarget) },
          [c.DataCirurgia, c.Prontuario, p.Nome || '', p.Telefone || '', c.ProcedimentoNHSN || c.Procedimento, String(dias), c.UltimoContato]
            .map(v => el('td', {}, String(v || ''))));
      }))) : el('p', { class: 'texto-suave' }, 'Nenhuma cirurgia aguardando contato.')));

  function mostrarDetalhe(c, p, dias, tr) {
    const campoData = el('input', { type: 'date', value: hoje });
    const selResultado = el('select', {}, ['Sem sinais de ISC', 'Não conseguiu contato', 'ISC confirmada'].map(o => el('option', { value: o }, o)));
    const selTipo = el('select', {}, Object.keys(TIPOS_ISC).map(t => el('option', { value: t }, t)));
    const rotuloTipo = el('label', { style: 'display:none' }, ' Tipo de ISC: ', selTipo);
    selResultado.addEventListener('change', () => { rotuloTipo.style.display = selResultado.value === 'ISC confirmada' ? '' : 'none'; });
    const campoObs = el('input', { type: 'text', placeholder: 'observações' });
    const msg = el('p', { class: 'aviso-erro-texto' });
    detalharNaLinha(tr, el('div', { class: 'cartao cartao-detalhe' },
      el('h2', {}, `${c.ID_Cirurgia} — ${c.ProcedimentoNHSN || c.Procedimento}`),
      el('p', { class: 'texto-suave' }, `${p.Nome || ''} (${c.Prontuario}) · tel. ${p.Telefone || 'não informado'} · cirurgia ${c.DataCirurgia} (${dias} dias) · NNIS ${c.IndiceNNIS || '—'}`),
      el('div', { class: 'linha-campos' },
        el('label', {}, 'Data do contato: ', campoData),
        el('label', {}, 'Resultado: ', selResultado), rotuloTipo),
      el('div', { class: 'linha-campos' }, campoObs),
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-primario', onclick: () => salvar(false) }, 'Registrar contato'),
        el('button', { class: 'botao-secundario', onclick: () => salvar(true) }, 'Registrar e encerrar vigilância'),
        el('button', { class: 'botao-secundario', onclick: async () => {
          try {
            await comTrava(['cirurgias'], async () => {
              const bancoAtual = await lerBanco('cirurgias');
              const alvo = bancoAtual.cirurgias.find(x => x.ID_Cirurgia === c.ID_Cirurgia);
              if (alvo) { alvo.StatusVigilancia = 'descartada'; alvo.ObservacoesVigilancia = 'Não é cirurgia — descartada da vigilância'; }
              await gravarBanco('cirurgias', bancoAtual);
            });
            navegar('cirurgias');
          } catch (e) { msg.textContent = e.message; }
        } }, 'Não é cirurgia (descartar)')),
      msg));

    async function salvar(encerrar) {
      try {
        const isISC = selResultado.value === 'ISC confirmada';
        await comTrava(isISC ? ['cirurgias', 'iras'] : ['cirurgias'], async () => {
          const bancoAtual = await lerBanco('cirurgias');
          const alvo = bancoAtual.cirurgias.find(x => x.ID_Cirurgia === c.ID_Cirurgia);
          if (!alvo) throw new Error('Cirurgia não encontrada no banco.');
          alvo.UltimoContato = campoData.value;
          const nota = `${campoData.value}: ${selResultado.value}${campoObs.value ? ' — ' + campoObs.value : ''}`;
          alvo.ObservacoesVigilancia = alvo.ObservacoesVigilancia ? alvo.ObservacoesVigilancia + ' | ' + nota : nota;
          if (isISC) {
            alvo.ISC = 'S'; alvo.TipoISC = selTipo.value; alvo.StatusVigilancia = 'encerrada (ISC)';
          } else if (encerrar) {
            alvo.StatusVigilancia = 'encerrada';
          }
          await gravarBanco('cirurgias', bancoAtual);
          if (isISC) {
            const bancoIras = await lerBanco('iras');
            bancoIras.casos.push({
              ID_IRAS: proximoIDLista(bancoIras.casos, 'ID_IRAS', 'IRA'),
              Prontuario: c.Prontuario, DataInfeccao: campoData.value, Topografia: TIPOS_ISC[selTipo.value],
              CriterioDiagnostico: 'Vigilância pós-alta', Setor: '', DispositivoAssociado: 'Nenhum',
              Microrganismo: '', Desfecho: '', StatusInvestigacao: 'em investigação',
              NotificadoANVISA: '', CriadoPor: app.usuario, CriadoEm: agoraCurto()
            });
            await gravarBanco('iras', bancoIras);
          }
        });
        navegar('cirurgias');
      } catch (e) { msg.textContent = e.message; }
    }
  }
}

/* ---- Aba UTI ---- */

async function montarUti(conteudo) {
  conteudo.append(el('h1', {}, 'UTI — visitas e dispositivos'));
  let banco;
  try { banco = await lerBanco('uti'); }
  catch (e) { conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message)); return; }

  /* ---- Resumo para levar à visita ----
     Quem vai fazer a visita técnica recebe no celular, por WhatsApp, o último mês e a
     situação atual do setor — os pontos críticos já vão mastigados para a conversa com a
     equipe. O texto usa iniciais + leito, nunca nome inteiro: viaja num app de mensagens. */
  try {
    const [bCulturas, bIso, bIras, bSepse, bHigiene, bDisp, bSurtos, bPac] = await Promise.all(
      ['culturas', 'isolamentos', 'iras', 'sepse', 'higiene_maos', 'dispositivos', 'surtos', 'pacientes']
        .map(nome => lerBanco(nome).catch(() => ({}))));
    const bancosResumo = { culturas: bCulturas, isolamentos: bIso, iras: bIras, sepse: bSepse,
      higiene_maos: bHigiene, dispositivos: bDisp, surtos: bSurtos, pacientes: bPac, uti: banco };
    const setoresUTI = [...new Set((bCulturas.culturas || []).map(c => String(c.Setor || '').trim())
      .filter(ehSetorDeUTI))].sort();
    const selSetorResumo = el('select', {},
      setoresUTI.map(sNome => el('option', { value: sNome }, sNome)),
      el('option', { value: '' }, 'todos os setores de UTI/CTI'));
    const caixaTexto = el('textarea', { rows: 10, style: 'width:100%;font-family:inherit', readonly: '' });
    const msgResumo = el('span', { class: 'texto-suave' });
    const gerar = () => {
      caixaTexto.value = resumoParaVisitaUTI(bancosResumo, selSetorResumo.value, hojeISO(), config.rotina.mdrMonitorados).texto;
    };
    selSetorResumo.addEventListener('change', gerar);
    gerar();
    conteudo.append(el('div', { class: 'cartao' },
      el('h2', {}, '📋 Resumo para levar à visita'),
      el('div', { class: 'linha-campos' }, el('label', {}, 'Setor: ', selSetorResumo)),
      caixaTexto,
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-primario', onclick: () => {
          /* wa.me sem número: o WhatsApp abre e a pessoa escolhe o próprio contato
             (ou o grupo da CCIH) — o app não precisa saber o telefone de ninguém. */
          window.open('https://wa.me/?text=' + encodeURIComponent(caixaTexto.value), '_blank');
        } }, '💬 Enviar por WhatsApp'),
        el('button', { class: 'botao-secundario', onclick: async () => {
          try { await navigator.clipboard.writeText(caixaTexto.value); msgResumo.textContent = 'Copiado ✓'; }
          catch (e) { msgResumo.textContent = 'Selecione o texto e copie com Ctrl+C.'; }
        } }, 'Copiar'), msgResumo)));
  } catch (e) { /* resumo é conveniência: não pode impedir a aba de abrir */ }
  const mes = hojeISO().slice(0, 7);
  const doMes = banco.visitas.filter(v => String(v.Data).startsWith(mes));
  const soma = campo => doMes.filter(v => v[campo] === 'S').length;
  const pacientesDia = doMes.length, cvcDia = soma('CVC'), vmDia = soma('VM'), svdDia = soma('SVD');
  const retiradasMes = doMes.filter(v => v.CVC_Retirar === 'S' || v.VM_Retirar === 'S' || v.SVD_Retirar === 'S').length;
  const atbMes = (banco.avaliacoes_atb || []).filter(a => String(a.Data).startsWith(mes)).length;
  const taxa = n => pacientesDia ? (n / pacientesDia * 100).toFixed(0) + '%' : '—';
  conteudo.append(el('div', { class: 'grade-cartoes' }, ...[
    ['Pacientes-dia no mês', pacientesDia], [`CVC-dia (${taxa(cvcDia)})`, cvcDia],
    [`VM-dia (${taxa(vmDia)})`, vmDia], [`SVD-dia (${taxa(svdDia)})`, svdDia],
    ['Retiradas sugeridas', retiradasMes], ['Antibióticos avaliados', atbMes]
  ].map(([r, n]) => el('div', { class: 'cartao cartao-numero' },
    el('div', { class: 'numero-grande' }, fmtInt(n)), el('div', { class: 'texto-suave' }, r)))));

  /* Identificação do paciente: o número anotado à beira do leito pode ser o prontuário ou
     o atendimento, então a busca tenta os dois e, havendo várias internações, fica com a
     que cobre a data da visita. Também é por ela que se acha os dispositivos do paciente. */
  let indice = indiceDeIdentificacao([], []);
  let dispositivos = [];
  try {
    const [bancoPacientes, bancoDispositivos] = await Promise.all([
      lerBanco('pacientes'), lerBanco('dispositivos').catch(() => ({ dispositivos: [] }))
    ]);
    indice = indiceDeIdentificacao(bancoPacientes.pacientes, bancoPacientes.internacoes);
    dispositivos = bancoDispositivos.dispositivos || [];
  } catch (e) { /* sem cadastro de pacientes ainda */ }
  const identificacaoDe = registro => identificarPaciente(registro.Prontuario, registro.Data, indice);
  const nomeDe = registro => {
    const id = identificacaoDe(registro);
    return id.encontrado ? id.nome : '';
  };
  const celulaPaciente = registro => {
    const id = identificacaoDe(registro);
    if (id.encontrado) {
      return el('td', { class: 'linha-clicavel', title: 'Abrir a ficha do paciente',
        onclick: e => { e.stopPropagation(); abrirPaciente(id.prontuario); } }, id.nome);
    }
    return el('td', { class: 'texto-suave', title: 'Importe o relatório de internações do período para o nome aparecer' },
      'não encontrado no cadastro');
  };

  /* Fecha o ciclo da visita: o que a CCIH pediu para retirar foi retirado? A resposta está
     no banco de dispositivos, cruzado por paciente e categoria. */
  const CATEGORIA_DA_MARCA = { CVC_Retirar: 'CVC', VM_Retirar: 'VM', SVD_Retirar: 'SVD' };
  function seguimentoDaRetirada(visita, marca) {
    const categoria = CATEGORIA_DA_MARCA[marca];
    const id = identificacaoDe(visita);
    const numeros = new Set([normalizarProntuario(visita.Prontuario)]);
    if (id.internacao) {
      numeros.add(normalizarProntuario(id.internacao.Prontuario));
      numeros.add(normalizarProntuario(id.internacao.Atendimento));
    }
    const doPaciente = dispositivos.filter(d => numeros.has(normalizarProntuario(d.Prontuario))
      && normalizarTexto(d.Categoria) === normalizarTexto(categoria));
    if (!doPaciente.length) return { categoria, situacao: 'sem registro no banco de dispositivos' };
    /* O dispositivo em questão é o que já estava instalado quando a visita aconteceu. */
    const naVisita = doPaciente.filter(d => String(d.DataInstalacao || '') <= String(visita.Data));
    const alvo = naVisita[naVisita.length - 1] || doPaciente[doPaciente.length - 1];
    const dias = a => {
      const x = Date.parse(String(a).slice(0, 10) + 'T00:00:00Z');
      const y = Date.parse(String(visita.Data).slice(0, 10) + 'T00:00:00Z');
      return isFinite(x) && isFinite(y) ? Math.round((x - y) / 86400000) : null;
    };
    if (alvo.DataRetirada) {
      const d = dias(alvo.DataRetirada);
      return {
        categoria, retirado: true, dataInstalacao: alvo.DataInstalacao, dataRetirada: alvo.DataRetirada,
        situacao: d === null ? `retirado em ${alvo.DataRetirada}`
          : d < 0 ? `já estava retirado (${alvo.DataRetirada})`
          : `retirado em ${alvo.DataRetirada} — ${d} dia(s) depois da visita`
      };
    }
    return {
      categoria, retirado: false, dataInstalacao: alvo.DataInstalacao,
      situacao: `ainda em uso (instalado em ${alvo.DataInstalacao || 'data não registrada'})`
    };
  }

  const avaliacoes = banco.avaliacoes_atb || [];
  const recentes = banco.visitas.slice().sort((a, b) => String(b.Data).localeCompare(String(a.Data))).slice(0, 30);

  /* O que a visita produz de acionável: dispositivo com retirada sugerida e antibiótico
     que a CCIH não mandou manter. É isso que a equipe precisa ver primeiro — antes
     ficava enterrado em colunas que a tela nem mostrava. */
  const pendencias = [];
  for (const v of recentes) {
    const retirar = [];
    if (v.CVC_Retirar === 'S') retirar.push(['CVC_Retirar', 'retirar CVC' + (v.CVC_Indicacoes ? ` (${v.CVC_Indicacoes})` : '')]);
    if (v.VM_Retirar === 'S') retirar.push(['VM_Retirar', 'avaliar extubação' + (v.VM_Indicacao ? ` (${v.VM_Indicacao})` : '')]);
    if (v.SVD_Retirar === 'S') retirar.push(['SVD_Retirar', 'retirar SVD' + (v.SVD_Indicacao ? ` (${v.SVD_Indicacao})` : '')]);
    retirar.forEach(([marca, texto]) => pendencias.push({ v, texto, marca, tipo: 'dispositivo' }));
  }
  /* As avaliações de antibiótico obedecem à mesma janela das visitas mostradas: sem o
     corte, um "suspender" de meses atrás reaparecia como pendência para sempre. */
  const dataMaisAntiga = recentes.length ? String(recentes[recentes.length - 1].Data) : '';
  for (const a of avaliacoes) {
    if (!a.Recomendacao || a.Recomendacao === 'Manter') continue;
    if (dataMaisAntiga && String(a.Data) < dataMaisAntiga) continue;
    const v = recentes.find(x => x.Data === a.Data && normalizarProntuario(x.Prontuario) === normalizarProntuario(a.Prontuario))
      || { Data: a.Data, Setor: a.Setor, Leito: a.Leito, Prontuario: a.Prontuario };
    pendencias.push({ v, texto: `${a.Recomendacao.toLowerCase()} ${a.Antibiotico}` + (a.Indicacao ? ` — ${a.Indicacao}` : ''), tipo: 'antibiótico' });
  }

  if (pendencias.length) {
    conteudo.append(el('div', { class: 'cartao' },
      el('h2', {}, `Condutas sugeridas na visita (${fmtInt(pendencias.length)})`),
      el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Data', 'Leito', 'Prontuário', 'Paciente', 'Conduta', 'Situação do dispositivo'].map(c => el('th', {}, c)))),
        el('tbody', {}, pendencias.map(p => {
          const seguimento = p.marca ? seguimentoDaRetirada(p.v, p.marca) : null;
          return el('tr', {},
            el('td', {}, String(p.v.Data || '')), el('td', {}, String(p.v.Leito || '')),
            el('td', {}, String(p.v.Prontuario || '')), celulaPaciente(p.v),
            el('td', { class: 'aviso-erro-texto' }, p.texto),
            el('td', { class: !seguimento ? 'texto-suave' : seguimento.retirado ? '' : 'aviso-erro-texto' },
              seguimento ? (seguimento.retirado ? '✓ ' : '') + seguimento.situacao : '—'));
        })))));
  }

  /* Dispositivo em uma célula só: presença, indicação e a marca de retirada. */
  const celulaDispositivo = (usa, indicacao, retirar) => {
    if (usa !== 'S') return el('td', { class: 'texto-suave' }, 'não');
    return el('td', {}, indicacao || 'sim', retirar === 'S' ? el('strong', { class: 'aviso-erro-texto' }, ' ⚠ retirar') : null);
  };
  conteudo.append(el('div', { class: 'cartao' },
    el('h2', {}, 'Últimas visitas'),
    recentes.length ? el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Data', 'Setor', 'Leito', 'Prontuário', 'Paciente', 'CVC', 'VM', 'SVD', 'NPT', 'Suspeita IRAS', 'Observações'].map(c => el('th', {}, c)))),
      el('tbody', {}, recentes.map(v => el('tr', {},
        el('td', {}, String(v.Data || '')), el('td', {}, String(v.Setor || '')),
        el('td', {}, String(v.Leito || '')), el('td', {}, String(v.Prontuario || '')),
        celulaPaciente(v),
        celulaDispositivo(v.CVC, (v.CVC_Qtd > 1 ? v.CVC_Qtd + '× ' : '') + (v.CVC_Indicacoes || ''), v.CVC_Retirar),
        celulaDispositivo(v.VM, v.VM_Indicacao, v.VM_Retirar),
        celulaDispositivo(v.SVD, v.SVD_Indicacao, v.SVD_Retirar),
        el('td', { class: v.NPT === 'S' ? '' : 'texto-suave' }, v.NPT === 'S' ? 'sim' : 'não'),
        el('td', {}, v.SuspeitaIRAS === 'S' ? el('strong', { class: 'aviso-erro-texto' }, v.FocoSuspeito || 'sim') : el('span', { class: 'texto-suave' }, 'não')),
        el('td', {}, String(v.Observacoes || ''))))))
      : el('p', { class: 'texto-suave' }, 'Nenhuma visita registrada — use o miniapp de visita à UTI no celular e importe a planilha gerada na aba Importar.')));

  conteudo.append(el('div', { class: 'cartao' },
    el('h2', {}, `Antibióticos avaliados (${fmtInt(avaliacoes.length)})`),
    avaliacoes.length ? el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Data', 'Leito', 'Prontuário', 'Paciente', 'Antibiótico', 'Indicação', 'Avaliação', 'Recomendação'].map(c => el('th', {}, c)))),
      el('tbody', {}, avaliacoes.slice().sort((a, b) => String(b.Data).localeCompare(String(a.Data))).slice(0, 50).map(a => el('tr', {},
        el('td', {}, String(a.Data || '')), el('td', {}, String(a.Leito || '')),
        el('td', {}, String(a.Prontuario || '')), celulaPaciente(a),
        el('td', {}, el('strong', {}, String(a.Antibiotico || ''))), el('td', {}, String(a.Indicacao || '')),
        el('td', { class: a.Avaliacao === 'Incorreto' ? 'aviso-erro-texto' : '' }, String(a.Avaliacao || '')),
        el('td', { class: a.Recomendacao && a.Recomendacao !== 'Manter' ? 'aviso-erro-texto' : '' }, String(a.Recomendacao || ''))))))
      : el('p', { class: 'texto-suave' }, 'Nenhuma avaliação de antibiótico importada ainda.')));
}
