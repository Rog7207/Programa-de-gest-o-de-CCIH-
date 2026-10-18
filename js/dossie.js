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
  t = t.replace(/(\[PACIENTE\]\s*){2,}/g, '[PACIENTE] ');
  /* Telefone, CPF e nome de familiar escritos no texto livre (amostra de 16/10/2026: "visita da
     filha Simone (48) 9xxxx-xxxx"). O familiar só quando o nome vem logo depois do parentesco e
     começa com maiúscula num texto que não está todo em caixa alta — em CAIXA ALTA não dá para
     separar nome de palavra comum, e o nome fica. */
  t = t.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]');
  t = t.replace(/(\(?\b\d{2}\)?\s?)?\b9?\d{4}[-.\s]?\d{4}\b/g, m => (m.replace(/\D/g, '').length >= 8 ? '[TELEFONE]' : m));
  const PARENTESCO = /^(filh[oa]s?|espos[oa]|marido|net[oa]s?|irm[ãa]o?s?|m[ãa]e|pai|sobrinh[oa]|genro|nora|companheir[oa]|cunhad[oa]|tio|tia|prim[oa])$/i;
  t = t.replace(/([A-Za-zÀ-ÿ]+)(\s+)([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõçà]{2,})/g, (m, rel, esp, nome) => PARENTESCO.test(rel) ? rel + esp + '[FAMILIAR]' : m);
  return t;
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

