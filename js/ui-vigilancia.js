/* Aba Pós-alta: vigilância de infecção de sítio cirúrgico depois que o paciente foi embora.

   O caminho de uma cirurgia aqui dentro:
     pendente → (triagem com checkbox) → sob vigilância | dispensada
     sob vigilância → (WhatsApp) → mensagem enviada
     mensagem enviada → sem infecção | em investigação
     em investigação → (validação por um segundo profissional) → infecção confirmada
     janela vencida sem resposta → encerrada sem contato
   Toda transição é reversível — abortar no meio não pode deixar rastro errado. */

const MODELO_PADRAO_VIGILANCIA = 'Olá, {nome}! Aqui é da CCIH do hospital. Você operou ({procedimento}) '
  + 'em {data} e estamos acompanhando sua recuperação. Como está o local da cirurgia? '
  + 'Notou vermelhidão, dor que piora, secreção, febre ou abertura de pontos? '
  + 'Pode responder por aqui mesmo — obrigado!';

const CHAVE_MODELO = 'mensagem_vigilancia_pos_alta';

async function lerModeloVigilancia() {
  try {
    const meta = (await lerBanco('config')).meta || [];
    const linha = meta.find(l => l.Chave === CHAVE_MODELO);
    return (linha && String(linha.Valor).trim()) ? linha.Valor : MODELO_PADRAO_VIGILANCIA;
  } catch (e) { return MODELO_PADRAO_VIGILANCIA; }
}

async function gravarModeloVigilancia(texto) {
  await comTrava(['config'], async () => {
    const banco = await lerBanco('config');
    banco.meta = (banco.meta || []).filter(l => l.Chave !== CHAVE_MODELO);
    banco.meta.push({ Chave: CHAVE_MODELO, Valor: texto });
    await gravarBanco('config', banco);
  });
}

/* Toda mudança de status passa por aqui: relê o banco sob trava, aplica e grava.
   `mudancas` recebe a linha fresca do banco — nunca a cópia da tela. */
async function mudarStatusCirurgia(idCirurgia, mudancas) {
  await comTrava(['cirurgias'], async () => {
    const banco = await lerBanco('cirurgias');
    const alvo = banco.cirurgias.find(c => c.ID_Cirurgia === idCirurgia);
    if (!alvo) throw new Error('Cirurgia não encontrada no banco.');
    mudancas(alvo);
    await gravarBanco('cirurgias', banco);
  });
}

