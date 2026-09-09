/* Aba Importar: assistente de importação de relatórios externos em 5 passos. */

const PASSOS = ['Arquivo', 'Mapeamento', 'Validação', 'Prévia', 'Conclusão'];
let imp = null;

function montarImportar(conteudo) {
  imp = { passo: 0 };
  conteudo.append(el('h1', {}, 'Importar relatório'));
  imp.barra = el('div', { class: 'passos' });
  imp.area = el('div', {});
  conteudo.append(imp.barra, imp.area);
  irParaPasso(0);
}

function irParaPasso(n) {
  imp.passo = n;
  imp.barra.replaceChildren(...PASSOS.map((p, i) => el('div', {
    class: 'passo' + (i === n ? ' passo-atual' : i < n ? ' passo-feito' : '')
  }, `${i + 1}. ${p}`)));
  imp.area.replaceChildren();
  [renderPasso1, renderPasso2, renderPasso3, renderPasso4, renderPasso5][n]();
}

/* ---- Passo 1: arquivo, cabeçalho e reconhecimento ---- */

function renderPasso1() {
  const entrada = el('input', { type: 'file', accept: '.xlsx,.xls,.csv,.txt,.dbf,.pdf', style: 'display:none' });
  entrada.addEventListener('change', () => { if (entrada.files[0]) processarArquivo(entrada.files[0], 'auto'); });
  const zona = el('div', { class: 'zona-arquivo', onclick: () => entrada.click() },
    el('strong', {}, 'Clique para escolher o relatório'),
    el('p', { class: 'texto-suave' }, 'ou arraste o arquivo até aqui — aceita .xlsx, .xls, .csv, .dbf e .pdf'),
    entrada);
  zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('zona-ativa'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('zona-ativa'));
  zona.addEventListener('drop', e => {
    e.preventDefault(); zona.classList.remove('zona-ativa');
    if (e.dataTransfer.files[0]) processarArquivo(e.dataTransfer.files[0], 'auto');
  });
  imp.area.append(zona);
  imp.area.append(el('div', { class: 'linha-botoes' },
    el('button', { class: 'botao-secundario', onclick: importarLote }, 'Importar pasta inteira (lote)'),
    el('span', { class: 'texto-suave' }, 'para os anexos diários do laboratório: cada arquivo com perfil salvo entra sozinho')));
  imp.detalhes = el('div', {});
  imp.area.append(imp.detalhes);
  if (imp.arquivo) renderDetalhesArquivo();
}

/* ---- Importação em lote: varre uma pasta e importa tudo que tem perfil salvo ---- */

async function importarLote() {
  let dir;
  try { dir = await window.showDirectoryPicker(); } catch (e) { return; }
  imp.detalhes.replaceChildren(el('div', { class: 'cartao' }, el('h2', {}, 'Importando pasta…')));
  const resultados = [];
  for await (const entrada of dir.values()) {
    if (entrada.kind !== 'file' || !/\.(xlsx|xls|csv|txt|dbf|pdf)$/i.test(entrada.name)) continue;
    try {
      resultados.push(await importarArquivoAutomatico(await entrada.getFile()));
    } catch (e) {
      resultados.push({ nome: entrada.name, situacao: 'erro: ' + e.message });
    }
  }
  imp.detalhes.replaceChildren(el('div', { class: 'cartao' },
    el('h2', {}, 'Importação em lote concluída'),
    resultados.length ? el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Arquivo', 'Resultado'].map(c => el('th', {}, c)))),
      el('tbody', {}, resultados.map(r => el('tr', {},
        el('td', {}, r.nome), el('td', {}, r.situacao)))))
      : el('p', { class: 'texto-suave' }, 'Nenhum arquivo compatível na pasta.'),
    el('p', { class: 'texto-suave' }, 'Arquivos "sem perfil" precisam ser importados manualmente uma vez — nas próximas o lote os reconhece.')));
}

async function importarArquivoAutomatico(arquivo) {
  const buffer = new Uint8Array(await arquivo.arrayBuffer());
  let bruto, linhaCab;
  /* Pacote de miniapp entra direto, sem perfil de importação: o cabeçalho ##ccih-miniapp
     já diz de que miniapp veio e quais abas traz. Sem isto o lote respondia
     "sem perfil" para os arquivos vindos do celular. */
  if (/\.(csv|txt)$/i.test(arquivo.name)) {
    const pacote = analisarPacoteCSV(decodificarTexto(buffer, 'auto').texto);
    if (pacote) {
      const resumo = await ingerirMiniapp(pacote.tipo, pacote.abas, arquivo, true);
      return { nome: arquivo.name, situacao: resumo || 'pacote do miniapp importado' };
    }
  }
  if (/\.pdf$/i.test(arquivo.name)) {
    const aoa = analisarPDFCulturas(await extrairLinhasPDF(buffer));
    if (!aoa) return { nome: arquivo.name, situacao: 'modelo de PDF não reconhecido' };
    bruto = { linhas: aoa };
    linhaCab = 0;
  } else {
    bruto = lerBruto(buffer, arquivo.name, 'auto');
    const tabelaInvasivos = analisarInvasivos(bruto.linhas);
    if (tabelaInvasivos) { bruto = { linhas: tabelaInvasivos }; linhaCab = 0; }
    else linhaCab = detectarCabecalho(bruto.linhas);
  }
  const cabecalhos = (bruto.linhas[linhaCab] || []).map(String);
  const perfil = config.perfilPorFingerprint(calcularFingerprint(cabecalhos));
  if (!perfil) return { nome: arquivo.name, situacao: 'sem perfil — importe manualmente uma vez' };
  const porNome = {};
  JSON.parse(perfil.MapeamentoJSON || '[]').forEach(m => { porNome[normalizarTexto(m.cabecalho)] = m.destino; });
  const mapeamento = cabecalhos.map((cab, i) => ({ coluna: i, cabecalho: cab, destino: porNome[normalizarTexto(cab)] || '' }));
  const tipo = perfil.Tipo;
  const definicao = TIPOS_RELATORIO[tipo];
  const { registros } = normalizarLinhas(bruto.linhas, linhaCab, mapeamento, tipo, config.aliases);
  const validacao = validar(registros, tipo, config.vocabulario);
  const linhasComErro = new Set(validacao.erros.map(e => e.linha));
  let validos = registros.filter(r => !linhasComErro.has(r._linha));
  let naoCirurgias = 0;
  if (tipo === 'cirurgias') {
    const antes = validos.length;
    validos = validos.filter(r => r.Procedimento !== NAO_CIRURGIA);
    naoCirurgias = antes - validos.length;
  }
  Object.entries(validacao.termosNovos).forEach(([vocab, termos]) =>
    termos.forEach(t => config.acrescentarVocabulario(vocab, t)));
  const agora = new Date().toISOString().slice(0, 16).replace('T', ' ');

  let semIdentificacao = 0;
  if (tipo === 'cirurgias' || tipo === 'dispositivos') {
    const bancoPac = await lerBanco('pacientes');
    if (tipo === 'cirurgias') {
      resolverProntuarioPorAtendimento(validos, bancoPac.internacoes || []);
      resolverProntuarioPorNome(validos, bancoPac.pacientes || []);
      for (const r of validos) {
        if (!String(r.Prontuario || '').trim()) {
          const atendimento = String(r.Atendimento || '').replace(/\D/g, '');
          if (atendimento) r.Prontuario = 'AT-' + atendimento;
        }
      }
      const antes = validos.length;
      validos = validos.filter(r => String(r.Prontuario || '').trim());
      semIdentificacao = antes - validos.length;
    } else {
      resolverProntuarioPorNome(validos, bancoPac.pacientes || []);
    }
  }
  return await comTrava([definicao.destino, 'pacientes'], async () => {
    const banco = await lerBanco(definicao.destino);
    if (definicao.modo === 'atualizar_internacoes') {
      const resultado = aplicarAltas(banco.internacoes || [], validos);
      if (resultado.atualizadas) await gravarBanco('pacientes', banco);
      await config.salvar();
      await arquivarOriginal(arquivo);
      return { nome: arquivo.name, situacao: `${definicao.rotulo}: ${fmtInt(resultado.atualizadas)} atualizadas, ${fmtInt(resultado.semCorrespondencia)} sem correspondência, ${fmtInt(resultado.semMudanca)} já em dia` };
    }
    let reparadasAntigas = 0;
    if (tipo === 'cirurgias') {
      const bancoPacReparo = await lerBanco('pacientes');
      const reparo = repararCirurgiasSemIdentificacao(banco.cirurgias, bancoPacReparo.internacoes || []);
      if (reparo.reparadas || reparo.removidas) {
        banco.cirurgias = reparo.cirurgias;
        reparadasAntigas = reparo.reparadas + reparo.removidas;
      }
    }
    const existentes = banco[definicao.abaDestino] || [];
    const { novos } = deduplicar(validos, existentes, tipo);
    let internacoesAtualizadas = 0;
    if (tipo === 'internacoes') {
      internacoesAtualizadas = atualizarInternacoesExistentes(existentes, validos);
    }
    const gerarID = proximoID(existentes, definicao.campoID, definicao.prefixoID);
    const tempoCorte = config.tempoCortePorProcedimento();
    const linhasSensibilidade = [];
    const linhasAvaliacao = [];
    for (const registro of novos) {
      const id = gerarID();
      const linha = montarLinhaImportada(registro, tipo, id, app.usuario, agora, tempoCorte);
      existentes.push(linha);
      for (const item of registro._antibiograma || []) {
        linhasSensibilidade.push({ ID_Cultura: id, Antibiotico: item.Antibiotico, Resultado: item.Resultado });
      }
      /* Relatório que traz prescrição e parecer na mesma linha alimenta as duas abas. */
      if (tipo === 'antibioticos') {
        const avaliacao = avaliacaoDaPrescricao(registro, id, agora);
        if (avaliacao) linhasAvaliacao.push(avaliacao);
      }
    }
    banco[definicao.abaDestino] = existentes;
    if (definicao.permiteAntibiograma) banco.sensibilidade = (banco.sensibilidade || []).concat(linhasSensibilidade);
    if (linhasAvaliacao.length) banco.avaliacoes = (banco.avaliacoes || []).concat(linhasAvaliacao);
    if (novos.length || internacoesAtualizadas || reparadasAntigas) await gravarBanco(definicao.destino, banco);

    const bancoPacientes = await lerBanco('pacientes');
    const porProntuario = new Map(bancoPacientes.pacientes.map(p => [normalizarProntuario(p.Prontuario), p]));
    let mudouPacientes = false;
    for (const registro of validos) {
      const prontuario = normalizarProntuario(registro.Prontuario);
      if (!prontuario) continue;
      const existente = porProntuario.get(prontuario);
      if (!existente) {
        const paciente = { Prontuario: prontuario, Nome: registro.NomePaciente || '', DataNascimento: registro.DataNascimento || '', Sexo: registro.Sexo || '', Telefone: registro.Telefone || '', CriadoPor: app.usuario, CriadoEm: agora };
        bancoPacientes.pacientes.push(paciente);
        porProntuario.set(prontuario, paciente);
        mudouPacientes = true;
      } else {
        if (!existente.Nome && registro.NomePaciente) { existente.Nome = registro.NomePaciente; mudouPacientes = true; }
        if (!existente.Telefone && registro.Telefone) { existente.Telefone = registro.Telefone; mudouPacientes = true; }
        if (!existente.Sexo && registro.Sexo) { existente.Sexo = registro.Sexo; mudouPacientes = true; }
        if (!existente.DataNascimento && registro.DataNascimento) { existente.DataNascimento = registro.DataNascimento; mudouPacientes = true; }
      }
    }
    if (mudouPacientes) await gravarBanco('pacientes', bancoPacientes);
    const casaveis = mudouPacientes ? novasUnificacoesPossiveis(bancoPacientes) : 0;
    await config.salvar();
    await arquivarOriginal(arquivo);
    return {
      nome: arquivo.name,
      casaveis,
      situacao: `${definicao.rotulo}: ${fmtInt(novos.length)} novos, ${fmtInt(validos.length - novos.length)} duplicados, ${fmtInt(linhasComErro.size)} linhas com erro`
        + (internacoesAtualizadas ? `, ${fmtInt(internacoesAtualizadas)} internações atualizadas` : '')
        + (naoCirurgias ? `, ${fmtInt(naoCirurgias)} não-cirurgias excluídas` : '')
        + (semIdentificacao ? `, ${fmtInt(semIdentificacao)} sem identificação excluídas` : '')
        + (reparadasAntigas ? `, ${fmtInt(reparadasAntigas)} registros antigos reparados` : '')
        + (casaveis ? `, ${fmtInt(casaveis)} registros do laboratório passíveis de unificação` : '')
    };
  });
}

