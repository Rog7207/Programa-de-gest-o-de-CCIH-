/* Dossiê de internação para avaliação por IA (pedido de 16/10/2026).
   NÚCLEO PURO E TESTÁVEL (sem DOM, sem gravação): junta, para UMA internação (atendimento),
   tudo que o banco sabe e que pesa no diagnóstico de IRAS — trajetória por setor, cirurgias,
   dispositivos, cursos de antibiótico, culturas, protocolos de sepse, decisões já tomadas pela
   CCIH e o TEXTO das evoluções da janela recente — e devolve um documento único, ordenado
   pelo DIA DE INTERNAÇÃO (D1 = dia da admissão), para um modelo de linguagem (local, Qwen)
   classificar a probabilidade de IRAS. A ideia é tirar a leitura evolução-a-evolução da
   CCIH: a IA lê o dossiê inteiro e devolve faixa + sítio + trechos; a CCIH confirma.

   O dossiê SAI pseudonimizado: identificador = nº do atendimento/prontuário, sem nome, sem
   autor das evoluções; o nome do paciente é apagado do texto livre. Nomes de familiares e
   de profissionais escritos no corpo da evolução NÃO são apagados (não há como saber quem
   são) — por isso o arquivo fica DENTRO da pasta de dados (dossies/) e só vai para modelo
   que roda na máquina da CCIH. Nada aqui grava no banco. */

const DOSSIE_JANELA_EVOLUCOES_DIAS = 21;   /* evoluções que entram: as últimas 3 semanas */
const DOSSIE_ANTES_ADMISSAO_DIAS = 30;     /* cirurgia/cultura prévias que ainda contam (ISC: 30 d) */
const DOSSIE_DIA_IRAS = 3;                 /* D1 = admissão; início em D3+ conta como hospitalar */
const DOSSIE_MINIMO_HORAS = 48;            /* só vale a pena avaliar quem já passou de 48 h */

const _d10 = v => String(v == null ? '' : v).slice(0, 10);
const _ehData = v => /^\d{4}-\d{2}-\d{2}/.test(String(v || ''));
const _np = v => (typeof normalizarProntuario === 'function' ? normalizarProntuario(v) : String(v == null ? '' : v).replace(/\D/g, ''));
const _nt = v => (typeof normalizarTexto === 'function' ? normalizarTexto(v) : String(v == null ? '' : v).toLowerCase());

function _somaDias(dataISO, dias) {
  const t = Date.parse(_d10(dataISO) + 'T00:00:00Z');
  if (!isFinite(t)) return '';
  return new Date(t + dias * 864e5).toISOString().slice(0, 10);
}

/* Dia de internação: D1 = dia da admissão (mesma convenção de internacaoNaColeta). Antes da
   admissão fica negativo: véspera = D-1. */
function diaDaInternacao(dataISO, admissaoISO) {
  const a = Date.parse(_d10(dataISO) + 'T00:00:00Z');
  const b = Date.parse(_d10(admissaoISO) + 'T00:00:00Z');
  if (!isFinite(a) || !isFinite(b)) return null;
  const dif = Math.round((a - b) / 864e5);
  return dif >= 0 ? dif + 1 : dif;
}
function rotuloDia(dia) {
  if (dia === null || dia === undefined || !isFinite(dia)) return '';
  return 'D' + dia;
}
function dataBR(iso) {
  const d = _d10(iso);
  return _ehData(d) ? d.split('-').reverse().join('/') : '';
}

/* A internação de um atendimento (a aberta vence; senão a mais recente). */
function internacaoDoAtendimento(internacoes, atendimento) {
  const alvo = _np(atendimento);
  if (!alvo) return null;
  const lista = (internacoes || []).filter(i => _np(i.Atendimento) === alvo && _ehData(i.DataInternacao));
  if (!lista.length) return null;
  lista.sort((a, b) => {
    const abertaA = !String(a.DataAlta || '').trim(), abertaB = !String(b.DataAlta || '').trim();
    if (abertaA !== abertaB) return abertaA ? -1 : 1;
    return _d10(b.DataInternacao).localeCompare(_d10(a.DataInternacao));
  });
  return lista[0];
}

/* Os prontuários que são a mesma pessoa (mesma regra da ficha: nome igual no cadastro). */
function numerosDaPessoa(prontuario, pacientes) {
  const alvo = _np(prontuario);
  const reg = (pacientes || []).find(p => _np(p.Prontuario) === alvo);
  const nome = _nt(reg && reg.Nome);
  if (!nome) return alvo ? [alvo] : [];
  return [...new Set((pacientes || []).filter(p => _nt(p.Nome) === nome).map(p => _np(p.Prontuario)))];
}

/* Apaga o nome do paciente do texto livre: cada palavra do nome com 3+ letras (menos
   partículas) vira [PACIENTE], com tolerância a acento e caixa. */
const _PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'del', 'di', 'van', 'von']);
const _ACENTOS = { a: '[aáàâãä]', e: '[eéèêë]', i: '[iíìîï]', o: '[oóòôõö]', u: '[uúùûü]', c: '[cç]', n: '[nñ]' };
function anonimizarTexto(texto, nomes) {
  let t = String(texto == null ? '' : texto);
  const palavras = new Set();
  for (const nome of (nomes || [])) {
    for (const p of String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/)) {
      if (p.length >= 3 && !_PARTICULAS.has(p)) palavras.add(p);
    }
  }
  for (const p of palavras) {
    const re = new RegExp('\\b' + p.split('').map(ch => _ACENTOS[ch] || ch).join('') + '\\b', 'gi');
    t = t.replace(re, '[PACIENTE]');
  }
  return t.replace(/(\[PACIENTE\]\s*){2,}/g, '[PACIENTE] ');
}

/* Export cru de evoluções do Tasy, SEM a retenção da foto operacional (lerEvolucoesTasy guarda
   só a última/última médica): aqui entram TODAS as linhas, porque o dossiê quer a história. */
function lerEvolucoesCompletasTasy(matriz) {
  const linhas = matriz || [];
  let cab = -1, col = {};
  for (let i = 0; i < Math.min(linhas.length, 8); i++) {
    const nomes = (linhas[i] || []).map(c => _nt(c));
    if (nomes.includes('nratendimento') && nomes.includes('dsevolucao')) { cab = i; nomes.forEach((n, j) => { col[n] = j; }); break; }
  }
  if (cab < 0) return { reconhecido: false, evolucoes: [] };
  const valor = (l, n) => col[n] === undefined ? '' : String(l[col[n]] == null ? '' : l[col[n]]).trim();
  const dataDe = v => {
    const n = Number(v);
    if (isFinite(n) && n > 40000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 864e5).toISOString().slice(0, 10);
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/) || null;
    if (m) return m[0];
    const b = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return b ? `${b[3]}-${b[2].padStart(2, '0')}-${b[1].padStart(2, '0')}` : '';
  };
  const evolucoes = [];
  for (const l of linhas.slice(cab + 1)) {
    const atendimento = valor(l, 'nratendimento').replace(/\D/g, '');
    const texto = valor(l, 'dsevolucao');
    if (!atendimento || !texto || valor(l, 'dtinativacao')) continue;
    const data = dataDe(valor(l, 'dtevolucao'));
    if (!data) continue;
    evolucoes.push({ Atendimento: atendimento, Prontuario: '', Setor: valor(l, 'dssetoratendimento'),
      Categoria: valor(l, 'ieevolucaoclinica'), DataEvolucao: data, Autor: valor(l, 'nmpessoaevolucao'), Texto: texto,
      _ordem: Number(valor(l, 'cdevolucao')) || 0 });
  }
  return { reconhecido: true, evolucoes };
}

