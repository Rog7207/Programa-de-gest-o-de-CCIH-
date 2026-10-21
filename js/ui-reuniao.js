/* Tela "Reunião CCIH": os principais indicadores consistentes do banco, em formato de
   apresentação — um slide por assunto, botões ‹ › (e setas do teclado) para avançar,
   como pediu o usuário (16/09/2026). O cálculo vive em indicadoresReuniao (núcleo puro,
   js/relatorios.js); aqui é só apresentação. */

function _fmtIndicador(v) {
  return (v === null || v === undefined || v === '') ? '—' : String(v);
}

/* Barras horizontais simples em CSS — sem biblioteca, imprime bem. */
function barrasMensais(serie, campo, formato) {
  const valores = serie.map(s => s[campo]).map(v => (v === null || v === undefined) ? 0 : Number(v));
  const maximo = Math.max(...valores, 1);
  return el('div', { class: 'reuniao-barras' }, ...serie.map((s, i) => {
    const v = valores[i];
    return el('div', { class: 'reuniao-barra-linha' },
      el('span', { class: 'reuniao-barra-rotulo' }, s.mes.slice(2).split('-').reverse().join('/')),
      el('div', { class: 'reuniao-barra-trilha' },
        el('div', { class: 'reuniao-barra', style: `width:${Math.round(v / maximo * 100)}%` })),
      el('span', { class: 'reuniao-barra-valor' }, formato ? formato(s[campo]) : _fmtIndicador(s[campo])));
  }));
}

/* Barras horizontais por categoria (ex.: sítios de IRAS): [[rotulo, n], ...]. */
function barrasCategorias(pares) {
  const maximo = Math.max(...pares.map(([, n]) => Number(n) || 0), 1);
  return el('div', { class: 'reuniao-barras' }, ...pares.map(([rotulo, n]) =>
    el('div', { class: 'reuniao-barra-linha' },
      el('span', { class: 'reuniao-barra-rotulo reuniao-barra-rotulo-largo' }, rotulo),
      el('div', { class: 'reuniao-barra-trilha' },
        el('div', { class: 'reuniao-barra', style: `width:${Math.round(Number(n) / maximo * 100)}%` })),
      el('span', { class: 'reuniao-barra-valor' }, String(n)))));
}

/* Colunas verticais em SVG, uma série mensal, valor escrito em cima de cada coluna
   (pedido de 21/10/2026: IRAS por mês em barras verticais). */
