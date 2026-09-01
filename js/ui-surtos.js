/* Aba Surtos: investigação das suspeitas levantadas no painel. Guarda a decisão da CCIH
   (é surto? não é?), o cruzamento automático dos dados dos pacientes e os documentos
   da investigação. */

const SITUACOES_SURTO = ['em investigação', 'confirmado', 'encerrado', 'descartado'];

/* Cada suspeita detectada é casada com a investigação já registrada, se houver. */
function investigacaoDaSuspeita(surto, investigacoes) {
  return (investigacoes || []).find(i => mesmaSuspeita(surto, i)) || null;
}

async function salvarInvestigacao(dados) {
  return comTrava(['surtos'], async () => {
    const banco = await lerBanco('surtos');
    banco.investigacoes = banco.investigacoes || [];
    let alvo = dados.ID_Surto ? banco.investigacoes.find(i => i.ID_Surto === dados.ID_Surto) : null;
    if (!alvo) {
      alvo = {
        ID_Surto: proximoIDLista(banco.investigacoes, 'ID_Surto', 'SUR'),
        DataAbertura: hojeISO(), CriadoPor: app.usuario, CriadoEm: agoraCurto()
      };
      banco.investigacoes.push(alvo);
    }
    Object.assign(alvo, dados, {
      ID_Surto: alvo.ID_Surto, AtualizadoPor: app.usuario, AtualizadoEm: agoraCurto()
    });
    if (dados.Situacao === 'encerrado' && !alvo.DataEncerramento) alvo.DataEncerramento = hojeISO();
    await gravarBanco('surtos', banco);
    return alvo;
  });
}

/* Anexo: o arquivo é copiado para surtos/<ID>/ dentro da pasta de dados e só o nome vai
   para a planilha — assim o documento acompanha o banco na rede, sem depender do
   computador de quem anexou. */