/* Depois de qualquer importação que mexa no cadastro de pacientes, confere se os
   pseudo-registros do laboratório (que não têm prontuário, só nascimento+iniciais) passaram
   a ter um paciente real com o mesmo nome. É o caso típico do relatório de internações que
   chega dias depois da cultura — sem esta conferência, o órfão só apareceria se alguém
   abrisse a aba Pacientes por acaso. */
function novasUnificacoesPossiveis(bancoPacientes) {
  try { return sugerirUnificacoes(bancoPacientes.pacientes || []).length; }
  catch (e) { return 0; }
}

function avisoDeUnificacoes(quantas) {
  if (!quantas) return null;
  return el('div', { class: 'aviso-alerta' },
    el('strong', {}, `${fmtInt(quantas)} registro(s) do laboratório agora casam com um paciente real.`),
    el('p', { class: 'texto-suave' }, 'São culturas que chegaram antes do relatório de internações e ficaram '
      + 'com registro provisório (nascimento + iniciais). Unificar junta tudo no prontuário verdadeiro.'),
    el('button', { class: 'botao-secundario', onclick: () => navegar('pacientes') }, 'Revisar na aba Pacientes'));
}

async function processarArquivo(arquivo, codificacao, opcoesAba) {
  try {
    /* Arquivo diferente zera a escolha de aba — senão a aba do anterior valeria para o
       próximo, escolhendo dado errado sem avisar. */
    if (imp.arquivo !== arquivo) imp.opcoesAba = null;
    imp.arquivo = arquivo;
    imp.buffer = new Uint8Array(await arquivo.arrayBuffer());
    if (/\.xlsx?$/i.test(arquivo.name)) {
      const wbCompleto = XLSX.read(imp.buffer, { type: 'array', bookSheets: true });
      if (wbCompleto.SheetNames.includes('_miniapp')) {
        const wb = XLSX.read(imp.buffer, { type: 'array' });
        const meta = XLSX.utils.sheet_to_json(wb.Sheets['_miniapp'])[0] || {};
        const dados = {};
        wb.SheetNames.filter(n => n !== '_miniapp').forEach(n => {
          dados[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { raw: false, defval: '' });
        });
        await ingerirMiniapp(meta.Tipo, dados, arquivo);
        return;
      }
    }
    if (/\.pdf$/i.test(arquivo.name)) {
      const aoa = analisarPDFCulturas(await extrairLinhasPDF(imp.buffer));
      if (!aoa) throw new Error('Modelo de PDF não reconhecido — me envie um exemplar para eu criar o leitor.');
      imp.bruto = { linhas: aoa, nomeArquivo: arquivo.name, formato: 'pdf', codificacao: '—', totalLinhas: aoa.length };
      imp.linhaCabecalho = 0;
      aoMudarCabecalho();
      renderDetalhesArquivo();
      return;
    }
    if (/\.(csv|txt)$/i.test(arquivo.name)) {
      const pacote = analisarPacoteCSV(decodificarTexto(imp.buffer, 'auto').texto);
      if (pacote) { await ingerirMiniapp(pacote.tipo, pacote.abas, arquivo); return; }
    }
    /* Planilha de controle da CCIH costuma ter uma aba por mês: a escolha de aba (ou de
       juntar todas) fica guardada em imp.opcoesAba para sobreviver à troca de codificação
       e ao redesenho da tela. */
    imp.opcoesAba = opcoesAba || imp.opcoesAba || {};
    imp.bruto = lerBruto(imp.buffer, arquivo.name, codificacao, imp.opcoesAba);
    const tabelaInvasivos = analisarInvasivos(imp.bruto.linhas);
    if (tabelaInvasivos) {
      imp.bruto = { ...imp.bruto, linhas: tabelaInvasivos, totalLinhas: tabelaInvasivos.length };
      imp.linhaCabecalho = 0;
    } else {
      imp.linhaCabecalho = detectarCabecalho(imp.bruto.linhas);
    }
    aoMudarCabecalho();
    renderDetalhesArquivo();
  } catch (e) {
    imp.detalhes.replaceChildren(el('div', { class: 'cartao aviso-erro' }, 'Não foi possível ler o arquivo: ' + e.message));
  }
}

/* Pacote CSV dos miniapps: primeira linha ##ccih-miniapp;tipo=...;versao=...,
   seções ##nome_da_aba com tabela CSV dentro. */