function colunasMensais(serie, campo, opcoes) {
  const op = opcoes || {};
  const L = 44, T = 22, W = 760, H = 260, R = 12, B = 30;
  const valores = serie.map(s => (s[campo] === null || s[campo] === undefined) ? 0 : Number(s[campo]));
  const maximo = Math.max(...valores, 1) * 1.15;
  const largura = (W - L - R) / Math.max(serie.length, 1);
  const y = v => T + (H - T - B) * (1 - v / maximo);
  const svgNs = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, texto) => { const e = document.createElementNS(svgNs, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (texto != null) e.textContent = texto; return e; };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'reuniao-grafico', role: 'img', 'aria-label': op.titulo || '' });
  for (let i = 0; i <= 4; i++) {
    const v = maximo / 1.15 * i / 4, yy = y(v);
    svg.append(mk('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: 'reuniao-grade' }));
    svg.append(mk('text', { x: L - 6, y: yy + 4, 'text-anchor': 'end', class: 'reuniao-eixo' }, Math.round(v)));
  }
  serie.forEach((m, i) => {
    const x0 = L + i * largura + largura * 0.18, w = largura * 0.64, v = valores[i];
    svg.append(mk('rect', { x: x0, y: y(v), width: w, height: Math.max(0, y(0) - y(v)), rx: 3, fill: op.cor || '#0d3f7a' }));
    svg.append(mk('text', { x: x0 + w / 2, y: y(v) - 5, 'text-anchor': 'middle', class: 'reuniao-coluna-valor' }, _fmtIndicador(m[campo])));
    svg.append(mk('text', { x: x0 + w / 2, y: H - B + 16, 'text-anchor': 'middle', class: 'reuniao-eixo' }, m.mes.slice(5) + '/' + m.mes.slice(2, 4)));
  });
  return svg;
}

/* Gráfico de linhas em SVG, duas ou mais séries mensais, sem biblioteca; imprime bem.
   series = [{ rotulo, campo, cor }]; valores null viram buraco na linha. */
function linhasMensais(serie, series, opcoes) {
  const op = opcoes || {};
  const L = 56, T = 14, W = 760, H = 240, R = 16, B = 34;
  const xs = serie.map((_, i) => L + (serie.length > 1 ? i * (W - L - R) / (serie.length - 1) : 0));
  const valores = series.flatMap(s => serie.map(m => m[s.campo])).filter(v => v !== null && v !== undefined && isFinite(v));
  const maximo = Math.max(...valores, 1) * 1.1;
  const y = v => T + (H - T - B) * (1 - v / maximo);
  const svgNs = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, texto) => { const e = document.createElementNS(svgNs, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (texto != null) e.textContent = texto; return e; };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'reuniao-grafico', role: 'img', 'aria-label': op.titulo || '' });
  /* eixo y: 4 linhas de grade */
  for (let i = 0; i <= 4; i++) {
    const v = maximo / 1.1 * i / 4, yy = y(v);
    svg.append(mk('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: 'reuniao-grade' }));
    svg.append(mk('text', { x: L - 6, y: yy + 4, 'text-anchor': 'end', class: 'reuniao-eixo' }, (op.formato || (n => Math.round(n)))(v)));
  }
  serie.forEach((m, i) => svg.append(mk('text', { x: xs[i], y: H - B + 16, 'text-anchor': 'middle', class: 'reuniao-eixo' }, m.mes.slice(5) + '/' + m.mes.slice(2, 4))));
  series.forEach(s => {
    let d = '', aberto = false;
    serie.forEach((m, i) => {
      const v = m[s.campo];
      if (v === null || v === undefined || !isFinite(v)) { aberto = false; return; }
      d += (aberto ? ' L' : ' M') + xs[i].toFixed(1) + ' ' + y(v).toFixed(1); aberto = true;
      svg.append(mk('circle', { cx: xs[i], cy: y(v), r: 3.5, fill: s.cor }));
      svg.append(mk('title', {}, `${s.rotulo} · ${m.mes}: ${v}`));
    });
    svg.append(mk('path', { d: d.trim(), fill: 'none', stroke: s.cor, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
  });
  const legenda = el('div', { class: 'reuniao-legenda' }, ...series.map(s =>
    el('span', {}, el('span', { class: 'reuniao-legenda-cor', style: `background:${s.cor}` }), ' ' + s.rotulo)));
  return el('div', {}, svg, legenda);
}

function slideNumeros(pares) {
  return el('div', { class: 'grade-cartoes' }, ...pares.map(([rotulo, valor]) =>
    el('div', { class: 'cartao cartao-numero' },
      el('div', { class: 'numero-grande' }, _fmtIndicador(valor)),
      el('div', { class: 'texto-suave' }, rotulo))));
}

async function montarReuniao(conteudo) {
  conteudo.append(el('h1', {}, 'Reunião da CCIH'));
  const bancos = {};
  await Promise.all(BANCOS_RELATORIOS.map(async n => {
    try { bancos[n] = await lerBanco(n); } catch (e) { bancos[n] = {}; }
  }));
  let dados;
  try { dados = indicadoresReuniao(bancos, hojeISO()); }
  catch (e) {
    conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao calcular os indicadores: ' + e.message));
    return;
  }
  const ultimo = dados.serie[dados.serie.length - 1];
  const rotuloMes = dados.mesReferencia.split('-').reverse().join('/');

  const mesCurto = m => m.slice(5) + '/' + m.slice(2, 4);
  const anoRef = dados.mesReferencia.slice(0, 4);

  const slides = [
    /* 1. Só o essencial: taxa, número e sítios (pedido de 21/10/2026). */
    { titulo: `IRAS — ${rotuloMes}`, corpo: () => el('div', {},
      slideNumeros([
        ['IRAS por 1.000 pacientes-dia', ultimo.densidade],
        ['IRAS confirmadas no mês', ultimo.iras]
      ]),
      el('h3', {}, 'Sítios de infecção'),
      dados.sitios.length ? barrasCategorias(dados.sitios) : el('p', { class: 'texto-suave' }, 'Nenhuma IRAS confirmada no mês.'),
      el('p', { class: 'texto-suave' }, `Mês fechado mais recente; ${fmtInt(ultimo.pacientesDia)} pacientes-dia (censo individual). Só casos confirmados pela CCIH ou digitados no Tasy.`)) },

    /* 2. Número de IRAS por mês, colunas verticais. */
    { titulo: 'IRAS por mês — últimos 12 meses', corpo: () => el('div', {},
      colunasMensais(dados.serie, 'iras', { titulo: 'IRAS por mês' })) },

    /* 3. Utilização de dispositivos e densidade, mês × 6 meses anteriores. */
    ...(dados.dispositivos && dados.dispositivos.mes ? [{
      titulo: `Dispositivos — ${dados.dispositivos.setores.join(', ')}`,
      corpo: () => {
        const d = dados.dispositivos;
        const antes = new Map((d.seisMeses.linhas || []).map(l => [l.dispositivo, l]));
        const pct = v => (v === null || v === undefined) ? '—' : Math.round(v * 100) + '%';
        const num = v => (v === null || v === undefined) ? '—' : String(v);
        return el('div', {},
          el('table', { class: 'tabela reuniao-tabela' },
            el('thead', {},
              el('tr', {}, el('th', { rowspan: '2' }, 'Dispositivo'), el('th', { colspan: '2' }, 'Taxa de utilização'), el('th', { colspan: '2' }, 'Densidade de IRAS / 1.000 dias')),
              el('tr', {}, ...[rotuloMes, '6 meses anteriores', rotuloMes, '6 meses anteriores'].map(c => el('th', {}, c)))),
            el('tbody', {}, d.mes.linhas.map(l => {
              const a = antes.get(l.dispositivo) || {};
              return el('tr', {}, el('td', {}, l.dispositivo),
                el('td', { class: 'reuniao-destaque' }, pct(l.utilizacao)), el('td', {}, pct(a.utilizacao)),
                el('td', { class: 'reuniao-destaque' }, num(l.densidade) + (l.iras ? ` (${l.iras})` : '')), el('td', {}, num(a.densidade) + (a.iras ? ` (${a.iras})` : '')));
            }))),
          el('p', { class: 'texto-suave' },
            `Utilização = dias de dispositivo ÷ pacientes-dia (${fmtInt(d.mes.pacientesDia)} no mês; ${fmtInt(d.seisMeses.pacientesDia || 0)} em ${d.seisMeses.periodo}). `
            + 'Densidade = IRAS do dispositivo por 1.000 dias de dispositivo (número de casos entre parênteses). Censo diário de invasividade (NISS). PAV→ventilação mecânica, IPCS→cateter central, ITU→sonda vesical.'));
      } }] : []),

    { titulo: `Multirresistentes em IRAS — ${dados.trimestre}`, corpo: () => dados.mdr.length
      ? el('table', { class: 'tabela reuniao-tabela' },
          el('thead', {}, el('tr', {}, ['Microrganismo', 'Resistência', 'Setor', 'Isolados'].map(c => el('th', {}, c)))),
          el('tbody', {}, dados.mdr.map(m => el('tr', {},
            [m.germe, m.mecanismo, m.setor, m.n].map(v => el('td', {}, String(v)))))))
      : el('p', { class: 'texto-suave' }, 'Nenhuma cepa multirresistente em IRAS no trimestre.') },

    /* 5. Consumo só a partir de janeiro do ano de referência (antes o banco não tem prescrição). */
    ...(dados.consumoAtb ? [{
      titulo: `Consumo de antibióticos — ${anoRef}`,
      corpo: () => {
        const c = dados.consumoAtb.filter(m => m.mes >= anoRef + '-01');
        const ultimo = c[c.length - 1] || {};
        const comDDD = c.filter(m => m.dddMil !== null);
        const semDose = c.reduce((s, m) => s + m.semDose, 0), naoConv = c.reduce((s, m) => s + m.naoConvertida.reduce((x, [, n]) => x + n, 0), 0);
        const motivos = new Map(); c.forEach(m => m.naoConvertida.forEach(([mot, n]) => motivos.set(mot, (motivos.get(mot) || 0) + n)));
        return el('div', {},
          el('h3', {}, 'DOT (dias de terapia) por 1.000 pacientes-dia'),
          linhasMensais(c, [{ rotulo: 'UTI adulto (CTI)', campo: 'dotMilUti', cor: '#b03a2e' }, { rotulo: 'Hospital', campo: 'dotMil', cor: '#0d3f7a' }], { titulo: 'DOT por 1.000 pacientes-dia' }),
          el('h3', {}, 'DDD (dose diária definida, OMS) por 1.000 pacientes-dia'),
          comDDD.length
            ? linhasMensais(c, [{ rotulo: 'UTI adulto (CTI)', campo: 'dddMilUti', cor: '#b03a2e' }, { rotulo: 'Hospital', campo: 'dddMil', cor: '#0d3f7a' }], { titulo: 'DDD por 1.000 pacientes-dia' })
            : el('p', { class: 'texto-suave' }, 'Sem dose nas prescrições do período — o DDD precisa do relatório de prescrições do Tasy (com dose) importado diariamente.'),
          el('table', { class: 'tabela reuniao-tabela' },
            el('thead', {}, el('tr', {}, ['Mês', 'DOT UTI', 'DOT hosp.', 'DDD UTI', 'DDD hosp.', 'Dias com dose', 'Pac.-dia UTI', 'Pac.-dia hosp.'].map(t => el('th', {}, t)))),
            el('tbody', {}, c.map(m => el('tr', {}, [m.mes.slice(5) + '/' + m.mes.slice(2, 4), m.dotMilUti, m.dotMil, m.dddMilUti, m.dddMil, m.coberturaDose + '%', m.pdUti || '—', m.pdHosp].map(v => el('td', {}, _fmtIndicador(v))))))),
          el('p', { class: 'texto-suave' },
            `Pacientes-dia da UTI: ${ultimo.fonteUti === 'NISS' ? 'censo NISS' : ultimo.fonteUti === 'passagens' ? 'passagem por setores (foto diária)' : 'não disponível no último mês'}; do hospital: censo individual. `
            + `DDD só nos meses em que ao menos ${Math.round(DDD_COBERTURA_MINIMA * 100)}% dos dias de terapia têm dose convertível${comDDD.length ? ' (desde ' + comDDD[0].mes.slice(5) + '/' + comDDD[0].mes.slice(2, 4) + ')' : ''}; com cobertura abaixo de 100% o DDD está subestimado na mesma proporção. `
            + (semDose ? `${fmtInt(semDose)} prescrição(ões) sem dose no período (não entram no DDD). ` : '')
            + (naoConv ? `${fmtInt(naoConv)} com dose não convertível (${[...motivos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, n]) => m + ': ' + n).join('; ')}). ` : '')
            + 'Tabela de DDD e apresentações: config.xlsx, aba ddd_antibioticos (OMS ATC/DDD, a conferir pela CCIH).'));
      } }] : []),

    /* 6. Avaliações de antibiótico da visita à UTI adulto (o relatório do Tasy não sai). */
    { titulo: `Avaliações de antibióticos na UTI adulto — ${rotuloMes}`, corpo: () => {
      const a = dados.avaliacoesUTI;
      return el('div', {},
        slideNumeros([
          ['Pacientes avaliados', a.pacientesAvaliados],
          ['Antibióticos avaliados', a.antibioticosAvaliados],
          ['Antibióticos modificados', a.modificados],
          ['Antibióticos suspensos', a.suspensos],
          ['Retiradas de sonda vesical recomendadas', a.retirarSVD],
          ['Retiradas de cateter central recomendadas', a.retirarCVC]
        ]),
        el('p', { class: 'texto-suave' },
          `Registros da visita à UTI (miniapp): ${fmtInt(a.visitas)} visita(s) a leito no mês. "Modificados" inclui troca e ajuste de dose. Só o CTI adulto.`));
    } },

    /* 7. Higiene de mãos: momentos e setores do trimestre. */
    { titulo: `Higiene de mãos — ${dados.higiene.periodo.split(' a ').map(mesCurto).join(' a ')}`, corpo: () => {
      const tabela = (colunas, linhas) => el('table', { class: 'tabela reuniao-tabela' },
        el('thead', {}, el('tr', {}, colunas.map(c => el('th', {}, c)))),
        el('tbody', {}, linhas.map(l => el('tr', {}, l.map((v, i) => el('td', i === 2 ? { class: 'reuniao-destaque' } : {}, String(v)))))));
      if (!dados.higiene.porMomento.length) return el('p', { class: 'texto-suave' }, 'Sem observações de higiene das mãos no trimestre.');
      return el('div', { class: 'reuniao-duas-colunas' },
        el('div', {}, el('h3', {}, 'Pelos 5 momentos'), tabela(['Momento', 'Oportunidades', 'Adesão'], dados.higiene.porMomento)),
        el('div', {}, el('h3', {}, 'Por setor'), tabela(['Setor', 'Oportunidades', 'Adesão'], dados.higiene.porSetor.slice(0, 12))));
    } },

    /* 8. Pós-alta das cirurgias do mês ANTERIOR (o contato leva 30 dias). */
    { titulo: `Vigilância pós-alta — cirurgias de ${mesCurto(dados.posAlta.mes)}`, corpo: () => el('div', {},
      slideNumeros([
        ['Cirurgias sob vigilância', dados.posAlta.sobVigilancia],
        ['Contatos realizados', dados.posAlta.contatos],
        ['Respostas obtidas', dados.posAlta.respostas],
        ['Infecções de sítio cirúrgico', dados.posAlta.isc]
      ]),
      el('p', { class: 'texto-suave' },
        `${fmtInt(dados.posAlta.cirurgias || 0)} cirurgias no mês; taxa de ISC entre desfechos conhecidos: ${dados.posAlta.taxaISC || '—'}. Mês anterior ao de referência porque o contato pós-alta é feito aos 30 dias.`)) },

    { titulo: 'Isolamentos ativos hoje', corpo: () => el('div', {},
      slideNumeros([['Pacientes em precaução', dados.isolamentos.ativos]]),
      dados.isolamentos.porTipo.length ? el('table', { class: 'tabela reuniao-tabela' },
        el('thead', {}, el('tr', {}, ['Tipo de precaução', 'Pacientes'].map(c => el('th', {}, c)))),
        el('tbody', {}, dados.isolamentos.porTipo.map(([t, n]) =>
          el('tr', {}, el('td', {}, t), el('td', {}, String(n)))))) : null) },

    { titulo: 'Internações — óbitos e permanência (12 meses)', corpo: () => el('div', {},
      el('p', { class: 'texto-suave' }, 'Letalidade hospitalar (% das altas do mês):'),
      barrasMensais(dados.serie, 'letalidade'),
      el('p', { class: 'texto-suave' }, 'Permanência média (dias):'),
      barrasMensais(dados.serie, 'permanencia')) }
  ];

  let atual = 0;
  const area = el('div', {});
  const contador = el('span', { class: 'texto-suave' });
  const desenhar = () => {
    const s = slides[atual];
    contador.textContent = `${atual + 1} / ${slides.length}`;
    area.replaceChildren(el('div', { class: 'cartao reuniao-slide' },
      el('h2', {}, s.titulo), s.corpo()));
  };
  const ir = passo => { atual = (atual + passo + slides.length) % slides.length; desenhar(); };
  const aoTeclar = e => {
    if (app.abaAtual !== 'reuniao') { window.removeEventListener('keydown', aoTeclar); return; }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { ir(1); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { ir(-1); e.preventDefault(); }
  };
  window.addEventListener('keydown', aoTeclar);

  conteudo.append(
    el('div', { class: 'reuniao-nav' },
      el('button', { class: 'botao-secundario', onclick: () => ir(-1) }, '‹ Anterior'),
      contador,
      el('button', { class: 'botao-primario', onclick: () => ir(1) }, 'Próximo ›'),
      el('span', { class: 'texto-suave' }, 'setas do teclado também funcionam')),
    area);
  desenhar();
}
