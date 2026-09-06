/* Aba "Decisão ATB": apoio à decisão de antibioticoterapia empírica.
   O médico (ou a CCIH) informa o registro do paciente e a síndrome; o app responde com o
   esquema do protocolo institucional, os exames a coletar e — o diferencial — os avisos
   construídos com os dados LOCAIS: histórico de multirresistentes do paciente e o
   antibiograma acumulado do hospital. Sempre apoio, nunca substituto do julgamento. */

async function montarDecisaoATB(conteudo) {
  conteudo.append(el('h1', {}, 'Decisão de antibioticoterapia empírica'));
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

  /* ---- Síndrome e perguntas do protocolo ---- */
  const selSindrome = el('select', {},
    el('option', { value: '' }, 'escolha a síndrome…'),
    PROTOCOLO_ATB.sindromes.map(s => el('option', { value: s.id }, s.rotulo)));
  const areaPerguntas = el('div', {});
  const areaResultado = el('div', {});
  const controles = new Map();

  /* Perguntas que o contexto local responde sozinho (o médico pode desmarcar). */
  const PERGUNTAS_DE_RISCO = ['riscoEsbl', 'riscoMDR', 'comorbAtb90', 'riscoMRSAHosp', 'riscoMRSA'];

  function desenharPerguntas() {
    areaResultado.replaceChildren();
    controles.clear();
    const sindrome = PROTOCOLO_ATB.sindromes.find(s => s.id === selSindrome.value);
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
      return el('div', { class: 'linha-campos' }, el('label', {}, p.rotulo + ': ', controle));
    });
    areaPerguntas.replaceChildren(
      el('p', { class: 'texto-suave' }, 'Germes prováveis (protocolo): ' + sindrome.germes.join(', ') + '.'),
      ...linhas,
      el('div', { class: 'linha-botoes' },
        el('button', { class: 'botao-primario', onclick: analisar }, 'Analisar caso')));
  }
  selSindrome.addEventListener('change', desenharPerguntas);

  function analisar() {
    const sindrome = PROTOCOLO_ATB.sindromes.find(s => s.id === selSindrome.value);
    if (!sindrome) return;
    const respostas = {};
    for (const [id, { controle, tipo }] of controles) {
      respostas[id] = tipo === 'escolha' ? controle.value : controle.value === 'S';
    }
    const decisao = sindrome.decidir(respostas);
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
        'Fonte: ' + PROTOCOLO_ATB.fonte + '. Ferramenta de APOIO à decisão — não substitui o julgamento '
        + 'clínico nem a avaliação da CCIH para antimicrobianos auditados.'),
      PROTOCOLO_ATB.adendos.length ? el('p', { class: 'texto-suave' }, 'Adendos validados pela CCIH: '
        + PROTOCOLO_ATB.adendos.map(a => `${a.data.split('-').reverse().join('/')} — ${a.texto}`).join(' · ')) : null));
  }

  conteudo.append(el('div', { class: 'cartao' },
    el('h2', {}, 'Caso'),
    el('p', { class: 'texto-suave' }, PROTOCOLO_ATB.publico),
    el('div', { class: 'linha-campos' },
      el('label', {}, 'Prontuário: ', campoProntuario),
      el('label', {}, 'Síndrome: ', selSindrome)),
    areaContexto,
    areaPerguntas),
    areaResultado);
}