/* Texto minúsculo sem acento, COM espaços (normalizarTexto tira os espaços). */
const _txt = v => String(v == null ? '' : v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const _germeNorm = v => _txt(v).replace(/\b(spp?|sp)\.?$/, '').trim();

function ehHemocultura(material) { return /hemocult|\bsangue\b/.test(_txt(material)); }

/* Contaminantes comuns de pele (lista do critério de IPCS). */
const RE_CONTAMINANTE_COMUM = /coagulase[- ]?negativ|\bscn\b|staphylococcus (epidermidis|haemolyticus|hominis|capitis|warneri|saprophyticus|simulans|cohnii)|corynebacterium|difteroide|^bacillus(?! anthracis)|micrococcus|cutibacterium|propionibacterium|viridans|aerococcus|rhodococcus/;
function ehContaminanteComum(microrganismo) { return RE_CONTAMINANTE_COMUM.test(_txt(microrganismo)); }

/* Síndrome a que o material pertence — mesmas síndromes de sinaisDeInfeccaoNaEvolucao. Swab
   de vigilância e materiais sem sítio ficam '' (não definem infecção de sítio). */
function sindromeDoMaterial(material, sitio) {
  const t = _txt((material || '') + ' ' + (sitio || ''));
  if (/swab|vigilancia|leite|agua/.test(t)) return '';
  if (/hemocult|sangue|ponta de cateter/.test(t)) return 'corrente sanguinea';
  if (/urocult|urina/.test(t)) return 'urinaria';
  if (/traqueal|escarro|broncoalveolar|aspirado|pleural|pulmon/.test(t)) return 'respiratoria';
  if (/ferida operat|incis|sitio cirurg/.test(t)) return 'ferida operatoria';
  if (/partes moles|tecido|abscesso|pele|osso|articular|ferida/.test(t)) return 'pele e partes moles';
  if (/ascit|peritone|abdom|bile|biliar/.test(t)) return 'abdominal';
  if (/liquor|lcr/.test(t)) return 'snc';
  if (/fezes/.test(t)) return 'gastrointestinal';
  return '';
}
/* Ferida operatória e pele/partes moles se confundem na prática: mesmo grupo. */
function grupoSindrome(s) { return s === 'ferida operatoria' || s === 'pele e partes moles' ? 'pele/ferida' : (s || ''); }

/* Categorias de evolução do Tasy do HNSC (Ie evolução clínica), mapeadas pelo CONTEÚDO em
   16/10/2026. grupo: medica | enfermagem | fisioterapia | ccih | outra. As de grupo 'outra'
   (nutrição, plano multidisciplinar, boletim à família, agência transfusional…) não pesam para
   infecção e ficam fora do formato por dia. As da CCIH ('Pelo SCIH', notificação do NHE,
   checklist de inserção) são JULGAMENTO/registro da própria CCIH: nunca entram em dossiê cego —
   o checklist de inserção vira evento de dispositivo. Código desconhecido: entra, pelo texto
   (FISIOTERAPIA → fisioterapia). */
const CATEGORIAS_EVOLUCAO = {
  E: ['evolução médica', 'medica'], SRM: ['evolução médica (UTI)', 'medica'], SUO: ['evolução médica (UTI)', 'medica'],
  USF: ['evolução médica (UTI)', 'medica'], SUN: ['evolução médica (UTI)', 'medica'], SU: ['evolução médica (admissão/especialidade)', 'medica'],
  AF: ['anamnese de admissão', 'medica'], AU: ['admissão na UTI', 'medica'], Cur: ['evolução médica', 'medica'], R: ['pedido de parecer', 'medica'],
  ENF: ['evolução de enfermagem', 'enfermagem'], Tec: ['técnico de enfermagem', 'enfermagem'], SAE: ['SAE (enfermagem)', 'enfermagem'],
  EM: ['anotação de enfermagem', 'enfermagem'], ES: ['cuidados com a pele (enfermagem)', 'enfermagem'],
  N3: ['fisioterapia', 'fisioterapia'], N4: ['fisioterapia', 'fisioterapia'], NP7: ['fisioterapia', 'fisioterapia'], NP9: ['fisioterapia', 'fisioterapia'],
  /* EV é formulário genérico ("Avaliação: HNSC - …"): fisioterapia OU solicitação de leito de
     UTI etc. — decidido pelo texto em categoriaEvolucao. */
  EV: ['formulário de avaliação', 'medica'],
  FIS: ['fluxo de isolamento (síndrome gripal)', 'enfermagem'],
  EC: ['nota da CCIH', 'ccih'], NHE: ['núcleo de epidemiologia', 'ccih'], CHL: ['checklist da CCIH', 'ccih'],
  HDU: ['plano multidisciplinar', 'outra'], RM: ['round multidisciplinar', 'outra'], TNU: ['triagem nutricional', 'outra'],
  EN: ['avaliação nutricional', 'outra'], TSF: ['nutrição', 'outra'], PCO: ['cuidados paliativos', 'outra'], FCH: ['farmácia clínica', 'outra'],
  SAC: ['aviso cirúrgico', 'outra'], C19: ['boletim à família', 'outra'], P: ['parecer (psicologia/serviço social)', 'outra'],
  CME: ['anotação de exame de imagem', 'outra'], EAG: ['agência transfusional', 'outra'],
  /* mapeadas pelo conteúdo em 18/10/2026 (1º histórico de 2 dias) */
  T: ['classificação de risco (emergência)', 'enfermagem'], CRM: ['classificação de risco (emergência)', 'enfermagem'],
  TO: ['classificação de risco (emergência)', 'enfermagem'],
  ISC: ['alerta de sepse (SBAR)', 'enfermagem'], IAC: ['alerta de sepse (SBAR)', 'enfermagem'],
  CAT: ['avaliação por NEWS alterado', 'medica'],
  PIC: ['solicitação de isolamento', 'enfermagem'], TRP: ['teste rápido', 'enfermagem'], TRC: ['teste rápido', 'enfermagem'],
  EGO: ['admissão obstétrica', 'enfermagem'], 1: ['alta hospitalar (enfermagem)', 'enfermagem'],
  BBL: ['banco de leite', 'outra']
};
function categoriaEvolucao(codigo, texto) {
  const cod = String(codigo || '').trim();
  if (cod === 'EV') {
    if (/fisioterap/i.test(String(texto || '').slice(0, 80))) return { rotulo: 'fisioterapia (avaliação funcional)', grupo: 'fisioterapia' };
    /* título do formulário: o Tasy repete o título logo depois ("Solicitação de Leito de UTI
       Solicitação de Leito…") — corta na repetição da 1ª palavra */
    const m = /avalia[cç][aã]o:\s*hnsc\s*-\s*([^\n]{3,80})/i.exec(String(texto || ''));
    let titulo = m ? m[1] : '';
    const prim = (titulo.match(/^\S+/) || [''])[0];
    const rep = prim ? titulo.indexOf(prim, prim.length) : -1;
    titulo = (rep > 0 ? titulo.slice(0, rep) : titulo.slice(0, 40)).trim().toLowerCase();
    return { rotulo: 'formulário' + (titulo ? ': ' + titulo : ''), grupo: 'medica' };
  }
  /* boletim à família escrito na evolução médica: não é dado clínico */
  if (/^\W*(forne[cç]o|passo|realizo passagem de|boletim m[eé]dico)\b.{0,40}boletim|^\W*boletim m[eé]dico/i.test(String(texto || ''))) return { rotulo: 'boletim à família', grupo: 'outra' };
  const c = CATEGORIAS_EVOLUCAO[cod];
  if (c) return { rotulo: c[0], grupo: c[1] };
  if (/^\W*fisioterapia/i.test(String(texto || '')) || /fisioterapia/i.test(String(texto || '').slice(0, 60))) return { rotulo: 'fisioterapia', grupo: 'fisioterapia' };
  if (/^\W*pelo s?cih/i.test(String(texto || ''))) return { rotulo: 'nota da CCIH', grupo: 'ccih' };
  return { rotulo: codigo ? 'evolução (' + codigo + ')' : 'evolução', grupo: 'medica' };
}
const ROTULO_CATEGORIA_EVOLUCAO = Object.fromEntries(Object.entries(CATEGORIAS_EVOLUCAO).map(([k, v]) => [k, v[0]]));

/* Dispositivos registrados de forma PADRONIZADA no texto (vale também nas enfermarias, onde
   não há o cabeçalho do CTI): "Realizada instalação/retirada do dispositivo Cateter Venoso
   Central" (enfermagem) e o checklist da CCIH "Inserção Cateter Venoso Central …". Devolve
   [{ acao: 'insercao'|'retirada', nome }]. */
function dispositivosNoTexto(texto) {
  const t = String(texto || '');
  const r = [];
  const re = /realizad[ao]\s+(?:a\s+)?(instala[cç][aã]o|inser[cç][aã]o|retirada|remo[cç][aã]o)\s+d[oa]\s+dispositivo\s+([^.;\n"]{3,60})/gi;
  let m;
  while ((m = re.exec(t))) r.push({ acao: /retirad|remo/i.test(m[1]) ? 'retirada' : 'insercao', nome: m[2].trim() });
  const ck = /ccih\s*-\s*hnsc\s*-\s*inser[cç][aã]o\s+([a-zà-ú ]{5,50}?)(?:\s+adult|\s+pedi|\s+neonat|\s+local|\s+i\.|$)/i.exec(t);
  if (ck && ck[1]) r.push({ acao: 'insercao', nome: ck[1].trim() });
  return r;
}

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
      /* Positiva = cresceu germe e não é triagem automática (negativa, colonização, água…).
         "Contaminação" é JULGAMENTO da CCIH: não entra aqui (senão o modo cego vazaria); o
         contaminante comum de pele é marcado de forma determinística mais abaixo. */
      const positiva = !!germe(c.Microrganismo) && !classesTriagem.includes(classe) && classe !== 'Não é cultura';
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
      /* D1–D2 entram SEMPRE, mesmo fora da janela de 21 dias: é nelas que está o motivo da
         internação, e sem isso a IA chama de IRAS a infecção que veio de casa (1ª rodada do
         Qwen, 16/10/2026: "pneumonia aspirativa" em D2 virou PAV em D7). */
      const daAdmissao = _ehData(d) && d >= _somaDias(admissao, -1) && d <= _somaDias(admissao, DOSSIE_DIA_IRAS - 2);
      if (!_ehData(d) || (d < inicioEvo && !daAdmissao) || d > referencia || d < _somaDias(admissao, -1)) continue;
      const texto = String(e.Texto || '').trim();
      if (!texto) continue;
      const chave = d + '|' + _nt(texto).slice(0, 200);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const sinais = sinaisFn(texto);
      const vitais = vitaisFn(texto, { neoPed });
      evolucoes.push({ data: d, dia: dia(d), admissao: daAdmissao, sindromes: (sinais.sindromes || []).filter(s => s !== 'geral'),
        trechosSinais: (sinais.sinais || []).map(s => s.rotulo + ': ' + s.trecho), setor: String(e.Setor || '').trim(), categoria: String(e.Categoria || '').trim(),
        rotuloCategoria: categoriaEvolucao(e.Categoria, texto).rotulo, grupoCategoria: categoriaEvolucao(e.Categoria, texto).grupo,
        dispositivosTexto: dispositivosNoTexto(texto),
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

  /* ---- contaminante comum de pele em hemocultura de amostra ÚNICA ----
     Critério de IPCS: contaminante comum (SCN, Corynebacterium, Bacillus, Micrococcus,
     Cutibacterium, Streptococcus viridans) só conta com DUAS hemoculturas de coletas separadas
     no mesmo dia ou em dias consecutivos. Amostra única é marcada (1ª rodada: o Qwen chamou de
     IPCS um SCN isolado que a CCIH tinha descartado). */
  for (const c of culturas) {
    if (!c.positiva || !ehHemocultura(c.material) || !ehContaminanteComum(c.microrganismo)) continue;
    const g = _germeNorm(c.microrganismo);
    const pares = culturas.filter(o => o !== c && o.positiva && ehHemocultura(o.material) && _germeNorm(o.microrganismo) === g
      && o.dia !== null && c.dia !== null && Math.abs(o.dia - c.dia) <= 1);
    c.contaminanteUnico = pares.length === 0;
    c.contaminanteComum = true;
  }

  /* ---- infecção PRESENTE NA ADMISSÃO (D1–D2) ----
     Síndromes nomeadas nas evoluções de D1–D2, culturas positivas colhidas até D2 e antibiótico
     terapêutico iniciado até D2. Cultura do MESMO sítio colhida até 14 dias depois do último dia
     da janela de admissão (D2 + 14 = D16) é marcada como provável MESMA infecção (prazo de
     infecção repetida do critério nacional/NHSN). */
  const limiteAdm = DOSSIE_DIA_IRAS - 1;              /* D2 */
  const evoAdm = evolucoes.filter(e => e.dia !== null && e.dia <= limiteAdm);
  const culAdm = culturas.filter(c => c.positiva && c.dia !== null && c.dia <= limiteAdm && sindromeDoMaterial(c.material, c.sitio));
  const cursosAdm = cursos.filter(c => !c.profilaxia && c.diaInicio !== null && c.diaInicio <= limiteAdm);
  cursosAdm.forEach(c => { c.naAdmissao = true; });
  const gruposAdm = new Set();
  evoAdm.forEach(e => e.sindromes.forEach(s => gruposAdm.add(grupoSindrome(s))));
  culAdm.forEach(c => gruposAdm.add(grupoSindrome(sindromeDoMaterial(c.material, c.sitio))));
  gruposAdm.delete('');
  for (const c of culturas) {
    if (c.dia === null) continue;
    const grupo = grupoSindrome(sindromeDoMaterial(c.material, c.sitio));
    if (c.dia <= limiteAdm) c.naAdmissao = true;
    else if (grupo && gruposAdm.has(grupo) && c.dia <= limiteAdm + 14) c.mesmaInfeccaoDaAdmissao = true;
  }
  const infeccaoAdmissao = {
    grupos: [...gruposAdm],
    evolucoesDisponiveis: evoAdm.length,
    /* um trecho por dia + rótulo (as evoluções repetem o mesmo cabeçalho de manhã/tarde/noite) */
    trechos: (() => { const vistos = new Set(); return evoAdm.flatMap(e => e.trechosSinais.filter(t => !/^(febre|leucocitose|antibiótico iniciado)/i.test(t))
      .filter(t => { const k = e.dia + '|' + t.split(':')[0]; if (vistos.has(k)) return false; vistos.add(k); return true; })
      .map(t => `${rotuloDia(e.dia)}: ${t}`)).slice(0, 8); })(),
    culturas: [...new Set(culAdm.map(c => `${c.microrganismo} em ${c.material} (${rotuloDia(c.dia)})`))],
    cursos: [...new Set(cursosAdm.map(c => `${c.antibiotico} desde ${rotuloDia(c.diaInicio)}`))]
  };

  const dossie = {
    atendimento: atd, prontuario: pront, outrosNumeros: numeros.filter(n => n !== pront), infeccaoAdmissao,
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
  const positivas = colhidas.filter(c => c.positiva && !c.contaminanteUnico && !c.mesmaInfeccaoDaAdmissao);
  if (positivas.length) add('cultura_positiva_apos_d3', 4, 'cultura positiva a partir de D3: ' + positivas.map(c => `${c.microrganismo} em ${c.material || 'material não informado'} (${rotuloDia(c.dia)})`).join('; '));
  const unicas = colhidas.filter(c => c.contaminanteUnico);
  if (unicas.length) add('contaminante_amostra_unica', 0, 'contaminante comum de pele em hemocultura de amostra ÚNICA (não satisfaz IPCS sozinho): ' + unicas.map(c => `${c.microrganismo} (${rotuloDia(c.dia)})`).join('; '));
  const adm = d.infeccaoAdmissao || { grupos: [] };
  if (adm.grupos.length) {
    const mesmas = colhidas.filter(c => c.mesmaInfeccaoDaAdmissao && c.positiva);
    add('infeccao_na_admissao', -3, `infecção já presente na admissão (D1–D2): ${adm.grupos.join(', ')}` + (mesmas.length
      ? ' — culturas posteriores do MESMO sítio até D16 são provavelmente a mesma infecção: ' + mesmas.map(c => `${c.microrganismo} em ${c.material} (${rotuloDia(c.dia)})`).join('; ') : ''));
  }
  const mdr = d.culturas.filter(c => c.mecanismo);
  if (mdr.length) add('multirresistente', 1, 'mecanismo de resistência: ' + [...new Set(mdr.map(c => c.mecanismo))].join(', '));
  const cirNaInternacao = d.cirurgias.filter(c => c.dia !== null && c.dia >= 1);
  if (cirNaInternacao.length) add('cirurgia', 2, 'cirurgia nesta internação: ' + cirNaInternacao.map(c => `${c.procedimento} (${rotuloDia(c.dia)})`).join('; '));
  const cirPrevia = d.cirurgias.filter(c => c.dia !== null && c.dia < 1);
  if (cirPrevia.length) add('cirurgia_previa_30d', 2, 'cirurgia nos 30 dias antes da admissão (vigilância de ISC): ' + cirPrevia.map(c => `${c.procedimento} (${c.data})`).join('; '));
  const dispAtivos = d.dispositivos.filter(x => !x.retirada || x.retirada >= d.referencia);
  const dispVisita = new Set(); d.visitasUti.forEach(v => v.dispositivos.forEach(x => dispVisita.add(x.replace(/\s*\(.*$/, ''))));
  const dispEvo = new Set(); d.evolucoes.forEach(e => (e.template.dispositivos || []).forEach(x => dispEvo.add(x.nome)));
  /* instalação registrada pela enfermagem/checklist que não tem retirada depois */
  const dispTexto = new Map();
  d.evolucoes.slice().sort((a, b) => a.data.localeCompare(b.data)).forEach(e => (e.dispositivosTexto || []).forEach(x => {
    const n = typeof nomeDispositivo === 'function' ? nomeDispositivo(x.nome) : x.nome;
    if (x.acao === 'insercao') dispTexto.set(n, true); else dispTexto.delete(n);
  }));
  dispTexto.forEach((_, n) => dispEvo.add(n));
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
    add(c.inicio, c.diaInicio, 'antibiotico', (c.profilaxia ? 'Profilaxia cirúrgica: ' : 'Início de ') + c.antibiotico, [c.dose, c.via, c.indicacao, c.setor, c.naAdmissao ? 'iniciado na admissão' : '', c.emCurso ? `em curso (${c.dias} d)` : ''].filter(Boolean).join(' · '));
    if (!c.emCurso) add(c.fim, c.diaFim, 'antibiotico', 'Fim de ' + c.antibiotico, `${c.dias} dia(s)` + (c.parecer ? ' · ' + c.parecer : ''));
  });
  d.culturas.forEach(c => add(c.data, c.dia, c.positiva ? 'cultura_positiva' : 'cultura', c.microrganismo ? `Cultura: ${c.microrganismo}` : 'Cultura colhida (sem crescimento/sem resultado)',
    [c.material, c.sitio, c.setor, c.mecanismo, c.classificacao ? 'CCIH: ' + c.classificacao : (c.status ? 'revisão: ' + c.status : ''), c.resultado ? 'resultado ' + dataBR(c.resultado) : '', c.resistentes.length ? 'R: ' + c.resistentes.join(', ') : '', c.sensiveis.length ? 'S: ' + c.sensiveis.join(', ') : '', notaDaCultura(c) ? '⚠ ' + notaDaCultura(c) : ''].filter(Boolean).join(' · ')));
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

/* Observação determinística de uma cultura (vai na tabela e na linha do tempo). */
function notaDaCultura(c) {
  const n = [];
  if (c.naAdmissao && c.positiva) n.push('colhida em D1–D2: infecção/colonização PRESENTE NA ADMISSÃO');
  if (c.mesmaInfeccaoDaAdmissao && c.positiva) n.push('mesmo sítio da infecção presente na admissão, até D16: provável MESMA infecção, não IRAS nova');
  if (c.contaminanteUnico) n.push('contaminante comum de pele em hemocultura de amostra ÚNICA: não satisfaz IPCS sozinho');
  else if (c.contaminanteComum && ehHemocultura(c.material)) n.push('contaminante comum de pele com 2+ hemoculturas em dias próximos');
  return n.join('; ');
}

/* Texto do dossiê (Markdown), pronto para o modelo. Sem nome, sem autor. */
/* Versão CEGA do dossiê (calibração, 16/10/2026): tira o que é JULGAMENTO da CCIH — casos de
   IRAS registrados e a classificação clínica das culturas (IRAS, contaminação, presente na
   admissão…) — para o modelo não "colar" a resposta. Fica a triagem automática (Negativa,
   Colonização: não é julgamento) e a suspeita anotada na visita (dado de entrada que a IA
   também terá na rotina). O gabarito sai de d.iras do dossiê completo. */
function cegarDossie(d) {
  const triagem = (typeof CLASSES_TRIAGEM !== 'undefined' && CLASSES_TRIAGEM) || ['Negativa', 'Colonização', 'Água', 'Leite', 'Controle ambiental/alimentar'];
  const c = { ...d, iras: [],
    /* notas da CCIH ("Pelo SCIH…", NHE, checklist) são julgamento/registro da própria CCIH */
    evolucoes: (d.evolucoes || []).filter(e => e.grupoCategoria !== 'ccih'),
    culturas: d.culturas.map(x => ({ ...x, idIras: '', classificacao: triagem.includes(x.classificacao) ? x.classificacao : '', status: triagem.includes(x.classificacao) ? x.status : '' })),
    sinais: d.sinais.filter(s => s.codigo !== 'iras_registrada') };
  c.escore = c.sinais.reduce((s, f) => s + f.peso, 0);
  c.eventos = eventosDoDossie(c);
  return c;
}

/* ---- Formato POR DIA (pedido de 16/10/2026) ----
   Uma linha por evento, tudo no eixo do dia da internação, com as evoluções intercaladas:
     D5 - Urocultura positiva: Escherichia coli …
     D6 - Inserção de cateter venoso central
     D10 - Início de meropenem
   É a entrada pensada para um classificador pequeno (sim/não, sítio, data): sem tabelas nem
   seções, só a sequência. Leva só eventos POSITIVOS (o que aconteceu) — cultura negativa fica
   de fora salvo opcoes.incluirNegativas — e nunca as decisões da CCIH (é sempre "cego").
   Devolve [{ dia, data, tipo, texto }] em ordem; linhasPorDia() vira o texto. */
const NOME_DISPOSITIVO = [
  [/\bcvc|cateter venoso central|picc|duplo.?lumen|shilley/i, 'cateter venoso central'],   /* CVCJD, CVCSCE… */
  [/\bsvd\b|sonda vesical|cateter vesical|folley|foley/i, 'sonda vesical de demora'],
  [/\bvm\b|\btot\b|ventila[cç][aã]o mec|tubo orotraqueal|intuba/i, 'ventilação mecânica (tubo orotraqueal)'],
  [/\btqt\b|traqueostom/i, 'traqueostomia'],
  [/\bpai\b|pressao arterial invasiva|pressão arterial invasiva/i, 'pressão arterial invasiva'],
  [/\bdve\b|derivacao ventricular|derivação ventricular/i, 'derivação ventricular externa'],
  [/\bnpt\b/i, 'nutrição parenteral'],
  [/hemodi[aá]lise|cateter de di[aá]lise|\bcdl\b/i, 'cateter de hemodiálise']
];
function nomeDispositivo(nome) {
  for (const [re, rot] of NOME_DISPOSITIVO) if (re.test(String(nome || ''))) return rot;
  return String(nome || '').trim().toLowerCase();
}
/* "03/10" ou "03/10/26" do cabeçalho da evolução → ISO, com o ano da admissão (ou o anterior
   se a data cairia depois da evolução). */
function _dataCurta(ddmm, referenciaISO) {
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(String(ddmm || '').trim());
  if (!m) return '';
  let ano = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : Number(String(referenciaISO).slice(0, 4));
  let iso = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (!m[3] && iso > _d10(referenciaISO)) iso = `${ano - 1}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return _ehData(iso) && isFinite(Date.parse(iso)) ? iso : '';
}
function linhaDoTempoPorDia(dossie, opcoes) {
  const op = opcoes || {};
  const d = cegarDossie(dossie);
  const L = [];
  /* Grupos de evolução que entram (padrão: médica, enfermagem e fisioterapia). */
  const grupos = new Set(op.gruposEvolucao || ['medica', 'enfermagem', 'fisioterapia']);
  const add = (data, dia, tipo, texto, ordem) => { if (_ehData(data) && texto) L.push({ dia, data: _d10(data), tipo, texto, _o: ordem }); };
  add(d.admissao, 1, 'admissao', `Admissão hospitalar${d.setores.length ? ' em ' + d.setores[0].setor : ''}${d.clinica ? ' (clínica: ' + d.clinica + ')' : ''}`, 0);
  for (const p of d.internacoesPrevias) add(p.entrada, diaDaInternacao(p.entrada, d.admissao), 'internacao_previa', `Internação anterior${p.alta ? ', alta em ' + dataBR(p.alta) : ''}`, 0);
  d.setores.slice(1).forEach(s => add(s.entrada, s.diaEntrada, 'transferencia', 'Transferência para ' + s.setor, 1));
  d.cirurgias.forEach(c => add(c.data, c.dia, 'cirurgia', 'Cirurgia: ' + [c.procedimento, c.contaminacao ? 'potencial ' + c.contaminacao.toLowerCase() : '', c.duracaoMin ? c.duracaoMin + ' min' : ''].filter(Boolean).join(', '), 2));
  /* dispositivos: cadastro + cabeçalho das evoluções (uma inserção por dispositivo e data) */
  const vistosDisp = new Set();
  const addDisp = (nome, data, fonte) => {
    const rot = nomeDispositivo(nome); const k = rot + '|' + _d10(data);
    if (!rot || !_ehData(data) || vistosDisp.has(k)) return; vistosDisp.add(k);
    add(data, diaDaInternacao(data, d.admissao), 'dispositivo', 'Inserção de ' + rot + (fonte ? ' (' + fonte + ')' : ''), 3);
  };
  d.dispositivos.forEach(x => { addDisp(x.nome, x.instalacao); if (x.retirada) add(x.retirada, x.diaRetirada, 'dispositivo', 'Retirada de ' + nomeDispositivo(x.nome), 3); });
  d.evolucoes.forEach(e => (e.template.dispositivos || []).forEach(x => addDisp(x.nome, _dataCurta(x.data, e.data), 'citado na evolução')));
  /* registro padronizado da enfermagem e checklist de inserção da CCIH (o checklist sai do
     dossiê cego como texto, mas o FATO da inserção é dado, não julgamento) */
  (dossie.evolucoes || []).forEach(e => (e.dispositivosTexto || []).forEach(x => {
    if (x.acao === 'insercao') addDisp(x.nome, e.data, e.grupoCategoria === 'ccih' ? 'checklist de inserção' : 'registro da enfermagem');
    else { const rot = nomeDispositivo(x.nome); const k = 'ret|' + rot + '|' + e.data; if (!vistosDisp.has(k)) { vistosDisp.add(k); add(e.data, e.dia, 'dispositivo', 'Retirada de ' + rot, 3); } }
  }));
  /* Visita da CCIH à UTI: o que estava EM USO naquele dia (sem data de inserção). */
  d.visitasUti.forEach(v => { if (v.dispositivos.length) add(v.data, v.dia, 'dispositivo', 'Em uso na visita à UTI: ' + v.dispositivos.map(x => nomeDispositivo(x.replace(/\s*\(.*$/, ''))).join(', '), 3); });
  d.culturas.forEach(c => {
    if (!c.positiva && !op.incluirNegativas) return;
    const mat = c.material || 'Cultura';
    const partes = [c.microrganismo, c.mecanismo, c.resistentes.length ? 'resistente a ' + c.resistentes.join(', ') : ''].filter(Boolean).join('; ');
    const nota = notaDaCultura(c);
    add(c.data, c.dia, c.positiva ? 'cultura_positiva' : 'cultura', c.positiva ? `${mat} positiva: ${partes}${nota ? ' [' + nota + ']' : ''}` : `${mat} sem crescimento`, 4);
  });
  d.cursos.forEach(c => {
    const nome = String(c.antibiotico).toLowerCase();
    add(c.inicio, c.diaInicio, 'antibiotico', c.profilaxia ? 'Profilaxia cirúrgica com ' + nome : 'Início de ' + nome, 5);
    if (!c.emCurso && !c.profilaxia) add(c.fim, c.diaFim, 'antibiotico', `Fim de ${nome} (${c.dias} dias)`, 5);
  });
  d.sepse.forEach(s => add(s.data, s.dia, 'sepse', 'Protocolo de sepse aberto' + (s.foco ? ', foco ' + s.foco : ''), 6));
  d.vitais.forEach(v => add(v.data, v.dia, 'vitais', 'Sinais vitais alterados: ' + v.alterados.join(', '), 7));
  d.evolucoes.filter(e => grupos.has(e.grupoCategoria || 'medica')).forEach(e => add(e.data, e.dia, 'evolucao', `${e.rotuloCategoria.charAt(0).toUpperCase() + e.rotuloCategoria.slice(1)}${e.setor ? ' (' + e.setor + ')' : ''}: ${String(e.texto).replace(/\s+/g, ' ').trim()}`, 9));
  if (d.alta) add(d.alta, diaDaInternacao(d.alta, d.admissao), d.obito ? 'obito' : 'alta', d.obito ? 'Óbito' : 'Alta hospitalar', 10);
  L.sort((a, b) => a.data.localeCompare(b.data) || a._o - b._o);
  return L.map(({ _o, ...x }) => x);
}
/* ---- Fatias para classificador de 512 tokens (pedido de 16/10/2026) ----
   Uma fatia por dia de internação com evolução ou evento. Cada fatia =
     1) ESTADO no dia (determinístico, curto): dispositivos em uso e há quantos dias,
        antibióticos em curso (desde Dn), culturas positivas dos últimos 7 dias, infecção
        presente na admissão;
     2) EVENTOS do dia (linhas "Dn - …" do formato por dia);
     3) EVOLUÇÕES do dia, resumidas: médica > fisioterapia > enfermagem; texto repetido entre
        turnos sai; dentro de cada evolução ficam primeiro os trechos com termo clínico de
        infecção.
   Orçamento em CARACTERES (padrão 1.800 ≈ 512 tokens de BERT em português; ajuste com o
   tokenizador do modelo). Rótulo (para treino), a partir dos casos da CCIH: iras = início de
   IRAS não descartada a ±2 dias da fatia; descartada = idem com caso descartado (negativo
   difícil). agregarFatias junta a resposta do classificador por internação. */
const FATIA_MAX_CARACTERES = 1800;
const FATIA_JANELA_ROTULO_DIAS = 2;
const RE_TRECHO_CLINICO = /febr|febril|tax|temperatura|3[89][,.]\d|secre[cç]|purulent|amarelad|esverdead|espess|infiltrad|consolida|opacidade|dessatur|sat ?o2|spo2|fio2|peep|piora|hipotens|choque|dva|noradren|sepse|septic|pcr\b|procalcit|leucocit|leuc[oó]cit|bastonet|lactato|hemocult|urocult|cultura|antibi|\batb\b|meropen|vancomic|piperacil|cefepim|ceftriax|polimix|ferida|deisc|hiperemi|flog|calor|edema|dor|disuria|pi[uú]ria|urina turva|diurese|diarr|abdome|peritoni|cateter|cvc|svd|sonda|tot\b|ventila|pneumon|\bitu\b|\bpav\b|ipcs|infec/i;
function _semelhantes(a, b) {
  const pa = new Set(_txt(a).split(/\W+/).filter(p => p.length > 3));
  const pb = new Set(_txt(b).split(/\W+/).filter(p => p.length > 3));
  if (!pa.size || !pb.size) return false;
  let comum = 0; pa.forEach(p => { if (pb.has(p)) comum++; });
  return comum / Math.min(pa.size, pb.size) >= 0.8;
}
function _resumirTexto(texto, limite) {
  const t = String(texto || '').replace(/\s+/g, ' ').replace(/^"\s*/, '').trim();
  if (t.length <= limite) return t;
  /* pedaços sem conteúdo (cabeçalho "# … #", "-x-x-x-", campo vazio "Atual:") saem */
  const partes = t.split(/(?<=[.;#!?])\s+|\s+(?=#)/).map(p => p.replace(/^#+\s*|\s*#+$/g, '').trim())
    .filter(p => (p.match(/[a-zà-ú]/gi) || []).length >= 4 && !/^[^:]{1,40}:\s*(-x-|x-x|-+|atual:)?\s*$/i.test(p) && !/-x-x-/.test(p))
    .map((p, i) => ({ p, i, clinico: RE_TRECHO_CLINICO.test(p) }));
  const escolhidos = new Set();
  let usado = 0;
  for (const grupo of [partes.filter(x => x.clinico), partes.filter(x => !x.clinico)]) {
    for (const x of grupo) { if (usado + x.p.length + 1 > limite) continue; escolhidos.add(x.i); usado += x.p.length + 1; }
  }
  const r = partes.filter(x => escolhidos.has(x.i)).map(x => x.p).join(' … ');
  return r || t.slice(0, limite);
}
function estadoNoDia(d, dia) {
  const data = _somaDias(d.admissao, dia - 1);
  const partes = [];
  const linhas = linhaDoTempoPorDia(d).filter(l => l.dia <= dia);
  /* dispositivos: última inserção sem retirada posterior, até o dia */
  const disp = new Map();
  for (const l of linhas) {
    const ins = /^Inserção de (.+?)(?: \(|$)/.exec(l.texto), ret = /^Retirada de (.+)$/.exec(l.texto);
    if (ins) disp.set(ins[1], l.dia); else if (ret) disp.delete(ret[1]);
  }
  if (disp.size) partes.push('Dispositivos: ' + [...disp].map(([n, di]) => `${n} desde ${rotuloDia(di)} (${dia - di + 1} d)`).join('; '));
  const atb = d.cursos.filter(c => !c.profilaxia && c.inicio <= data && c.fim >= data).map(c => `${String(c.antibiotico).toLowerCase()} desde ${rotuloDia(c.diaInicio)}`);
  if (atb.length) partes.push('Antibióticos em curso: ' + atb.join('; '));
  const cul = d.culturas.filter(c => c.positiva && c.dia !== null && c.dia <= dia && c.dia >= dia - 6).map(c => `${c.material} ${c.microrganismo} (${rotuloDia(c.dia)})${c.contaminanteUnico ? ' [contaminante, amostra única]' : ''}${c.mesmaInfeccaoDaAdmissao ? ' [mesma infecção da admissão]' : ''}`);
  if (cul.length) partes.push('Culturas positivas nos últimos 7 dias: ' + cul.join('; '));
  const adm = (d.infeccaoAdmissao || {}).grupos || [];
  partes.push(adm.length ? 'Infecção presente na admissão: ' + adm.join(', ') : 'Sem infecção documentada na admissão');
  return partes.join('. ') + '.';
}
function fatiasParaClassificador(dossie, opcoes) {
  const op = opcoes || {};
  const max = op.maxCaracteres || FATIA_MAX_CARACTERES;
  const d = cegarDossie(dossie);
  const todas = linhaDoTempoPorDia(dossie, op);
  const dias = [...new Set(todas.filter(l => l.dia >= 1).map(l => l.dia))].sort((a, b) => a - b);
  const prioridade = { medica: 0, fisioterapia: 1, enfermagem: 2 };
  const fatias = [];
  for (const dia of dias) {
    const cab = `${rotuloDia(dia)} de internação${d.setores.length ? ' · ' + ((d.setores.filter(s => s.diaEntrada <= dia).pop() || d.setores[0]).setor) : ''}`;
    const estado = estadoNoDia(d, dia);
    const eventos = todas.filter(l => l.dia === dia && l.tipo !== 'evolucao' && l.tipo !== 'admissao').map(l => '- ' + l.texto);
    let base = [cab, estado, eventos.length ? 'Eventos do dia:\n' + eventos.join('\n') : ''].filter(Boolean).join('\n');
    if (base.length > max * 0.6) base = base.slice(0, Math.floor(max * 0.6)) + ' […]';
    /* evoluções do dia: prioridade por grupo, sem repetição entre turnos */
    const grupos = new Set(op.gruposEvolucao || ['medica', 'enfermagem', 'fisioterapia']);
    const evos = d.evolucoes.filter(e => e.dia === dia && grupos.has(e.grupoCategoria || 'medica'))
      .sort((a, b) => (prioridade[a.grupoCategoria] || 0) - (prioridade[b.grupoCategoria] || 0) || (b.sinaisLista.length - a.sinaisLista.length));
    const unicas = [];
    for (const e of evos) if (!unicas.some(u => _semelhantes(u.texto, e.texto))) unicas.push(e);
    let resto = max - base.length - 20;
    const blocos = [];
    for (const e of unicas) {
      if (resto < 120) break;
      const limite = Math.max(120, Math.floor(resto / Math.max(1, Math.min(3, unicas.length - blocos.length))));
      const r = _resumirTexto(e.texto, limite - e.rotuloCategoria.length - 4);
      blocos.push(`[${e.rotuloCategoria}] ${r}`);
      resto -= r.length + e.rotuloCategoria.length + 5;
    }
    let texto = base + (blocos.length ? '\nEvoluções:\n' + blocos.join('\n') : '');
    if (texto.length > max) texto = texto.slice(0, max - 2) + ' …';   /* teto rígido */
    /* rótulo da CCIH (só quando há casos no dossiê completo) */
    const perto = (dossie.iras || []).filter(c => c.dia !== null && Math.abs(c.dia - dia) <= FATIA_JANELA_ROTULO_DIAS);
    const valido = perto.find(c => !/descart/i.test(c.status));
    fatias.push({ atendimento: d.atendimento, dia, data: _somaDias(d.admissao, dia - 1), texto, caracteres: texto.length,
      evolucoes: unicas.length, evolucoesDescartadasPorRepeticao: evos.length - unicas.length,
      rotulo: valido ? { iras: true, sitio: valido.topografia, diaInicio: valido.dia } : { iras: false, descartada: perto.some(c => /descart/i.test(c.status)) } });
  }
  return fatias;
}
/* Resposta do classificador por fatia [{ dia, infeccao, probabilidade?, sitio }] → uma
   avaliação por internação: infecção se alguma fatia der sim; dia = 1ª fatia positiva; sítio
   = o mais frequente entre as positivas (empate: o da 1ª). Sai no formato que
   suspeitaJaNotificada usa ({ sitio, dia: 'Dn' }). */
function agregarFatias(respostas) {
  const pos = (respostas || []).filter(r => r.infeccao === true || r.infeccao === 'sim' || Number(r.probabilidade) >= 0.5)
    .sort((a, b) => a.dia - b.dia);
  if (!pos.length) return { infeccao: false, sitio: 'nenhum', dia: '', probabilidade: Math.max(0, ...(respostas || []).map(r => Number(r.probabilidade) || 0)) };
  const cont = new Map();
  pos.forEach(r => cont.set(r.sitio, (cont.get(r.sitio) || 0) + 1));
  const sitio = [...cont.entries()].sort((a, b) => b[1] - a[1] || pos.findIndex(r => r.sitio === a[0]) - pos.findIndex(r => r.sitio === b[0]))[0][0];
  return { infeccao: true, sitio, dia: rotuloDia(pos[0].dia), diasPositivos: pos.map(r => r.dia), probabilidade: Math.max(...pos.map(r => Number(r.probabilidade) || 1)) };
}

function linhasPorDia(dossie, opcoes) {
  const d = dossie;
  const cab = `Atendimento ${d.atendimento} · ${d.paciente.idade !== '' ? d.paciente.idade + ' anos' : 'idade não informada'}${d.paciente.sexo ? ' · ' + d.paciente.sexo : ''} · admissão ${dataBR(d.admissao)} (D1) · referência ${rotuloDia(d.diaReferencia)}${d.alta ? (d.obito ? ' · óbito' : ' · alta') + ' em ' + rotuloDia(diaDaInternacao(d.alta, d.admissao)) : ''}`;
  return [cab, ''].concat(linhaDoTempoPorDia(d, opcoes).map(l => `${rotuloDia(l.dia)} - ${l.texto}`)).join('\n') + '\n';
}

function renderizarDossie(dossie, opcoes) {
  const op = opcoes || {};
  const d = op.cego ? cegarDossie(dossie) : dossie;
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

  const adm = d.infeccaoAdmissao || { grupos: [], trechos: [], culturas: [], cursos: [], evolucoesDisponiveis: 0 };
  L.push('## Infecção presente na admissão (D1–D2)');
  L.push('');
  if (adm.grupos.length || adm.culturas.length || adm.cursos.length) {
    if (adm.grupos.length) L.push(`- Síndrome(s) infecciosa(s) já na admissão: **${adm.grupos.join(', ')}**. Infecção do MESMO sítio até D16 é provavelmente a MESMA infecção (não é IRAS nova).`);
    adm.trechos.forEach(t => L.push(`- ${t}`));
    if (adm.culturas.length) L.push(`- Culturas positivas colhidas até D2: ${adm.culturas.join('; ')}`);
    if (adm.cursos.length) L.push(`- Antibiótico terapêutico iniciado até D2 (tratamento de infecção da admissão): ${adm.cursos.join('; ')}`);
  } else {
    L.push('- Nenhuma infecção documentada em D1–D2 nas evoluções, culturas e antibióticos disponíveis.');
  }
  /* Sem evolução de D1–D2 (comum enquanto o histórico acumula), quem decide é o que foi FEITO
     na admissão: antibiótico terapêutico ou cultura positiva em D1–D2 sugerem infecção que veio
     de fora; sem nada disso, infecção na admissão é improvável. (2ª rodada, 16/10/2026: o aviso
     genérico rebaixava para MÉDIA as IRAS verdadeiras.) */
  if (!adm.evolucoesDisponiveis) {
    L.push(adm.cursos.length || adm.culturas.length
      ? '- Não há evolução de D1–D2 neste dossiê (motivo da internação desconhecido), MAS houve antibiótico terapêutico e/ou cultura positiva em D1–D2: é possível que já houvesse infecção na admissão.'
      : '- Não há evolução de D1–D2 neste dossiê, mas também NÃO houve antibiótico terapêutico nem cultura positiva em D1–D2: infecção presente na admissão é improvável.');
  }
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
    d.cursos.forEach(c => L.push(`| ${c.antibiotico} | ${rotuloDia(c.diaInicio)} (${dataBR(c.inicio)}) | ${c.emCurso ? 'em curso' : rotuloDia(c.diaFim) + ' (' + dataBR(c.fim) + ')'} | ${c.dias} | ${[c.dose, c.via].filter(Boolean).join(' ')} | ${c.indicacao} | ${[c.profilaxia ? 'provável profilaxia cirúrgica' : '', c.naAdmissao ? 'iniciado na admissão (D1–D2)' : '', c.parecer].filter(Boolean).join('; ')} |`));
  } else L.push('Nenhum antibiótico no período.');
  L.push('');

  L.push('## Culturas');
  L.push('');
  if (d.culturas.length) {
    L.push('| Coleta | Material | Microrganismo | Mecanismo | Antibiograma | Classificação | Observação automática |');
    L.push('|---|---|---|---|---|---|---|');
    d.culturas.forEach(c => L.push(`| ${rotuloDia(c.dia)} (${dataBR(c.data)}) | ${[c.material, c.sitio].filter(Boolean).join(' / ')} | ${c.microrganismo || 'sem crescimento / sem resultado'} | ${c.mecanismo} | ${c.resistentes.length || c.sensiveis.length ? ['R: ' + c.resistentes.join(', '), 'S: ' + c.sensiveis.join(', ')].filter(x => !/: $/.test(x)).join('; ') : c.antibiogramaTexto} | ${c.classificacao || (c.status ? 'revisão ' + c.status : '')} | ${notaDaCultura(c)} |`));
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

  L.push(`## Evoluções (${d.evolucoes.length}: as de D1–D2 e as dos últimos ${d.janelaEvolucoesDias} dias, ordem cronológica)`);
  L.push('');
  if (!d.evolucoes.length) L.push('Nenhuma evolução disponível na janela.');
  for (const e of d.evolucoes) {
    L.push(`### ${rotuloDia(e.dia)} · ${dataBR(e.data)} · ${e.setor || 'setor não informado'} · ${e.rotuloCategoria}${e.admissao ? ' · ADMISSÃO' : ''}`);
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
  const comEvolucao = new Set();
  for (const e of (((b.evolucoes_historico || {}).evolucoes) || []).concat(((b.evolucoes || {}).evolucoes) || [], op.evolucoesExtras || [])) if (String(e.Texto || '').trim()) comEvolucao.add(_np(e.Atendimento));
  /* incluirAltas (treino): toda internação que tem evolução guardada, internada ou não. */
  const base = op.atendimentos && op.atendimentos.length
    ? op.atendimentos.map(a => internacaoDoAtendimento(((b.pacientes || {}).internacoes) || [], a)).filter(Boolean)
    : op.incluirAltas ? [...comEvolucao].map(a => internacaoDoAtendimento(((b.pacientes || {}).internacoes) || [], a)).filter(Boolean)
    : internadosFn(b);
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
    if (!op.atendimentos && !op.incluirAltas && _ehData(i.DataAlta)) continue;
    const diaHoje = diaDaInternacao(hoje, i.DataInternacao);
    if (diaHoje === null || diaHoje < Math.ceil(DOSSIE_MINIMO_HORAS / 24) + 1) continue;   /* D3+ = passou de 48 h */
    if (exigirEvolucao && !comEvolucao.has(atd)) continue;
    const d = montarDossieInternacao(b, atd, { hoje, evolucoesExtras: op.evolucoesExtras, janelaEvolucoesDias: op.janelaEvolucoesDias });
    if (!d) continue;
    if (!op.atendimentos && ((d.alta && !op.incluirAltas) || d.diaReferencia === null || d.diaReferencia < Math.ceil(DOSSIE_MINIMO_HORAS / 24) + 1)) continue;
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

/* Confere os trechos que o modelo citou em EVIDÊNCIAS contra o texto do dossiê (1ª rodada do
   Qwen, 16/10/2026: ~1 em 5 "trechos literais" era paráfrase ou inventado). Para cada item:
   'literal' (o texto aparece igual, ignorando caixa/acento/pontuação), 'parcial' (≥ 80% das
   palavras aparecem no dossiê) ou 'ausente'. Devolve { itens, literais, parciais, ausentes }. */
function conferirTrechos(resposta, textoDossie) {
  const norm = v => _txt(v).replace(/[^a-z0-9%/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const base = ' ' + norm(textoDossie) + ' ';
  const palavrasBase = new Set(base.split(' ').filter(Boolean));
  const t = String(resposta || '').replace(/\*\*/g, '');
  const m = /EVID[ÊE]NCIAS\s*:([\s\S]*?)(?:\n\s*(?:CONTRA|CONFIAN[ÇC]A|CRIT[ÉE]RIOS ATENDIDOS)\s*:|$)/i.exec(t);
  const itens = [];
  if (m) {
    for (const linha of m[1].split('\n')) {
      const l = linha.replace(/^\s*[-*•\d.)]+\s*/, '').trim();
      if (!l) continue;
      const aspas = [...l.matchAll(/["“”«]([^"“”»]{3,})["“”»]/g)].map(x => x[1]);
      const dia = (/\(?\b(D-?\d+)\b\)?/.exec(l) || [])[1] || '';
      const trechos = aspas.length ? aspas : [l.replace(/\(?\bD-?\d+\b\)?/g, '').trim()];
      for (const tr of trechos) {
        const n = norm(tr);
        if (!n) continue;
        let situacao;
        if (base.includes(' ' + n + ' ') || base.includes(n)) situacao = 'literal';
        else {
          const ps = n.split(' ').filter(p => p.length >= 3);
          const achadas = ps.filter(p => palavrasBase.has(p)).length;
          situacao = ps.length && achadas / ps.length >= 0.8 ? 'parcial' : 'ausente';
        }
        itens.push({ trecho: tr, dia, situacao });
      }
    }
  }
  const conta = s => itens.filter(i => i.situacao === s).length;
  return { itens, literais: conta('literal'), parciais: conta('parcial'), ausentes: conta('ausente') };
}

/* ---- Suspeita da IA × IRAS já notificada (pedido de 16/10/2026) ----
   Se a CCIH já notificou a MESMA IRAS na janela de tempo, a suspeita da IA é desconsiderada:
   mesmo grupo de sítio e início a até 14 dias do caso registrado (a mesma janela de
   mesmoCasoIras / IRAS_JANELA_DUPLICATA_DIAS da aba Infecções). Caso que a CCIH DESCARTOU não
   suprime — a IA pode estar vendo um episódio novo —, mas a suspeita vai com o aviso.
   O sítio da IA é texto livre ("pneumonia/PAV", "IPCS", "pele e partes moles"); os dois
   lados passam pelo mesmo agrupamento. */
const DOSSIE_JANELA_MESMA_IRAS_DIAS = 14;
function gruposDoSitio(texto) {
  const t = _txt(texto);
  const g = new Set();
  if (/pneumon|\bpav\b|traqueobronq|respirat/.test(t)) g.add('pneumonia');
  if (/ipcs|corrente sangu|bacteremia|\bsepse\b|septic/.test(t)) g.add('ipcs');
  if (/\bitu\b|urin/.test(t)) g.add('itu');
  if (/\bisc\b|sitio cirurg|ferida operat|incisional|orgao.?cavidade/.test(t)) g.add('isc');
  if (/pele|partes moles|celulite/.test(t)) g.add('pele');
  if (/abdom|peritoni/.test(t)) g.add('abdominal');
  if (/gastro|clostr|diarr/.test(t)) g.add('gastrointestinal');
  if (/\bsnc\b|meningit|ventriculit|nervoso central/.test(t)) g.add('snc');
  return g;
}
const _STATUS_NOTIFICADA = /confirmad|digitad|investiga/;
/* campos = { sitio, dia } da resposta da IA; casos = [{ id, topografia, dia, status }] da
   internação. Devolve { situacao: 'nova' | 'ja_notificada' | 'descartada_antes', caso }. */
function suspeitaJaNotificada(campos, casos, janelaDias) {
  const janela = janelaDias === undefined ? DOSSIE_JANELA_MESMA_IRAS_DIAS : janelaDias;
  const gIA = gruposDoSitio((campos || {}).sitio);
  if (!gIA.size) return { situacao: 'nova', caso: null };
  const diaIA = Number((/D(-?\d+)/.exec(String((campos || {}).dia || '')) || [])[1]);
  const casam = (casos || []).filter(c => {
    const gC = gruposDoSitio(c.topografia);
    if (![...gIA].some(g => gC.has(g))) return false;
    if (!isFinite(diaIA) || c.dia === null || c.dia === undefined || c.dia === '') return true;
    return Math.abs(Number(c.dia) - diaIA) <= janela;
  });
  const notificado = casam.find(c => _STATUS_NOTIFICADA.test(_txt(c.status)));
  if (notificado) return { situacao: 'ja_notificada', caso: notificado };
  const descartado = casam.find(c => /descart/.test(_txt(c.status)));
  if (descartado) return { situacao: 'descartada_antes', caso: descartado };
  return { situacao: 'nova', caso: null };
}

/* ---- Pré-anotação de FRAGMENTO SUSPEITO (pedido de 16/10/2026) ----
   O alvo do classificador de 512 tokens, na 1ª fase, é SUSPEITA (não IRAS confirmada): cerca de
   40% dos pacientes e 15–20% dos fragmentos. O modelo grande (Qwen) pré-anota, a CCIH corrige na
   página de anotação, e a correção humana é o rótulo. A DEFINIÇÃO é a da CCIH — semente a ajustar.
   Saída curta para rodar sem raciocínio (segundos por fragmento). */
const VERSAO_PROMPT_SUSPEITA = 2;
const PROMPT_SUSPEITA_FRAGMENTO = `Você recebe UM DIA de uma internação hospitalar: o estado do paciente naquele dia, os eventos do dia e trechos das evoluções. Responda se ESTE DIA traz SUSPEITA de infecção NOVA.

É SUSPEITO quando aparece NESTE DIA pelo menos um sinal novo de infecção que não é explicado pela infecção já presente na admissão:
- febre (temperatura ≥ 37,8 °C, "febril", "pico febril") ou hipotermia;
- secreção purulenta nova ou piora da secreção (traqueal, ferida, cateter);
- piora respiratória (dessaturação, aumento de O2, FiO2 ou PEEP);
- instabilidade hemodinâmica nova (hipotensão, início ou aumento de noradrenalina/DVA);
- antibiótico NOVO ou ESCALONADO neste dia (não profilaxia);
- cultura colhida por suspeita ou cultura positiva de sítio estéril neste dia;
- protocolo de sepse aberto;
- o médico nomeia uma infecção nova (pneumonia, ITU, infecção de ferida, infecção de cateter, sepse).

Leia a lista "Eventos do dia": "Início de <antibiótico>" (que não seja profilaxia) já é sinal de suspeita.

NÃO é suspeito: cirurgia, internação ou transferência SOZINHAS (sem sinal de infecção); dia estável sem sinal novo; continuidade do tratamento de infecção da admissão; cultura de vigilância (colonização); contaminante de pele em hemocultura única; profilaxia cirúrgica; "afebril", "sem sinais flogísticos" e outras negações.

Responda SOMENTE neste formato, em português, sem mais nada:
SUSPEITO: sim ou não
SÍTIO: pneumonia, IPCS, ITU, ISC, pele e partes moles, abdominal, outro, nenhum
MOTIVO: uma frase curta com o sinal que justificou (ou "nenhum sinal novo")`;

/* Sinais determinísticos de suspeita no fragmento (2ª fonte da pré-anotação, ao lado do
   modelo): a partir de D3, antibiótico novo não profilático, cultura positiva que não é
   contaminante único nem continuação da infecção da admissão, protocolo de sepse. Lê as linhas
   "- …" de "Eventos do dia". NÃO entra no texto do fragmento (senão o classificador só aprenderia
   a regra) — é só sugestão para quem anota. */
function sinaisDeterministicosDoFragmento(texto, dia) {
  if (!(Number(dia) >= DOSSIE_DIA_IRAS)) return [];
  const bloco = (/Eventos do dia:\n([\s\S]*?)(?:\nEvoluções:|$)/.exec(String(texto || '')) || [])[1] || '';
  const s = [];
  for (const l of bloco.split('\n').map(x => x.replace(/^-\s*/, '').trim()).filter(Boolean)) {
    if (/^Início de /.test(l)) s.push('antibiótico novo: ' + l.slice(10));
    else if (/ positiva: /.test(l) && !/amostra ÚNICA|MESMA infecção|PRESENTE NA ADMISSÃO/.test(l)) s.push('cultura positiva: ' + l.split(':')[0].replace(/ positiva$/, '') + ' ' + l.split(': ')[1].split(';')[0]);
    else if (/^Protocolo de sepse/.test(l)) s.push('protocolo de sepse');
  }
  return s;
}

/* Lê a resposta curta do pré-anotador. */
function lerRespostaSuspeita(texto) {
  const t = String(texto || '').replace(/\*\*/g, '');
  const campo = rot => { const m = new RegExp('^\\s*' + rot + '\\s*:\\s*(.+)$', 'im').exec(t); return m ? m[1].trim() : ''; };
  const s = _txt(campo('SUSPEITO'));
  return { suspeito: /^sim/.test(s) ? true : /^n[aã]o/.test(s) ? false : null, sitio: campo('S[ÍI]TIO'), motivo: campo('MOTIVO') };
}

/* Treino × teste POR PACIENTE (fragmentos do mesmo atendimento nunca se dividem): hash estável
   do atendimento; ~20% teste. */
function particaoDoAtendimento(atendimento, fracaoTeste) {
  let h = 2166136261;
  for (const ch of String(atendimento)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return (h % 1000) / 1000 < (fracaoTeste === undefined ? 0.2 : fracaoTeste) ? 'teste' : 'treino';
}

/* Instrução para o modelo: a pergunta, a convenção temporal e os critérios principais por
   sítio. Semente para a CCIH VALIDAR contra os critérios nacionais vigentes (ANVISA, Critérios
   Diagnósticos de IRAS) — não é documento oficial. A saída pedida é estruturada para a
   conferência por amostragem ser rápida. Versão 2 (16/10/2026), depois da 1ª rodada do Qwen:
   regra explícita da infecção presente na admissão, do contaminante em amostra única, faixas
   definidas (o modelo nunca usava MÉDIA) e trechos obrigatoriamente copiados. */
const VERSAO_PROMPT_DOSSIE = 3;
const PROMPT_AVALIACAO_DOSSIE = `# Tarefa: avaliar probabilidade de infecção relacionada à assistência à saúde (IRAS)

Você recebe o dossiê de UMA internação hospitalar: infecção presente na admissão, trajetória por setor, cirurgias, dispositivos invasivos, cursos de antibiótico, culturas, protocolos e o texto das evoluções clínicas (ordem cronológica). Leia tudo e responda SOMENTE no formato de saída abaixo, em português. Você não decide nada sozinho: a Comissão de Controle de Infecção Hospitalar (CCIH) confere a sua resposta.

## Convenção temporal (use exatamente esta)
- D1 = dia da admissão hospitalar. D2 = dia seguinte, e assim por diante. Dias negativos = antes da admissão.
- Uma infecção é HOSPITALAR (IRAS) quando o primeiro sinal/sintoma ou a primeira cultura compatível ocorre em D3 ou depois, E não havia a mesma infecção presente ou incubando na admissão (D1–D2).
- Associada a dispositivo: o dispositivo (ventilação mecânica, cateter venoso central, sonda vesical de demora) estava em uso por mais de 2 dias consecutivos e estava presente no dia da infecção ou no dia anterior.
- Infecção de sítio cirúrgico (ISC): até 30 dias após a cirurgia (90 dias se houver implante). ISC de cirurgia ANTERIOR à internação é IRAS mesmo aparecendo em D1.

## Regras que você DEVE aplicar antes de concluir
1. INFECÇÃO PRESENTE NA ADMISSÃO: leia a seção "Infecção presente na admissão (D1–D2)" e as evoluções marcadas ADMISSÃO. Se a síndrome já estava lá (ex.: "pneumonia aspirativa" em D2), uma cultura ou piora do MESMO sítio até D16 é a MESMA infecção — NÃO é IRAS. Só é IRAS se surgir um sítio DIFERENTE, ou o mesmo sítio depois de D16, ou houver melhora clara seguida de quadro novo.
2. Antibiótico iniciado em D1–D2 trata infecção da admissão. Troca ou escalonamento desse antibiótico depois de D3, sozinho, não prova IRAS.
3. CONTAMINANTE: estafilococo coagulase-negativo, Corynebacterium, Bacillus, Micrococcus, Cutibacterium ou Streptococcus viridans em UMA hemocultura isolada NÃO é IPCS (precisa de duas hemoculturas de coletas separadas + febre, calafrio ou hipotensão). A coluna "Observação automática" das culturas já marca isso.
4. Cultura de vigilância (swab retal/nasal) positiva é COLONIZAÇÃO, não infecção.
5. Se o dossiê não traz evolução de D1–D2, siga a seção "Infecção presente na admissão": sem antibiótico terapêutico nem cultura positiva em D1–D2, considere que NÃO havia infecção na admissão e avalie o quadro a partir de D3 normalmente. Com antibiótico ou cultura em D1–D2 e quadro do MESMO sítio até D16, use no máximo MÉDIA.

## Critérios principais por sítio (resumo; a CCIH valida a versão completa)
- Pneumonia (PAV se em ventilação mecânica > 2 dias): imagem com infiltrado/consolidação novo ou progressivo E pelo menos dois de: febre (> 38 °C) ou hipotermia, leucocitose ou leucopenia, secreção traqueal/escarro purulento novo ou aumentado, piora da troca gasosa (queda de saturação, aumento de O2 ou de parâmetros ventilatórios), tosse/dispneia/taquipneia novas, ausculta com roncos/estertores novos.
- Infecção primária de corrente sanguínea (IPCS; associada a CVC se CVC > 2 dias): hemocultura com patógeno reconhecido não relacionado a infecção em outro sítio; OU duas hemoculturas (coletas separadas) com o mesmo contaminante comum de pele MAIS febre, calafrios ou hipotensão.
- Infecção do trato urinário (ITU; associada a SVD se SVD > 2 dias): pelo menos um sintoma (febre, urgência, polaciúria, disúria, dor suprapúbica ou lombar) E urocultura com até duas espécies e pelo menos 10^5 UFC/mL. Bacteriúria sem sintomas não é infecção.
- Infecção de sítio cirúrgico: drenagem purulenta da incisão ou de órgão/cavidade; OU cultura positiva de secreção/tecido do sítio obtida assepticamente; OU deiscência/abertura deliberada da ferida com dor, edema, calor ou hiperemia; OU abscesso/evidência de infecção em reoperação, imagem ou exame histopatológico.
- Pele e partes moles, intra-abdominal, gastroenterite (incluindo Clostridioides difficile), sistema nervoso central e outras: sinais locais + cultura ou imagem compatível, iniciados em D3 ou depois, sem estarem presentes na admissão.

## Como escolher a FAIXA
- ALTA: critério completo de um sítio, com início em D3 ou depois, documentado no dossiê, e NÃO explicado pela infecção da admissão, por colonização ou por contaminante. Use ALTA só quando você consegue citar os trechos que fecham o critério.
- MÉDIA: há sinais de infecção NOVA a partir de D3 (antibiótico novo ou escalonado com sinal clínico, infecção nomeada pelo médico, cultura positiva de sítio estéril), mas falta parte do critério, OU não dá para separar da infecção da admissão.
- BAIXA: só sinais fracos ou isolados (febre isolada, PCR/leucocitose sem foco, antibiótico sem foco descrito), OU o quadro é bem explicado pela infecção da admissão, colonização ou contaminante.
- SEM EVIDÊNCIA: nenhum sinal de infecção a partir de D3.
- CONFIANÇA: 80–100 só quando o dossiê é claro; 50–79 quando há dúvida; abaixo de 50 quando faltam dados.

## Formato de saída (obrigatório, sem texto antes ou depois)
FAIXA: uma de [ALTA probabilidade de IRAS | MÉDIA probabilidade de IRAS | BAIXA probabilidade de IRAS | SEM EVIDÊNCIA de infecção]
SÍTIO PROVÁVEL: (pneumonia/PAV, IPCS, ITU, ISC, pele e partes moles, intra-abdominal, gastrointestinal, SNC, outro, nenhum)
DISPOSITIVO ASSOCIADO: (VM, CVC, SVD, nenhum, não dá para saber)
DIA PROVÁVEL DE INÍCIO: Dn (ou "não dá para saber")
INFECÇÃO NA ADMISSÃO: qual síndrome já estava presente em D1–D2 (ou "nenhuma documentada") e se o quadro atual é a mesma infecção
CRITÉRIOS ATENDIDOS: lista curta
EVIDÊNCIAS: até 5 itens, cada um com um trecho COPIADO EXATAMENTE do dossiê entre aspas, seguido do dia, ex.: - "secreção traqueal purulenta" (D7). Não traduza, não resuma, não invente: se não achar o trecho, não cite.
CONTRA: o que fala contra IRAS (infecção da admissão, colonização, contaminante, profilaxia, negações…)
CONFIANÇA: 0 a 100
`;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DOSSIE_JANELA_EVOLUCOES_DIAS, DOSSIE_ANTES_ADMISSAO_DIAS, DOSSIE_DIA_IRAS, DOSSIE_MINIMO_HORAS,
    DOSSIE_RETENCAO_HISTORICO_DIAS, TAMANHO_EVOLUCAO_HISTORICO, acumularHistoricoEvolucoes,
    diaDaInternacao, rotuloDia, dataBR, internacaoDoAtendimento, numerosDaPessoa, anonimizarTexto, cegarDossie,
    ehHemocultura, ehContaminanteComum, sindromeDoMaterial, grupoSindrome, notaDaCultura, conferirTrechos,
    gruposDoSitio, suspeitaJaNotificada, DOSSIE_JANELA_MESMA_IRAS_DIAS, linhaDoTempoPorDia, linhasPorDia, nomeDispositivo, fatiasParaClassificador, agregarFatias, estadoNoDia, FATIA_MAX_CARACTERES, categoriaEvolucao, dispositivosNoTexto, CATEGORIAS_EVOLUCAO,
    lerEvolucoesCompletasTasy, montarDossieInternacao, sinaisDoDossie, eventosDoDossie, renderizarDossie,
    selecionarInternacoesParaDossie, amostrarDossies, PROMPT_AVALIACAO_DOSSIE, VERSAO_PROMPT_DOSSIE,
    PROMPT_SUSPEITA_FRAGMENTO, VERSAO_PROMPT_SUSPEITA, lerRespostaSuspeita, particaoDoAtendimento, sinaisDeterministicosDoFragmento
  };
}