/* Acumula o recorte diário no histórico (evolucoes_historico). Dedup por atendimento + data +
   começo do texto; retenção: fica enquanto o atendimento está internado (sem DataAlta) ou a
   evolução tem menos de DOSSIE_RETENCAO_HISTORICO_DIAS. Texto aparado em TAMANHO_EVOLUCAO_HISTORICO
   (limite de célula do Excel é 32 767). Devolve { evolucoes, novas, descartadas }. */
const DOSSIE_RETENCAO_HISTORICO_DIAS = 28;
const TAMANHO_EVOLUCAO_HISTORICO = 8000;
function acumularHistoricoEvolucoes(novas, antigas, internacoes, hoje, opcoes) {
  const op = opcoes || {};
  const dia = _d10(hoje) || new Date().toISOString().slice(0, 10);
  const corte = _somaDias(dia, -(op.retencaoDias || DOSSIE_RETENCAO_HISTORICO_DIAS));
  const pronDoAt = new Map(), internado = new Set();
  for (const i of (internacoes || [])) {
    const a = _np(i.Atendimento), p = _np(i.Prontuario);
    if (!a) continue;
    if (p && !pronDoAt.has(a)) pronDoAt.set(a, p);
    if (!String(i.DataAlta || '').trim()) internado.add(a);
  }
  const chave = e => _np(e.Atendimento) + '|' + _d10(e.DataEvolucao) + '|' + _nt(e.Texto).slice(0, 200);
  const sinaisFn = typeof sinaisDeInfeccaoNaEvolucao === 'function' ? sinaisDeInfeccaoNaEvolucao : () => ({ resumo: '' });
  const saida = [], vistos = new Set();
  let descartadas = 0, n = 0;
  const fica = e => { const a = _np(e.Atendimento); const d = _d10(e.DataEvolucao); return _ehData(d) && (internado.has(a) || d >= corte); };
  for (const e of (antigas || [])) {
    if (!fica(e)) { descartadas++; continue; }
    const k = chave(e);
    if (vistos.has(k)) continue;
    vistos.add(k);
    saida.push({ ...e, Prontuario: e.Prontuario || pronDoAt.get(_np(e.Atendimento)) || '' });
  }
  for (const e of (novas || [])) {
    const texto = String(e.Texto || '').trim();
    if (!texto || !fica(e)) continue;
    const k = chave(e);
    if (vistos.has(k)) continue;
    vistos.add(k);
    n++;
    saida.push({ ID_Evolucao: '', Atendimento: _np(e.Atendimento), Prontuario: e.Prontuario || pronDoAt.get(_np(e.Atendimento)) || '',
      Setor: String(e.Setor || '').trim(), Categoria: String(e.Categoria || '').trim(), DataEvolucao: _d10(e.DataEvolucao),
      Texto: texto.length > TAMANHO_EVOLUCAO_HISTORICO ? texto.slice(0, TAMANHO_EVOLUCAO_HISTORICO) + ' […]' : texto,
      SinaisInfeccao: (sinaisFn(texto) || {}).resumo || '', ImportadoEm: dia });
  }
  saida.sort((x, y) => _np(x.Atendimento).localeCompare(_np(y.Atendimento)) || _d10(x.DataEvolucao).localeCompare(_d10(y.DataEvolucao)));
  let seq = 0;
  for (const e of saida) if (!e.ID_Evolucao) e.ID_Evolucao = 'EVH-' + dia.replace(/-/g, '') + '-' + String(++seq).padStart(5, '0');
  return { evolucoes: saida, novas: n, descartadas };
}

const ROTULO_CATEGORIA_EVOLUCAO = { E: 'evolução médica', ENF: 'evolução de enfermagem', SAE: 'SAE (enfermagem)', Tec: 'técnico de enfermagem', SRM: 'sala de recuperação/medicação', EV: 'evolução', P: 'parecer', R: 'residente' };

/* Monta o dossiê de UMA internação. opcoes: { hoje, janelaEvolucoesDias, evolucoesExtras } —
   evolucoesExtras são evoluções lidas de um export cru (lerEvolucoesCompletasTasy), que se somam
   à foto do banco (deduplicadas por data + começo do texto). Devolve null se o atendimento não
   tem internação conhecida. */
