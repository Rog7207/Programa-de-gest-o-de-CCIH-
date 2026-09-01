/* Aba Higiene das mãos: adesão a partir das observações diretas (Vigispec ou miniapp).

   Adesão = higienizou ÷ oportunidades observadas. O denominador é a oportunidade, não o
   profissional nem o dia: cada linha do banco é uma oportunidade vista por um observador. */

const CORES_INSUMO = { 'Álcool': '#185fa5', 'Sabonete': '#0f6e56' };

/* Ordem da OMS (MOMENTOS_OMS, em importacao.js — a mesma lista que concilia o miniapp e o
   Vigispec). Ordenar por frequência esconderia o padrão que interessa: a adesão costuma cair
   nos momentos "antes", que são os que protegem o paciente. */
const ORDEM_MOMENTOS = MOMENTOS_OMS;

function taxa(numerador, denominador) {
  return denominador ? Math.round(numerador / denominador * 1000) / 10 : null;
}

/* Barra de percentual: mostra a fração junto com o percentual porque "100%" de duas
   oportunidades não é a mesma informação que 100% de duzentas. */
function barraTaxa(rotulo, higienizou, total, aoClicar) {
  const pct = taxa(higienizou, total);
  const cor = pct === null ? '#c9d2db' : (pct >= 80 ? '#0f6e56' : pct >= 60 ? '#854f0b' : '#b03a2e');
  return el('div', { class: 'barra-linha' + (aoClicar ? ' linha-clicavel' : ''), onclick: aoClicar || null },
    el('span', { class: 'barra-rotulo', title: rotulo }, rotulo),
    el('div', { class: 'barra-trilho' },
      el('div', { class: 'barra', style: `width:${pct === null ? 0 : pct}%;background:${cor}` })),
    el('span', { class: 'barra-num' }, pct === null ? '—' : `${pct}%`),
    el('span', { class: 'texto-suave', style: 'min-width:88px;text-align:right' }, `${fmtInt(higienizou)}/${fmtInt(total)}`));
}

