/* Aba Infecções (IRAS).

   Duas fontes, com pesos diferentes:
   - as culturas que a CCIH classificou como IRAS ou bacteremia secundária — é onde está
     hoje quase toda a informação (mais de mil), com setor, data, germe e resistência;
   - o banco `iras`, onde entram os casos investigados com topografia, critério e
     dispositivo associado. Um caso lá vale mais (é diagnóstico, não só isolado), mas hoje
     ele quase não tem nada.

   O painel mostra as duas e nunca soma uma na outra: uma cultura de IRAS é um isolado, um
   caso de IRAS é um diagnóstico, e o mesmo episódio pode aparecer nos dois. */

/* Um episódio de infecção rende várias culturas: hemocultura em dois frascos, urocultura de
   controle, secreção da mesma ferida. Contar isolados infla o numerador. Episódio = culturas
   do mesmo paciente dentro de uma janela — 14 dias, o mesmo corte que se usa para dizer que
   uma nova cultura já é outro episódio, e não a mesma infecção ainda em curso. */
const JANELA_EPISODIO_DIAS = 14;
function episodiosDeInfeccao(culturas, janelaDias) {
  const janela = (janelaDias === undefined ? JANELA_EPISODIO_DIAS : janelaDias) * 86400000;
  const porPaciente = new Map();
  for (const c of culturas) {
    const chave = normalizarProntuario(c.Prontuario);
    const data = Date.parse(String(c.DataColeta || '').slice(0, 10) + 'T00:00:00Z');
    if (!chave || !isFinite(data)) continue;
    if (!porPaciente.has(chave)) porPaciente.set(chave, []);
    porPaciente.get(chave).push({ data, cultura: c });
  }
  const episodios = [];
  for (const lista of porPaciente.values()) {
    lista.sort((a, b) => a.data - b.data);
    let atual = null;
    for (const item of lista) {
      if (atual && item.data - atual.ultima <= janela) {
        atual.ultima = item.data;
        atual.culturas.push(item.cultura);
      } else {
        atual = { ultima: item.data, culturas: [item.cultura], inicio: item.cultura };
        episodios.push(atual);
      }
    }
  }
  return episodios;
}

/* pacientesDia (denominador da densidade) vive em relatorios.js — os relatórios padrão
   usam o mesmo cálculo, e denominador de indicador não pode ter duas versões. */

function densidade(casos, diasPaciente) {
  if (!diasPaciente) return null;
  return Math.round(casos / diasPaciente * 1000 * 100) / 100;
}