function analisarPacoteCSV(texto) {
  const linhas = String(texto).replace(/^\uFEFF/, '').split(/\r?\n/);
  if (!linhas[0] || !linhas[0].startsWith('##ccih-miniapp')) return null;
  const meta = {};
  linhas[0].split(';').slice(1).forEach(par => {
    const [chave, valor] = par.split('=');
    if (chave) meta[chave.trim()] = (valor || '').trim();
  });
  const abas = {};
  let atual = null, buffer = [];
  const fechar = () => {
    if (atual === null) return;
    const conteudo = buffer.join('\n').trim();
    if (conteudo) {
      const wb = XLSX.read(conteudo, { type: 'string', raw: true });
      abas[atual] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: '' });
    } else abas[atual] = [];
  };
  for (let i = 1; i < linhas.length; i++) {
    if (linhas[i].startsWith('##')) { fechar(); atual = linhas[i].slice(2).trim(); buffer = []; }
    else if (atual !== null) buffer.push(linhas[i]);
  }
  fechar();
  return { tipo: meta.tipo, abas };
}

/* Ingestão direta: arquivos gerados pelos miniapps entram sem assistente. */
async function ingerirMiniapp(tipo, dadosPorAba, arquivo, silencioso) {
  const agora = new Date().toISOString().slice(0, 16).replace('T', ' ');
  let resumo;
  if (tipo === 'uti') {
    const linhas = dadosPorAba.visitas || [];
    const avaliacoes = (dadosPorAba.avaliacoes_atb || []).filter(a => a.Antibiotico);
    resumo = await comTrava(['uti', 'iras', 'antibioticos'], async () => {
      const banco = await lerBanco('uti');
      /* A visita é identificada por paciente e dia, não pelo leito: dois pacientes no
         mesmo leito no mesmo dia (troca de leito, ou leito digitado errado) faziam um
         sobrescrever o outro em silêncio, e o paciente sumia do banco. Por paciente-dia,
         reexportar o mesmo dia continua atualizando, que é o comportamento desejado. */
      const chaveDe = v => {
        const pront = normalizarProntuario(v.Prontuario);
        return pront
          ? [normalizarTexto(v.Data), pront].join('|')
          : [normalizarTexto(v.Data), 'leito', normalizarTexto(v.Leito), normalizarTexto(v.Nome || v.Paciente)].join('|');
      };
      const porChave = new Map(banco.visitas.map(v => [chaveDe(v), v]));
      const gerarID = proximoID(banco.visitas, 'ID_Visita', 'VIS');
      let novos = 0, atualizados = 0, semIdentificacao = 0;
      const chavesArquivo = new Set();
      for (const l of linhas) {
        if (!l.Data || !l.Leito) continue;
        /* Sem prontuário, a chave paciente-dia degeneraria em "dia|" e dois pacientes
           diferentes colapsariam num só. O leito+nome desempata; e fica contado para o
           resumo avisar que há visitas sem identificação. */
        if (!normalizarProntuario(l.Prontuario)) semIdentificacao++;
        const chave = chaveDe(l);
        chavesArquivo.add(chave);
        const dados = { ...l, Prontuario: normalizarProntuario(l.Prontuario), CriadoEm: l.CriadoEm || agora };
        delete dados.ID_Visita;
        const existente = porChave.get(chave);
        if (existente) { Object.assign(existente, dados); atualizados++; }
        else {
          const nova = { ID_Visita: gerarID(), ...dados };
          banco.visitas.push(nova);
          porChave.set(chave, nova);
          novos++;
        }
      }
      /* Suspeita de IRAS marcada na visita vira caso aberto para a CCIH confirmar —
         era a regra do projeto e este caminho ainda não a cumpria. Dedup contra as
         suspeitas já abertas do mesmo paciente+foco. */
      const comSuspeita = linhas.filter(l => l.SuspeitaIRAS === 'S' && String(l.FocoSuspeito || '').trim());
      if (comSuspeita.length) {
        const bancoIras = await lerBanco('iras');
        const abertas = new Set(bancoIras.casos
          .filter(cs => cs.StatusInvestigacao === 'em investigação')
          .map(cs => normalizarProntuario(cs.Prontuario) + '|' + normalizarTexto(cs.Topografia)));
        let novasSuspeitas = 0;
        for (const l of comSuspeita) {
          const chave = normalizarProntuario(l.Prontuario) + '|' + normalizarTexto(l.FocoSuspeito);
          if (abertas.has(chave)) continue;
          abertas.add(chave);
          bancoIras.casos.push({
            ID_IRAS: proximoID(bancoIras.casos, 'ID_IRAS', 'IRA')(),
            Prontuario: normalizarProntuario(l.Prontuario), DataInfeccao: String(l.Data).slice(0, 10),
            Topografia: l.FocoSuspeito, CriterioDiagnostico: 'Suspeita na visita técnica da UTI',
            Setor: l.Setor || '', DispositivoAssociado: '', Microrganismo: '', Desfecho: '',
            StatusInvestigacao: 'em investigação', NotificadoANVISA: '',
            CriadoPor: app.usuario, CriadoEm: agora
          });
          novasSuspeitas++;
        }
        if (novasSuspeitas) await gravarBanco('iras', bancoIras);
      }

      /* Substitui as avaliações apenas dos paciente-dias que o arquivo TRAZ avaliados.
         Antes, qualquer reexportação do dia (mesmo sem a parte de antibióticos preenchida)
         apagava as avaliações guardadas e não punha nada no lugar. */
      const chavesComAvaliacao = new Set(avaliacoes.map(a => chaveDe(a)));
      banco.avaliacoes_atb = (banco.avaliacoes_atb || []).filter(a => !chavesComAvaliacao.has(chaveDe(a)));
      for (const a of avaliacoes) {
        banco.avaliacoes_atb.push({ ...a, Prontuario: normalizarProntuario(a.Prontuario), CriadoEm: a.CriadoEm || agora });
      }
      if (novos || atualizados || avaliacoes.length) await gravarBanco('uti', banco);

      /* A avaliação feita à beira do leito DÁ BAIXA na fila de antibióticos: vira uma
         avaliação no banco de antibióticos, ligada à prescrição do extrato quando ela
         existir. Sem isto, o mesmo antibiótico avaliado na visita reaparecia como
         pendente na aba Antibióticos e na página remota dos médicos. */
      let avaliacoesIntegradas = 0;
      if (avaliacoes.length) {
        const bancoAtb = await lerBanco('antibioticos');
        bancoAtb.avaliacoes = bancoAtb.avaliacoes || [];
        const jaTem = new Set(bancoAtb.avaliacoes.map(a =>
          normalizarProntuario(a.Prontuario) + '|' + normalizarTexto(a.Antibiotico) + '|' + String(a.DataDados).slice(0, 10)));
        for (const a of avaliacoes) {
          const chave = normalizarProntuario(a.Prontuario) + '|' + normalizarTexto(a.Antibiotico) + '|' + String(a.Data).slice(0, 10);
          if (jaTem.has(chave)) continue;
          jaTem.add(chave);
          bancoAtb.avaliacoes.push({
            ID_Prescricao: vincularAvaliacaoAPrescricao(a, bancoAtb.prescricoes || []),
            Prontuario: normalizarProntuario(a.Prontuario), Antibiotico: a.Antibiotico,
            Indicacao: a.Indicacao || '', Avaliacao: a.Avaliacao || '', Recomendacao: a.Recomendacao || '',
            ParecerTexto: 'Avaliado na visita técnica da UTI',
            Avaliador: a.CriadoPor || app.usuario, DataDados: String(a.Data).slice(0, 10), CriadoEm: agora
          });
          avaliacoesIntegradas++;
        }
        if (avaliacoesIntegradas) await gravarBanco('antibioticos', bancoAtb);
      }
      return { rotulo: 'Visita à UTI', novos, ignorados: 0, atualizados, avaliacoesATB: avaliacoes.length,
        avaliacoesIntegradas, semIdentificacao };
    });
  } else if (tipo === 'avaliacao_atb') {
    const linhas = (dadosPorAba.avaliacoes || []).filter(a => a.ID_Prescricao);
    const suspeitas = (dadosPorAba.suspeitas || []).filter(s => s.Prontuario && s.FocoSuspeito);
    const culturasAvaliadas = (dadosPorAba.culturas_avaliadas || []).filter(x => x.ID_Cultura && x.Classificacao);
    const arquivosTrava = ['antibioticos'];
    if (culturasAvaliadas.length) arquivosTrava.push('culturas');
    if (suspeitas.length || culturasAvaliadas.some(x => x.Classificacao === 'IRAS')) arquivosTrava.push('iras');
    resumo = await comTrava(arquivosTrava, async () => {
      const banco = await lerBanco('antibioticos');
      banco.avaliacoes = banco.avaliacoes || [];
      const chaves = new Set(banco.avaliacoes.map(a => [a.ID_Prescricao, a.Avaliador, a.CriadoEm].join('|')));
      const porPrescricao = new Map(banco.prescricoes.map(p => [p.ID_Prescricao, p]));
      let novos = 0;
      for (const l of linhas) {
        const chave = [l.ID_Prescricao, l.Avaliador, l.CriadoEm].join('|');
        if (chaves.has(chave)) continue;
        chaves.add(chave);
        banco.avaliacoes.push({ ...l, Prontuario: normalizarProntuario(l.Prontuario) });
        const prescricao = porPrescricao.get(l.ID_Prescricao);
        if (prescricao) {
          prescricao.ParecerInfecto = `${l.Avaliacao} — ${l.Recomendacao}${l.ParecerTexto ? ' — ' + l.ParecerTexto : ''}`.slice(0, 250);
        }
        novos++;
      }
      if (novos) await gravarBanco('antibioticos', banco);
      let culturasClassificadas = 0, culturasIgnoradas = 0;
      const casosNovos = [];
      if (culturasAvaliadas.length) {
        const bancoCulturas = await lerBanco('culturas');
        const porID = new Map(bancoCulturas.culturas.map(x => [x.ID_Cultura, x]));
        for (const r of culturasAvaliadas) {
          const alvo = porID.get(r.ID_Cultura);
          if (!alvo || alvo.StatusRevisao !== 'pendente') { culturasIgnoradas++; continue; }
          if (r.Classificacao === 'Não é cultura') {
            alvo.StatusRevisao = 'descartada';
            alvo.AvaliacaoCCIH = 'Não é cultura';
            culturasClassificadas++;
            continue;
          }
          alvo.StatusRevisao = 'avaliada';
          alvo.AvaliacaoCCIH = r.Classificacao === 'IRAS' ? `IRAS — ${r.Topografia}` : r.Classificacao;
          if (r.Classificacao === 'IRAS') {
            casosNovos.push({
              Prontuario: normalizarProntuario(r.Prontuario), DataInfeccao: alvo.DataColeta,
              Topografia: r.Topografia, CriterioDiagnostico: 'Classificado na avaliação remota',
              Setor: alvo.Setor, DispositivoAssociado: r.Dispositivo, Microrganismo: alvo.Microrganismo,
              Desfecho: '', StatusInvestigacao: 'em investigação', NotificadoANVISA: '',
              CriadoPor: r.Avaliador || app.usuario, CriadoEm: agora
            });
          }
          culturasClassificadas++;
        }
        if (culturasClassificadas) await gravarBanco('culturas', bancoCulturas);
      }
      let suspeitasNovas = 0;
      if (suspeitas.length || casosNovos.length) {
        const bancoIras = await lerBanco('iras');
        for (const caso of casosNovos) {
          bancoIras.casos.push({ ID_IRAS: proximoID(bancoIras.casos, 'ID_IRAS', 'IRA')(), ...caso });
        }
        const abertas = new Set(bancoIras.casos
          .filter(cs => cs.StatusInvestigacao === 'em investigação')
          .map(cs => normalizarProntuario(cs.Prontuario) + '|' + normalizarTexto(cs.Topografia)));
        for (const s of suspeitas) {
          const chave = normalizarProntuario(s.Prontuario) + '|' + normalizarTexto(s.FocoSuspeito);
          if (abertas.has(chave)) continue;
          abertas.add(chave);
          bancoIras.casos.push({
            ID_IRAS: proximoID(bancoIras.casos, 'ID_IRAS', 'IRA')(),
            Prontuario: normalizarProntuario(s.Prontuario),
            DataInfeccao: String(s.DataDados || '').slice(0, 10), Topografia: s.FocoSuspeito,
            CriterioDiagnostico: 'Suspeita notificada na avaliação remota de antimicrobianos',
            Setor: '', DispositivoAssociado: '', Microrganismo: '', Desfecho: '',
            StatusInvestigacao: 'em investigação', NotificadoANVISA: '',
            CriadoPor: s.Avaliador || app.usuario, CriadoEm: agora
          });
          suspeitasNovas++;
        }
        if (suspeitasNovas || casosNovos.length) await gravarBanco('iras', bancoIras);
      }
      return { rotulo: 'Avaliação remota', novos, ignorados: linhas.length - novos, suspeitas: suspeitasNovas, culturas: culturasClassificadas, culturasIgnoradas };
    });
  } else if (tipo === 'decisao_atb') {
    /* Decisões empíricas dos médicos assistentes (miniapp). Só entram registros com
       síndrome — o resto é linha inútil. A adesão ao protocolo é calculada aqui, uma vez,
       para não depender de comparar texto livre toda vez que um relatório for gerado. */
    const linhas = (dadosPorAba.decisoes || []).filter(d => String(d.Sindrome || '').trim());
    resumo = await comTrava(['antibioticos'], async () => {
      const banco = await lerBanco('antibioticos');
      banco.decisoes_empiricas = banco.decisoes_empiricas || [];
      const chaveDe = d => [normalizarProntuario(d.Prontuario), d.Data, d.Hora,
        normalizarTexto(d.Sindrome), normalizarTexto(d.CriadoPor)].join('|');
      const existentes = new Set(banco.decisoes_empiricas.map(chaveDe));
      const proximo = proximoID(banco.decisoes_empiricas, 'ID_Decisao', 'DEC');
      let novos = 0, foraDoProtocolo = 0;
      for (const l of linhas) {
        const chave = chaveDe(l);
        if (existentes.has(chave)) continue;
        existentes.add(chave);
        const seguiu = seguiuProtocoloEmpirico(l);
        if (!seguiu) foraDoProtocolo++;
        banco.decisoes_empiricas.push({
          ID_Decisao: proximo(), ...l,
          Prontuario: normalizarProntuario(l.Prontuario),
          SeguiuProtocolo: seguiu ? 'S' : 'N',
          ImportadoPor: app.usuario, ImportadoEm: agora
        });
        novos++;
      }
      if (novos) await gravarBanco('antibioticos', banco);
      return { rotulo: 'Decisões de ATB empírico (miniapp)', novos,
        ignorados: linhas.length - novos, foraDoProtocolo };
    });
  } else if (tipo === 'higiene_maos') {
    const linhas = (dadosPorAba.observacoes || []).filter(o => o.ID_Observacao);
    resumo = await comTrava(['higiene_maos'], async () => {
      const banco = await lerBanco('higiene_maos');
      const chaves = new Set(banco.observacoes.map(o => o.ID_Observacao));
      let novos = 0;
      for (const l of linhas) {
        if (!l.ID_Observacao || chaves.has(l.ID_Observacao)) continue;
        chaves.add(l.ID_Observacao);
        /* O miniapp usa os mesmos nomes de coluna com outro sentido (Acao = insumo,
           TipoHigienizacao = técnica, Momento = número). Sem conciliar aqui, a observação
           entra no banco e some do painel. */
        banco.observacoes.push(normalizarObservacaoHigiene(l));
        novos++;
      }
      if (novos) await gravarBanco('higiene_maos', banco);
      return { rotulo: 'Higiene das mãos', novos, ignorados: linhas.length - novos };
    });
  } else {
    if (silencioso) return `miniapp desconhecido: "${tipo}"`;
    imp.detalhes.replaceChildren(el('div', { class: 'cartao aviso-erro' }, `Miniapp desconhecido: "${tipo}".`));
    return;
  }
  await arquivarOriginal(arquivo);
  const texto = `${resumo.rotulo}: ${fmtInt(resumo.novos)} registros novos`
    + (resumo.semIdentificacao ? `, ⚠ ${fmtInt(resumo.semIdentificacao)} visita(s) sem prontuário (identificadas por leito+nome)` : '')
    + (resumo.atualizados ? `, ${fmtInt(resumo.atualizados)} atualizados (reenvio)` : '')
    + (resumo.ignorados ? `, ${fmtInt(resumo.ignorados)} já existentes ignorados` : '')
    + (resumo.avaliacoesATB ? `, ${fmtInt(resumo.avaliacoesATB)} avaliações de antibiótico` : '')
    + (resumo.avaliacoesIntegradas ? ` (${fmtInt(resumo.avaliacoesIntegradas)} deram baixa na fila de antibióticos)` : '')
    + (resumo.suspeitas ? `, ${fmtInt(resumo.suspeitas)} suspeitas de IRAS abertas para investigação` : '')
    + (resumo.culturas ? `, ${fmtInt(resumo.culturas)} culturas classificadas` : '')
    + (resumo.culturasIgnoradas ? `, ${fmtInt(resumo.culturasIgnoradas)} culturas já revisadas ignoradas` : '')
    + (resumo.foraDoProtocolo ? `, ${fmtInt(resumo.foraDoProtocolo)} com conduta diferente da sugerida` : '')
    + '. Original arquivado.';
  if (!silencioso) {
    imp.detalhes.replaceChildren(el('div', { class: 'cartao' },
      el('h2', {}, 'Planilha de miniapp reconhecida — ingestão direta'),
      el('div', { class: 'aviso-sucesso' }, texto),
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-primario', onclick: () => navegar('importar') }, 'Importar outro arquivo'))));
  }
  return texto;
}

function aoMudarCabecalho() {
  imp.cabecalhos = (imp.bruto.linhas[imp.linhaCabecalho] || []).map(c => String(c).trim());
  imp.fingerprint = calcularFingerprint(imp.cabecalhos);
  imp.perfilExistente = config.perfilPorFingerprint(imp.fingerprint);
}

function renderDetalhesArquivo() {
  const b = imp.bruto;
  const seletorCodificacao = el('select', {}, ['auto', 'utf-8', 'windows-1252', 'cp850'].map(c =>
    el('option', { value: c, selected: (b.codificacao || '').startsWith(c) ? '' : null }, c)));
  seletorCodificacao.addEventListener('change', () => processarArquivo(imp.arquivo, seletorCodificacao.value));

  /* Seletor de aba: só aparece quando o arquivo tem mais de uma. "Todas as abas" junta as
     que têm o mesmo cabeçalho — o caso das planilhas com uma aba por mês. */
  let controleAba = null;
  if ((b.abas || []).length > 1) {
    const atual = imp.opcoesAba || {};
    const sel = el('select', {},
      el('option', { value: '@todas', selected: atual.todasAsAbas ? '' : null },
        `todas as abas (${b.abas.length})`),
      b.abas.map(nome => el('option', { value: nome, selected: (!atual.todasAsAbas && b.abaLida === nome) ? '' : null }, nome)));
    sel.addEventListener('change', () => processarArquivo(imp.arquivo, seletorCodificacao.value,
      sel.value === '@todas' ? { todasAsAbas: true } : { aba: sel.value }));
    const nota = b.abasLidas
      ? el('span', { class: 'texto-suave' },
          ` ${b.abasLidas.length} aba(s) com dados: ${b.abasLidas.join(', ')}`
          + ((b.abasIgnoradas || []).length ? ` · ⚠ fora por cabeçalho diferente: ${b.abasIgnoradas.join(', ')}` : ''))
      : null;
    controleAba = el('label', {}, 'Aba: ', sel, nota);
  }

  const opcoesLinha = [];
  for (let i = 0; i < Math.min(b.linhas.length, 20); i++) {
    const previa = (b.linhas[i] || []).slice(0, 4).map(c => String(c).trim()).filter(Boolean).join(' | ') || '(vazia)';
    opcoesLinha.push(el('option', { value: i, selected: i === imp.linhaCabecalho ? '' : null },
      `linha ${i + 1}: ${previa.slice(0, 60)}`));
  }
  const seletorLinha = el('select', {}, opcoesLinha);
  seletorLinha.addEventListener('change', () => {
    imp.linhaCabecalho = Number(seletorLinha.value);
    aoMudarCabecalho();
    renderDetalhesArquivo();
  });

  const inicio = Math.max(0, imp.linhaCabecalho - 1);
  const linhasPrevia = b.linhas.slice(inicio, inicio + 6);
  const tabela = el('table', { class: 'tabela tabela-previa' },
    el('tbody', {}, linhasPrevia.map((linha, i) => el('tr',
      { class: inicio + i === imp.linhaCabecalho ? 'linha-cabecalho' : '' },
      el('td', { class: 'texto-suave' }, String(inicio + i + 1)),
      (linha || []).slice(0, 10).map(c => el('td', {}, String(c).slice(0, 25)))))));

  let reconhecimento;
  if (imp.perfilExistente) {
    const p = imp.perfilExistente;
    reconhecimento = el('div', { class: 'aviso-sucesso' },
      el('strong', {}, `Relatório reconhecido: ${p.Nome}`),
      el('span', {}, ` (${(TIPOS_RELATORIO[p.Tipo] || {}).rotulo || p.Tipo}) — mapeamento automático.`),
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-primario', onclick: () => aplicarPerfil(p) }, 'Usar perfil e continuar'),
        el('button', { class: 'botao-secundario', onclick: () => { prepararMapeamento(p.Tipo); irParaPasso(1); } }, 'Revisar mapeamento')));
  } else {
    const seletorTipo = el('select', {},
      el('option', { value: '' }, '— escolha o tipo de relatório —'),
      Object.entries(TIPOS_RELATORIO).map(([id, t]) => el('option', { value: id }, t.rotulo)));
    reconhecimento = el('div', { class: 'aviso-alerta' },
      el('strong', {}, 'Relatório novo — primeiro mapeamento.'),
      el('div', { class: 'linha-campos' }, seletorTipo,
        el('button', { class: 'botao-primario', onclick: () => {
          if (!seletorTipo.value) return;
          prepararMapeamento(seletorTipo.value);
          irParaPasso(1);
        } }, 'Continuar para o mapeamento')));
  }

  imp.detalhes.replaceChildren(el('div', { class: 'cartao' },
    el('h2', {}, b.nomeArquivo),
    el('p', { class: 'texto-suave' }, `Formato .${b.formato} · ${fmtInt(b.totalLinhas)} linhas · codificação ${b.codificacao}`),
    el('div', { class: 'linha-campos' },
      el('label', {}, 'Linha do cabeçalho: ', seletorLinha),
      el('label', {}, 'Codificação: ', seletorCodificacao)),
    controleAba ? el('div', { class: 'linha-campos' }, controleAba) : null,
    tabela, reconhecimento));
}

function prepararMapeamento(tipo) {
  imp.tipo = tipo;
  const dados = imp.bruto.linhas.slice(imp.linhaCabecalho + 1, imp.linhaCabecalho + 40);
  imp.mapeamento = sugerirMapeamento(imp.cabecalhos, dados, tipo);
  imp.nomePerfil = imp.arquivo.name.replace(/\.[^.]+$/, '');
}

function aplicarPerfil(perfil) {
  imp.tipo = perfil.Tipo;
  imp.nomePerfil = perfil.Nome;
  const salvo = JSON.parse(perfil.MapeamentoJSON || '[]');
  const porNome = {};
  salvo.forEach(m => { porNome[normalizarTexto(m.cabecalho)] = m.destino; });
  imp.mapeamento = imp.cabecalhos.map((cab, i) => ({
    coluna: i, cabecalho: cab, destino: porNome[normalizarTexto(cab)] || ''
  }));
  irParaPasso(2);
}

/* ---- Passo 2: mapeamento coluna → campo ---- */

function renderPasso2() {
  const definicao = TIPOS_RELATORIO[imp.tipo];
  const dados = imp.bruto.linhas.slice(imp.linhaCabecalho + 1);
  const aviso = el('p', { class: 'aviso-erro-texto', style: 'display:none' });

  const seletores = [];
  const linhasTabela = imp.mapeamento.map(m => {
    const amostra = dados.map(l => l[m.coluna]).filter(v => String(v).trim() !== '').slice(0, 3)
      .map(v => String(v).slice(0, 20)).join(' · ');
    const seletor = el('select', { 'data-coluna': m.coluna },
      el('option', { value: '' }, '— ignorar —'),
      definicao.campos.map(c => el('option', {
        value: c.id, selected: m.destino === c.id ? '' : null
      }, c.rotulo + (c.obrigatorio ? ' *' : ''))),
      definicao.permiteAntibiograma
        ? [el('option', { value: '@antibiograma', selected: m.destino === '@antibiograma' ? '' : null },
            'Antibiograma (cabeçalho = antibiótico)'),
           el('option', { value: '@antibiograma_texto', selected: m.destino === '@antibiograma_texto' ? '' : null },
            'Antibiograma completo num campo só')]
        : null);
    seletor.addEventListener('change', () => {
      const valor = seletor.value;
      if (valor && !valor.startsWith('@')) {
        seletores.forEach(s => { if (s !== seletor && s.value === valor) s.value = ''; });
      }
      m.destino = valor;
      imp.mapeamento.forEach(mm => {
        const s = seletores.find(x => Number(x.dataset.coluna) === mm.coluna);
        if (s) mm.destino = s.value;
      });
    });
    seletores.push(seletor);
    return el('tr', {},
      el('td', { class: 'texto-suave' }, String(m.coluna + 1)),
      el('td', {}, el('strong', {}, m.cabecalho || '(sem título)')),
      el('td', { class: 'texto-suave' }, amostra),
      el('td', {}, seletor));
  });

  const campoNomePerfil = el('input', { type: 'text', value: imp.nomePerfil });
  imp.area.append(el('div', { class: 'cartao' },
    el('h2', {}, 'Mapeamento — ' + definicao.rotulo),
    el('p', { class: 'texto-suave' }, 'Diga a que campo do banco corresponde cada coluna do relatório. Campos com * são obrigatórios.'),
    el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['#', 'Coluna do relatório', 'Amostra', 'Campo de destino'].map(c => el('th', {}, c)))),
      el('tbody', {}, linhasTabela)),
    el('label', {}, 'Nome deste perfil de importação: ', campoNomePerfil),
    aviso,
    el('div', { class: 'linha-botoes' },
      el('button', { class: 'botao-secundario', onclick: () => irParaPasso(0) }, 'Voltar'),
      el('button', { class: 'botao-primario', onclick: () => {
        const mapeados = imp.mapeamento.filter(m => m.destino && !m.destino.startsWith('@')).map(m => m.destino);
        const faltando = definicao.campos.filter(c => c.obrigatorio && !mapeados.includes(c.id));
        if (faltando.length) {
          aviso.textContent = 'Faltam campos obrigatórios: ' + faltando.map(c => c.rotulo).join(', ');
          aviso.style.display = '';
          return;
        }
        imp.nomePerfil = campoNomePerfil.value.trim() || imp.nomePerfil;
        irParaPasso(2);
      } }, 'Continuar'))));
}