async function montarVigilancia(conteudo) {
  conteudo.append(el('h1', {}, 'Vigilância pós-alta (cirurgias)'));
  let banco, bancoPacientes, modelo;
  try {
    [banco, bancoPacientes, modelo] = await Promise.all([
      lerBanco('cirurgias'), lerBanco('pacientes'), lerModeloVigilancia()
    ]);
  } catch (e) { conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message)); return; }

  const hoje = hojeISO();

  /* ---- Exclusão automática por óbito ----
     Quem faleceu depois da cirurgia sai da fila sozinho: status "encerrada — óbito",
     gravado UMA vez sob trava. Não há botão de reverter aqui de propósito — enquanto o
     óbito existir no cadastro, a vigilância reencerraria no próximo carregamento; a
     correção certa é no registro de óbito do paciente. */
  const indiceObitos = indiceDeObitos(bancoPacientes);
  const ATIVAS_PARA_OBITO = ['pendente', 'sob vigilância', 'mensagem enviada'];
  const faleceu = c => faleceuAposCirurgia(c, indiceObitos);
  const falecidasAbertas = banco.cirurgias.filter(c =>
    ATIVAS_PARA_OBITO.includes(String(c.StatusVigilancia || 'pendente')) && faleceu(c));
  /* O caminho de volta: óbito corrigido/apagado no cadastro → a vigilância reabre sozinha. */
  const reabrirSemObito = banco.cirurgias.filter(c =>
    String(c.StatusVigilancia) === 'encerrada — óbito' && !faleceu(c));
  if (falecidasAbertas.length || reabrirSemObito.length) {
    try {
      await comTrava(['cirurgias'], async () => {
        const atual = await lerBanco('cirurgias');
        for (const c of falecidasAbertas) {
          const alvo = atual.cirurgias.find(x => x.ID_Cirurgia === c.ID_Cirurgia);
          if (!alvo || !ATIVAS_PARA_OBITO.includes(String(alvo.StatusVigilancia || 'pendente'))) continue;
          alvo.StatusVigilancia = 'encerrada — óbito';
          const dataObito = indiceObitos.get(normalizarProntuario(c.Prontuario));
          alvo.ObservacoesVigilancia = (String(alvo.ObservacoesVigilancia || '') + ' '
            + `Encerrada automaticamente: óbito${dataObito ? ' em ' + dataObito : ''}.`).trim();
        }
        for (const c of reabrirSemObito) {
          const alvo = atual.cirurgias.find(x => x.ID_Cirurgia === c.ID_Cirurgia);
          if (!alvo || String(alvo.StatusVigilancia) !== 'encerrada — óbito') continue;
          alvo.StatusVigilancia = 'pendente';
          alvo.ObservacoesVigilancia = (String(alvo.ObservacoesVigilancia || '') + ' '
            + 'Reaberta: o registro de óbito foi corrigido.').trim();
        }
        await gravarBanco('cirurgias', atual);
      });
      banco = await lerBanco('cirurgias');
      const partes = [];
      if (falecidasAbertas.length) partes.push(`✝ ${fmtInt(falecidasAbertas.length)} vigilância(s) encerradas automaticamente por óbito registrado`);
      if (reabrirSemObito.length) partes.push(`${fmtInt(reabrirSemObito.length)} reabertas após correção do óbito`);
      conteudo.append(el('p', { class: 'texto-suave' }, partes.join(' · ') + '.'));
    } catch (e) { /* trava de outro usuário: nesta sessão o filtro abaixo segura as filas */ }
  }

  const pacientePor = new Map(bancoPacientes.pacientes.map(p => [normalizarProntuario(p.Prontuario), p]));
  const nomeDe = c => (pacientePor.get(normalizarProntuario(c.Prontuario)) || {}).Nome || '';
  const telefoneDe = c => (pacientePor.get(normalizarProntuario(c.Prontuario)) || {}).Telefone || '';
  const idadePosOp = c => diasDesde(c.DataCirurgia, hoje);

  const naJanela = c => {
    const dias = idadePosOp(c);
    return dias !== null && dias >= JANELA_VIGILANCIA.inicioDias && dias <= JANELA_VIGILANCIA.fimDias;
  };
  const janelaVencida = c => {
    const dias = idadePosOp(c);
    return dias !== null && dias > JANELA_VIGILANCIA.fimDias;
  };

  /* ---- Filtro de período: mês da cirurgia ----
     Vale para todas as listas da tela. A escolha vive na sessão (app.filtroMesVigilancia)
     para sobreviver aos recarregamentos que cada ação da tela dispara. */
  const mesesDisponiveis = [...new Set(banco.cirurgias
    .map(c => String(c.DataCirurgia).slice(0, 7)).filter(m => /^\d{4}-\d{2}$/.test(m)))]
    .sort().reverse();
  const mesFiltro = mesesDisponiveis.includes(app.filtroMesVigilancia) ? app.filtroMesVigilancia : '';
  const doMes = c => !mesFiltro || String(c.DataCirurgia).slice(0, 7) === mesFiltro;
  const mesBR = m => m.split('-').reverse().join('/');
  const selMes = el('select', { onchange: ev => { app.filtroMesVigilancia = ev.target.value; recarregar(); } },
    el('option', { value: '' }, 'todos os meses'),
    mesesDisponiveis.map(m => el('option', { value: m, selected: m === mesFiltro ? '' : null }, mesBR(m))));
  conteudo.append(el('div', { class: 'cartao' },
    el('div', { class: 'linha-campos' },
      el('label', {}, 'Mês da cirurgia: ', selMes),
      el('span', { class: 'texto-suave' },
        mesFiltro ? `mostrando só cirurgias de ${mesBR(mesFiltro)} em todas as listas` : 'todas as listas, sem filtro'))));

  const porStatus = status => banco.cirurgias.filter(c => c.StatusVigilancia === status && doMes(c));
  const recarregar = () => navegar('vigilancia', { historico: 'substituir' });

  const categoriasVigiadas = config.rotina.vigilanciaCategorias;
  const seloImplante = c => classificarParaVigilancia(c, categoriasVigiadas).implante
    ? el('span', { class: 'selo', style: 'color:#533ab7;font-weight:600', title: 'Com prótese/implante — vigilância vale até 90 dias' }, ' ⚙ prótese')
    : null;
  const seloVencida = c => janelaVencida(c)
    ? el('span', { class: 'selo aviso-erro-texto', title: 'Passou dos 120 dias sem desfecho' }, ' ⏰ janela vencida')
    : null;

  /* ---- 1. Triagem: o que entra na vigilância ---- */
  /* O .filter(!faleceu) das três filas é o cinto de segurança para quando a trava de
     outro usuário impediu a gravação do encerramento: falecido não aparece nem assim. */
  const triagem = porStatus('pendente').filter(naJanela).filter(c => !faleceu(c))
    .sort((a, b) => String(a.DataCirurgia).localeCompare(String(b.DataCirurgia)));

  /* Triagem vazia parecia defeito quando era eficiência: a equipe zera a janela e as
     cirurgias novas ainda não completaram 30 dias. O painel agora conta as que estão
     a caminho e diz QUANDO a primeira entra. */
  const aCaminho = porStatus('pendente').filter(c => {
    const d = idadePosOp(c);
    return d !== null && d >= 0 && d < JANELA_VIGILANCIA.inicioDias;
  }).filter(c => !faleceu(c));
  const proximaEntrada = aCaminho.length
    ? new Date(Date.parse(aCaminho.map(c => String(c.DataCirurgia).slice(0, 10)).sort()[0] + 'T00:00:00Z')
        + JANELA_VIGILANCIA.inicioDias * 86400000).toISOString().slice(0, 10).split('-').reverse().join('/')
    : null;
  const avisoACaminho = aCaminho.length
    ? el('p', { class: 'texto-suave' },
        `⏳ ${fmtInt(aCaminho.length)} cirurgia(s) recentes aguardam completar ${JANELA_VIGILANCIA.inicioDias} dias de pós-operatório — a primeira entra na triagem em ${proximaEntrada}.`)
    : null;
  if (!triagem.length) {
    conteudo.append(el('div', { class: 'cartao' },
      el('h2', {}, 'Triagem — nenhuma cirurgia aguardando'),
      el('p', { class: 'texto-suave' },
        'Todas as cirurgias da janela de 30–120 dias já foram triadas.'),
      avisoACaminho || el('p', { class: 'texto-suave' }, 'Também não há cirurgias recentes a caminho — confira se o relatório do centro cirúrgico está sendo importado.')));
  }

  if (triagem.length) {
    const caixas = new Map();
    const linhasTabela = triagem.map(c => {
      const regra = classificarParaVigilancia(c, categoriasVigiadas);
      const caixa = el('input', { type: 'checkbox', checked: regra.marcar ? '' : null });
      caixas.set(c.ID_Cirurgia, caixa);
      const tr = el('tr', { class: regra.marcar ? '' : 'linha-esmaecida' },
        el('td', {}, caixa),
        el('td', {}, c.DataCirurgia, el('span', { class: 'texto-suave' }, ` (${idadePosOp(c)}d)`)),
        el('td', {}, nomeDe(c) || c.Prontuario),
        el('td', {}, String(c.Procedimento || '').slice(0, 60), seloImplante(c)),
        el('td', { class: 'texto-suave' }, regra.motivo));
      caixa.addEventListener('change', () => { tr.className = caixa.checked ? '' : 'linha-esmaecida'; });
      return tr;
    });

    const msgTriagem = el('p', { class: 'aviso-erro-texto' });
    conteudo.append(el('div', { class: 'cartao' },
      el('h2', {}, `Triagem — ${fmtInt(triagem.length)} cirurgias de 30 a 120 dias`),
      avisoACaminho,
      el('p', { class: 'texto-suave' },
        'Pré-marcadas conforme a rotina da instituição (Configurações → Rotina → cirurgias vigiadas; '
        + 'padrão de fábrica: próteses/implantes, cesarianas e limpas). O relatório do centro cirúrgico '
        + 'ainda não traz o potencial de contaminação — enquanto isso, as categorias que dependem dele '
        + 'aparecem como "sem classificação". Marque ou desmarque à vontade antes de confirmar.'),
      el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Vigiar', 'Cirurgia', 'Paciente', 'Procedimento', 'Regra'].map(t => el('th', {}, t)))),
        el('tbody', {}, linhasTabela)),
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-primario', onclick: async () => {
          try {
            const marcadas = triagem.filter(c => caixas.get(c.ID_Cirurgia).checked);
            const dispensadas = triagem.filter(c => !caixas.get(c.ID_Cirurgia).checked);
            await comTrava(['cirurgias'], async () => {
              const atual = await lerBanco('cirurgias');
              const indice = new Map(atual.cirurgias.map(c => [c.ID_Cirurgia, c]));
              for (const c of marcadas) {
                const alvo = indice.get(c.ID_Cirurgia);
                if (alvo && alvo.StatusVigilancia === 'pendente') {
                  alvo.StatusVigilancia = 'sob vigilância';
                  alvo.VigilanciaPor = app.usuario;
                }
              }
              for (const c of dispensadas) {
                const alvo = indice.get(c.ID_Cirurgia);
                if (alvo && alvo.StatusVigilancia === 'pendente') alvo.StatusVigilancia = 'dispensada';
              }
              await gravarBanco('cirurgias', atual);
            });
            recarregar();
          } catch (e) { msgTriagem.textContent = e.message; }
        } }, 'Confirmar triagem')), msgTriagem));
  }

  /* ---- 2. Modelo da mensagem ---- */
  const campoModelo = el('textarea', { rows: 4, style: 'width:100%' }, modelo);
  const msgModelo = el('span', { class: 'texto-suave' });
  const sobVigilancia = porStatus('sob vigilância').filter(c => !faleceu(c))
    .sort((a, b) => String(a.DataCirurgia).localeCompare(String(b.DataCirurgia)));

  conteudo.append(el('div', { class: 'cartao' },
    el('h2', {}, 'Mensagem padrão do WhatsApp'),
    el('p', { class: 'texto-suave' },
      'Campos que se preenchem sozinhos: {nome}, {procedimento}, {data}. O modelo fica salvo no banco e vale para todos.'),
    campoModelo,
    el('div', { class: 'linha-botoes' },
      el('button', { class: 'botao-secundario', onclick: async () => {
        try { await gravarModeloVigilancia(campoModelo.value); msgModelo.textContent = 'Modelo salvo ✓'; }
        catch (e) { msgModelo.textContent = e.message; }
      } }, 'Salvar modelo'), msgModelo)));

  /* ---- 3. Sob vigilância: enviar mensagem ---- */
  function linhaContato(c, aposEnvio) {
    const paciente = pacientePor.get(normalizarProntuario(c.Prontuario));
    const telefone = telefoneDe(c);
    if (telefoneWhatsApp(telefone)) {
      const dados = {
        nome: String(nomeDe(c)).split(' ')[0] || 'paciente',
        procedimento: String(c.Procedimento || '').trim(),
        data: String(c.DataCirurgia || '').slice(0, 10).split('-').reverse().join('/')
      };
      const link = linkWhatsApp(telefone, aposEnvio ? '' : mensagemVigilancia(campoModelo.value, dados));
      return el('a', { href: link, target: '_blank', class: 'botao-secundario', style: 'text-decoration:none',
        onclick: aposEnvio ? null : async () => {
          /* O clique abre o WhatsApp e marca o envio. Se a pessoa abortar lá, o ↩ desfaz. */
          try {
            await mudarStatusCirurgia(c.ID_Cirurgia, alvo => {
              alvo.StatusVigilancia = 'mensagem enviada';
              alvo.MensagemEnviadaEm = hoje;
              alvo.UltimoContato = hoje;
            });
            setTimeout(recarregar, 300);
          } catch (e) { alert(e.message); }
        } }, aposEnvio ? '💬 abrir contato' : '💬 enviar WhatsApp');
    }
    /* Sem telefone utilizável: campo para registrar na hora. */
    const campoTel = el('input', { type: 'text', placeholder: 'DDD + número', style: 'width:130px' });
    return el('span', {}, campoTel, ' ',
      el('button', { class: 'botao-secundario', onclick: async () => {
        try {
          if (!telefoneWhatsApp(campoTel.value)) { alert('Número inválido — use DDD + número.'); return; }
          await comTrava(['pacientes'], async () => {
            const atual = await lerBanco('pacientes');
            const alvo = atual.pacientes.find(p => normalizarProntuario(p.Prontuario) === normalizarProntuario(c.Prontuario));
            if (!alvo) throw new Error('Paciente não está no cadastro.');
            alvo.Telefone = campoTel.value;
            await gravarBanco('pacientes', atual);
          });
          recarregar();
        } catch (e) { alert(e.message); }
      } }, 'Salvar telefone'));
  }

  /* Reverter uma etapa que mexeu na IRAS precisa desfazer TAMBÉM a IRAS: a investigação
     revertida apaga o caso que abriu (se ninguém confirmou); a confirmação revertida
     devolve o caso para "em investigação" e limpa a assinatura de validação. */
  const reverterComIras = (c, statusAnterior, modo) => el('button', {
    class: 'botao-secundario', title: 'Reverter para "' + statusAnterior + '"',
    onclick: async () => {
      try {
        await comTrava(['cirurgias', 'iras'], async () => {
          const atualCir = await lerBanco('cirurgias');
          const atualIras = await lerBanco('iras');
          const alvo = atualCir.cirurgias.find(x => x.ID_Cirurgia === c.ID_Cirurgia);
          if (!alvo) throw new Error('Cirurgia não encontrada.');
          const caso = atualIras.casos.find(k => k.ID_IRAS === alvo.ID_IRAS);
          if (modo === 'apagarIras') {
            if (caso && caso.StatusInvestigacao === 'confirmado') {
              throw new Error('O caso de IRAS já foi confirmado — desfaça a validação primeiro.');
            }
            atualIras.casos = atualIras.casos.filter(k => k.ID_IRAS !== alvo.ID_IRAS);
            alvo.ISC = ''; alvo.TipoISC = ''; alvo.ID_IRAS = ''; alvo.InvestigadoPor = '';
          } else {
            if (caso) caso.StatusInvestigacao = 'em investigação';
            alvo.ValidadoPor = ''; alvo.ValidadoEm = '';
          }
          alvo.StatusVigilancia = statusAnterior;
          await gravarBanco('iras', atualIras);
          await gravarBanco('cirurgias', atualCir);
        });
        recarregar();
      } catch (e) { alert(e.message); }
    } }, '↩');

  const botaoReverter = (c, statusAnterior, extras) => el('button', {
    class: 'botao-secundario', title: 'Reverter para "' + statusAnterior + '"',
    onclick: async () => {
      try {
        await mudarStatusCirurgia(c.ID_Cirurgia, alvo => {
          alvo.StatusVigilancia = statusAnterior;
          if (extras) extras(alvo);
        });
        recarregar();
      } catch (e) { alert(e.message); }
    } }, '↩');

  if (sobVigilancia.length) {
    conteudo.append(el('div', { class: 'cartao' },
      el('h2', {}, `Sob vigilância — ${fmtInt(sobVigilancia.length)} aguardando contato`),
      el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Cirurgia', 'Paciente', 'Procedimento', 'Contato', ''].map(t => el('th', {}, t)))),
        el('tbody', {}, sobVigilancia.map(c => el('tr', {},
          el('td', {}, c.DataCirurgia, el('span', { class: 'texto-suave' }, ` (${idadePosOp(c)}d)`), seloVencida(c)),
          el('td', { class: 'linha-clicavel', onclick: () => abrirPaciente(c.Prontuario) }, nomeDe(c) || c.Prontuario),
          el('td', {}, String(c.Procedimento || '').slice(0, 50), seloImplante(c)),
          el('td', {}, linhaContato(c, false)),
          el('td', {}, el('div', { class: 'linha-botoes' },
            janelaVencida(c)
              ? el('button', { class: 'botao-secundario', onclick: async () => {
                  try {
                    await mudarStatusCirurgia(c.ID_Cirurgia, alvo => { alvo.StatusVigilancia = 'encerrada sem contato'; });
                    recarregar();
                  } catch (e) { alert(e.message); }
                } }, 'Encerrar sem contato')
              : botaoReverter(c, 'pendente', alvo => { alvo.VigilanciaPor = ''; }),
            botaoNumeroIncorreto(c)))))))));
  }

  /* ---- 4. Mensagem enviada: aguardando resposta ---- */
  const enviadas = porStatus('mensagem enviada').filter(c => !faleceu(c))
    .sort((a, b) => String(a.MensagemEnviadaEm).localeCompare(String(b.MensagemEnviadaEm)));

  /* Acrescenta uma entrada ao diário de observações da cirurgia (datada e assinada). */
  const anotar = (alvo, rotulo, texto) => {
    alvo.ObservacoesVigilancia = acrescentarObservacao(alvo.ObservacoesVigilancia, rotulo, texto, app.usuario, agoraCurto());
  };

  /* ---- Registro da resposta da vigilância ----
     O que a enfermeira ouviu (a conversa) e o que ela acha (a avaliação) são registros
     separados no diário — quem valida depois lê os dois. O mesmo card resolve os dois
     desfechos: sem infecção ou abrir investigação de ISC. */
  function cartaoResposta(c, tr) {
    const campoConversa = el('textarea', { rows: 3, style: 'width:100%',
      placeholder: 'o que o paciente/família relatou na conversa (ferida, febre, secreção, retorno…)' });
    const campoAvaliacao = el('textarea', { rows: 2, style: 'width:100%',
      placeholder: 'avaliação de quem fez a busca: sua impressão sobre o caso' });
    const selTipo = el('select', {}, Object.entries(TIPOS_ISC).map(([v, r]) => el('option', { value: v }, r)));
    const campoData = el('input', { type: 'date', value: hoje });
    const msg = el('p', { class: 'aviso-erro-texto' });

    const registrarDiario = alvo => {
      anotar(alvo, 'Relato do paciente', campoConversa.value);
      anotar(alvo, 'Avaliação', campoAvaliacao.value);
    };

    const semInfeccao = async () => {
      try {
        await mudarStatusCirurgia(c.ID_Cirurgia, alvo => {
          registrarDiario(alvo);
          alvo.StatusVigilancia = 'sem infecção';
          alvo.UltimoContato = hoje;
        });
        recarregar();
      } catch (e) { msg.textContent = e.message; }
    };

    /* Paciente não responde às mensagens: encerra como "sem contato" — conta como busca
       tentada e não concluída no relatório de desempenho. */
    const semResposta = async () => {
      try {
        await mudarStatusCirurgia(c.ID_Cirurgia, alvo => {
          registrarDiario(alvo);
          anotar(alvo, '', 'Sem resposta às tentativas de contato.');
          alvo.StatusVigilancia = 'encerrada sem contato';
        });
        recarregar();
      } catch (e) { msg.textContent = e.message; }
    };

    const abrirInvestigacao = async () => {
      try {
        await comTrava(['cirurgias', 'iras'], async () => {
          const atualCir = await lerBanco('cirurgias');
          const atualIras = await lerBanco('iras');
          const alvo = atualCir.cirurgias.find(x => x.ID_Cirurgia === c.ID_Cirurgia);
          if (!alvo) throw new Error('Cirurgia não encontrada.');
          const idIras = proximoIDLista(atualIras.casos, 'ID_IRAS', 'IRA');
          /* A IRAS nasce "em investigação": o caso só vira oficial quando um segundo
             profissional valida — é a dupla assinatura que o processo pede. */
          atualIras.casos.push({
            ID_IRAS: idIras, Prontuario: alvo.Prontuario, DataInfeccao: campoData.value,
            Topografia: TIPOS_ISC[selTipo.value], CriterioDiagnostico: 'Vigilância pós-alta (contato telefônico)',
            Setor: '', DispositivoAssociado: '', Microrganismo: '',
            Desfecho: '', StatusInvestigacao: 'em investigação', NotificadoANVISA: '',
            CriadoPor: app.usuario, CriadoEm: agoraCurto()
          });
          alvo.StatusVigilancia = 'em investigação';
          alvo.ISC = 'S';
          alvo.TipoISC = selTipo.value;
          alvo.ID_IRAS = idIras;
          alvo.InvestigadoPor = app.usuario;
          registrarDiario(alvo);
          await gravarBanco('iras', atualIras);
          await gravarBanco('cirurgias', atualCir);
        });
        recarregar();
      } catch (e) { msg.textContent = e.message; }
    };

    detalharNaLinha(tr, el('div', { class: 'cartao cartao-detalhe' },
      el('h2', {}, 'Resposta da vigilância — ' + (nomeDe(c) || c.Prontuario)),
      el('label', {}, 'Relato do paciente (a conversa): ', campoConversa),
      el('label', {}, 'Avaliação da enfermagem: ', campoAvaliacao),
      el('div', { class: 'linha-campos' },
        el('label', {}, 'Tipo de ISC: ', selTipo),
        el('label', {}, 'Data da infecção: ', campoData),
        el('span', { class: 'texto-suave' }, '(só usados ao abrir investigação)')),
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-secundario', onclick: semInfeccao }, '✓ Sem infecção'),
        el('button', { class: 'botao-primario', onclick: abrirInvestigacao }, '⚠ Abrir investigação'),
        el('button', { class: 'botao-secundario', title: 'O paciente não respondeu às mensagens',
          onclick: semResposta }, '✗ Sem resposta'),
        botaoNumeroIncorreto(c)),
      el('p', { class: 'texto-suave' },
        'Os textos entram no diário da cirurgia, datados e assinados — a validação lê tudo.'),
      msg));
  }

  /* Erro de cadastro: número incorreto ou inexistente. Dá baixa, mas numa categoria
     própria — no relatório é descarte por cadastro, não falha da busca.
     FUNÇÃO (içada), não const: é chamada na montagem da fila "sob vigilância", que fica
     ACIMA desta declaração no arquivo — como const, a tela morria ali e as triadas
     sumiam com tudo que vem depois. */
  function botaoNumeroIncorreto(c) { return el('button', {
    class: 'botao-secundario', title: 'Telefone incorreto ou inexistente no cadastro — dá baixa em categoria própria',
    onclick: async () => {
      try {
        await mudarStatusCirurgia(c.ID_Cirurgia, alvo => {
          anotar(alvo, '', 'Número de telefone incorreto ou inexistente no cadastro.');
          alvo.StatusVigilancia = 'encerrada — número incorreto';
        });
        recarregar();
      } catch (e) { alert(e.message); }
    } }, '☎ Número incorreto'); }

  /* Botão "＋": observação avulsa a qualquer momento, sem mudar o status.
     Também FUNÇÃO içada — é chamada na montagem das filas. */
  function botaoMaisObservacao(c) { return el('button', {
    class: 'botao-secundario', title: 'Adicionar observação ao diário (não muda o status)',
    onclick: async () => {
      const texto = prompt('Nova observação para ' + (nomeDe(c) || c.Prontuario) + ':');
      if (texto === null || !texto.trim()) return;
      try {
        await mudarStatusCirurgia(c.ID_Cirurgia, alvo => anotar(alvo, '', texto));
        recarregar();
      } catch (e) { alert(e.message); }
    } }, '＋'); }

  if (enviadas.length) {
    conteudo.append(el('div', { class: 'cartao' },
      el('h2', {}, `Mensagem enviada — ${fmtInt(enviadas.length)} aguardando resposta`),
      el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Enviada em', 'Paciente', 'Procedimento', 'Contato', 'Desfecho', ''].map(t => el('th', {}, t)))),
        el('tbody', {}, enviadas.map(c => el('tr', {},
          el('td', {}, c.MensagemEnviadaEm || '—',
            el('span', { class: 'texto-suave' }, c.MensagemEnviadaEm ? ` (${diasDesde(c.MensagemEnviadaEm, hoje)}d)` : ''), seloVencida(c)),
          el('td', { class: 'linha-clicavel', onclick: () => abrirPaciente(c.Prontuario) }, nomeDe(c) || c.Prontuario),
          el('td', {}, String(c.Procedimento || '').slice(0, 44), seloImplante(c)),
          el('td', {}, linhaContato(c, true)),
          el('td', {}, el('div', { class: 'linha-botoes' },
            el('button', { class: 'botao-primario', title: 'Registrar a conversa e o desfecho (sem infecção ou investigação)',
              onclick: e => cartaoResposta(c, e.currentTarget.closest('tr')) }, '📞 Registrar resposta'),
            botaoMaisObservacao(c))),
          el('td', {}, janelaVencida(c)
            ? el('button', { class: 'botao-secundario', onclick: async () => {
                try {
                  await mudarStatusCirurgia(c.ID_Cirurgia, alvo => { alvo.StatusVigilancia = 'encerrada sem contato'; });
                  recarregar();
                } catch (e) { alert(e.message); }
              } }, 'Encerrar sem contato')
            : botaoReverter(c, 'sob vigilância', alvo => { alvo.MensagemEnviadaEm = ''; }))))))));
  }

  /* ---- 5. Em investigação: validar ---- */
  const investigacoes = porStatus('em investigação');
  if (investigacoes.length) {
    conteudo.append(el('div', { class: 'cartao' },
      el('h2', {}, `Em investigação — ${fmtInt(investigacoes.length)} aguardando validação`),
      el('p', { class: 'texto-suave' },
        'A validação é a segunda assinatura: quem valida não precisa ser quem investigou, e o caso de IRAS '
        + 'só vira confirmado aqui.'),
      el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Paciente', 'Procedimento', 'Tipo de ISC', 'Investigou', 'Observações', 'Validação', ''].map(t => el('th', {}, t)))),
        el('tbody', {}, investigacoes.map(c => {
          const caixaValida = el('input', { type: 'checkbox' });
          caixaValida.addEventListener('change', async () => {
            if (!caixaValida.checked) return;
            try {
              await comTrava(['cirurgias', 'iras'], async () => {
                const atualCir = await lerBanco('cirurgias');
                const atualIras = await lerBanco('iras');
                const alvo = atualCir.cirurgias.find(x => x.ID_Cirurgia === c.ID_Cirurgia);
                if (!alvo) throw new Error('Cirurgia não encontrada.');
                alvo.StatusVigilancia = 'infecção confirmada';
                alvo.ValidadoPor = app.usuario;
                alvo.ValidadoEm = hoje;
                const caso = atualIras.casos.find(k => k.ID_IRAS === alvo.ID_IRAS);
                if (caso) { caso.StatusInvestigacao = 'confirmado'; caso.ConfirmadoPor = app.usuario; caso.ConfirmadoEm = hoje; }
                await gravarBanco('iras', atualIras);
                await gravarBanco('cirurgias', atualCir);
              });
              recarregar();
            } catch (e) { caixaValida.checked = false; alert(e.message); }
          });
          return el('tr', {},
            el('td', { class: 'linha-clicavel', onclick: () => abrirPaciente(c.Prontuario) }, nomeDe(c) || c.Prontuario),
            el('td', {}, String(c.Procedimento || '').slice(0, 40)),
            el('td', {}, TIPOS_ISC[c.TipoISC] || c.TipoISC),
            el('td', {}, c.InvestigadoPor),
            el('td', { class: 'texto-suave', style: 'white-space:pre-line;max-width:420px' },
              String(c.ObservacoesVigilancia || '')),
            el('td', {}, el('label', {}, caixaValida, ' validada')),
            el('td', {}, el('div', { class: 'linha-botoes' },
              botaoMaisObservacao(c), reverterComIras(c, 'mensagem enviada', 'apagarIras'))));
        })))));
  }

  /* ---- 6. Encerradas ---- */
  const semInfeccao = porStatus('sem infecção');
  const confirmadas = porStatus('infecção confirmada');
  const semContato = porStatus('encerrada sem contato');
  const dispensadas = porStatus('dispensada');
  const porObito = porStatus('encerrada — óbito');
  const numeroErrado = porStatus('encerrada — número incorreto');

  conteudo.append(el('div', { class: 'grade-cartoes' },
    [[sobVigilancia.length, 'sob vigilância'], [enviadas.length, 'mensagens aguardando resposta'],
     [semInfeccao.length, 'sem infecção'], [confirmadas.length, 'infecções confirmadas'],
     [semContato.length, 'encerradas sem contato'], [porObito.length, 'encerradas por óbito'],
     [numeroErrado.length, 'número incorreto/inexistente']].map(([n, r]) =>
      el('div', { class: 'cartao cartao-numero' },
        el('div', { class: 'numero-grande' }, fmtInt(n)), el('div', { class: 'texto-suave' }, r)))));

  const blocoEncerradas = (titulo, lista, statusVolta) => el('details', {},
    el('summary', {}, `${titulo} (${fmtInt(lista.length)})`),
    el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Cirurgia', 'Paciente', 'Procedimento', 'Por', ''].map(t => el('th', {}, t)))),
      el('tbody', {}, lista.slice(0, 200).map(c => el('tr', {},
        el('td', {}, c.DataCirurgia),
        el('td', { class: 'linha-clicavel', onclick: () => abrirPaciente(c.Prontuario) }, nomeDe(c) || c.Prontuario),
        el('td', {}, String(c.Procedimento || '').slice(0, 50)),
        el('td', { class: 'texto-suave' }, c.ValidadoPor || c.InvestigadoPor || c.VigilanciaPor || ''),
        el('td', {}, botaoReverter(c, statusVolta)))))));

  const blocoObitos = () => el('details', {},
    el('summary', {}, `Encerradas por óbito (${fmtInt(porObito.length)})`),
    el('p', { class: 'texto-suave' },
      'Encerramento automático: o paciente tem óbito registrado após a cirurgia. Não há botão de reverter — '
      + 'se o óbito estiver errado, corrija o registro do paciente e a vigilância reabre pela triagem.'),
    el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Cirurgia', 'Paciente', 'Procedimento', 'Óbito em'].map(t => el('th', {}, t)))),
      el('tbody', {}, porObito.slice(0, 200).map(c => el('tr', {},
        el('td', {}, c.DataCirurgia),
        el('td', { class: 'linha-clicavel', onclick: () => abrirPaciente(c.Prontuario) }, nomeDe(c) || c.Prontuario),
        el('td', {}, String(c.Procedimento || '').slice(0, 50)),
        el('td', {}, indiceObitos.get(normalizarProntuario(c.Prontuario)) || 'data não informada'))))));

  if (semInfeccao.length || confirmadas.length || semContato.length || dispensadas.length
      || porObito.length || numeroErrado.length) {
    conteudo.append(el('div', { class: 'cartao' },
      el('h2', {}, 'Encerradas'),
      blocoEncerradas('Vigilância realizada sem infecção', semInfeccao, 'mensagem enviada'),
      el('details', {},
        el('summary', {}, `Infecções confirmadas (${fmtInt(confirmadas.length)})`),
        el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['Cirurgia', 'Paciente', 'Tipo de ISC', 'Investigou', 'Validou', ''].map(t => el('th', {}, t)))),
          el('tbody', {}, confirmadas.slice(0, 200).map(c => el('tr', {},
            el('td', {}, c.DataCirurgia),
            el('td', { class: 'linha-clicavel', onclick: () => abrirPaciente(c.Prontuario) }, nomeDe(c) || c.Prontuario),
            el('td', {}, TIPOS_ISC[c.TipoISC] || c.TipoISC),
            el('td', {}, c.InvestigadoPor), el('td', {}, `${c.ValidadoPor} em ${c.ValidadoEm}`),
            el('td', {}, reverterComIras(c, 'em investigação', 'reabrirIras'))))))),
      blocoEncerradas('Sem contato (janela vencida)', semContato, 'sob vigilância'),
      blocoEncerradas('Número incorreto ou inexistente', numeroErrado, 'sob vigilância'),
      blocoEncerradas('Dispensadas na triagem', dispensadas, 'pendente'),
      porObito.length ? blocoObitos() : null));
  }

  if (!triagem.length && !sobVigilancia.length && !enviadas.length && !investigacoes.length
      && !semInfeccao.length && !confirmadas.length && !semContato.length) {
    conteudo.append(el('div', { class: 'cartao' }, el('p', { class: 'texto-suave' },
      'Nenhuma cirurgia na janela de vigilância (30 a 120 dias de pós-operatório). '
      + 'As cirurgias entram aqui automaticamente conforme completam 30 dias.')));
  }
}