async function montarInfeccoes(conteudo) {
  conteudo.append(el('h1', {}, 'Infecções relacionadas à assistência'));
  let bancoIras, bancoCulturas, bancoPacientes, bancoEvolucoes;
  try {
    [bancoIras, bancoCulturas, bancoPacientes, bancoEvolucoes] = await Promise.all([
      lerBanco('iras'), lerBanco('culturas'), lerBanco('pacientes'), lerBanco('evolucoes').catch(() => ({ evolucoes: [] }))
    ]);
  } catch (e) { conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message)); return; }

  const culturas = bancoCulturas.culturas || [];
  const casos = bancoIras.casos || [];
  const internacoes = bancoPacientes.internacoes || [];
  const nomes = new Map((bancoPacientes.pacientes || []).map(p => [normalizarProntuario(p.Prontuario), p.Nome]));
  /* Identidade pelo nome: o mesmo paciente sob dois prontuários é UM paciente na dedup. */
  const identidadeDe = identidadePorNome(bancoPacientes.pacientes);

  const ehInfeccao = c => /^IRAS/i.test(String(c.AvaliacaoCCIH || '')) || c.AvaliacaoCCIH === 'Bacteremia secundária';
  const ehAdmissao = c => c.AvaliacaoCCIH === 'Presente na admissão';
  const infeccoes = culturas.filter(ehInfeccao);
  if (!infeccoes.length && !casos.length) {
    conteudo.append(el('div', { class: 'cartao' }, el('p', { class: 'texto-suave' },
      'Nenhuma cultura classificada como IRAS e nenhum caso registrado. Classifique culturas na aba Culturas.')));
    return;
  }

  const datas = culturas.map(c => String(c.DataColeta || '').slice(0, 10)).filter(d => /^\d{4}-/.test(d)).sort();
  /* Abre nos últimos 12 meses: o histórico inteiro tem cinco anos e mistura períodos com
     critérios de classificação diferentes. */
  const ultimo = datas[datas.length - 1] || hojeISO();
  const umAnoAntes = new Date(Date.parse(ultimo + 'T00:00:00Z') - 365 * 86400000).toISOString().slice(0, 10);
  const campoDe = el('input', { type: 'date', value: umAnoAntes < (datas[0] || '') ? datas[0] : umAnoAntes });
  const campoAte = el('input', { type: 'date', value: ultimo });
  const setores = [...new Set(culturas.filter(ehInfeccao).map(c => String(c.Setor || '').trim()).filter(Boolean))].sort();
  const selSetor = el('select', {}, el('option', { value: '' }, 'todos os setores'),
    setores.map(s => el('option', { value: s }, s)));
  const selSerie = el('select', {}, [['mes', 'por mês'], ['semestre', 'por semestre'], ['ano', 'por ano']]
    .map(([v, r]) => el('option', { value: v }, r)));
  const area = el('div', {});

  [campoDe, campoAte, selSetor, selSerie].forEach(c => c.addEventListener('change', desenhar));
  conteudo.append(el('div', { class: 'cartao' },
    el('div', { class: 'linha-campos' },
      el('label', {}, 'De: ', campoDe), el('label', {}, 'Até: ', campoAte),
      el('label', {}, 'Setor: ', selSetor), el('label', {}, 'Série: ', selSerie)),
    el('div', { class: 'linha-botoes' },
      el('button', { class: 'botao-secundario', onclick: () => exportar() }, 'Exportar (Excel)'))),
    area);

  let filtradasAtuais = [];

  function noPeriodo(lista, campoData) {
    return lista.filter(x => {
      const data = String(x[campoData] || '').slice(0, 10);
      if (campoDe.value && data < campoDe.value) return false;
      if (campoAte.value && data > campoAte.value) return false;
      if (selSetor.value && String(x.Setor || '').trim() !== selSetor.value) return false;
      return true;
    });
  }

  /* ---- Confirmação de suspeitas: a segunda assinatura ----
     Toda tela que levanta suspeita de IRAS (revisão de culturas, avaliação remota, visita
     da UTI, pós-alta) abre o caso como "em investigação". A notificação oficial nasce
     AQUI, quando um segundo profissional confirma — ou morre como descartada, com o rastro
     de quem decidiu. */
  const areaSuspeitas = el('div', {});
  conteudo.insertBefore(areaSuspeitas, area);

  /* ---- Digitação no Tasy: fichas e conciliação (CCIH do HNSC, 22/09/2026) ----
     Confirmada aqui → ficha impressa (2 por página, arquivo guardado em fichas/) → digitada
     no Tasy → o export do Tasy volta pela aba Importar (tipo "IRAS digitadas no Tasy") e a
     conciliação marca o caso como DIGITADO. A partir da data de início da conciliação, só o
     digitado conta nos relatórios. */
  const areaDigitacao = el('div', {});
  conteudo.insertBefore(areaDigitacao, area);

  /* ---- Evoluções que sugerem infecção (pedido de 25/09/2026) ----
     Busca determinística no texto da última evolução (febre, secreção purulenta, PAV, ITU,
     sepse…, com negações tratadas). Lista quem NÃO tem caso de IRAS nos últimos 14 dias; a
     suspeita abre com um clique e segue para a dupla assinatura como qualquer outra. */
  const areaEvolucoes = el('div', {});
  conteudo.insertBefore(areaEvolucoes, area);
  function desenharEvolucoes() {
    const evolucoes = (bancoEvolucoes.evolucoes || []).filter(e => String(e.SinaisInfeccao || '').trim());
    if (!evolucoes.length) { areaEvolucoes.replaceChildren(); return; }
    const casosPorId = new Map();
    for (const k of casos) {
      const i = identidadeDe(normalizarProntuario(k.Prontuario));
      if (!casosPorId.has(i)) casosPorId.set(i, []);
      casosPorId.get(i).push(k);
    }
    /* Silêncio de EVOLUCAO_SILENCIO_DIAS após um caso aberto: passado o prazo, evolução com
       sinal reaparece. */
    const temCasoRecente = e => {
      const d = Date.parse(String(e.DataEvolucao || '').slice(0, 10) + 'T00:00:00Z');
      return (casosPorId.get(identidadeDe(normalizarProntuario(e.Prontuario))) || []).some(k => {
        if (normalizarTexto(k.StatusInvestigacao) === 'descartado') return false;
        const dk = Date.parse(String(k.DataInfeccao || '').slice(0, 10) + 'T00:00:00Z');
        return isFinite(d) && isFinite(dk) && Math.abs(d - dk) / 86400000 <= EVOLUCAO_SILENCIO_DIAS;
      });
    };
    const semCaso = evolucoes.filter(e => normalizarProntuario(e.Prontuario) && !temCasoRecente(e))
      .sort((a, b) => String(b.DataEvolucao).localeCompare(String(a.DataEvolucao)));
    if (!semCaso.length) { areaEvolucoes.replaceChildren(); return; }
    const diaInternacao = e => { const s = internacaoNaColeta(e.Prontuario, e.DataEvolucao, internacoes); return s && s.situacao === 'internado' ? s.diaDaInternacao : null; };
    const msg = el('p', { class: 'aviso-erro-texto' });
    const abrir = async e => {
      try {
        const r = sinaisDeInfeccaoNaEvolucao(e.Texto);
        const template = extrairTemplateEvolucao(e.Texto);
        const disp = template.dispositivos.map(d => d.nome).find(n => /cvc|picc/.test(n.toLowerCase())) ? 'CVC'
          : template.dispositivos.some(d => /vm|tot|ventil/.test(d.nome.toLowerCase())) ? 'VM' : '';
        await comTrava(['iras'], async () => {
          const atual = await lerBanco('iras');
          registrarCasoIras(atual.casos, {
            Prontuario: e.Prontuario, DataInfeccao: String(e.DataEvolucao || '').slice(0, 10),
            Topografia: topografiaSugeridaPorSinais(r), CriterioDiagnostico: 'Termos na evolução: ' + r.resumo,
            Setor: e.Setor || '', DispositivoAssociado: disp, Microrganismo: '', Desfecho: '',
            StatusInvestigacao: 'em investigação', NotificadoANVISA: '',
            Observacoes: acrescentarObservacao('', 'Evolução', r.sinais.map(s => `${s.rotulo}: ${s.trecho}`).join(' | ').slice(0, 900), app.usuario, agoraCurto()),
            CriadoPor: app.usuario, CriadoEm: agoraCurto()
          }, () => proximoIDLista(atual.casos, 'ID_IRAS', 'IRA'), identidadeDe);
          await gravarBanco('iras', atual);
        });
        navegar('iras', { historico: 'substituir' });
      } catch (err) { msg.textContent = err.message; }
    };
    areaEvolucoes.replaceChildren(el('div', { class: 'cartao' },
      el('h2', {}, `Evoluções que sugerem infecção — ${fmtInt(semCaso.length)} paciente(s) sem suspeita aberta`),
      el('p', { class: 'texto-suave' }, 'Termos achados no texto da última evolução do Tasy (negações como "afebril" já descontadas; "!" = o médico nomeou a infecção). '
        + `Não é diagnóstico: abra a suspeita se fizer sentido — ela segue para a confirmação como qualquer outra. Paciente com caso aberto nos últimos ${EVOLUCAO_SILENCIO_DIAS} dias não aparece aqui.`),
      el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Evolução', 'Paciente', 'Setor', 'Dia de internação', 'Sinais', ''].map(c => el('th', {}, c)))),
        el('tbody', {}, semCaso.slice(0, 60).map(e => el('tr', {},
          el('td', {}, e.DataEvolucao),
          el('td', { class: 'linha-clicavel', onclick: () => abrirPaciente(e.Prontuario) }, nomes.get(normalizarProntuario(e.Prontuario)) || e.Prontuario),
          el('td', {}, e.Setor || ''),
          el('td', {}, diaInternacao(e) ? `${diaInternacao(e)}º` : '—'),
          el('td', {}, e.SinaisInfeccao),
          el('td', {}, el('button', { class: 'botao-secundario', onclick: () => abrir(e) }, 'Abrir suspeita')))))),
      semCaso.length > 60 ? el('p', { class: 'texto-suave' }, `… e mais ${fmtInt(semCaso.length - 60)}.`) : null,
      msg));
  }
  desenharEvolucoes();
  function desenharDigitacao() {
    const desde = config.conciliacaoDesde || '';
    const aguardando = casos.filter(k => k.StatusInvestigacao === 'confirmado' && String(k.DataInfeccao || '').slice(0, 10) >= desde)
      .sort((a, b) => String(a.DataInfeccao).localeCompare(String(b.DataInfeccao)));
    const digitadas = casos.filter(k => k.StatusInvestigacao === 'digitado').length;
    if (!aguardando.length && !digitadas) { areaDigitacao.replaceChildren(); return; }
    const caixas = aguardando.map(() => el('input', { type: 'checkbox', checked: '' }));
    const msg = el('p', { class: 'aviso-erro-texto' });
    const imprimir = async () => {
      const escolhidos = aguardando.filter((k, i) => caixas[i].checked);
      if (!escolhidos.length) { msg.textContent = 'Marque ao menos um caso.'; return; }
      try {
        msg.className = 'texto-suave'; msg.textContent = 'Montando fichas…';
        const [bCir, bDisp, bDen] = await Promise.all([
          lerBanco('cirurgias').catch(() => ({ cirurgias: [] })),
          lerBanco('dispositivos').catch(() => ({ dispositivos: [] })),
          lerBanco('denominadores').catch(() => ({ passagem_setor: [] }))]);
        const bancos = { pacientes: bancoPacientes, culturas: bancoCulturas, cirurgias: bCir, dispositivos: bDisp, denominadores: bDen };
        const fichas = escolhidos.map(k => fichaDeNotificacao(k, bancos, { identidadeDe }));
        const html = htmlDasFichas(fichas, { usuario: app.usuario, geradoEm: agoraCurto() });
        /* Registro: o arquivo fica na pasta de dados (fichas/), e cada caso guarda FichaEm. */
        const nomeArquivo = `${agoraCurto().replace(/[: ]/g, '-')}_fichas-iras.html`;
        const dir = await pasta.subpasta('fichas');
        const fh = await dir.getFileHandle(nomeArquivo, { create: true });
        const w = await fh.createWritable(); await w.write(html); await w.close();
        await comTrava(['iras'], async () => {
          const atual = await lerBanco('iras');
          atual.fichas = atual.fichas || [];
          atual.fichas.push({ ID_Ficha: proximoIDLista(atual.fichas, 'ID_Ficha', 'FIC'), Arquivo: 'fichas/' + nomeArquivo,
            Casos: escolhidos.map(k => k.ID_IRAS).join(';'), CriadoPor: app.usuario, CriadoEm: agoraCurto() });
          for (const k of escolhidos) { const alvo = atual.casos.find(x => x.ID_IRAS === k.ID_IRAS); if (alvo) alvo.FichaEm = hojeISO(); }
          await gravarBanco('iras', atual);
        });
        const janela = window.open('', '_blank');
        if (!janela) { msg.className = 'aviso-erro-texto'; msg.textContent = `Fichas gravadas em fichas/${nomeArquivo}, mas o navegador bloqueou a janela de impressão — libere pop-ups.`; return; }
        janela.document.write(html); janela.document.close(); janela.focus(); janela.print();
        msg.textContent = `${fmtInt(escolhidos.length)} ficha(s) impressa(s) e guardada(s) em fichas/${nomeArquivo}.`;
      } catch (e) { msg.className = 'aviso-erro-texto'; msg.textContent = e.message; }
    };
    areaDigitacao.replaceChildren(el('div', { class: 'cartao' },
      el('h2', {}, `Digitação no Tasy — ${fmtInt(aguardando.length)} confirmada(s) aguardando, ${fmtInt(digitadas)} digitada(s)`),
      el('p', { class: 'texto-suave' },
        `Desde ${desde.split('-').reverse().join('/')} só a infecção DIGITADA no Tasy conta nos relatórios. Fluxo: imprimir as fichas `
        + '(2 por página; o arquivo fica em fichas/ na pasta de dados), digitar no Tasy e importar o export do Tasy '
        + '(aba Importar, tipo "IRAS digitadas no Tasy") — a conciliação marca cada caso como digitado. '
        + 'Casos com ficha já impressa mostram a data.'),
      aguardando.length ? el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, el('th', {}), ['Data', 'Paciente', 'Topografia', 'Setor', 'Agente', 'Ficha impressa'].map(c => el('th', {}, c)))),
        el('tbody', {}, aguardando.map((k, i) => el('tr', {},
          el('td', {}, caixas[i]),
          ...[k.DataInfeccao, nomes.get(normalizarProntuario(k.Prontuario)) || k.Prontuario, k.Topografia, k.Setor, k.Microrganismo, k.FichaEm]
            .map(v => el('td', {}, String(v || ''))))))) : null,
      aguardando.length ? el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-primario', onclick: imprimir }, 'Imprimir fichas selecionadas')) : null,
      msg));
  }
  desenharDigitacao();

  /* ---- Duplicatas: o mesmo episódio aberto por caminhos diferentes ----
     A prevenção age na entrada (registrarCasoIras, em todas as telas e importações), mas
     o banco acumulou duplicatas de antes — e fundir REMOVE linhas, então só acontece com
     clique e confirmação, nunca sozinho. */
  const areaDuplicatas = el('div', {});
  conteudo.insertBefore(areaDuplicatas, area);

  function desenharDuplicatas() {
    const grupos = agruparCasosIrasDuplicados(casos, undefined, identidadeDe);
    if (!grupos.length) { areaDuplicatas.replaceChildren(); return; }
    const redundantes = grupos.reduce((soma, g) => soma + g.length - 1, 0);
    const linhaDoGrupo = g => el('tr', {},
      el('td', {}, nomes.get(normalizarProntuario(g[0].Prontuario)) || g[0].Prontuario),
      el('td', {}, [...new Set(g.map(k => k.Topografia))].join(' / ')),
      el('td', {}, [...new Set(g.map(k => String(k.DataInfeccao || '').slice(0, 10)))].join(', ')),
      el('td', {}, g.map(k => `${k.ID_IRAS} (${k.StatusInvestigacao || 'sem status'})`).join(', ')));
    areaDuplicatas.replaceChildren(el('div', { class: 'aviso-alerta' },
      el('div', { class: 'alerta-titulo' },
        `${fmtInt(grupos.length)} episódio(s) com casos duplicados — ${fmtInt(redundantes)} caso(s) redundante(s)`),
      el('div', { class: 'texto-suave' },
        'Mesmo paciente, mesma topografia (contando siglas equivalentes) e datas até '
        + `${IRAS_JANELA_DUPLICATA_DIAS} dias entre si: o episódio foi detectado por mais de um caminho. `
        + 'Fundir mantém o caso mais forte (decisão da segunda assinatura vale mais que suspeita aberta), '
        + 'completa os campos vazios com o que os outros sabiam e registra a fusão nas observações.'),
      el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Paciente', 'Topografia', 'Datas', 'Casos'].map(c => el('th', {}, c)))),
        el('tbody', {}, grupos.slice(0, 12).map(linhaDoGrupo))),
      grupos.length > 12 ? el('p', { class: 'texto-suave' }, `… e mais ${fmtInt(grupos.length - 12)} grupo(s).`) : null,
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-primario', onclick: fundirDuplicatas }, 'Fundir duplicatas'))));
  }

  async function fundirDuplicatas() {
    if (!confirm('Fundir os casos duplicados? Os redundantes saem do banco e o rastro da fusão fica nas observações do caso mantido.')) return;
    try {
      await comTrava(['iras', 'cirurgias'], async () => {
        const atualIras = await lerBanco('iras');
        const resultado = deduplicarCasosIras(atualIras.casos, undefined, identidadeDe);
        if (!resultado.remover.size) return;
        atualIras.casos = resultado.casos;
        await gravarBanco('iras', atualIras);
        /* Cirurgias da pós-alta apontam para o caso pelo ID: reapontam para o mantido. */
        const atualCir = await lerBanco('cirurgias');
        let reapontadas = 0;
        for (const cirurgia of atualCir.cirurgias || []) {
          const novoID = resultado.remover.get(cirurgia.ID_IRAS);
          if (novoID) { cirurgia.ID_IRAS = novoID; reapontadas++; }
        }
        if (reapontadas) await gravarBanco('cirurgias', atualCir);
      });
      navegar('iras', { historico: 'substituir' });
    } catch (e) { alert(e.message); }
  }
  desenharDuplicatas();

  function desenharSuspeitas() {
    const suspeitas = casos.filter(k => k.StatusInvestigacao === 'em investigação')
      .sort((a, b) => String(b.DataInfeccao).localeCompare(String(a.DataInfeccao)));
    if (!suspeitas.length) { areaSuspeitas.replaceChildren(); return; }
    const tabela = el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Data', 'Paciente', 'Topografia', 'Setor', 'Origem', 'Notificou'].map(c => el('th', {}, c)))),
      el('tbody', {}, suspeitas.map(k => el('tr', { class: 'linha-clicavel', onclick: e => detalharSuspeita(k, e.currentTarget) },
        [k.DataInfeccao, nomes.get(normalizarProntuario(k.Prontuario)) || k.Prontuario, k.Topografia,
         k.Setor, k.CriterioDiagnostico, k.CriadoPor].map(v => el('td', {}, String(v || '')))))));
    areaSuspeitas.replaceChildren(el('div', { class: 'aviso-alerta' },
      el('div', { class: 'alerta-titulo' }, `${fmtInt(suspeitas.length)} suspeita(s) de IRAS aguardando confirmação`),
      el('div', { class: 'texto-suave' },
        'A notificação oficial só existe depois da segunda análise. Clique na linha para confirmar ou descartar.'),
      tabela));
  }

  /* Caso já registrado (confirmado, digitado ou em investigação): vincular/trocar o agente
     sem passar de novo pela confirmação. Mesma lista de culturas do episódio. */
  function editarAgente(caso, tr) {
    const candidatas = culturasDoEpisodio(culturas, caso, { identidadeDe });
    const sel = el('select', {},
      el('option', { value: '' }, '— escolher —'),
      ...candidatas.map(c => el('option', { value: c.ID_Cultura, selected: c.ID_Cultura === caso.ID_CulturaAgente ? '' : null },
        `${c.DataColeta} · ${c.Material} · ${c.Microrganismo}${c.MecanismoResistencia ? ' (' + c.MecanismoResistencia + ')' : ''}`)),
      el('option', { value: '__sem__', selected: caso.Microrganismo === SEM_CULTURA_VALIDA ? '' : null }, SEM_CULTURA_VALIDA),
      el('option', { value: '__outro__' }, 'Outro (digitar)…'));
    const campo = el('input', { type: 'text', value: caso.ID_CulturaAgente ? '' : (caso.Microrganismo === SEM_CULTURA_VALIDA ? '' : caso.Microrganismo || ''), placeholder: 'microrganismo', style: 'display:none' });
    sel.addEventListener('change', () => { campo.style.display = sel.value === '__outro__' ? '' : 'none'; });
    const msg = el('p', { class: 'aviso-erro-texto' });
    const salvar = async () => {
      try {
        await comTrava(['iras', 'culturas'], async () => {
          const atualIras = await lerBanco('iras');
          const alvo = atualIras.casos.find(k => k.ID_IRAS === caso.ID_IRAS);
          if (!alvo) throw new Error('Caso não encontrado no banco.');
          const escolha = sel.value;
          if (escolha === '__sem__') { alvo.Microrganismo = SEM_CULTURA_VALIDA; alvo.ID_CulturaAgente = ''; }
          else if (escolha === '__outro__' || !escolha) { alvo.Microrganismo = campo.value.trim(); alvo.ID_CulturaAgente = ''; }
          else { const cul = culturas.find(c => c.ID_Cultura === escolha); alvo.Microrganismo = cul ? cul.Microrganismo : alvo.Microrganismo; alvo.ID_CulturaAgente = escolha; }
          if (!String(alvo.AgenteOriginal || '').trim() && String(alvo.Microrganismo || '').trim()) alvo.AgenteOriginal = alvo.Microrganismo;
          alvo.Observacoes = acrescentarObservacao(alvo.Observacoes, 'Agente', `agente definido: ${alvo.Microrganismo || '—'}${alvo.ID_CulturaAgente ? ' (' + alvo.ID_CulturaAgente + ')' : ''}`, app.usuario, agoraCurto());
          await gravarBanco('iras', atualIras);
          const atualCul = await lerBanco('culturas');
          let mudou = false;
          for (const c of atualCul.culturas || []) {
            const deve = c.ID_Cultura === alvo.ID_CulturaAgente;
            if (deve && c.ID_IRAS !== alvo.ID_IRAS) { c.ID_IRAS = alvo.ID_IRAS; mudou = true; }
            else if (!deve && c.ID_IRAS === alvo.ID_IRAS) { c.ID_IRAS = ''; mudou = true; }
          }
          if (mudou) await gravarBanco('culturas', atualCul);
        });
        navegar('iras', { historico: 'substituir' });
      } catch (e) { msg.textContent = e.message; }
    };
    detalharNaLinha(tr, el('div', { class: 'cartao cartao-detalhe' },
      el('h2', {}, `${caso.ID_IRAS} — ${caso.Topografia || 'sem topografia'} · ${caso.StatusInvestigacao}`),
      el('p', { class: 'texto-suave' }, `${nomes.get(normalizarProntuario(caso.Prontuario)) || ''} (${caso.Prontuario}) · ${caso.Setor || ''} · ${caso.DataInfeccao}`
        + (caso.Microrganismo ? ` · agente atual: ${caso.Microrganismo}${caso.ID_CulturaAgente ? ' (' + caso.ID_CulturaAgente + ')' : ' (sem cultura vinculada)'}` : ' · sem agente')),
      el('div', { class: 'linha-campos' }, el('label', {}, 'Agente (cultura do episódio, ±14 dias): ', sel), campo),
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-primario', onclick: salvar }, 'Salvar agente'),
        el('button', { class: 'botao-secundario', onclick: e => { e.stopPropagation(); abrirPaciente(caso.Prontuario); } }, 'Ver ficha do paciente')),
      msg));
  }

  function detalharSuspeita(caso, tr) {
    const topografias = (config.vocabulario.topografias || []);
    const selTopo = el('select', {},
      topografias.map(t => el('option', { value: t, selected: t === caso.Topografia ? '' : null }, t)),
      topografias.includes(caso.Topografia) ? null : el('option', { value: caso.Topografia, selected: '' }, caso.Topografia));
    const selDisp = el('select', {}, ['', 'CVC', 'VM', 'SVD', 'Nenhum'].map(d =>
      el('option', { value: d, selected: d === (caso.DispositivoAssociado || '') ? '' : null }, d || '—')));
    /* Agente ↔ infecção (decisão da CCIH, 22/09/2026): escolhe-se a CULTURA que definiu a
       infecção (positivas válidas do paciente em ±14 dias), ou "Sem cultura positiva válida",
       ou outro nome digitado. A cultura escolhida ganha o ID_IRAS. */
    const candidatas = culturasDoEpisodio(culturas, caso, { identidadeDe });
    const opcoesAgente = [
      el('option', { value: '' }, '— escolher —'),
      ...candidatas.map(c => el('option', { value: c.ID_Cultura, selected: c.ID_Cultura === caso.ID_CulturaAgente ? '' : null },
        `${c.DataColeta} · ${c.Material} · ${c.Microrganismo}${c.MecanismoResistencia ? ' (' + c.MecanismoResistencia + ')' : ''}`)),
      el('option', { value: '__sem__', selected: caso.Microrganismo === SEM_CULTURA_VALIDA ? '' : null }, SEM_CULTURA_VALIDA),
      el('option', { value: '__outro__', selected: caso.Microrganismo && caso.Microrganismo !== SEM_CULTURA_VALIDA && !caso.ID_CulturaAgente ? '' : null }, 'Outro (digitar)…')
    ];
    const selAgente = el('select', {}, opcoesAgente);
    const campoMicro = el('input', { type: 'text', value: caso.ID_CulturaAgente ? '' : (caso.Microrganismo === SEM_CULTURA_VALIDA ? '' : caso.Microrganismo || ''),
      placeholder: 'microrganismo', style: selAgente.value === '__outro__' ? '' : 'display:none' });
    selAgente.addEventListener('change', () => { campoMicro.style.display = selAgente.value === '__outro__' ? '' : 'none'; });
    const campoCriterio = el('input', { type: 'text', value: caso.CriterioDiagnostico || '', style: 'width:320px' });
    const campoNovaObs = el('textarea', { rows: 2, style: 'width:100%',
      placeholder: 'observação da segunda análise (opcional) — entra no diário do caso' });
    const msg = el('p', { class: 'aviso-erro-texto' });
    const mesmaPessoa = normalizarTexto(caso.CriadoPor) === normalizarTexto(app.usuario);

    async function decidir(statusNovo) {
      try {
        await comTrava(['iras', 'cirurgias', 'culturas'], async () => {
          const atualIras = await lerBanco('iras');
          const alvo = atualIras.casos.find(k => k.ID_IRAS === caso.ID_IRAS);
          if (!alvo) throw new Error('Caso não encontrado no banco.');
          alvo.Topografia = selTopo.value;
          alvo.DispositivoAssociado = selDisp.value;
          const escolha = selAgente.value;
          if (escolha === '__sem__') { alvo.Microrganismo = SEM_CULTURA_VALIDA; alvo.ID_CulturaAgente = ''; }
          else if (escolha === '__outro__' || !escolha) { alvo.Microrganismo = campoMicro.value.trim(); alvo.ID_CulturaAgente = ''; }
          else {
            const cul = culturas.find(c => c.ID_Cultura === escolha);
            alvo.Microrganismo = cul ? cul.Microrganismo : alvo.Microrganismo;
            alvo.ID_CulturaAgente = escolha;
          }
          if (!String(alvo.AgenteOriginal || '').trim() && String(alvo.Microrganismo || '').trim()) alvo.AgenteOriginal = alvo.Microrganismo;
          alvo.CriterioDiagnostico = campoCriterio.value;
          alvo.Observacoes = acrescentarObservacao(alvo.Observacoes,
            'Segunda análise', campoNovaObs.value, app.usuario, agoraCurto());
          alvo.StatusInvestigacao = statusNovo;
          alvo.ConfirmadoPor = app.usuario;
          alvo.ConfirmadoEm = hojeISO();
          await gravarBanco('iras', atualIras);
          /* A cultura que definiu a infecção aponta para o caso (e só ela). */
          if (statusNovo === 'confirmado') {
            const atualCul = await lerBanco('culturas');
            let mudou = false;
            for (const c of atualCul.culturas || []) {
              const deveApontar = c.ID_Cultura === alvo.ID_CulturaAgente;
              if (deveApontar && c.ID_IRAS !== alvo.ID_IRAS) { c.ID_IRAS = alvo.ID_IRAS; mudou = true; }
              else if (!deveApontar && c.ID_IRAS === alvo.ID_IRAS) { c.ID_IRAS = ''; mudou = true; }
            }
            if (mudou) await gravarBanco('culturas', atualCul);
          }
          /* Suspeita que veio da vigilância pós-alta fecha o ciclo lá também. */
          const atualCir = await lerBanco('cirurgias');
          const cirurgia = atualCir.cirurgias.find(c => c.ID_IRAS === caso.ID_IRAS);
          if (cirurgia) {
            if (statusNovo === 'confirmado') {
              cirurgia.StatusVigilancia = 'infecção confirmada';
              cirurgia.ValidadoPor = app.usuario;
              cirurgia.ValidadoEm = hojeISO();
            } else {
              cirurgia.StatusVigilancia = 'sem infecção';
              cirurgia.ISC = ''; cirurgia.TipoISC = '';
            }
            await gravarBanco('cirurgias', atualCir);
          }
        });
        navegar('iras', { historico: 'substituir' });
      } catch (e) { msg.textContent = e.message; }
    }

    const cartao = el('div', { class: 'cartao cartao-detalhe' },
      el('h2', {}, 'Segunda análise — ' + (nomes.get(normalizarProntuario(caso.Prontuario)) || caso.Prontuario)),
      el('p', { class: 'texto-suave' },
        `Notificado por ${caso.CriadoPor || '?'} em ${String(caso.CriadoEm || '').slice(0, 10)} · ${caso.CriterioDiagnostico || ''}`),
      mesmaPessoa ? el('p', { class: 'aviso-erro-texto' },
        '⚠ Você mesmo abriu esta suspeita — o ideal é que outro profissional faça a confirmação.') : null,
      el('div', { class: 'linha-campos' },
        el('label', {}, 'Topografia: ', selTopo),
        el('label', {}, 'Dispositivo: ', selDisp)),
      el('div', { class: 'linha-campos' },
        el('label', {}, 'Agente (cultura): ', selAgente), campoMicro,
        el('label', {}, 'Critério: ', campoCriterio)),
      String(caso.Observacoes || '').trim()
        ? el('p', { class: 'texto-suave', style: 'white-space:pre-line;border-left:3px solid #ccc;padding-left:8px' },
            caso.Observacoes)
        : null,
      campoNovaObs,
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-secundario', onclick: e => { e.stopPropagation(); abrirPaciente(caso.Prontuario); } },
          'Ver ficha do paciente'),
        el('button', { class: 'botao-primario', onclick: () => decidir('confirmado') }, '✓ Confirmar notificação'),
        el('button', { class: 'botao-secundario', onclick: () => decidir('descartado') }, 'Descartar suspeita')),
      msg);
    detalharNaLinha(tr, cartao);
  }
  desenharSuspeitas();

  function desenhar() {
    const doPeriodo = noPeriodo(culturas, 'DataColeta');
    const inf = doPeriodo.filter(ehInfeccao);
    const adm = doPeriodo.filter(ehAdmissao);
    const pendentes = doPeriodo.filter(c => c.StatusRevisao === 'pendente' && c.Microrganismo);
    const casosPeriodo = noPeriodo(casos, 'DataInfeccao');
    filtradasAtuais = inf;

    const dias = pacientesDia(internacoes, campoDe.value, campoAte.value);
    const comMecanismo = inf.filter(c => String(c.MecanismoResistencia || '').trim());
    const episodios = episodiosDeInfeccao(inf);

    const cartaoNumero = (valor, rotulo, dica, acao) => el('div', {
      class: 'cartao cartao-numero' + (acao ? ' linha-clicavel' : ''), title: dica || '', onclick: acao || null
    }, el('div', { class: 'numero-grande' }, valor), el('div', { class: 'texto-suave' }, rotulo));

    /* A fila de revisão é parte do resultado, não um detalhe: um mês com muita cultura por
       classificar parece um mês sem infecção. Sem este aviso o gráfico mente. */
    const avisoPendentes = pendentes.length ? el('div', { class: 'aviso-alerta' },
      el('div', { class: 'alerta-titulo' },
        `${fmtInt(pendentes.length)} culturas positivas do período ainda não foram classificadas`),
      el('div', { class: 'texto-suave' },
        'Enquanto elas estiverem pendentes, os meses recentes aparecem com menos infecções do que realmente tiveram.'),
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-secundario', onclick: () => { app.filtroCulturas = { status: 'pendente' }; navegar('culturas'); } },
          'Ir para a revisão'))) : null;

    /* A densidade usa episódios, não isolados: duas hemoculturas do mesmo dia são uma
       infecção, e contá-las duas vezes inflaria a taxa. */
    const densidadeGlobal = densidade(episodios.length, dias);

    /* Série: IRAS × presentes na admissão. A comparação é o que separa "o hospital está
       infectando" de "a cidade está mandando gente infectada". */
    const chaves = new Map();
    const registrar = (lista, grupo) => {
      for (const c of lista) {
        const chave = chavePeriodo(String(c.DataColeta || '').slice(0, 10), selSerie.value);
        if (!chave) continue;
        if (!chaves.has(chave)) chaves.set(chave, { IRAS: 0, Admissão: 0 });
        chaves.get(chave)[grupo]++;
      }
    };
    registrar(inf, 'IRAS');
    registrar(adm, 'Admissão');
    const periodos = [...chaves.keys()].sort();
    const series = new Map([
      ['IRAS', periodos.map(p => chaves.get(p).IRAS)],
      ['Presente na admissão', periodos.map(p => chaves.get(p).Admissão)]
    ]);

    /* Densidade por setor: só dos setores que têm pacientes-dia no período. Setor sem
       denominador entra na contagem mas fica sem taxa, em vez de virar uma taxa inventada. */
    const porSetor = new Map();
    for (const c of inf) {
      const s = String(c.Setor || '').trim() || '(não informado)';
      porSetor.set(s, (porSetor.get(s) || 0) + 1);
    }
    const episodiosPorSetor = new Map();
    for (const e of episodios) {
      const s = String(e.inicio.Setor || '').trim() || '(não informado)';
      episodiosPorSetor.set(s, (episodiosPorSetor.get(s) || 0) + 1);
    }
    const linhasSetor = [...porSetor.entries()].sort((a, b) => b[1] - a[1])
      .map(([setor, n]) => ({ setor, n, episodios: episodiosPorSetor.get(setor) || 0 }));

    /* replaceChildren nativo transforma null no TEXTO "null" — filtrar antes. */
    area.replaceChildren(...[
      avisoPendentes,
      el('div', { class: 'grade-cartoes' },
        cartaoNumero(fmtInt(episodios.length), 'episódios de IRAS',
          `Culturas do mesmo paciente em até ${JANELA_EPISODIO_DIAS} dias contam como um episódio`),
        cartaoNumero(fmtInt(inf.length), 'isolados classificados como IRAS',
          'Culturas classificadas como IRAS ou bacteremia secundária'),
        cartaoNumero(fmtInt(adm.length), 'isolados presentes na admissão', 'Para comparação — não são IRAS'),
        cartaoNumero(densidadeGlobal === null ? '—' : densidadeGlobal.toFixed(2),
          'episódios por 1.000 pacientes-dia',
          dias ? `Denominador: ${fmtInt(Math.round(dias))} pacientes-dia no período`
            : 'Sem internações importadas cobrindo este período'),
        cartaoNumero(fmtInt(comMecanismo.length), 'com mecanismo de resistência',
          'IRAS por germe multirresistente'),
        cartaoNumero(fmtInt(casosPeriodo.filter(k => k.StatusInvestigacao === 'digitado').length),
          'digitadas no Tasy', 'Casos conciliados com o Tasy — os que valem nos relatórios a partir da data de início da conciliação'),
        cartaoNumero(fmtInt(casosPeriodo.filter(k => k.StatusInvestigacao === 'confirmado').length),
          'notificações confirmadas',
          'Casos de IRAS com as duas assinaturas (quem notificou e quem confirmou)'),
        cartaoNumero(fmtInt(casos.filter(k => k.StatusInvestigacao === 'em investigação').length),
          'suspeitas aguardando confirmação', 'Ver o quadro no topo desta aba')),

      dias ? null : el('div', { class: 'aviso-alerta' },
        el('div', { class: 'alerta-titulo' }, 'Sem denominador para este período'),
        el('div', { class: 'texto-suave' },
          'As internações importadas não cobrem o intervalo escolhido, então só dá para contar '
          + 'infecções — não medir risco. Importe o censo de internações do período para ter as densidades.')),

      el('div', { class: 'cartao' },
        el('h2', {}, 'IRAS × presentes na admissão'),
        periodos.length ? el('div', {}, grafLinhas(periodos, series), legendaSeries(series),
          el('p', { class: 'texto-suave' },
            'Contagem de isolados. A linha da admissão é o pano de fundo: quando as duas sobem juntas, '
            + 'costuma ser mudança no volume de exames, não no risco do hospital.'))
          : el('p', { class: 'texto-suave' }, 'sem dados no período')),

      el('div', { class: 'cartao' },
        el('h2', {}, 'Por setor'),
        el('p', { class: 'texto-suave' },
          'Contagem, não taxa. O censo de internações registra o setor por onde o paciente entrou '
          + '(a maioria cai em "Emergência"), não onde ele ficou — então não há pacientes-dia por '
          + 'setor para servir de denominador. Quando o censo trouxer as passagens de setor, as '
          + 'densidades por unidade entram aqui.'),
        linhasSetor.length ? el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['Setor', 'Episódios', 'Isolados'].map(c => el('th', {}, c)))),
          el('tbody', {}, linhasSetor.map(l => el('tr', {
            /* "(não informado)" não existe como opção do seletor: clicar nele fazia o
               select voltar calado para "todos", parecendo filtrar sem filtrar. */
            class: l.setor === '(não informado)' ? '' : 'linha-clicavel',
            onclick: l.setor === '(não informado)' ? null : () => { selSetor.value = l.setor; desenhar(); }
          },
            el('td', {}, l.setor), el('td', {}, fmtInt(l.episodios)), el('td', {}, fmtInt(l.n))))))
          : el('p', { class: 'texto-suave' }, 'sem dados no período')),

      el('div', { class: 'grade-graficos' },
        grafBarras('Microrganismos nas IRAS', contarPor(inf, 'Microrganismo', 10)),
        grafBarras('Mecanismos de resistência', contarPor(comMecanismo, 'MecanismoResistencia', 10))),

      el('div', { class: 'cartao' },
        el('h2', {}, 'Casos investigados'),
        casosPeriodo.length ? el('div', {},
          el('p', { class: 'texto-suave' }, 'Do banco IRAS — com topografia, dispositivo e critério.'),
          el('table', { class: 'tabela' },
            el('thead', {}, el('tr', {}, ['Data', 'Paciente', 'Setor', 'Topografia', 'Microrganismo', 'Situação', 'Notificou / Confirmou'].map(c => el('th', {}, c)))),
            el('tbody', {}, casosPeriodo.slice(0, 200).map(k => el('tr', { class: 'linha-clicavel', title: 'Clique para ver/trocar o agente ou abrir a ficha', onclick: e => editarAgente(k, e.currentTarget) },
              [k.DataInfeccao, nomes.get(normalizarProntuario(k.Prontuario)) || k.Prontuario, k.Setor,
               k.Topografia, (k.Microrganismo || '') + (k.ID_CulturaAgente ? ' ✓' : ''), k.StatusInvestigacao,
               [k.CriadoPor, k.ConfirmadoPor].filter(Boolean).join(' / ')].map(v => el('td', {}, String(v || ''))))))),
          el('p', { class: 'texto-suave' }, '✓ = agente vinculado a uma cultura do episódio.'))
          : el('p', { class: 'texto-suave' },
              'Nenhum caso investigado registrado neste período. Os casos entram ao classificar uma cultura '
              + 'como IRAS na aba Culturas (que pede a topografia) ou importando um relatório de IRAS.')),

      el('div', { class: 'cartao' },
        el('h2', {}, 'Isolados classificados como IRAS'),
        el('p', { class: 'texto-suave' }, fmtInt(inf.length) + ' isolados' + (inf.length > 300 ? ' (mostrando 300)' : '')
          + ` — ${fmtInt(episodios.length)} episódio(s). Várias amostras da mesma infecção aparecem aqui uma por linha, com o mesmo caso na última coluna: é UMA infecção.`),
        el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['Coleta', 'Paciente', 'Setor', 'Material', 'Microrganismo', 'Mecanismo', 'Classificação', 'Caso'].map(c => el('th', {}, c)))),
          el('tbody', {}, inf.slice().sort((a, b) => String(b.DataColeta).localeCompare(String(a.DataColeta)))
            .slice(0, 300).map(c => el('tr', { class: 'linha-clicavel', onclick: () => abrirPaciente(c.Prontuario) },
              [c.DataColeta, nomes.get(normalizarProntuario(c.Prontuario)) || c.Prontuario, c.Setor, c.Material,
               c.Microrganismo, c.MecanismoResistencia, c.AvaliacaoCCIH, c.ID_IRAS].map(v => el('td', {}, String(v || ''))))))))
    ].filter(Boolean));
  }

  function exportar() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtradasAtuais.map(c => ({
      Coleta: c.DataColeta, Prontuario: c.Prontuario,
      Paciente: nomes.get(normalizarProntuario(c.Prontuario)) || '', Setor: c.Setor,
      Material: c.Material, Microrganismo: c.Microrganismo, Mecanismo: c.MecanismoResistencia,
      Classificacao: c.AvaliacaoCCIH
    }))), 'iras_isolados');
    const porSetor = new Map();
    filtradasAtuais.forEach(c => {
      const s = String(c.Setor || '').trim() || '(não informado)';
      porSetor.set(s, (porSetor.get(s) || 0) + 1);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...porSetor.entries()].map(([setor, n]) => ({
      Setor: setor, Isolados: n
    }))), 'por_setor');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(noPeriodo(casos, 'DataInfeccao')), 'casos_investigados');
    XLSX.writeFile(wb, 'infeccoes-' + hojeISO() + '.xlsx');
  }

  desenhar();
}