/* ---- Passo 3: validação e termos novos ---- */

async function renderPasso3() {
  imp.area.append(el('p', { class: 'texto-suave' }, 'Processando…'));
  const resultado = normalizarLinhas(imp.bruto.linhas, imp.linhaCabecalho, imp.mapeamento, imp.tipo, config.aliases);
  imp.normalizado = resultado;
  imp.validacao = validar(resultado.registros, imp.tipo, config.vocabulario);
  try {
    imp.bancoDestino = await lerBanco(TIPOS_RELATORIO[imp.tipo].destino);
    if (imp.tipo === 'cirurgias' || imp.tipo === 'dispositivos') {
      imp.bancoPacientes = await lerBanco('pacientes');
    }
  } catch (e) {
    imp.area.replaceChildren(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco de destino: ' + e.message));
    return;
  }
  imp.area.replaceChildren();

  const v = imp.validacao;
  const linhasComErro = new Set(v.erros.map(e => e.linha));
  imp.area.append(el('div', { class: 'cartao' },
    el('h2', {}, 'Validação'),
    el('p', {}, `${fmtInt(resultado.registros.length)} registros lidos · `
      + `${fmtInt(v.erros.length)} erros em ${fmtInt(linhasComErro.size)} linhas (serão excluídas) · `
      + `${fmtInt(resultado.problemas.length)} avisos`),
    tabelaProblemas('Erros (linhas excluídas da importação)', v.erros.map(e => ({ linha: e.linha, campo: e.campo, valor: '', motivo: e.motivo })), 'aviso-erro-texto'),
    tabelaProblemas('Avisos de normalização', resultado.problemas, 'texto-suave')));

  imp.decisoes = {};
  const vocabsComNovos = Object.keys(v.termosNovos).filter(vc => v.termosNovos[vc].length);
  if (vocabsComNovos.length) {
    const cartaoTermos = el('div', { class: 'cartao' },
      el('h2', {}, 'Termos novos encontrados'),
      el('p', { class: 'texto-suave' }, 'Cadastre como termo novo ou aponte o termo já existente equivalente — o aplicativo memoriza a escolha e nunca mais pergunta.'));
    for (const vocab of vocabsComNovos) {
      imp.decisoes[vocab] = {};
      const secao = el('div', { class: 'secao-termos' }, el('h3', {}, VOCAB_ROTULOS[vocab] || vocab));
      for (const termo of v.termosNovos[vocab]) {
        const chave = normalizarTexto(termo);
        const ehProcedimento = vocab === 'procedimentos_nhsn';
        const sugestao = sugerirEquivalente(termo, config.vocabulario[vocab], vocab);
        const suspeitaNaoCirurgia = ehProcedimento && !sugestao && pareceNaoCirurgia(termo);
        imp.decisoes[vocab][chave] = sugestao ? { acao: 'alias', termo, para: sugestao }
          : suspeitaNaoCirurgia ? { acao: 'excluir', termo }
          : { acao: 'novo', termo };
        const nomeRadio = `termo-${vocab}-${chave}`;
        const radio = marcado => el('input', { type: 'radio', name: nomeRadio, checked: marcado ? '' : null });
        const seletorExistente = el('select', { disabled: sugestao ? null : '' },
          config.vocabulario[vocab].map(t => el('option', { value: t, selected: t === sugestao ? '' : null }, t)));
        const campoNovoNome = ehProcedimento
          ? el('input', { type: 'text', placeholder: 'ex.: Colocação de duplo J', disabled: '' }) : null;
        const radioNovo = radio(!sugestao && !suspeitaNaoCirurgia);
        const radioAlias = radio(!!sugestao);
        const radioExcluir = ehProcedimento ? radio(suspeitaNaoCirurgia) : null;
        const radioRenomear = ehProcedimento ? radio(false) : null;
        const aplicarEscolha = () => {
          seletorExistente.disabled = !radioAlias.checked;
          if (campoNovoNome) campoNovoNome.disabled = !(radioRenomear && radioRenomear.checked);
          if (radioAlias.checked) imp.decisoes[vocab][chave] = { acao: 'alias', termo, para: seletorExistente.value };
          else if (radioExcluir && radioExcluir.checked) imp.decisoes[vocab][chave] = { acao: 'excluir', termo };
          else if (radioRenomear && radioRenomear.checked) imp.decisoes[vocab][chave] = { acao: 'renomear', termo, para: campoNovoNome.value.trim() || termo };
          else imp.decisoes[vocab][chave] = { acao: 'novo', termo };
        };
        [radioNovo, radioAlias, radioExcluir, radioRenomear].filter(Boolean).forEach(r => r.addEventListener('change', aplicarEscolha));
        seletorExistente.addEventListener('change', aplicarEscolha);
        if (campoNovoNome) campoNovoNome.addEventListener('input', aplicarEscolha);
        secao.append(el('div', { class: 'linha-termo' },
          el('strong', {}, termo),
          el('label', {}, radioNovo, ' termo novo'),
          el('label', {}, radioAlias, ' é o mesmo que: ', seletorExistente),
          radioExcluir ? el('label', { class: 'aviso-erro-texto' }, radioExcluir, ' não é cirurgia (excluir)') : null,
          radioRenomear ? el('label', {}, radioRenomear, ' dar nome padrão: ', campoNovoNome) : null));
      }
      cartaoTermos.append(secao);
    }
    imp.area.append(cartaoTermos);
  }

  imp.area.append(el('div', { class: 'linha-botoes' },
    el('button', { class: 'botao-secundario', onclick: () => irParaPasso(1) }, 'Voltar'),
    el('button', { class: 'botao-primario', onclick: () => { aplicarDecisoes(linhasComErro); irParaPasso(3); } }, 'Continuar')));
}

function tabelaProblemas(titulo, itens, classe) {
  if (!itens.length) return el('span', {});
  const mostrados = itens.slice(0, 50);
  return el('details', { class: classe },
    el('summary', {}, `${titulo}: ${fmtInt(itens.length)}`),
    el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Linha', 'Campo', 'Valor', 'Motivo'].map(c => el('th', {}, c)))),
      el('tbody', {}, mostrados.map(p => el('tr', {},
        el('td', {}, String(p.linha)), el('td', {}, p.campo), el('td', {}, p.valor || ''), el('td', {}, p.motivo))))),
    itens.length > 50 ? el('p', { class: 'texto-suave' }, `… e mais ${fmtInt(itens.length - 50)}.`) : null);
}

