/* Aba "Decisão ATB": apoio à decisão de antibioticoterapia empírica.
   O médico (ou a CCIH) informa o registro do paciente e a síndrome; o app responde com o
   esquema do protocolo institucional, os exames a coletar e — o diferencial — os avisos
   construídos com os dados LOCAIS: histórico de multirresistentes do paciente e o
   antibiograma acumulado do hospital. Sempre apoio, nunca substituto do julgamento. */

async function montarDecisaoATB(conteudo) {
  conteudo.append(el('h1', {}, 'Decisão de antibioticoterapia empírica'));
  /* Decisões dos plantões chegam do celular direto na planilha do Google; daqui se puxa. */
  try { const c = await cartaoSincronizarMiniapp('decisao_atb', 'decisao'); if (c) conteudo.append(c); } catch (e) { /* conveniência */ }
  /* QR do miniapp de celular (pedido da revisão tela a tela, 16/09/2026): mesma fonte e
     mesmo gerador do cartão de Distribuição — o QR daqui nunca diverge do de lá. */
  const miniapp = (typeof CATALOGO_MINIAPPS !== 'undefined' ? CATALOGO_MINIAPPS : [])
    .find(m => m.titulo === 'Decisão de ATB empírica');
  /* Com a planilha do Google ligada, o endereço dos médicos é o do Apps Script: abre no
     navegador do celular (iPhone inclusive) e busca o paciente nos internados de hoje. */
  const cfgSync = await sincronizacaoGoogle.config().catch(() => ({}));
  if (sincronizacaoConfigurada(cfgSync)) {
    /* Um link por protocolo/público (03/10/2026): o pediatra nunca vê o da emergência. */
    const protocolos = (typeof MINIAPPS_PARA_PASTA !== 'undefined' ? MINIAPPS_PARA_PASTA : []).filter(m => m.protocolo);
    const urlMedicos = urlAppMedicos(cfgSync, 'decisao-atb');
    conteudo.append(el('div', { class: 'cartao', style: 'display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap' },
      qrDe(urlMedicos, 'Decisão ATB — emergência adulto'),
      el('div', { style: 'max-width:560px' },
        el('h2', {}, 'Leve no celular (abre direto no navegador — iPhone inclusive)'),
        el('p', { class: 'texto-suave' }, 'O médico entra com CRM + senha (aba "medicos" da planilha da CCIH), digita o prontuário e vê o nome, ou digita parte do nome e escolhe entre os internados de hoje. '
          + 'Cada decisão registra prontuário, CRM, protocolo, ID do fluxo, data e as versões do protocolo e do miniapp — nunca o nome do paciente.'),
        el('ul', { class: 'texto-suave', style: 'word-break:break-all' }, protocolos.map(m => {
          const p = (typeof PROTOCOLOS_ATB !== 'undefined' ? PROTOCOLOS_ATB[m.protocolo] : null) || {};
          const url = urlAppMedicos(cfgSync, m.arquivo.replace(/\.html$/, ''));
          return el('li', {}, el('strong', {}, p.rotulo || m.titulo), ` — ${(p.sindromes || []).length} fluxo(s), versão ${typeof versaoDoProtocolo === 'function' ? versaoDoProtocolo(p) : ''}: `,
            el('a', { href: url, target: '_blank' }, url));
        })),
        el('button', { class: 'botao-secundario', onclick: () =>
          window.open('https://wa.me/?text=' + encodeURIComponent('CCIH — apoio à decisão de antibioticoterapia empírica (protocolo institucional, emergência adulto). Abra no navegador do celular:\n' + urlMedicos), '_blank') },
          'Enviar o da emergência pelo WhatsApp'))));
  } else if (miniapp && miniapp.url) {
    conteudo.append(el('div', { class: 'cartao', style: 'display:flex;gap:18px;align-items:center;flex-wrap:wrap' },
      qrDe(miniapp.url, miniapp.titulo),
      el('div', { style: 'max-width:520px' },
        el('h2', {}, 'Leve no celular'),
        el('p', { class: 'texto-suave' }, 'Aponte a câmera para o QR e BAIXE o arquivo (a pré-visualização do '
          + 'Drive não executa — abra pela pasta Downloads ou ⋮ → Abrir com → Chrome). Depois de aberto, '
          + 'funciona sem internet e registra as decisões do plantão para enviar à CCIH.'),
        el('button', { class: 'botao-secundario', onclick: () =>
          window.open('https://wa.me/?text=' + encodeURIComponent(miniapp.mensagem + '\n' + miniapp.url), '_blank') },
          'Enviar pelo WhatsApp'))));
  }
  let bancos;
  try {
    const [bCulturas, bAntibioticos, bPacientes] = await Promise.all([
      lerBanco('culturas'), lerBanco('antibioticos').catch(() => ({})), lerBanco('pacientes')]);
    bancos = { culturas: bCulturas, antibioticos: bAntibioticos, pacientes: bPacientes };
  } catch (e) { conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message)); return; }
  const hoje = hojeISO();
  const nomes = new Map((bancos.pacientes.pacientes || []).map(p => [normalizarProntuario(p.Prontuario), p.Nome]));

  /* ---- Contexto do paciente (opcional, mas é onde o banco brilha) ---- */
  const campoProntuario = el('input', { type: 'text', placeholder: 'prontuário (opcional)', style: 'width:180px' });
  const areaContexto = el('div', {});
  let contexto = null;
  const buscarContexto = () => {
    contexto = contextoLocalDoPaciente(bancos, campoProntuario.value, hoje);
    if (!contexto) { areaContexto.replaceChildren(); desenharPerguntas(); return; }
    const nome = nomes.get(normalizarProntuario(campoProntuario.value)) || '';
    areaContexto.replaceChildren(el('div', { class: contexto.riscoPresumido ? 'aviso-alerta' : 'cartao' },
      el('div', { class: 'alerta-titulo' },
        `${nome || 'Paciente ' + campoProntuario.value.trim()} — ${fmtInt(contexto.culturasRecentes)} cultura(s) nos últimos 12 meses`),
      contexto.alertas.length
        ? el('ul', {}, contexto.alertas.map(a => el('li', {}, a)))
        : el('p', { class: 'texto-suave' }, 'Sem multirresistentes, antibióticos recentes ou internação nos últimos 90 dias no banco.'),
      el('p', { class: 'texto-suave' },
        'Os fatores de risco abaixo foram pré-marcados com base nisso — confirme ou corrija.')));
    desenharPerguntas();
  };
  campoProntuario.addEventListener('input', aoPararDeDigitar(buscarContexto, 400));

  /* ---- Protocolo, navegação por 3 botões e síndrome (06/10/2026) ----
     O computador passa a ter o que o celular já tinha: seletor de protocolo (Emergência,
     UTI…) e os 3 caminhos — por sítio, troca IV→VO, situações específicas. */
  const protocolosDisponiveis = (typeof PROTOCOLOS_ATB !== 'undefined' ? Object.values(PROTOCOLOS_ATB) : [PROTOCOLO_ATB]).filter(p => (p.sindromes || []).length);
  const selProtocolo = el('select', {}, protocolosDisponiveis.map(p => el('option', { value: p.id }, p.rotulo + (p.homologado ? '' : ' (em construção)'))));
  const protocoloAtual = () => (typeof PROTOCOLOS_ATB !== 'undefined' && PROTOCOLOS_ATB[selProtocolo.value]) || PROTOCOLO_ATB;
  const grupos = () => (typeof agruparSindromes === 'function' ? agruparSindromes(protocoloAtual()) : { sitios: [], especificas: [] });

  const selSindrome = el('select', {}, el('option', { value: '' }, 'escolha…'));
  const rotuloSindrome = el('span', {}, 'Síndrome');
  const areaPerguntas = el('div', {});
  const areaSindrome = el('div', {}, el('button', { class: 'botao-secundario', onclick: () => mostrar('home') }, '← voltar'),
    el('div', { class: 'linha-campos' }, el('label', {}, rotuloSindrome, ' ', selSindrome)), areaPerguntas);
  const areaIVVO = el('div', {});
  const areaResultado = el('div', {});
  const controles = new Map();

  function mostrar(qual) {
    areaSindrome.style.display = qual === 'sindrome' ? '' : 'none';
    areaIVVO.style.display = qual === 'ivvo' ? '' : 'none';
    if (qual !== 'sindrome') areaResultado.replaceChildren();
  }
  function popularSindromes(listaGrupos, rotulo) {
    rotuloSindrome.textContent = rotulo;
    selSindrome.replaceChildren(el('option', { value: '' }, 'escolha…'));
    for (const g of listaGrupos) {
      const og = document.createElement('optgroup');
      og.label = g.grupo;
      for (const s of g.sindromes) og.append(el('option', { value: s.id }, s.rotulo + (s.homologacao === 'pendente' ? ' (a homologar)' : '')));
      selSindrome.append(og);
    }
    selSindrome.value = '';
    desenharPerguntas();
  }
  function desenharIVVO() {
    const t = typeof TROCA_IV_VO !== 'undefined' ? TROCA_IV_VO : null;
    if (!t) { areaIVVO.replaceChildren(el('p', { class: 'texto-suave' }, 'Dados de troca IV→VO indisponíveis.')); return; }
    areaIVVO.replaceChildren(
      el('button', { class: 'botao-secundario', onclick: () => mostrar('home') }, '← voltar'),
      el('h3', {}, 'Troca de IV para VO'),
      el('p', { class: 'texto-suave' }, 'Pode trocar quando TODOS estiverem presentes:'),
      el('ul', {}, t.criterios.map(c => el('li', {}, c))),
      el('p', { class: 'texto-suave' }, 'Decisão individual com o infectologista nestes casos: ' + t.excecoes.join(', ') + '.'),
      el('table', { class: 'tabela' }, el('thead', {}, el('tr', {}, ['IV', 'Equivalente oral', 'Biodisp.'].map(c => el('th', {}, c)))),
        el('tbody', {}, t.equivalencias.map(e => el('tr', {}, el('td', {}, e.iv), el('td', {}, e.vo), el('td', {}, e.biodisp))))),
      el('ul', { class: 'texto-suave' }, t.notas.map(n => el('li', {}, n))));
  }
  const btSitio = el('button', { class: 'botao-primario', onclick: () => { popularSindromes(grupos().sitios, 'Sítio / síndrome (o esquema considera o risco de resistência do paciente)'); mostrar('sindrome'); } }, '🩺 Esquema antibiótico por sítio');
  const btIVVO = el('button', { class: 'botao-secundario', onclick: () => { desenharIVVO(); mostrar('ivvo'); } }, '💊 Troca de IV para VO');
  const btEspecificas = el('button', { class: 'botao-secundario', onclick: () => { popularSindromes(grupos().especificas, 'Situação específica'); mostrar('sindrome'); } }, '📋 Situações específicas');
  const areaNavegacao = el('div', { class: 'linha-botoes' }, btSitio, btIVVO, btEspecificas);
  const pPublico = el('p', { class: 'texto-suave' });
  function aoTrocarProtocolo() {
    pPublico.textContent = protocoloAtual().publico || '';
    btEspecificas.style.display = grupos().especificas.length ? '' : 'none';
    mostrar('home');
    areaResultado.replaceChildren();
  }
  selProtocolo.addEventListener('change', aoTrocarProtocolo);

  /* Perguntas que o contexto local responde sozinho (o médico pode desmarcar). */
  const PERGUNTAS_DE_RISCO = ['riscoEsbl', 'riscoMDR', 'comorbAtb90', 'riscoMRSAHosp', 'riscoMRSA'];

  function desenharPerguntas() {
    areaResultado.replaceChildren();
    controles.clear();
    const sindrome = protocoloAtual().sindromes.find(s => s.id === selSindrome.value);
    if (!sindrome) { areaPerguntas.replaceChildren(); return; }
    const linhas = sindrome.perguntas.map(p => {
      let controle;
      if (p.tipo === 'escolha') {
        controle = el('select', {}, p.opcoes.map(([v, r]) => el('option', { value: v }, r)));
      } else {
        const preMarcada = contexto && contexto.riscoPresumido && PERGUNTAS_DE_RISCO.includes(p.id);
        controle = el('select', {},
          el('option', { value: '' , selected: preMarcada ? null : '' }, 'não'),
          el('option', { value: 'S', selected: preMarcada ? '' : null }, 'sim'));
      }
      controles.set(p.id, { controle, tipo: p.tipo });
      return el('div', { class: 'linha-campos', style: 'flex-direction:column;align-items:flex-start' },
        el('label', {}, p.rotulo + ': ', controle),
        p.ajuda ? el('ul', { class: 'texto-suave', style: 'margin:2px 0 0;padding-left:18px;font-size:12px' },
          p.ajuda.map(a => el('li', {}, a))) : null);
    });
    areaPerguntas.replaceChildren(
      el('p', { class: 'texto-suave' }, 'Germes prováveis (protocolo): ' + sindrome.germes.join(', ') + '.'),
      ...linhas,
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-primario', onclick: analisar }, 'Analisar caso')));
  }
  selSindrome.addEventListener('change', desenharPerguntas);

  function analisar() {
    const sindrome = protocoloAtual().sindromes.find(s => s.id === selSindrome.value);
    if (!sindrome) return;
    const respostas = {};
    for (const [id, { controle, tipo }] of controles) {
      respostas[id] = tipo === 'escolha' ? controle.value : controle.value === 'S';
    }
    const decisao = sindrome.decidir(respostas);
    /* Fluxos vindos de PCDT/manual do MS (03/10/2026) ainda não homologados pela CCIH: o
       aviso aparece aqui e no miniapp até a homologação virar adendo. */
    if (sindrome.homologacao === 'pendente') {
      decisao.avisos = ['Fluxo baseado em ' + (sindrome.fonte || 'documento nacional') + ' — ainda NÃO homologado pela CCIH do HNSC.', ...(decisao.avisos || [])];
    }
    const antibiograma = antibiogramaLocalPorGermes(bancos, sindrome.germes, hoje, 24);
    const avisosLocais = avisosDeResistenciaLocal(decisao.esquemas, antibiograma);
    const avisosPaciente = (contexto && contexto.alertas) || [];

    const tabelaAntibiograma = bloco => el('details', {},
      el('summary', {}, `${bloco.germe} — ${fmtInt(bloco.culturas)} isolados locais (24 meses)`),
      bloco.linhas.length ? el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Antibiótico', '%R local', 'Testados'].map(c => el('th', {}, c)))),
        el('tbody', {}, bloco.linhas.slice(0, 12).map(l => el('tr', {},
          el('td', {}, l.rotulo),
          el('td', { style: l.pctR >= 30 ? 'color:#a33;font-weight:600' : '' }, l.pctR + '%'),
          el('td', {}, fmtInt(l.testados))))))
        : el('p', { class: 'texto-suave' }, 'Sem antibiograma local para este germe.'));

    areaResultado.replaceChildren(el('div', { class: 'cartao' },
      el('h2', {}, 'Sugestão — ' + sindrome.rotulo),
      el('table', { class: 'tabela' }, el('tbody', {},
        decisao.esquemas.map(e => el('tr', {},
          el('td', {}, el('strong', {}, e.rotulo)),
          el('td', {}, e.posologia))))),
      (avisosPaciente.length || avisosLocais.length || decisao.avisos.length)
        ? el('div', { class: 'aviso-alerta' },
            el('div', { class: 'alerta-titulo' }, '⚠ Avisos dos dados locais'),
            el('ul', {}, [...avisosPaciente, ...avisosLocais, ...decisao.avisos].map(a => el('li', {}, a))))
        : null,
      el('h3', {}, 'Culturas e exames antes do antibiótico'),
      el('ul', {}, decisao.exames.map(x => el('li', { class: 'texto-suave' }, x))),
      el('h3', {}, 'Ajuste à função renal'),
      el('p', { class: 'texto-suave' }, ORIENTACAO_RENAL),
      ...ajusteRenalDosEsquemas(decisao.esquemas).map(r => el('details', {},
        el('summary', {}, r.rotulo + (r.nota ? ' — ' + r.nota : '')),
        el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['TFG/ClCr (mL/min)', 'Dose'].map(c => el('th', {}, c)))),
          el('tbody', {}, r.faixas.map(([tfg, dose]) => el('tr', {}, el('td', {}, tfg), el('td', {}, dose))))))),
      ajusteRenalDosEsquemas(decisao.esquemas).length ? null
        : el('p', { class: 'texto-suave' }, 'Nenhuma droga do esquema precisa de ajuste renal.'),
      el('h3', {}, 'Antibiograma local dos germes prováveis'),
      ...antibiograma.map(tabelaAntibiograma),
      el('p', { class: 'texto-suave' }, REVISAO_PROTOCOLO_ATB),
      el('p', { class: 'texto-suave' },
        'Fonte: ' + (sindrome.fonte || protocoloAtual().fonte) + '. Ferramenta de APOIO à decisão — não substitui o julgamento '
        + 'clínico nem a avaliação da CCIH para antimicrobianos auditados.'),
      (protocoloAtual().adendos || []).length ? el('p', { class: 'texto-suave' }, 'Adendos validados pela CCIH: '
        + protocoloAtual().adendos.map(a => `${a.data.split('-').reverse().join('/')} — ${a.texto}`).join(' · ')) : null));
  }

  conteudo.append(el('div', { class: 'cartao' },
    el('h2', {}, 'Caso'),
    el('div', { class: 'linha-campos' },
      el('label', {}, 'Protocolo: ', selProtocolo),
      el('label', {}, 'Prontuário: ', campoProntuario)),
    pPublico,
    areaContexto,
    areaNavegacao,
    areaSindrome,
    areaIVVO),
    areaResultado);
  aoTrocarProtocolo();   /* estado inicial: público, botão de específicas e home */

  /* ---- Decisões recebidas dos médicos assistentes (miniapp) ----
     Fecha o ciclo: o que foi perguntado, o que o protocolo sugeriu e o que foi prescrito.
     A adesão por síndrome mostra onde o protocolo convence e onde precisa de conversa. */
  const recebidas = (bancos.antibioticos.decisoes_empiricas || []).slice()
    .sort((a, b) => String(b.Data + b.Hora).localeCompare(String(a.Data + a.Hora)));
  if (recebidas.length) {
    const seguiram = recebidas.filter(d => d.SeguiuProtocolo === 'S').length;
    /* Adesão por protocolo › síndrome (03/10/2026): emergência e UTI são indicadores
       distintos. Registros antigos, sem a coluna, caem em "emergencia-adulto". */
    const porSindrome = new Map();
    for (const d of recebidas) {
      const s = String(d.Protocolo || 'emergencia-adulto').trim() + ' › ' + String(d.Sindrome || '(sem síndrome)').trim();
      if (!porSindrome.has(s)) porSindrome.set(s, { total: 0, seguiu: 0 });
      const reg = porSindrome.get(s);
      reg.total++;
      if (d.SeguiuProtocolo === 'S') reg.seguiu++;
    }
    conteudo.append(el('div', { class: 'cartao' },
      el('h2', {}, `Decisões recebidas dos assistentes (${fmtInt(recebidas.length)})`),
      el('p', { class: 'texto-suave' },
        `Adesão ao protocolo: ${Math.round(seguiram / recebidas.length * 100)}% `
        + `(${fmtInt(seguiram)} de ${fmtInt(recebidas.length)}). Enviadas pelo miniapp e importadas na aba Importar.`),
      el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Protocolo › síndrome', 'Decisões', 'Seguiram o protocolo'].map(c => el('th', {}, c)))),
        el('tbody', {}, [...porSindrome.entries()].sort((a, b) => b[1].total - a[1].total)
          .map(([s, r]) => el('tr', {},
            el('td', {}, s), el('td', {}, fmtInt(r.total)),
            el('td', {}, `${Math.round(r.seguiu / r.total * 100)}%`))))),
      el('details', {},
        el('summary', {}, 'Últimas decisões registradas'),
        el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['Data', 'Prontuário', 'Síndrome', 'Sugerido', 'Conduta adotada', 'Quem decidiu'].map(c => el('th', {}, c)))),
          el('tbody', {}, recebidas.slice(0, 100).map(d => el('tr', {
            class: d.Prontuario ? 'linha-clicavel' : '',
            onclick: d.Prontuario ? () => abrirPaciente(d.Prontuario) : null
          },
            el('td', {}, String(d.Data || '').split('-').reverse().join('/')),
            el('td', {}, d.Prontuario || '—'),
            el('td', {}, d.Sindrome),
            el('td', {}, String(d.EsquemaSugerido || '').slice(0, 60)),
            el('td', { style: d.SeguiuProtocolo === 'S' ? '' : 'color:#a33;font-weight:600' },
              d.SeguiuProtocolo === 'S' ? 'seguiu a sugestão' : String(d.CondutaAdotada || '').slice(0, 60)),
            el('td', {}, d.CriadoPor || ''))))))));
  }
}