function montarDossieInternacao(bancos, atendimento, opcoes) {
  const op = opcoes || {};
  const b = bancos || {};
  const hoje = _d10(op.hoje) || new Date().toISOString().slice(0, 10);
  const janelaEvo = op.janelaEvolucoesDias || DOSSIE_JANELA_EVOLUCOES_DIAS;
  const internacoes = ((b.pacientes || {}).internacoes) || [];
  const intern = internacaoDoAtendimento(internacoes, atendimento);
  if (!intern) return null;
  const atd = _np(intern.Atendimento);
  const pront = _np(intern.Prontuario);
  const pacientes = ((b.pacientes || {}).pacientes) || [];
  const cadastro = pacientes.find(p => _np(p.Prontuario) === pront) || {};
  const numeros = numerosDaPessoa(pront, pacientes);
  const conjunto = new Set(numeros.concat(pront ? [pront] : []));
  const daPessoa = lista => (lista || []).filter(l => conjunto.has(_np(l.Prontuario)) || (l.Atendimento != null && _np(l.Atendimento) === atd));

  const admissao = _d10(intern.DataInternacao);
  const alta = _ehData(intern.DataAlta) ? _d10(intern.DataAlta) : '';
  const referencia = alta && alta < hoje ? alta : hoje;
  const diaRef = diaDaInternacao(referencia, admissao);
  const inicioJanela = _somaDias(admissao, -DOSSIE_ANTES_ADMISSAO_DIAS);
  const dentro = d => _ehData(d) && _d10(d) >= inicioJanela && _d10(d) <= referencia;
  const obito = intern.Obito === 'S' || /obito/.test(_nt(intern.Desfecho));
  const dia = d => diaDaInternacao(d, admissao);

  let idade = '';
  if (_ehData(cadastro.DataNascimento)) {
    const anos = Math.floor((Date.parse(admissao + 'T00:00:00Z') - Date.parse(_d10(cadastro.DataNascimento) + 'T00:00:00Z')) / (365.25 * 864e5));
    if (isFinite(anos) && anos >= 0 && anos < 130) idade = anos;
  }

  /* ---- trajetória por setor ---- */
  const passagens = (((b.denominadores || {}).passagem_setor) || []).filter(p => _np(p.Atendimento) === atd && _ehData(p.EntradaSetor))
    .sort((x, y) => _d10(x.EntradaSetor).localeCompare(_d10(y.EntradaSetor)));
  /* Passagens consecutivas no MESMO setor (troca de leito, reabertura) viram uma estada só. */
  const setores = [];
  for (const p of passagens) {
    const setor = String(p.Setor || '').trim();
    const saida = _ehData(p.SaidaSetor) ? _d10(p.SaidaSetor) : '';
    const ult = setores[setores.length - 1];
    if (ult && ult.setor === setor) {
      if (!saida || !ult.saida || saida > ult.saida) { ult.saida = saida; ult.diaSaida = saida ? dia(saida) : null; }
      continue;
    }
    setores.push({ setor, entrada: _d10(p.EntradaSetor), saida, diaEntrada: dia(p.EntradaSetor), diaSaida: saida ? dia(saida) : null });
  }
  if (!setores.length && String(intern.SetorAtual || '').trim()) setores.push({ setor: String(intern.SetorAtual).trim(), entrada: admissao, saida: alta, diaEntrada: 1, diaSaida: alta ? dia(alta) : null });
  const setorAtual = setores.length ? setores[setores.length - 1].setor : String(intern.SetorAtual || '').trim();
  const emUTI = /\b(uti|cti)\b/i.test(setorAtual);

  /* ---- internações prévias (readmissão) ---- */
  const previas = daPessoa(internacoes).filter(i => _np(i.Atendimento) !== atd && _ehData(i.DataInternacao) && _d10(i.DataInternacao) < admissao
    && (!_ehData(i.DataAlta) || _d10(i.DataAlta) >= _somaDias(admissao, -90)))
    .map(i => ({ entrada: _d10(i.DataInternacao), alta: _ehData(i.DataAlta) ? _d10(i.DataAlta) : '', setor: String(i.SetorAtual || '').trim(), desfecho: String(i.Desfecho || '').trim() }));

  /* ---- cirurgias ---- */
  const cirurgias = daPessoa(((b.cirurgias || {}).cirurgias) || []).filter(c => dentro(c.DataCirurgia))
    .map(c => ({ data: _d10(c.DataCirurgia), dia: dia(c.DataCirurgia), procedimento: String(c.ProcedimentoNHSN || c.Procedimento || '').trim(), procedimentoOriginal: String(c.Procedimento || '').trim(),
      contaminacao: String(c.PotencialContaminacao || '').trim(), asa: String(c.ASA || '').trim(), duracaoMin: String(c.DuracaoMin || '').trim(), carater: String(c.Carater || '').trim(),
      profilaxia: String(c.ProfilaxiaAntibiotico || '').trim(), isc: c.ISC === 'S' ? (String(c.TipoISC || '').trim() || 'sim') : '' }))
    .sort((x, y) => x.data.localeCompare(y.data));

  /* ---- dispositivos (cadastro + visitas da CCIH à UTI + template da evolução) ---- */
  const dispositivos = daPessoa(((b.dispositivos || {}).dispositivos) || [])
    .filter(d => _ehData(d.DataInstalacao) && _d10(d.DataInstalacao) <= referencia && (!_ehData(d.DataRetirada) || _d10(d.DataRetirada) >= inicioJanela))
    .map(d => ({ nome: String(d.Dispositivo || d.Categoria || '').trim(), categoria: String(d.Categoria || '').trim(), instalacao: _d10(d.DataInstalacao),
      retirada: _ehData(d.DataRetirada) ? _d10(d.DataRetirada) : '', diaInstalacao: dia(d.DataInstalacao), diaRetirada: _ehData(d.DataRetirada) ? dia(d.DataRetirada) : null,
      dias: (() => { const fim = _ehData(d.DataRetirada) ? _d10(d.DataRetirada) : referencia; const n = diaDaInternacao(fim, d.DataInstalacao); return n === null ? '' : n; })() }))
    .sort((x, y) => x.instalacao.localeCompare(y.instalacao));
  const visitasUti = daPessoa(((b.uti || {}).visitas) || []).filter(v => _ehData(v.Data) && _d10(v.Data) >= admissao && _d10(v.Data) <= referencia)
    .map(v => ({ data: _d10(v.Data), dia: dia(v.Data), setor: String(v.Setor || '').trim(),
      dispositivos: [v.CVC === 'S' ? 'CVC' + (v.CVC_Indicacoes ? ' (' + v.CVC_Indicacoes + ')' : '') : '', v.VM === 'S' ? 'VM' + (v.VM_Indicacao ? ' (' + v.VM_Indicacao + ')' : '') : '',
        v.SVD === 'S' ? 'SVD' + (v.SVD_Indicacao ? ' (' + v.SVD_Indicacao + ')' : '') : '', v.NPT === 'S' ? 'NPT' : ''].filter(Boolean),
      suspeita: v.SuspeitaIRAS === 'S' ? String(v.FocoSuspeito || 'foco não definido') : '', observacoes: String(v.Observacoes || '').trim() }))
    .sort((x, y) => x.data.localeCompare(y.data));

  /* ---- antibióticos: cursos ---- */
  const cursosFn = typeof cursosDeAntibiotico === 'function' ? cursosDeAntibiotico : () => [];
  const cursos = cursosFn(daPessoa(((b.antibioticos || {}).prescricoes) || []))
    .filter(c => _d10(c.fim) >= inicioJanela && _d10(c.inicio) <= referencia)
    .map(c => ({ antibiotico: String(c.Antibiotico || '').trim(), inicio: _d10(c.inicio), fim: _d10(c.fim), diaInicio: dia(c.inicio), diaFim: dia(c.fim), dias: c.dias,
      emCurso: !alta && _d10(c.fim) >= referencia, dose: String((c.ultima || {}).Dose || '').trim(), via: String((c.ultima || {}).Via || '').trim(),
      indicacao: String((c.ultima || {}).Indicacao || '').trim(), setor: String(c.Setor || '').trim(), parecer: String((c.ultima || {}).ParecerInfecto || '').trim(),
      /* profilaxia cirúrgica: começa no dia da cirurgia (±1) e dura até 2 dias */
      profilaxia: cirurgias.some(ci => Math.abs((diaDaInternacao(c.inicio, ci.data) || 99) - 1) <= 1) && c.dias <= 2 }))
    .sort((x, y) => x.inicio.localeCompare(y.inicio));

  /* ---- culturas ---- */
  const sensPorCultura = new Map();
  for (const s of (((b.culturas || {}).sensibilidade) || [])) { if (!sensPorCultura.has(s.ID_Cultura)) sensPorCultura.set(s.ID_Cultura, []); sensPorCultura.get(s.ID_Cultura).push(s); }
  const germe = typeof germeDaCultura === 'function' ? germeDaCultura : (v => String(v || '').trim());
  const classesTriagem = (typeof CLASSES_TRIAGEM !== 'undefined' && CLASSES_TRIAGEM) || ['Negativa', 'Colonização', 'Água', 'Leite', 'Controle ambiental/alimentar'];
  const culturas = daPessoa(((b.culturas || {}).culturas) || []).filter(c => dentro(c.DataColeta) && c.StatusRevisao !== 'descartada')
    .map(c => {
      const sens = sensPorCultura.get(c.ID_Cultura) || [];
      const classe = String(c.AvaliacaoCCIH || '').trim();
      const positiva = !!germe(c.Microrganismo) && !classesTriagem.includes(classe) && classe !== 'Não é cultura' && classe !== 'Contaminação';
      return { id: c.ID_Cultura, data: _d10(c.DataColeta), dia: dia(c.DataColeta), resultado: _d10(c.DataResultado), material: String(c.Material || '').trim(), sitio: String(c.Sitio || '').trim(),
        setor: String(c.Setor || '').trim(), microrganismo: String(c.Microrganismo || '').trim(), mecanismo: String(c.MecanismoResistencia || '').trim(),
        classificacao: classe, status: String(c.StatusRevisao || '').trim(), positiva, idIras: String(c.ID_IRAS || '').trim(),
        resistentes: sens.filter(s => s.Resultado === 'R').map(s => s.Antibiotico), sensiveis: sens.filter(s => s.Resultado === 'S').map(s => s.Antibiotico), antibiogramaTexto: String(c.Antibiograma || '').trim() };
    }).sort((x, y) => x.data.localeCompare(y.data));

  /* ---- sepse, IRAS, isolamento ---- */
  const sepse = daPessoa(((b.sepse || {}).casos) || []).filter(s => dentro(s.DataProtocolo))
    .map(s => ({ data: _d10(s.DataProtocolo), dia: dia(s.DataProtocolo), setor: String(s.Setor || '').trim(), confirmada: s.SepseConfirmada === 'S' ? 'confirmada' : s.SepseConfirmada === 'N' ? 'descartada' : 'em aberto',
      foco: String(s.FocoInfeccioso || '').trim(), news: String(s.ClassificacaoNEWS || '').trim() }));
  const iras = daPessoa(((b.iras || {}).casos) || []).filter(i => dentro(i.DataInfeccao) || (!_ehData(i.DataInfeccao) && !alta))
    .map(i => ({ id: i.ID_IRAS, data: _d10(i.DataInfeccao), dia: dia(i.DataInfeccao), topografia: String(i.Topografia || '').trim(), criterio: String(i.CriterioDiagnostico || '').trim(),
      setor: String(i.Setor || '').trim(), dispositivo: String(i.DispositivoAssociado || '').trim(), microrganismo: String(i.Microrganismo || '').trim(), status: String(i.StatusInvestigacao || '').trim(),
      observacoes: String(i.Observacoes || '').trim() }));
  const precaucoes = daPessoa(((b.isolamentos || {}).precaucoes) || []).filter(p => _ehData(p.DataInicio) && _d10(p.DataInicio) <= referencia && (!_ehData(p.DataFim) || _d10(p.DataFim) >= inicioJanela))
    .map(p => ({ inicio: _d10(p.DataInicio), fim: _ehData(p.DataFim) ? _d10(p.DataFim) : '', dia: dia(p.DataInicio), tipo: String(p.TipoPrecaucao || '').trim(), motivo: String(p.Motivo || '').trim(), ativa: !_ehData(p.DataFim) }));

  /* ---- evoluções: foto do banco + export cru extra, janela de 21 dias ---- */
  const nomes = [cadastro.Nome].concat(pacientes.filter(p => conjunto.has(_np(p.Prontuario))).map(p => p.Nome)).filter(Boolean);
  const inicioEvo = _somaDias(referencia, -(janelaEvo - 1));
  const vistos = new Set();
  const evolucoes = [];
  const sinaisFn = typeof sinaisDeInfeccaoNaEvolucao === 'function' ? sinaisDeInfeccaoNaEvolucao : () => ({ sinais: [], fortes: 0, sindromes: [], negados: [], resumo: '' });
  const vitaisFn = typeof sinaisVitaisNaEvolucao === 'function' ? sinaisVitaisNaEvolucao : () => ({ medidas: [], alterados: [], resumo: '' });
  const templateFn = typeof extrairTemplateEvolucao === 'function' ? extrairTemplateEvolucao : () => ({ dataIH: '', dispositivos: [], antibioticos: [], culturas: [] });
  const neoPed = /neonatal|pediatr|bercario/.test(_nt(setorAtual));
  /* Histórico acumulado primeiro (texto mais longo, 3 semanas), depois a foto operacional e
     o que vier de export cru pela linha de comando. */
  const fontes = [((b.evolucoes_historico || {}).evolucoes) || [], ((b.evolucoes || {}).evolucoes) || [], op.evolucoesExtras || []];
  for (const lista of fontes) {
    for (const e of lista) {
      const doAtendimento = _np(e.Atendimento) === atd;
      const daPessoaMesma = !e.Atendimento && conjunto.has(_np(e.Prontuario));
      if (!doAtendimento && !daPessoaMesma) continue;
      const d = _d10(e.DataEvolucao);
      if (!_ehData(d) || d < inicioEvo || d > referencia || d < _somaDias(admissao, -1)) continue;
      const texto = String(e.Texto || '').trim();
      if (!texto) continue;
      const chave = d + '|' + _nt(texto).slice(0, 200);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const sinais = sinaisFn(texto);
      const vitais = vitaisFn(texto, { neoPed });
      evolucoes.push({ data: d, dia: dia(d), setor: String(e.Setor || '').trim(), categoria: String(e.Categoria || '').trim(),
        rotuloCategoria: ROTULO_CATEGORIA_EVOLUCAO[String(e.Categoria || '').trim()] || (e.Categoria ? 'evolução (' + e.Categoria + ')' : 'evolução'),
        texto: anonimizarTexto(texto, nomes), sinais: sinais.resumo, sinaisLista: sinais.sinais.map(s => s.rotulo), sinaisFortes: sinais.fortes, negados: sinais.negados,
        vitaisAlterados: vitais.alterados || [], template: templateFn(texto), _ordem: Number(e._ordem) || 0 });
    }
  }
  evolucoes.sort((x, y) => x.data.localeCompare(y.data) || x._ordem - y._ordem);
  evolucoes.forEach(e => { delete e._ordem; });

  /* ---- sinais vitais estruturados (relatório 2411) ---- */
  const alterFn = typeof alteracoesDaMedida === 'function' ? alteracoesDaMedida : () => [];
  const vitaisPorDia = new Map();
  for (const m of (((b.evolucoes || {}).sinais_vitais) || [])) {
    if (_np(m.Atendimento) !== atd || !_ehData(m.DataMedida)) continue;
    const d = _d10(m.DataMedida);
    if (d < inicioEvo || d > referencia) continue;
    const alt = alterFn(m, { neoPed });
    if (!alt.length) continue;
    if (!vitaisPorDia.has(d)) vitaisPorDia.set(d, new Set());
    alt.forEach(a => vitaisPorDia.get(d).add(a));
  }
  const vitais = [...vitaisPorDia.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([d, s]) => ({ data: d, dia: dia(d), alterados: [...s] }));

  const dossie = {
    atendimento: atd, prontuario: pront, outrosNumeros: numeros.filter(n => n !== pront),
    paciente: { idade, sexo: String(cadastro.Sexo || '').trim() },
    admissao, alta, obito, desfecho: String(intern.Desfecho || '').trim(), clinica: String(intern.Clinica || '').trim(),
    referencia, diaReferencia: diaRef, hoje, janelaEvolucoesDias: janelaEvo, inicioJanelaEvolucoes: inicioEvo,
    setorAtual, emUTI, setores, internacoesPrevias: previas,
    cirurgias, dispositivos, visitasUti, cursos, culturas, sepse, iras, precaucoes, evolucoes, vitais
  };
  dossie.sinais = sinaisDoDossie(dossie);
  dossie.escore = dossie.sinais.reduce((s, f) => s + f.peso, 0);
  dossie.eventos = eventosDoDossie(dossie);
  return dossie;
}