async function anexarDocumento(idSurto, arquivo, descricao) {
  const destino = await pasta.subpasta('surtos/' + idSurto);
  const carimbo = new Date().toISOString().slice(0, 10);
  const nome = `${carimbo}_${arquivo.name}`.replace(/[\\/:*?"<>|]/g, '-');
  const fh = await destino.getFileHandle(nome, { create: true });
  const escrita = await fh.createWritable();
  await escrita.write(await arquivo.arrayBuffer());
  await escrita.close();
  await comTrava(['surtos'], async () => {
    const banco = await lerBanco('surtos');
    banco.documentos = banco.documentos || [];
    banco.documentos.push({
      ID_Surto: idSurto, Arquivo: nome, Descricao: descricao || '',
      CriadoPor: app.usuario, CriadoEm: agoraCurto()
    });
    await gravarBanco('surtos', banco);
  });
  return nome;
}

async function montarSurtos(conteudo) {
  conteudo.append(el('h1', {}, 'Investigação de surtos'));
  let culturas, bancoSurtos, pacientes, cirurgias, dispositivos;
  try {
    [culturas, bancoSurtos, pacientes, cirurgias, dispositivos] = await Promise.all([
      lerBanco('culturas'), lerBanco('surtos'), lerBanco('pacientes'),
      lerBanco('cirurgias').catch(() => ({ cirurgias: [] })),
      lerBanco('dispositivos').catch(() => ({ dispositivos: [] }))
    ]);
  } catch (e) {
    conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message));
    return;
  }
  const investigacoes = bancoSurtos.investigacoes || [];
  const documentos = bancoSurtos.documentos || [];
  const nomes = new Map(pacientes.pacientes.map(p => [normalizarProntuario(p.Prontuario), p.Nome]));
  const suspeitas = detectarSurtos(culturas.culturas);

  /* Suspeitas ativas + investigações já registradas que não aparecem mais na detecção
     (o surto passou, mas a investigação continua valendo). */
  const itens = suspeitas.map(s => ({ suspeita: s, investigacao: investigacaoDaSuspeita(s, investigacoes) }));
  for (const inv of investigacoes) {
    if (itens.some(i => i.investigacao && i.investigacao.ID_Surto === inv.ID_Surto)) continue;
    itens.push({
      suspeita: {
        Setor: inv.Setor, Microrganismo: inv.Microrganismo, Pacientes: Number(inv.PacientesEnvolvidos) || 0,
        Inicio: inv.DataInicio, Fim: inv.DataFim, Prontuarios: [], Culturas: []
      },
      investigacao: inv, historica: true
    });
  }

  const selSituacao = el('select', {}, el('option', { value: '' }, 'todas as situações'),
    ['sem registro'].concat(SITUACOES_SURTO).map(s => el('option', { value: s }, s)));
  const area = el('div', {});
  selSituacao.addEventListener('change', listar);
  conteudo.append(el('div', { class: 'cartao' },
    el('p', { class: 'texto-suave' }, 'Suspeitas levantadas pelo painel: mesmo microrganismo, mesmo setor, '
      + `${SURTO_MINIMO_PACIENTES} pacientes ou mais em ${SURTO_JANELA_DIAS} dias (swabs de vigilância não entram). `
      + 'Marcar "não é surto" tira a suspeita do painel sem apagar o registro.'),
    el('div', { class: 'linha-campos' }, el('label', {}, 'Situação: ', selSituacao))), area);

  function listar() {
    const filtro = selSituacao.value;
    const visiveis = itens.filter(({ investigacao }) => {
      if (!filtro) return true;
      if (filtro === 'sem registro') return !investigacao;
      return investigacao && investigacao.Situacao === filtro;
    });
    area.replaceChildren(visiveis.length
      ? el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['Setor', 'Microrganismo', 'Pacientes', 'Período', 'Situação', 'Documentos'].map(c => el('th', {}, c)))),
          el('tbody', {}, visiveis.map(item => {
            const inv = item.investigacao;
            const nDocs = inv ? documentos.filter(d => d.ID_Surto === inv.ID_Surto).length : 0;
            return el('tr', { class: 'linha-clicavel', onclick: e => abrirInvestigacao(item, e.currentTarget) },
              el('td', {}, item.suspeita.Setor + (item.historica ? ' (encerrada)' : '')),
              el('td', {}, el('strong', {}, item.suspeita.Microrganismo)),
              el('td', {}, fmtInt(item.suspeita.Pacientes)),
              el('td', {}, `${item.suspeita.Inicio} a ${item.suspeita.Fim}`),
              el('td', { class: inv && inv.Situacao === 'descartado' ? 'texto-suave' : inv && inv.Situacao === 'confirmado' ? 'aviso-erro-texto' : '' },
                inv ? inv.Situacao : 'sem registro'),
              el('td', {}, nDocs ? fmtInt(nDocs) + ' anexo(s)' : '—'));
          })))
      : el('p', { class: 'texto-suave' }, 'Nenhuma suspeita nesta situação.'));
  }

  function abrirInvestigacao(item, tr) {
    const { suspeita } = item;
    const inv = item.investigacao || {};
    const prontuarios = suspeita.Prontuarios && suspeita.Prontuarios.length
      ? suspeita.Prontuarios
      : (bancoSurtos.pacientes_surto || []).filter(p => p.ID_Surto === inv.ID_Surto).map(p => p.Prontuario);
    const correlacao = correlacionarSurto(prontuarios, {
      internacoes: pacientes.internacoes, cirurgias: cirurgias.cirurgias,
      dispositivos: dispositivos.dispositivos, culturas: culturas.culturas
    });

    const campo = (rotulo, valor, linhas) => {
      const entrada = linhas
        ? el('textarea', { rows: String(linhas), style: 'width:100%;font:inherit;padding:8px;border:1px solid #c3ccd6;border-radius:8px' })
        : el('input', { type: 'text', value: valor || '' });
      if (linhas) entrada.value = valor || '';
      return { rotulo, entrada };
    };
    const selSit = el('select', {}, SITUACOES_SURTO.map(s =>
      el('option', { value: s, selected: inv.Situacao === s ? '' : null }, s)));
    const fHipotese = campo('Hipótese', inv.Hipotese, 3);
    const fFonte = campo('Fonte provável', inv.FonteProvavel);
    const fMedidas = campo('Medidas adotadas', inv.MedidasAdotadas, 3);
    const fConclusao = campo('Conclusão', inv.Conclusao, 3);
    const fResponsavel = campo('Responsável', inv.Responsavel || app.usuario);
    const msg = el('p', { class: 'aviso-erro-texto' });

    const listaAchados = (titulo, lista, formatar) => lista.length
      ? el('div', {}, el('strong', {}, titulo),
          el('ul', { style: 'margin:4px 0 8px 18px' },
            lista.slice(0, 8).map(x => el('li', {}, formatar(x)))))
      : null;

    const cartao = el('div', { class: 'cartao cartao-detalhe' },
      el('h2', {}, `${suspeita.Microrganismo} — ${suspeita.Setor}`),
      el('p', { class: 'texto-suave' },
        `${fmtInt(suspeita.Pacientes)} pacientes entre ${suspeita.Inicio} e ${suspeita.Fim}`
        + (inv.ID_Surto ? ` · investigação ${inv.ID_Surto}` : ' · ainda sem investigação registrada')),

      el('h3', {}, 'Cruzamento automático dos dados dos pacientes'),
      el('p', { class: 'texto-suave' }, 'O que estes pacientes têm em comum no banco. São coincidências a verificar, não conclusões — '
        + `foram lidas ${fmtInt(correlacao.totais.internacoes)} internações, ${fmtInt(correlacao.totais.cirurgias)} cirurgias, `
        + `${fmtInt(correlacao.totais.dispositivos)} dispositivos e ${fmtInt(correlacao.totais.culturas)} culturas destes pacientes.`),
      el('div', { class: 'secao-termos' },
        listaAchados('Mesmo leito', correlacao.leitos, x => `leito ${x.valor} — ${x.pacientes} pacientes`),
        listaAchados('Mesmo setor de internação', correlacao.setores, x => `${x.valor} — ${x.pacientes} pacientes`),
        listaAchados('Internações simultâneas', correlacao.sobreposicoes,
          x => `${x.a} e ${x.b} juntos por ${x.dias} dia(s)${x.mesmoSetor ? ' no mesmo setor' : ''}`),
        listaAchados('Mesmo procedimento cirúrgico', correlacao.procedimentos, x => `${x.valor} — ${x.pacientes} pacientes`),
        listaAchados('Mesmo cirurgião', correlacao.cirurgioes, x => `${x.valor} — ${x.pacientes} pacientes`),
        listaAchados('Mesmo tipo de dispositivo', correlacao.dispositivos, x => `${x.valor} — ${x.pacientes} pacientes`),
        listaAchados('Mesmo mecanismo de resistência', correlacao.mecanismos, x => `${x.valor} — ${x.pacientes} pacientes`),
        listaAchados('Mesmo material de coleta', correlacao.materiais, x => `${x.valor} — ${x.pacientes} pacientes`),
        [correlacao.leitos, correlacao.setores, correlacao.sobreposicoes, correlacao.procedimentos,
         correlacao.cirurgioes, correlacao.dispositivos, correlacao.mecanismos].every(l => !l.length)
          ? el('p', { class: 'texto-suave' }, 'Nenhuma coincidência encontrada entre estes pacientes — '
              + 'pode faltar importar internações, cirurgias ou dispositivos do período.') : null),

      el('h3', {}, 'Pacientes envolvidos'),
      prontuarios.length ? el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Prontuário', 'Paciente', 'Culturas na suspeita'].map(c => el('th', {}, c)))),
        el('tbody', {}, prontuarios.map(p => el('tr', { class: 'linha-clicavel',
          title: 'Abrir a ficha completa do paciente',
          onclick: ev => { ev.stopPropagation(); abrirPaciente(p); } },
          el('td', {}, p), el('td', {}, nomes.get(normalizarProntuario(p)) || ''),
          el('td', {}, (suspeita.Culturas || []).filter(c => normalizarProntuario(c.Prontuario) === normalizarProntuario(p))
            .map(c => c.DataColeta).join(' · ') || '—')))))
        : el('p', { class: 'texto-suave' }, 'Lista de pacientes não disponível (investigação antiga).'),

      el('h3', {}, 'Registro da investigação'),
      el('div', { class: 'linha-campos' }, el('label', {}, 'Situação: ', selSit),
        el('label', {}, 'Responsável: ', fResponsavel.entrada)),
      el('label', {}, fHipotese.rotulo), fHipotese.entrada,
      el('label', {}, fFonte.rotulo), fFonte.entrada,
      el('label', {}, fMedidas.rotulo), fMedidas.entrada,
      el('label', {}, fConclusao.rotulo), fConclusao.entrada);

    const gravar = async () => {
      try {
        msg.className = 'texto-suave';
        msg.textContent = 'Gravando…';
        const salvo = await salvarInvestigacao({
          ID_Surto: inv.ID_Surto, Setor: suspeita.Setor, Microrganismo: suspeita.Microrganismo,
          DataInicio: suspeita.Inicio, DataFim: suspeita.Fim, PacientesEnvolvidos: String(suspeita.Pacientes),
          Situacao: selSit.value, Hipotese: fHipotese.entrada.value.trim(),
          FonteProvavel: fFonte.entrada.value.trim(), MedidasAdotadas: fMedidas.entrada.value.trim(),
          Conclusao: fConclusao.entrada.value.trim(), Responsavel: fResponsavel.entrada.value.trim()
        });
        app.avisoSurtos = `Investigação ${salvo.ID_Surto} gravada (${salvo.Situacao}).`;
        navegar('surtos');
      } catch (e) { msg.className = 'aviso-erro-texto'; msg.textContent = e.message; }
    };

    /* Anexos: ficam ao lado do banco, na subpasta do surto. */
    const entradaArquivo = el('input', { type: 'file', multiple: '', style: 'display:none' });
    const descricaoArquivo = el('input', { type: 'text', placeholder: 'descrição do documento (opcional)' });
    entradaArquivo.addEventListener('change', async () => {
      const arquivos = [...entradaArquivo.files];
      if (!arquivos.length) return;
      try {
        msg.className = 'texto-suave';
        msg.textContent = 'Anexando…';
        let id = inv.ID_Surto;
        if (!id) {
          const salvo = await salvarInvestigacao({
            Setor: suspeita.Setor, Microrganismo: suspeita.Microrganismo,
            DataInicio: suspeita.Inicio, DataFim: suspeita.Fim,
            PacientesEnvolvidos: String(suspeita.Pacientes), Situacao: selSit.value
          });
          id = salvo.ID_Surto;
        }
        for (const arquivo of arquivos) await anexarDocumento(id, arquivo, descricaoArquivo.value.trim());
        app.avisoSurtos = `${fmtInt(arquivos.length)} documento(s) anexado(s) ao surto ${id}.`;
        navegar('surtos');
      } catch (e) { msg.className = 'aviso-erro-texto'; msg.textContent = e.message; }
    });

    const docs = inv.ID_Surto ? documentos.filter(d => d.ID_Surto === inv.ID_Surto) : [];
    cartao.append(
      el('h3', {}, `Documentos do surto (${fmtInt(docs.length)})`),
      docs.length ? el('ul', { style: 'margin:4px 0 8px 18px' },
        docs.map(d => el('li', {}, `${d.Arquivo}${d.Descricao ? ' — ' + d.Descricao : ''} `,
          el('span', { class: 'texto-suave' }, `(${d.CriadoPor}, ${d.CriadoEm})`))))
        : el('p', { class: 'texto-suave' }, 'Nenhum documento anexado.'),
      el('p', { class: 'texto-suave' }, 'Os arquivos são copiados para a subpasta "surtos/<código>" da pasta de dados.'),
      el('div', { class: 'linha-campos' }, descricaoArquivo,
        el('button', { class: 'botao-secundario', onclick: e => { e.stopPropagation(); entradaArquivo.click(); } }, 'Anexar documentos'),
        entradaArquivo),
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-primario', onclick: e => { e.stopPropagation(); gravar(); } }, 'Salvar investigação')),
      msg);

    detalharNaLinha(tr, cartao);
  }

  if (app.avisoSurtos) {
    conteudo.append(el('div', { class: 'cartao aviso-sucesso' }, app.avisoSurtos));
    app.avisoSurtos = null;
  }
  listar();

  /* Vindo do botão "investigar" do painel, já abre a suspeita escolhida. */
  if (app.surtoParaAbrir) {
    const alvo = itens.find(i => normalizarTexto(i.suspeita.Setor) === normalizarTexto(app.surtoParaAbrir.Setor)
      && normalizarTexto(i.suspeita.Microrganismo) === normalizarTexto(app.surtoParaAbrir.Microrganismo));
    app.surtoParaAbrir = null;
    if (alvo) {
      const linhas = [...area.querySelectorAll('tbody tr')];
      const indice = itens.filter(i => !selSituacao.value).indexOf(alvo);
      if (linhas[indice]) linhas[indice].click();
    }
  }
}