function aplicarDecisoes(linhasComErro) {
  const definicao = TIPOS_RELATORIO[imp.tipo];
  const aliasPorVocab = {};
  for (const vocab of Object.keys(imp.decisoes)) {
    aliasPorVocab[vocab] = {};
    for (const decisao of Object.values(imp.decisoes[vocab])) {
      if (decisao.acao === 'alias' || decisao.acao === 'renomear') aliasPorVocab[vocab][normalizarTexto(decisao.termo)] = decisao.para;
      else if (decisao.acao === 'excluir') aliasPorVocab[vocab][normalizarTexto(decisao.termo)] = NAO_CIRURGIA;
    }
  }
  const registros = imp.normalizado.registros.filter(r => !linhasComErro.has(r._linha));
  for (const registro of registros) {
    for (const campo of definicao.campos) {
      if (campo.tipo !== 'vocab' || !registro[campo.id]) continue;
      const troca = (aliasPorVocab[campo.vocab] || {})[normalizarTexto(registro[campo.id])];
      if (troca) {
        registro._originais = registro._originais || {};
        if (!registro._originais[campo.id]) registro._originais[campo.id] = registro[campo.id];
        registro[campo.id] = troca;
      }
    }
    for (const item of registro._antibiograma || []) {
      const troca = (aliasPorVocab.antibioticos || {})[normalizarTexto(item.Antibiotico)];
      if (troca) item.Antibiotico = troca;
    }
  }
  imp.excluidasNaoCirurgia = 0;
  imp.excluidasSemIdentificacao = 0;
  let registrosFinais = registros;
  if (imp.tipo === 'cirurgias') {
    registrosFinais = registros.filter(r => {
      if (r.Procedimento === NAO_CIRURGIA) { imp.excluidasNaoCirurgia++; return false; }
      return true;
    });
    if (imp.bancoPacientes) {
      resolverProntuarioPorAtendimento(registrosFinais, imp.bancoPacientes.internacoes || []);
      resolverProntuarioPorNome(registrosFinais, imp.bancoPacientes.pacientes || []);
    }
    imp.identificadasProvisorias = 0;
    for (const r of registrosFinais) {
      if (!String(r.Prontuario || '').trim()) {
        const atendimento = String(r.Atendimento || '').replace(/\D/g, '');
        if (atendimento) { r.Prontuario = 'AT-' + atendimento; imp.identificadasProvisorias++; }
      }
    }
    registrosFinais = registrosFinais.filter(r => {
      if (!String(r.Prontuario || '').trim()) { imp.excluidasSemIdentificacao++; return false; }
      return true;
    });
  }
  const existentes = imp.bancoDestino[definicao.abaDestino] || [];
  imp.dedup = deduplicar(registrosFinais, existentes, imp.tipo);
  imp.excluidosPorErro = linhasComErro.size;
}

