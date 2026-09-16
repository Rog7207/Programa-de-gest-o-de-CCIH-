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

  const slides = [
    { titulo: `Panorama — ${rotuloMes}`, corpo: () => el('div', {},
      slideNumeros([
        ['IRAS notificadas no mês', ultimo.iras],
        ['IRAS por 100 internações', ultimo.por100],
        ['Internações iniciadas', ultimo.internacoes],
        ['Óbitos (altas do mês)', ultimo.obitos],
        ['Letalidade hospitalar (%)', ultimo.letalidade],
        ['Permanência média (dias)', ultimo.permanencia]
      ]),
      el('p', { class: 'texto-suave' }, 'Mês fechado mais recente. Detalhe de cada tema nos slides seguintes.')) },

    { titulo: 'IRAS — últimos 12 meses', corpo: () => el('div', {},
      barrasMensais(dados.serie, 'iras'),
      el('p', { class: 'texto-suave' }, 'IRAS por 100 internações no mesmo período:'),
      barrasMensais(dados.serie, 'por100')) },

    ...(dados.dispositivos && dados.dispositivos.taxas ? [{
      titulo: `Taxas por dispositivo — ${dados.dispositivos.setores.join(', ')} (${dados.dispositivos.periodo})`,
      corpo: () => el('div', {},
        el('table', { class: 'tabela reuniao-tabela' },
          el('thead', {}, el('tr', {}, ['Dispositivo', 'Dias de dispositivo', 'IRAS', 'Taxa / 1.000 dias'].map(c => el('th', {}, c)))),
          el('tbody', {}, dados.dispositivos.taxas.linhas.map(l =>
            el('tr', {}, l.map((v, i) => el('td', i === 3 ? { class: 'reuniao-destaque' } : {}, String(v))))))),
        el('p', { class: 'texto-suave' },
          'Denominador do censo diário de invasividade (NISS). PAV→ventilação mecânica, IPCS→cateter central, ITU→sonda vesical.')) }] : []),

    { titulo: `Multirresistentes em IRAS — ${dados.trimestre}`, corpo: () => dados.mdr.length
      ? el('table', { class: 'tabela reuniao-tabela' },
          el('thead', {}, el('tr', {}, ['Microrganismo', 'Resistência', 'Setor', 'Isolados'].map(c => el('th', {}, c)))),
          el('tbody', {}, dados.mdr.map(m => el('tr', {},
            [m.germe, m.mecanismo, m.setor, m.n].map(v => el('td', {}, String(v)))))))
      : el('p', { class: 'texto-suave' }, 'Nenhuma cepa multirresistente em IRAS no trimestre.') },

    { titulo: `Antibióticos (stewardship) — ${rotuloMes}`, corpo: () => el('div', {},
      slideNumeros([
        ['Dias de terapia (DOT)', dados.atb.dot],
        ['DOT / 1.000 pacientes-dia', dados.atb.dotMil],
        ['Prescrições analisadas (Tasy)', dados.atb.analisadas],
        ['Avaliações de stewardship', dados.atb.avaliacoes],
        ['Cursos com avaliação casada', dados.atb.cursosAvaliados]
      ]),
      el('p', { class: 'texto-suave' }, 'Detalhe por droga no relatório de Antibióticos.')) },

    { titulo: `Higiene de mãos — ${rotuloMes}`, corpo: () =>
      slideNumeros((dados.higiene.resumo.length ? dados.higiene.resumo
        : [['Sem observações no mês', '—']])) },

    { titulo: `Sepse — ${rotuloMes}`, corpo: () =>
      slideNumeros((dados.sepse.resumo.length ? dados.sepse.resumo
        : [['Sem protocolos no mês', '—']])) },

    { titulo: `Vigilância pós-alta — ${rotuloMes}`, corpo: () =>
      slideNumeros((dados.posAlta.resumo.length ? dados.posAlta.resumo
        : [['Sem dados no mês', '—']])) },

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