/* Sinais DETERMINÍSTICOS que pesam para IRAS (não é diagnóstico — é a triagem que ordena a
   fila e que a IA recebe como "atenção a"). Pesos simples, inteiros, para ordenar. */
function sinaisDoDossie(d) {
  const sinais = [];
  const add = (codigo, peso, texto) => sinais.push({ codigo, peso, texto });
  const diaRef = d.diaReferencia || 0;
  if (diaRef >= 7) add('internacao_longa', 1, `internação de ${diaRef} dias`);
  const atbNovos = d.cursos.filter(c => !c.profilaxia && c.diaInicio !== null && c.diaInicio >= DOSSIE_DIA_IRAS);
  if (atbNovos.length) add('atb_apos_d3', 3, 'antibiótico iniciado a partir de D3: ' + atbNovos.map(c => `${c.antibiotico} (${rotuloDia(c.diaInicio)})`).join(', '));
  /* escalonamento: um curso começa enquanto outro (não profilático) ainda corre */
  const escalonados = atbNovos.filter(c => d.cursos.some(o => o !== c && !o.profilaxia && o.inicio < c.inicio && o.fim >= c.inicio));
  if (escalonados.length) add('troca_ou_escalonamento', 2, 'antibiótico acrescentado/trocado com outro em curso: ' + escalonados.map(c => c.antibiotico).join(', '));
  const prolongados = d.cursos.filter(c => !c.profilaxia && c.dias >= 10);
  if (prolongados.length) add('atb_prolongado', 1, 'curso ≥10 dias: ' + prolongados.map(c => `${c.antibiotico} (${c.dias} d)`).join(', '));
  const colhidas = d.culturas.filter(c => c.dia !== null && c.dia >= DOSSIE_DIA_IRAS);
  if (colhidas.length) add('cultura_apos_d3', 2, `${colhidas.length} cultura(s) colhida(s) a partir de D3`);
  const positivas = colhidas.filter(c => c.positiva);
  if (positivas.length) add('cultura_positiva_apos_d3', 4, 'cultura positiva a partir de D3: ' + positivas.map(c => `${c.microrganismo} em ${c.material || 'material não informado'} (${rotuloDia(c.dia)})`).join('; '));
  const mdr = d.culturas.filter(c => c.mecanismo);
  if (mdr.length) add('multirresistente', 1, 'mecanismo de resistência: ' + [...new Set(mdr.map(c => c.mecanismo))].join(', '));
  const cirNaInternacao = d.cirurgias.filter(c => c.dia !== null && c.dia >= 1);
  if (cirNaInternacao.length) add('cirurgia', 2, 'cirurgia nesta internação: ' + cirNaInternacao.map(c => `${c.procedimento} (${rotuloDia(c.dia)})`).join('; '));
  const cirPrevia = d.cirurgias.filter(c => c.dia !== null && c.dia < 1);
  if (cirPrevia.length) add('cirurgia_previa_30d', 2, 'cirurgia nos 30 dias antes da admissão (vigilância de ISC): ' + cirPrevia.map(c => `${c.procedimento} (${c.data})`).join('; '));
  const dispAtivos = d.dispositivos.filter(x => !x.retirada || x.retirada >= d.referencia);
  const dispVisita = new Set(); d.visitasUti.forEach(v => v.dispositivos.forEach(x => dispVisita.add(x.replace(/\s*\(.*$/, ''))));
  const dispEvo = new Set(); d.evolucoes.forEach(e => (e.template.dispositivos || []).forEach(x => dispEvo.add(x.nome)));
  const todosDisp = [...new Set(dispAtivos.map(x => x.nome).concat([...dispVisita], [...dispEvo]))].filter(Boolean);
  if (todosDisp.length) add('dispositivo_invasivo', 2, 'dispositivo invasivo: ' + todosDisp.join(', '));
  if (d.emUTI) add('uti', 1, 'paciente em UTI/CTI');
  const comSinal = d.evolucoes.filter(e => e.sinais);
  if (comSinal.length) {
    const rotulos = [...new Set(comSinal.flatMap(e => e.sinaisLista))];
    const fortes = comSinal.reduce((s, e) => s + e.sinaisFortes, 0);
    add('sinais_na_evolucao', fortes ? 4 : 2, `${comSinal.length} evolução(ões) com sinal de infecção${fortes ? ' (infecção NOMEADA pelo assistente)' : ''}: ` + rotulos.join(', '));
  }
  const diasVitais = new Set(d.vitais.map(v => v.data).concat(d.evolucoes.filter(e => e.vitaisAlterados.length).map(e => e.data)));
  if (diasVitais.size) add('vitais_alterados', 1, `sinais vitais alterados em ${diasVitais.size} dia(s)`);
  if (d.sepse.length) add('protocolo_sepse', 3, 'protocolo de sepse aberto: ' + d.sepse.map(s => `${rotuloDia(s.dia)} ${s.confirmada}${s.foco ? ', foco ' + s.foco : ''}`).join('; '));
  if (d.visitasUti.some(v => v.suspeita)) add('suspeita_na_visita', 3, 'suspeita de IRAS anotada na visita da CCIH: ' + d.visitasUti.filter(v => v.suspeita).map(v => v.suspeita).join('; '));
  if (d.precaucoes.some(p => p.ativa)) add('isolamento', 1, 'precaução ativa: ' + d.precaucoes.filter(p => p.ativa).map(p => `${p.tipo}${p.motivo ? ' (' + p.motivo + ')' : ''}`).join('; '));
  if (d.iras.length) add('iras_registrada', 0, 'a CCIH JÁ registrou caso nesta internação: ' + d.iras.map(i => `${i.topografia} (${i.status}${i.dia !== null ? ', ' + rotuloDia(i.dia) : ''})`).join('; '));
  return sinais;
}

/* Linha do tempo única (ordem cronológica) — a mesma lógica da ficha, com o dia D. */
function eventosDoDossie(d) {
  const ev = [];
  const add = (data, dia, tipo, titulo, detalhe) => { if (_ehData(data)) ev.push({ data: _d10(data), dia, tipo, titulo, detalhe: detalhe || '' }); };
  for (const p of d.internacoesPrevias) add(p.entrada, diaDaInternacao(p.entrada, d.admissao), 'internacao_previa', 'Internação anterior', [p.setor, p.alta ? 'alta ' + dataBR(p.alta) : 'sem alta registrada', p.desfecho].filter(Boolean).join(' · '));
  add(d.admissao, 1, 'admissao', 'Admissão hospitalar', [d.setores.length ? d.setores[0].setor : d.setorAtual, d.clinica].filter(Boolean).join(' · '));
  d.setores.slice(1).forEach(s => add(s.entrada, s.diaEntrada, 'transferencia', 'Transferência para ' + s.setor, ''));
  d.cirurgias.forEach(c => add(c.data, c.dia, 'cirurgia', 'Cirurgia: ' + c.procedimento, [c.procedimentoOriginal !== c.procedimento ? c.procedimentoOriginal : '', c.contaminacao, c.asa ? 'ASA ' + c.asa : '', c.duracaoMin ? c.duracaoMin + ' min' : '', c.carater, c.profilaxia ? 'profilaxia: ' + c.profilaxia : '', c.isc ? 'ISC registrada: ' + c.isc : ''].filter(Boolean).join(' · ')));
  d.dispositivos.forEach(x => { add(x.instalacao, x.diaInstalacao, 'dispositivo', 'Instalado: ' + x.nome, x.categoria); if (x.retirada) add(x.retirada, x.diaRetirada, 'dispositivo', 'Retirado: ' + x.nome, x.dias !== '' ? x.dias + ' dias de uso' : ''); });
  d.cursos.forEach(c => {
    add(c.inicio, c.diaInicio, 'antibiotico', (c.profilaxia ? 'Profilaxia cirúrgica: ' : 'Início de ') + c.antibiotico, [c.dose, c.via, c.indicacao, c.setor, c.emCurso ? `em curso (${c.dias} d)` : ''].filter(Boolean).join(' · '));
    if (!c.emCurso) add(c.fim, c.diaFim, 'antibiotico', 'Fim de ' + c.antibiotico, `${c.dias} dia(s)` + (c.parecer ? ' · ' + c.parecer : ''));
  });
  d.culturas.forEach(c => add(c.data, c.dia, c.positiva ? 'cultura_positiva' : 'cultura', c.microrganismo ? `Cultura: ${c.microrganismo}` : 'Cultura colhida (sem crescimento/sem resultado)',
    [c.material, c.sitio, c.setor, c.mecanismo, c.classificacao ? 'CCIH: ' + c.classificacao : (c.status ? 'revisão: ' + c.status : ''), c.resultado ? 'resultado ' + dataBR(c.resultado) : '', c.resistentes.length ? 'R: ' + c.resistentes.join(', ') : '', c.sensiveis.length ? 'S: ' + c.sensiveis.join(', ') : ''].filter(Boolean).join(' · ')));
  d.sepse.forEach(s => add(s.data, s.dia, 'sepse', 'Protocolo de sepse (' + s.confirmada + ')', [s.setor, s.foco, s.news ? 'NEWS ' + s.news : ''].filter(Boolean).join(' · ')));
  d.visitasUti.forEach(v => add(v.data, v.dia, 'visita_uti', 'Visita da CCIH à UTI', [v.dispositivos.join(', '), v.suspeita ? 'suspeita de IRAS: ' + v.suspeita : '', v.observacoes].filter(Boolean).join(' · ')));
  d.precaucoes.forEach(p => { add(p.inicio, p.dia, 'isolamento', 'Precaução de ' + (p.tipo || 'contato'), p.motivo); if (p.fim) add(p.fim, diaDaInternacao(p.fim, d.admissao), 'isolamento', 'Precaução encerrada', p.tipo); });
  d.iras.forEach(i => add(i.data, i.dia, 'iras', 'Caso de IRAS registrado pela CCIH: ' + i.topografia, [i.status, i.criterio, i.dispositivo, i.microrganismo].filter(Boolean).join(' · ')));
  d.vitais.forEach(v => add(v.data, v.dia, 'vitais', 'Sinais vitais alterados', v.alterados.join(', ')));
  if (d.alta) add(d.alta, diaDaInternacao(d.alta, d.admissao), d.obito ? 'obito' : 'alta', d.obito ? 'Óbito' : 'Alta hospitalar', d.desfecho);
  const ordem = { internacao_previa: 0, admissao: 1, transferencia: 2, cirurgia: 3, dispositivo: 4, antibiotico: 5, cultura: 6, cultura_positiva: 6, sepse: 7, visita_uti: 8, isolamento: 9, iras: 10, vitais: 11, alta: 12, obito: 12 };
  ev.sort((x, y) => x.data.localeCompare(y.data) || (ordem[x.tipo] || 0) - (ordem[y.tipo] || 0));
  return ev;
}

/* Texto do dossiê (Markdown), pronto para o modelo. Sem nome, sem autor. */
function renderizarDossie(d, opcoes) {
  const op = opcoes || {};
  const L = [];
  const dRef = `${rotuloDia(d.diaReferencia)} (${dataBR(d.referencia)})`;
  L.push(`# Dossiê de internação — atendimento ${d.atendimento}`);
  L.push('');
  L.push(`Prontuário ${d.prontuario || '?'}${d.outrosNumeros.length ? ' (outros números: ' + d.outrosNumeros.join(', ') + ')' : ''} · ${d.paciente.idade !== '' ? d.paciente.idade + ' anos' : 'idade não informada'}${d.paciente.sexo ? ' · ' + d.paciente.sexo : ''}.`);
  L.push(`Admissão em ${dataBR(d.admissao)} (D1)${d.setores.length ? ' em ' + d.setores[0].setor : ''}${d.clinica ? ' · clínica: ' + d.clinica : ''}.`);
  L.push(d.alta ? `${d.obito ? 'Óbito' : 'Alta'} em ${dataBR(d.alta)} (${rotuloDia(diaDaInternacao(d.alta, d.admissao))})${d.desfecho ? ' · ' + d.desfecho : ''}. Dia de referência deste dossiê: ${dRef}.`
    : `Ainda internado${d.setorAtual ? ' em ' + d.setorAtual : ''}. Dia de referência deste dossiê (hoje): ${dRef}.`);
  L.push('');
  L.push('Convenção: D1 = dia da admissão; D3 em diante = início hospitalar (critério temporal de IRAS). Dias negativos = antes da admissão.');
  if (d.internacoesPrevias.length) L.push(`Readmissão: ${d.internacoesPrevias.length} internação(ões) nos 90 dias anteriores (${d.internacoesPrevias.map(p => dataBR(p.entrada) + '→' + (p.alta ? dataBR(p.alta) : '?')).join('; ')}).`);
  L.push('');

  L.push('## Sinais de atenção (triagem automática, não é diagnóstico)');
  L.push('');
  if (d.sinais.length) d.sinais.forEach(s => L.push(`- ${s.texto}`)); else L.push('- nenhum sinal automático');
  L.push('');

  L.push('## Trajetória por setor');
  L.push('');
  if (d.setores.length) d.setores.forEach(s => L.push(`- ${rotuloDia(s.diaEntrada)}${s.diaSaida !== null && s.diaSaida !== undefined ? '–' + rotuloDia(s.diaSaida) : '–' + (d.alta ? rotuloDia(diaDaInternacao(d.alta, d.admissao)) : 'hoje')}: ${s.setor}`));
  else L.push('- setor não informado');
  L.push('');

  L.push('## Linha do tempo');
  L.push('');
  L.push('| Dia | Data | Evento | Detalhe |');
  L.push('|---|---|---|---|');
  for (const e of d.eventos) L.push(`| ${rotuloDia(e.dia)} | ${dataBR(e.data)} | ${e.titulo.replace(/\|/g, '/')} | ${String(e.detalhe).replace(/\|/g, '/').replace(/\n/g, ' ')} |`);
  L.push('');

  L.push('## Antibióticos (cursos, não renovações)');
  L.push('');
  if (d.cursos.length) {
    L.push('| Antibiótico | Início | Fim | Dias | Dose/via | Indicação registrada | Observação |');
    L.push('|---|---|---|---|---|---|---|');
    d.cursos.forEach(c => L.push(`| ${c.antibiotico} | ${rotuloDia(c.diaInicio)} (${dataBR(c.inicio)}) | ${c.emCurso ? 'em curso' : rotuloDia(c.diaFim) + ' (' + dataBR(c.fim) + ')'} | ${c.dias} | ${[c.dose, c.via].filter(Boolean).join(' ')} | ${c.indicacao} | ${[c.profilaxia ? 'provável profilaxia cirúrgica' : '', c.parecer].filter(Boolean).join('; ')} |`));
  } else L.push('Nenhum antibiótico no período.');
  L.push('');

  L.push('## Culturas');
  L.push('');
  if (d.culturas.length) {
    L.push('| Coleta | Material | Microrganismo | Mecanismo | Antibiograma | Classificação da CCIH |');
    L.push('|---|---|---|---|---|---|');
    d.culturas.forEach(c => L.push(`| ${rotuloDia(c.dia)} (${dataBR(c.data)}) | ${[c.material, c.sitio].filter(Boolean).join(' / ')} | ${c.microrganismo || 'sem crescimento / sem resultado'} | ${c.mecanismo} | ${c.resistentes.length || c.sensiveis.length ? ['R: ' + c.resistentes.join(', '), 'S: ' + c.sensiveis.join(', ')].filter(x => !/: $/.test(x)).join('; ') : c.antibiogramaTexto} | ${c.classificacao || ('revisão ' + c.status)} |`));
  } else L.push('Nenhuma cultura no período.');
  L.push('');

  L.push('## Cirurgias e dispositivos invasivos');
  L.push('');
  if (d.cirurgias.length) d.cirurgias.forEach(c => L.push(`- Cirurgia ${rotuloDia(c.dia)} (${dataBR(c.data)}): ${c.procedimento}${c.procedimentoOriginal && c.procedimentoOriginal !== c.procedimento ? ' [' + c.procedimentoOriginal + ']' : ''}${c.contaminacao ? ' · ' + c.contaminacao : ''}${c.asa ? ' · ASA ' + c.asa : ''}${c.duracaoMin ? ' · ' + c.duracaoMin + ' min' : ''}${c.profilaxia ? ' · profilaxia: ' + c.profilaxia : ''}${c.isc ? ' · ISC registrada: ' + c.isc : ''}`));
  else L.push('- Nenhuma cirurgia nos 30 dias antes da admissão nem na internação.');
  if (d.dispositivos.length) d.dispositivos.forEach(x => L.push(`- Dispositivo: ${x.nome} de ${rotuloDia(x.diaInstalacao)} (${dataBR(x.instalacao)}) a ${x.retirada ? rotuloDia(x.diaRetirada) + ' (' + dataBR(x.retirada) + ')' : 'hoje (em uso)'}${x.dias !== '' ? ' · ' + x.dias + ' dias' : ''}`));
  if (d.visitasUti.length) d.visitasUti.forEach(v => L.push(`- Visita da CCIH ${rotuloDia(v.dia)} (${dataBR(v.data)}): ${v.dispositivos.join(', ') || 'sem dispositivo anotado'}${v.suspeita ? ' · suspeita de IRAS: ' + v.suspeita : ''}${v.observacoes ? ' · ' + v.observacoes : ''}`));
  const dispEvo = [...new Set(d.evolucoes.flatMap(e => (e.template.dispositivos || []).map(x => `${x.nome} (${x.data})`)))];
  if (dispEvo.length) L.push(`- Dispositivos citados no cabeçalho das evoluções: ${dispEvo.join(', ')}`);
  if (!d.dispositivos.length && !d.visitasUti.length && !dispEvo.length) L.push('- Nenhum dispositivo registrado (o cadastro de dispositivos não é preenchido de rotina — procure nas evoluções).');
  L.push('');

  if (d.sepse.length || d.precaucoes.length || d.iras.length) {
    L.push('## Registros da CCIH e protocolos');
    L.push('');
    d.sepse.forEach(s => L.push(`- Protocolo de sepse ${rotuloDia(s.dia)} (${dataBR(s.data)}): ${s.confirmada}${s.foco ? ' · foco ' + s.foco : ''}${s.news ? ' · NEWS ' + s.news : ''}`));
    d.precaucoes.forEach(p => L.push(`- Precaução ${p.tipo || 'de contato'} desde ${rotuloDia(p.dia)} (${dataBR(p.inicio)})${p.fim ? ' até ' + dataBR(p.fim) : ' (ativa)'}${p.motivo ? ' · ' + p.motivo : ''}`));
    d.iras.forEach(i => L.push(`- Caso de IRAS já registrado: ${i.topografia}${i.dia !== null ? ' em ' + rotuloDia(i.dia) : ''} · ${i.status}${i.criterio ? ' · ' + i.criterio : ''}${i.microrganismo ? ' · ' + i.microrganismo : ''}`));
    L.push('');
  }

  L.push(`## Evoluções (${d.evolucoes.length}, últimos ${d.janelaEvolucoesDias} dias, ordem cronológica)`);
  L.push('');
  if (!d.evolucoes.length) L.push('Nenhuma evolução disponível na janela.');
  for (const e of d.evolucoes) {
    L.push(`### ${rotuloDia(e.dia)} · ${dataBR(e.data)} · ${e.setor || 'setor não informado'} · ${e.rotuloCategoria}`);
    const marcas = [];
    if (e.sinais) marcas.push('sinais no texto: ' + e.sinais);
    if (e.vitaisAlterados.length) marcas.push('vitais alterados: ' + e.vitaisAlterados.join(', '));
    if (e.negados.length) marcas.push('negações: ' + e.negados.join('; '));
    if (marcas.length) L.push('_' + marcas.join(' · ') + '_');
    L.push('');
    L.push(e.texto.replace(/\r\n?/g, '\n').trim());
    L.push('');
  }
  if (d.vitais.length) {
    L.push('## Sinais vitais alterados (aferições estruturadas)');
    L.push('');
    d.vitais.forEach(v => L.push(`- ${rotuloDia(v.dia)} (${dataBR(v.data)}): ${v.alterados.join(', ')}`));
    L.push('');
  }
  if (!op.semRodape) L.push(`_Gerado em ${dataBR(d.hoje)} pelo Aplicativo CCIH. Documento pseudonimizado: sem nome do paciente e sem autor das evoluções; o texto livre pode conter nomes de terceiros — uso interno da CCIH, só em modelo local._`);
  return L.join('\n');
}

/* Candidatos a dossiê: internados agora (ou todos os abertos), com ≥48 h de internação e
   pelo menos uma evolução na janela (banco + extras). Devolve ordenado por escore. */
function selecionarInternacoesParaDossie(bancos, opcoes) {
  const op = opcoes || {};
  const b = bancos || {};
  const hoje = _d10(op.hoje) || new Date().toISOString().slice(0, 10);
  const internadosFn = typeof internadosAgora === 'function' ? internadosAgora : (bb => (((bb.pacientes || {}).internacoes) || []).filter(i => !String(i.DataAlta || '').trim()));
  const base = op.atendimentos && op.atendimentos.length
    ? op.atendimentos.map(a => internacaoDoAtendimento(((b.pacientes || {}).internacoes) || [], a)).filter(Boolean)
    : internadosFn(b);
  const comEvolucao = new Set();
  for (const e of (((b.evolucoes_historico || {}).evolucoes) || []).concat(((b.evolucoes || {}).evolucoes) || [], op.evolucoesExtras || [])) if (String(e.Texto || '').trim()) comEvolucao.add(_np(e.Atendimento));
  /* Pedido explícito por atendimento não exige evolução (o dossiê sai com o que houver). */
  const exigirEvolucao = !op.semExigirEvolucao && !(op.atendimentos && op.atendimentos.length);
  const saida = [];
  const vistos = new Set();
  for (const i of base) {
    const atd = _np(i.Atendimento);
    if (!atd || vistos.has(atd)) continue;
    vistos.add(atd);
    /* Quem já teve alta só entra quando pedido por atendimento (a passagem de setor pode ter
       ficado aberta no censo mesmo com a alta registrada). */
    if (!op.atendimentos && _ehData(i.DataAlta)) continue;
    const diaHoje = diaDaInternacao(hoje, i.DataInternacao);
    if (diaHoje === null || diaHoje < Math.ceil(DOSSIE_MINIMO_HORAS / 24) + 1) continue;   /* D3+ = passou de 48 h */
    if (exigirEvolucao && !comEvolucao.has(atd)) continue;
    const d = montarDossieInternacao(b, atd, { hoje, evolucoesExtras: op.evolucoesExtras, janelaEvolucoesDias: op.janelaEvolucoesDias });
    if (!d) continue;
    if (!op.atendimentos && (d.alta || d.diaReferencia === null || d.diaReferencia < Math.ceil(DOSSIE_MINIMO_HORAS / 24) + 1)) continue;
    if (exigirEvolucao && !d.evolucoes.length) continue;
    saida.push({ atendimento: atd, prontuario: d.prontuario, dia: d.diaReferencia, setor: d.setorAtual, evolucoes: d.evolucoes.length, escore: d.escore,
      sinais: d.sinais.map(s => s.codigo), irasRegistrada: d.iras.length > 0, dossie: d });
  }
  saida.sort((x, y) => y.escore - x.escore || y.evolucoes - x.evolucoes || x.atendimento.localeCompare(y.atendimento));
  return saida;
}

/* Amostra ESTRATIFICADA para a rodada de calibração: metade do topo, 30% do meio, 20% do fim
   da lista por escore — para a IA ver casos óbvios, duvidosos e provavelmente negativos. */
function amostrarDossies(candidatos, n) {
  const lista = (candidatos || []).slice();
  const total = Math.min(n || 10, lista.length);
  if (total >= lista.length) return lista;
  const nTopo = Math.round(total * 0.5), nFim = Math.max(1, Math.round(total * 0.2)), nMeio = total - nTopo - nFim;
  const topo = lista.slice(0, nTopo);
  const fim = lista.slice(lista.length - nFim);
  const meioBase = lista.slice(nTopo, lista.length - nFim);
  const meio = [];
  for (let k = 0; k < nMeio && meioBase.length; k++) meio.push(meioBase[Math.floor((k + 0.5) * meioBase.length / nMeio)]);
  return topo.concat(meio, fim);
}

/* Instrução para o modelo: a pergunta, a convenção temporal e os critérios principais por
   sítio. Semente para a CCIH VALIDAR contra os critérios nacionais vigentes (ANVISA, Critérios
   Diagnósticos de IRAS) — não é documento oficial. A saída pedida é estruturada para a
   conferência por amostragem ser rápida. */
const PROMPT_AVALIACAO_DOSSIE = `# Tarefa: avaliar probabilidade de infecção relacionada à assistência à saúde (IRAS)

Você recebe o dossiê de UMA internação hospitalar: trajetória por setor, cirurgias, dispositivos invasivos, cursos de antibiótico, culturas, protocolos e o texto das evoluções clínicas (ordem cronológica). Leia tudo e responda SOMENTE no formato de saída abaixo. Você não decide nada sozinho: a Comissão de Controle de Infecção Hospitalar (CCIH) confere a sua resposta.

## Convenção temporal (use exatamente esta)
- D1 = dia da admissão hospitalar. D2 = dia seguinte, e assim por diante. Dias negativos = antes da admissão.
- Uma infecção é HOSPITALAR (IRAS) quando o primeiro sinal/sintoma ou a primeira cultura compatível ocorre em D3 ou depois, E não havia evidência de que já estava presente ou incubando na admissão (D1–D2).
- Infecção presente em D1–D2 é COMUNITÁRIA (não é IRAS), salvo infecção de sítio cirúrgico de cirurgia anterior ou infecção claramente ligada a internação/procedimento anterior.
- Associada a dispositivo: o dispositivo (ventilação mecânica, cateter venoso central, sonda vesical de demora) estava em uso por mais de 2 dias consecutivos e estava presente no dia da infecção ou no dia anterior.
- Infecção de sítio cirúrgico (ISC): até 30 dias após a cirurgia (90 dias se houver implante).

## Critérios principais por sítio (resumo; a CCIH valida a versão completa)
- Pneumonia (PAV se em ventilação mecânica > 2 dias): imagem com infiltrado/consolidação novo ou progressivo E pelo menos dois de: febre (> 38 °C) ou hipotermia, leucocitose ou leucopenia, secreção traqueal/escarro purulento novo ou aumentado, piora da troca gasosa (queda de saturação, aumento de O2 ou de parâmetros ventilatórios), tosse/dispneia/taquipneia novas, ausculta com roncos/estertores novos.
- Infecção primária de corrente sanguínea (IPCS; associada a CVC se CVC > 2 dias): hemocultura com patógeno reconhecido não relacionado a infecção em outro sítio; OU duas hemoculturas (coletas separadas) com o mesmo contaminante comum de pele (estafilococo coagulase-negativo, Bacillus, difteroides etc.) MAIS febre, calafrios ou hipotensão. Sepse clínica sem hemocultura positiva só com sinais sistêmicos e sem outro foco, com antibiótico iniciado.
- Infecção do trato urinário (ITU; associada a SVD se SVD > 2 dias): pelo menos um sintoma (febre, urgência, polaciúria, disúria, dor suprapúbica ou lombar) E urocultura com até duas espécies e pelo menos 10^5 UFC/mL. Bacteriúria sem sintomas não é infecção.
- Infecção de sítio cirúrgico: drenagem purulenta da incisão ou de órgão/cavidade; OU cultura positiva de secreção/tecido do sítio obtida assepticamente; OU deiscência/abertura deliberada da ferida com dor, edema, calor ou hiperemia; OU abscesso/evidência de infecção em reoperação, imagem ou exame histopatológico. Superficial (pele/subcutâneo), profunda (fáscia/músculo) ou de órgão/cavidade.
- Pele e partes moles, infecção intra-abdominal, gastroenterite (incluindo Clostridioides difficile), infecções do sistema nervoso central e outras: sinais locais + cultura ou imagem compatível, iniciados em D3 ou depois.

## Como pesar a evidência
- Cultura positiva colhida em D3 ou depois, com sítio compatível e tratamento iniciado, pesa muito. Cultura de vigilância (swab retal/nasal) positiva é COLONIZAÇÃO, não infecção.
- Antibiótico novo ou escalonado a partir de D3 sem explicação de profilaxia é sinal forte, mas não basta sozinho.
- O médico assistente escrever "pneumonia", "ITU", "sepse", "infecção de ferida" a partir de D3 é sinal forte. Observe negações ("afebril", "sem sinais flogísticos", "nega").
- Febre isolada, leucocitose isolada ou PCR elevada sem foco são sinais fracos.
- Se a CCIH já registrou um caso de IRAS nesta internação, avalie mesmo assim como se não soubesse e diga se concorda.

## Formato de saída (obrigatório)
FAIXA: uma de [ALTA probabilidade de IRAS | MÉDIA probabilidade de IRAS | BAIXA probabilidade de IRAS | SEM EVIDÊNCIA de infecção]
SÍTIO PROVÁVEL: (pneumonia/PAV, IPCS, ITU, ISC, pele e partes moles, intra-abdominal, gastrointestinal, SNC, outro, nenhum)
DISPOSITIVO ASSOCIADO: (VM, CVC, SVD, nenhum, não dá para saber)
DIA PROVÁVEL DE INÍCIO: Dn (ou "não dá para saber")
CRITÉRIOS ATENDIDOS: lista curta
EVIDÊNCIAS: até 5 trechos LITERAIS do dossiê (copiados), cada um com o Dn em que aparece
CONTRA: o que fala contra IRAS (infecção comunitária, colonização, profilaxia, negações…)
CONFIANÇA: 0 a 100
`;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DOSSIE_JANELA_EVOLUCOES_DIAS, DOSSIE_ANTES_ADMISSAO_DIAS, DOSSIE_DIA_IRAS, DOSSIE_MINIMO_HORAS,
    DOSSIE_RETENCAO_HISTORICO_DIAS, TAMANHO_EVOLUCAO_HISTORICO, acumularHistoricoEvolucoes,
    diaDaInternacao, rotuloDia, dataBR, internacaoDoAtendimento, numerosDaPessoa, anonimizarTexto,
    lerEvolucoesCompletasTasy, montarDossieInternacao, sinaisDoDossie, eventosDoDossie, renderizarDossie,
    selecionarInternacoesParaDossie, amostrarDossies, PROMPT_AVALIACAO_DOSSIE
  };
}