/* ---- Passo 4: prévia e confirmação ---- */

async function renderPasso4() {
  const definicao = TIPOS_RELATORIO[imp.tipo];
  const d = imp.dedup;
  const totalAntibiograma = d.novos.reduce((soma, r) => soma + (r._antibiograma || []).length, 0);

  const cartoes = [
    ['Registros novos', d.novos.length],
    ['Já no banco (ignorados)', d.duplicados.length],
    ['Duplicados no próprio arquivo', d.duplicadosInternos.length],
    ['Excluídos por erro', imp.excluidosPorErro]
  ];
  if (definicao.permiteAntibiograma) cartoes.push(['Linhas de antibiograma', totalAntibiograma]);
  if (imp.tipo === 'cirurgias' && imp.excluidasNaoCirurgia) cartoes.push(['Não é cirurgia (excluídas)', imp.excluidasNaoCirurgia]);
  if (imp.tipo === 'cirurgias' && imp.identificadasProvisorias) cartoes.push(['Sem internação — registro provisório pelo nome', imp.identificadasProvisorias]);
  if (imp.tipo === 'cirurgias' && imp.excluidasSemIdentificacao) cartoes.push(['Sem identificação (excluídas)', imp.excluidasSemIdentificacao]);

  const colunas = definicao.chaveNatural.concat(['Setor']).filter((c, i, a) => a.indexOf(c) === i);
  const amostra = d.novos.slice(0, 10);

  const areaTrava = el('div', {});
  const botaoConfirmar = el('button', { class: 'botao-primario', onclick: () => irParaPasso(4) },
    d.novos.length ? 'Confirmar e gravar' : 'Salvar perfil e arquivar (nada novo)');

  imp.area.append(el('div', { class: 'cartao' },
    el('h2', {}, 'Prévia da importação'),
    el('div', { class: 'grade-cartoes' }, cartoes.map(([rotulo, n]) =>
      el('div', { class: 'cartao cartao-numero' },
        el('div', { class: 'numero-grande' }, fmtInt(n)), el('div', { class: 'texto-suave' }, rotulo)))),
    amostra.length ? el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, colunas.map(c => el('th', {}, c)))),
      el('tbody', {}, amostra.map(r => el('tr', {}, colunas.map(c => el('td', {}, String(r[c] || ''))))))) : null,
    amostra.length ? el('p', { class: 'texto-suave' }, 'Amostra dos primeiros registros novos.') : null,
    imp.identificadasProvisorias ? el('p', { class: 'texto-suave' },
      'Cirurgias sem internação correspondente (ambulatoriais ou período não importado) entram com registro provisório AT-<atendimento>, guardando nome e telefone do relatório — a aba Pacientes as lista para unificação quando o prontuário aparecer.') : null,
    areaTrava,
    el('div', { class: 'linha-botoes' },
      el('button', { class: 'botao-secundario', onclick: () => irParaPasso(2) }, 'Voltar'),
      botaoConfirmar)));

  const situacao = await verificarTrava(definicao.destino, app.usuario);
  if (situacao && situacao.ativa) {
    botaoConfirmar.disabled = true;
    areaTrava.replaceChildren(el('div', { class: 'aviso-erro' },
      `Arquivo em edição por ${situacao.trava.usuario} desde ${new Date(situacao.trava.inicio).toLocaleString('pt-BR')}. `,
      el('button', { class: 'botao-secundario', onclick: () => irParaPasso(3) }, 'Verificar novamente')));
  } else if (situacao && situacao.expirada) {
    areaTrava.replaceChildren(el('div', { class: 'aviso-alerta' },
      `Há uma trava antiga de ${situacao.trava.usuario} (inativa há mais de 30 min) — será assumida ao gravar.`));
  }
}