/* Agrupa as observações por um campo e devolve [rotulo, higienizou, total]. */
function adesaoPor(observacoes, campo, ordem) {
  const grupos = new Map();
  for (const o of observacoes) {
    const chave = String(o[campo] || '').trim() || '(não informado)';
    if (!grupos.has(chave)) grupos.set(chave, { sim: 0, total: 0 });
    const g = grupos.get(chave);
    g.total++;
    if (o.Acao === 'Higienizou') g.sim++;
  }
  const lista = [...grupos.entries()].map(([k, g]) => [k, g.sim, g.total]);
  if (ordem) {
    return lista.sort((a, b) => {
      const ia = ordem.indexOf(a[0]), ib = ordem.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }
  return lista.sort((a, b) => b[2] - a[2]);
}

async function montarHigiene(conteudo) {
  conteudo.append(el('h1', {}, 'Higiene das mãos'));
  let banco;
  try { banco = await lerBanco('higiene_maos'); }
  catch (e) { conteudo.append(el('div', { class: 'cartao aviso-erro' }, 'Erro ao ler o banco: ' + e.message)); return; }

  const todas = banco.observacoes || [];
  if (!todas.length) {
    conteudo.append(el('div', { class: 'cartao' }, el('p', { class: 'texto-suave' },
      'Nenhuma observação importada ainda. Na aba Importar, escolha o tipo "Higiene das mãos (observações)".')));
    return;
  }

  const datas = todas.map(o => String(o.Data || '').slice(0, 10)).filter(d => /^\d{4}-/.test(d)).sort();
  const campoDe = el('input', { type: 'date', value: datas[0] || hojeISO() });
  const campoAte = el('input', { type: 'date', value: datas[datas.length - 1] || hojeISO() });
  const distintos = campo => [...new Set(todas.map(o => String(o[campo] || '').trim()).filter(Boolean))].sort();
  const seletor = (campo, primeira) => el('select', {}, el('option', { value: '' }, primeira),
    distintos(campo).map(v => el('option', { value: v }, v)));
  const selSetor = seletor('Setor', 'todos os setores');
  const selCategoria = seletor('Categoria', 'todas as categorias');
  const selTurno = seletor('Turno', 'todos os turnos');
  const selSerie = el('select', {}, [['mes', 'por mês'], ['semestre', 'por semestre'], ['ano', 'por ano']]
    .map(([v, r]) => el('option', { value: v }, r)));
  const area = el('div', {});

  [campoDe, campoAte, selSetor, selCategoria, selTurno, selSerie].forEach(c => c.addEventListener('change', desenhar));
  conteudo.append(el('div', { class: 'cartao' },
    el('div', { class: 'linha-campos' },
      el('label', {}, 'De: ', campoDe), el('label', {}, 'Até: ', campoAte),
      el('label', {}, 'Setor: ', selSetor), el('label', {}, 'Categoria: ', selCategoria),
      el('label', {}, 'Turno: ', selTurno), el('label', {}, 'Série: ', selSerie)),
    el('div', { class: 'linha-botoes' },
      el('button', { class: 'botao-secundario', onclick: () => exportar() }, 'Exportar (Excel)'))),
    area);

  let filtradasAtuais = [];

  function filtrar() {
    return todas.filter(o => {
      const data = String(o.Data || '').slice(0, 10);
      if (campoDe.value && data < campoDe.value) return false;
      if (campoAte.value && data > campoAte.value) return false;
      /* Opções vêm aparadas (trim); o dado bruto pode vir com espaços do relatório. */
      if (selSetor.value && String(o.Setor || '').trim() !== selSetor.value) return false;
      if (selCategoria.value && String(o.Categoria || '').trim() !== selCategoria.value) return false;
      if (selTurno.value && String(o.Turno || '').trim() !== selTurno.value) return false;
      return true;
    });
  }

  function desenhar() {
    const obs = filtrar();
    filtradasAtuais = obs;
    const higienizou = obs.filter(o => o.Acao === 'Higienizou');
    const alcool = higienizou.filter(o => o.TipoHigienizacao === 'Álcool').length;
    const sabonete = higienizou.filter(o => o.TipoHigienizacao === 'Sabonete').length;
    const adesaoGlobal = taxa(higienizou.length, obs.length);

    const cartaoNumero = (valor, rotulo, dica) => el('div', { class: 'cartao cartao-numero', title: dica || '' },
      el('div', { class: 'numero-grande' }, valor), el('div', { class: 'texto-suave' }, rotulo));

    /* Série temporal da adesão. Períodos com pouquíssimas observações produzem percentuais
       que balançam muito — por isso a contagem aparece junto, na legenda e na tabela. */
    const porPeriodo = new Map();
    for (const o of obs) {
      const chave = chavePeriodo(String(o.Data || '').slice(0, 10), selSerie.value);
      if (!chave) continue;
      if (!porPeriodo.has(chave)) porPeriodo.set(chave, { sim: 0, total: 0 });
      const g = porPeriodo.get(chave);
      g.total++;
      if (o.Acao === 'Higienizou') g.sim++;
    }
    const periodos = [...porPeriodo.keys()].sort();
    const serieAdesao = new Map([['Adesão (%)', periodos.map(p => taxa(porPeriodo.get(p).sim, porPeriodo.get(p).total) || 0)]]);

    const porSetor = adesaoPor(obs, 'Setor');
    const porCategoria = adesaoPor(obs, 'Categoria');
    const porMomento = adesaoPor(obs, 'Momento', ORDEM_MOMENTOS);

    area.replaceChildren(
      el('div', { class: 'grade-cartoes' },
        cartaoNumero(fmtInt(obs.length), 'oportunidades observadas'),
        cartaoNumero(adesaoGlobal === null ? '—' : adesaoGlobal + '%', 'adesão global',
          'Higienizou ÷ oportunidades observadas'),
        cartaoNumero(fmtInt(obs.length - higienizou.length), 'oportunidades perdidas'),
        cartaoNumero(taxa(alcool, alcool + sabonete) === null ? '—' : taxa(alcool, alcool + sabonete) + '%',
          'das higienizações com álcool')),

      el('div', { class: 'cartao' },
        el('h2', {}, 'Adesão por momento da OMS'),
        el('p', { class: 'texto-suave' },
          'Na ordem da OMS, não por frequência: o que interessa é ver se a adesão cai nos momentos '
          + '"antes", que são os que protegem o paciente.'),
        porMomento.length ? porMomento.map(([m, sim, total]) => barraTaxa(m, sim, total))
          : el('p', { class: 'texto-suave' }, 'sem observações no filtro')),

      el('div', { class: 'grade-graficos' },
        el('div', { class: 'cartao' },
          el('h2', {}, 'Adesão por setor'),
          porSetor.length ? porSetor.map(([s, sim, total]) =>
            barraTaxa(s, sim, total, s === '(não informado)' ? null : () => { selSetor.value = s; desenhar(); }))
            : el('p', { class: 'texto-suave' }, 'sem observações no filtro')),
        el('div', { class: 'cartao' },
          el('h2', {}, 'Adesão por categoria profissional'),
          porCategoria.length ? porCategoria.map(([c, sim, total]) =>
            barraTaxa(c, sim, total, c === '(não informado)' ? null : () => { selCategoria.value = c; desenhar(); }))
            : el('p', { class: 'texto-suave' }, 'sem observações no filtro'))),

      el('div', { class: 'cartao' },
        el('h2', {}, 'Adesão ao longo do tempo'),
        periodos.length ? el('div', {},
          grafLinhas(periodos, serieAdesao),
          el('p', { class: 'texto-suave' }, 'Percentual de adesão. Os números de cada período estão na tabela abaixo.'),
          el('table', { class: 'tabela' },
            el('thead', {}, el('tr', {}, ['Período', 'Oportunidades', 'Higienizou', 'Adesão'].map(c => el('th', {}, c)))),
            el('tbody', {}, periodos.map(p => {
              const g = porPeriodo.get(p);
              const pct = taxa(g.sim, g.total);
              return el('tr', {},
                el('td', {}, p), el('td', {}, fmtInt(g.total)), el('td', {}, fmtInt(g.sim)),
                el('td', { class: pct !== null && pct < 60 ? 'aviso-erro-texto' : '' }, pct === null ? '—' : pct + '%'));
            }))))
          : el('p', { class: 'texto-suave' }, 'sem observações no filtro')),

      el('div', { class: 'cartao' },
        el('h2', {}, 'Insumo usado'),
        el('p', { class: 'texto-suave' }, 'Só entre as oportunidades em que houve higienização.'),
        el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, ['Insumo', 'Vezes', '% das higienizações'].map(c => el('th', {}, c)))),
          el('tbody', {}, [['Álcool', alcool], ['Sabonete', sabonete]].map(([nome, n]) =>
            el('tr', {},
              el('td', {}, el('span', { style: `display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:${CORES_INSUMO[nome]}` }), nome),
              el('td', {}, fmtInt(n)),
              el('td', {}, (taxa(n, alcool + sabonete) === null ? '—' : taxa(n, alcool + sabonete) + '%'))))))));
  }

  function exportar() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtradasAtuais.map(o => ({
      Data: o.Data, Setor: o.Setor, Turno: o.Turno, Categoria: o.Categoria,
      Momento: o.Momento, Acao: o.Acao, Insumo: o.TipoHigienizacao, Observador: o.Observador
    }))), 'observacoes');
    const resumo = (titulo, lista) => lista.map(([rotulo, sim, total]) => ({
      Agrupamento: titulo, Item: rotulo, Oportunidades: total, Higienizou: sim, Adesao: taxa(sim, total)
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      ...resumo('Setor', adesaoPor(filtradasAtuais, 'Setor')),
      ...resumo('Categoria', adesaoPor(filtradasAtuais, 'Categoria')),
      ...resumo('Momento', adesaoPor(filtradasAtuais, 'Momento', ORDEM_MOMENTOS))
    ]), 'adesao');
    XLSX.writeFile(wb, 'higiene-maos-' + hojeISO() + '.xlsx');
  }

  desenhar();
}