/* ---- Passo 5: gravação ---- */

async function renderPasso5() {
  const definicao = TIPOS_RELATORIO[imp.tipo];
  const lista = el('ul', { class: 'lista-progresso' });
  imp.area.append(el('div', { class: 'cartao' }, el('h2', {}, 'Gravando…'), lista));
  const anotar = texto => { lista.append(el('li', {}, texto)); };
  const agora = new Date().toISOString().slice(0, 16).replace('T', ' ');
  /* A gravação também escreve pacientes.xlsx (cadastro) — precisa das duas travas. E a
     verificação é refeita AQUI, não só na prévia: a pessoa pode ficar minutos parada no
     passo 4, tempo de sobra para outra sessão travar o arquivo. */
  const travas = [...new Set([definicao.destino, 'pacientes'])];
  let travaCriada = false;

  try {
    for (const t of travas) {
      const situacao = await verificarTrava(t, app.usuario);
      if (situacao && situacao.ativa) {
        throw new Error(`${ESQUEMAS[t].arquivo} em edição por ${situacao.trava.usuario} — aguarde e confirme de novo.`);
      }
    }
    for (const t of travas) await criarTrava(t, app.usuario);
    travaCriada = true;
    for (const t of travas) {
      if (!(await confirmarTrava(t))) {
        throw new Error(`${ESQUEMAS[t].arquivo} acabou de ser travado por outra sessão — confirme de novo.`);
      }
    }

    const banco = await lerBanco(definicao.destino);
    if (imp.tipo === 'cirurgias') {
      const reparo = repararCirurgiasSemIdentificacao(banco.cirurgias, (imp.bancoPacientes || {}).internacoes || []);
      if (reparo.reparadas || reparo.removidas) {
        banco.cirurgias = reparo.cirurgias;
        await gravarBanco('cirurgias', banco);
        anotar(`Registros antigos sem identificação: ${fmtInt(reparo.reparadas)} reparados, ${fmtInt(reparo.removidas)} removidos.`);
      }
    }
    const existentes = banco[definicao.abaDestino] || [];
    if (definicao.modo === 'atualizar_internacoes') {
      const todos = imp.dedup.novos.concat(imp.dedup.duplicados, imp.dedup.duplicadosInternos);
      const resultado = aplicarAltas(banco.internacoes || [], todos);
      if (resultado.atualizadas) await gravarBanco('pacientes', banco);
      anotar(`Altas aplicadas: ${fmtInt(resultado.atualizadas)} internações atualizadas, ${fmtInt(resultado.semCorrespondencia)} sem correspondência, ${fmtInt(resultado.semMudanca)} já em dia.`);
    }
    if (imp.tipo === 'cirurgias' || imp.tipo === 'dispositivos') {
      const bancoPac = await lerBanco('pacientes');
      if (imp.tipo === 'cirurgias') {
        const resolvidos = resolverProntuarioPorAtendimento(imp.dedup.novos, bancoPac.internacoes || []);
        if (resolvidos) anotar(`${fmtInt(resolvidos)} prontuários resolvidos pelo nº de atendimento.`);
      } else {
        const resolvidos = resolverProntuarioPorNome(imp.dedup.novos, bancoPac.pacientes || []);
        if (resolvidos) anotar(`${fmtInt(resolvidos)} prontuários resolvidos pelo nome do paciente.`);
      }
    }
    const { novos } = definicao.modo ? { novos: [] } : deduplicar(imp.dedup.novos, existentes, imp.tipo);
    if (!definicao.modo) anotar(`Registros a gravar após verificação final: ${fmtInt(novos.length)}`);
    if (imp.tipo === 'internacoes') {
      const atualizadas = atualizarInternacoesExistentes(existentes, imp.dedup.novos.concat(imp.dedup.duplicados));
      if (atualizadas) {
        await gravarBanco('pacientes', banco);
        anotar(`${fmtInt(atualizadas)} internações existentes atualizadas (alta/desfecho/setor).`);
      }
    }

    /* Lista de isolados é uma foto: quem estava na foto anterior e sumiu desta teve a
       precaução suspensa naquele dia. É o que faz o banco ter fim de isolamento — e sem
       isso ele só cresceria, com todo mundo isolado para sempre. */
    let encerradas = 0;
    if (imp.tipo === 'isolamentos') {
      const foto = dataDoRelatorio(imp.bruto.linhas, imp.linhaCabecalho) || hojeISO();
      const todos = imp.dedup.novos.concat(imp.dedup.duplicados, imp.dedup.duplicadosInternos);
      todos.forEach(r => { r._vistoEm = foto; });
      encerradas = encerrarIsolamentosAusentes(existentes, todos, foto);
      anotar(`Foto de ${foto}: ${fmtInt(todos.length)} pacientes isolados na lista, `
        + `${fmtInt(encerradas)} precauções encerradas por não constarem mais.`);
    }

    if (novos.length || encerradas) {
      const gerarID = proximoID(existentes, definicao.campoID, definicao.prefixoID);
      const tempoCorte = config.tempoCortePorProcedimento();
      const linhasSensibilidade = [];
      for (const registro of novos) {
        const id = gerarID();
        const linha = montarLinhaImportada(registro, imp.tipo, id, app.usuario, agora, tempoCorte);
        existentes.push(linha);
        for (const item of registro._antibiograma || []) {
          linhasSensibilidade.push({ ID_Cultura: id, Antibiotico: item.Antibiotico, Resultado: item.Resultado });
        }
      }
      banco[definicao.abaDestino] = existentes;
      if (definicao.permiteAntibiograma) {
        banco.sensibilidade = (banco.sensibilidade || []).concat(linhasSensibilidade);
      }
      await gravarBanco(definicao.destino, banco);
      anotar(`${ESQUEMAS[definicao.destino].arquivo} gravado.`);
    }

    /* Óbitos fecham as internações correspondentes. Os que não acham par ficam só na aba
       de óbitos: criar internação a partir deles inventaria pacientes-dia de um período em
       que o banco só teria quem morreu. */
    if (imp.tipo === 'obitos' && novos.length) {
      const resultado = aplicarObitos(banco.internacoes || [], banco.obitos || []);
      if (resultado.atualizadas) await gravarBanco('pacientes', banco);
      anotar(`Internações fechadas como óbito: ${fmtInt(resultado.atualizadas)}.`
        + ` Já registradas: ${fmtInt(resultado.jaMarcadas)}.`
        + ` Sem internação no banco: ${fmtInt(resultado.semInternacao)} (ficam só na aba de óbitos).`);
    }

    /* O catálogo da farmácia dá ao vocabulário os nomes que o hospital realmente usa.
       `acrescentarVocabulario` ignora o que já existe com outra grafia, então a grafia
       antiga é preservada e só entra o que é novo. */
    if (imp.tipo === 'antimicrobianos' && novos.length) {
      await config.carregar();
      const antes = config.vocabulario.antibioticos.length;
      config.antimicrobianos.forEach(a => {
        if (a.Nome) config.acrescentarVocabulario('antibioticos', a.Nome);
      });
      await config.salvar();
      anotar(`Vocabulário de antibióticos: ${fmtInt(config.vocabulario.antibioticos.length - antes)} nomes novos`
        + ` (${fmtInt(config.vocabulario.antibioticos.length)} no total).`);
    }

    const bancoPacientes = await lerBanco('pacientes');
    const porProntuario = new Map(bancoPacientes.pacientes.map(p => [normalizarProntuario(p.Prontuario), p]));
    let pacientesNovos = 0, pacientesAtualizados = 0;
    for (const registro of novos.concat(imp.dedup.duplicados || [])) {
      const prontuario = normalizarProntuario(registro.Prontuario);
      if (!prontuario) continue;
      const existente = porProntuario.get(prontuario);
      if (!existente) {
        const paciente = {
          Prontuario: prontuario, Nome: registro.NomePaciente || '', DataNascimento: registro.DataNascimento || '', Sexo: registro.Sexo || '',
          Telefone: registro.Telefone || '', CriadoPor: app.usuario, CriadoEm: agora
        };
        bancoPacientes.pacientes.push(paciente);
        porProntuario.set(prontuario, paciente);
        pacientesNovos++;
      } else {
        let mudou = false;
        if (!existente.Nome && registro.NomePaciente) { existente.Nome = registro.NomePaciente; mudou = true; }
        if (!existente.Telefone && registro.Telefone) { existente.Telefone = registro.Telefone; mudou = true; }
        if (!existente.Sexo && registro.Sexo) { existente.Sexo = registro.Sexo; mudou = true; }
        if (!existente.DataNascimento && registro.DataNascimento) { existente.DataNascimento = registro.DataNascimento; mudou = true; }
        if (mudou) pacientesAtualizados++;
      }
    }
    let casaveis = 0;
    if (pacientesNovos || pacientesAtualizados) {
      await gravarBanco('pacientes', bancoPacientes);
      anotar(`Pacientes: ${fmtInt(pacientesNovos)} novos, ${fmtInt(pacientesAtualizados)} atualizados (nome/telefone).`);
      casaveis = novasUnificacoesPossiveis(bancoPacientes);
      if (casaveis) {
        anotar(`${fmtInt(casaveis)} registro(s) provisórios do laboratório passaram a casar com um paciente real.`);
      }
    }

    config.registrarPerfil(imp.fingerprint, imp.tipo, imp.nomePerfil, imp.linhaCabecalho, imp.mapeamento, app.usuario);
    for (const vocab of Object.keys(imp.decisoes || {})) {
      for (const decisao of Object.values(imp.decisoes[vocab])) {
        if (decisao.acao === 'novo') config.acrescentarVocabulario(vocab, decisao.termo);
        else if (decisao.acao === 'excluir') config.registrarAlias(vocab, decisao.termo, NAO_CIRURGIA);
        else if (decisao.acao === 'renomear') {
          config.acrescentarVocabulario(vocab, decisao.para);
          config.registrarAlias(vocab, decisao.termo, decisao.para);
        }
        else config.registrarAlias(vocab, decisao.termo, decisao.para);
      }
    }
    await config.salvar();
    anotar('Perfil, vocabulários e sinônimos salvos.');

    await arquivarOriginal(imp.arquivo);
    anotar('Relatório original arquivado em dados/importados/.');

    lista.parentElement.querySelector('h2').textContent = 'Importação concluída';
    const aviso = avisoDeUnificacoes(casaveis);
    if (aviso) imp.area.append(aviso);
    imp.area.append(el('div', { class: 'linha-botoes' },
      el('button', { class: 'botao-primario', onclick: () => navegar('importar') }, 'Importar outro relatório'),
      el('button', { class: 'botao-secundario', onclick: () => navegar('painel') }, 'Ir para o painel')));
  } catch (e) {
    const mensagem = e && (e.name === 'NoModificationAllowedError' || e.name === 'InvalidStateError')
      ? 'O arquivo de destino parece estar aberto no Excel. Feche-o e tente novamente.'
      : 'Erro ao gravar: ' + (e && e.message ? e.message : e);
    imp.area.append(el('div', { class: 'cartao aviso-erro' }, mensagem,
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-secundario', onclick: () => irParaPasso(3) }, 'Voltar à prévia'))));
  } finally {
    if (travaCriada) for (const t of travas) await liberarTrava(t).catch(() => {});
  }
}
