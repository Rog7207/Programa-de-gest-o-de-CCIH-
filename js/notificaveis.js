/* Radar de doenças de notificação compulsória.
   NÚCLEO PURO E TESTÁVEL (sem DOM): a UI fica em ui-notificaveis.js.

   O app NÃO notifica o SINAN — ele apenas SINALIZA um internado que parece ter agravo
   notificável e DOCUMENTA o que a CCIH fez (igual ao fluxo da IRAS digitada). A detecção é
   DETERMINÍSTICA: ou um microrganismo de cultura, ou um termo nomeado na evolução (negações
   tratadas). Nunca é diagnóstico — é um sinal para a fila "A notificar".

   A lista abaixo segue a Lista Nacional de Notificação Compulsória (Portaria de Consolidação
   GM/MS nº 5/2017, Anexo, com a redação da Portaria GM/MS nº 420/2022). PRAZO e composição
   devem ser CONFERIDOS pela CCIH contra a Portaria vigente e a lista estadual/municipal — é
   semente editável, não documento oficial. */

/* prazo: 'imediata' (24 h) | 'semanal'. grupo: 'infecciosa' | 'causa_externa' | 'ambiental' */
const LISTA_NOTIFICACAO_COMPULSORIA = [
  { nome: 'Acidente de trabalho com exposição a material biológico', cid: '', prazo: 'semanal', grupo: 'causa_externa' },
  { nome: 'Acidente de trabalho grave, fatal ou em menores', cid: '', prazo: 'semanal', grupo: 'causa_externa' },
  { nome: 'Acidente por animal peçonhento', cid: 'T63', prazo: 'semanal', grupo: 'causa_externa' },
  { nome: 'Acidente por animal potencialmente transmissor da raiva', cid: '', prazo: 'semanal', grupo: 'causa_externa' },
  { nome: 'Botulismo', cid: 'A05.1', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Cólera', cid: 'A00', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Coqueluche', cid: 'A37', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Dengue (casos)', cid: 'A90', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Dengue (óbitos e casos graves)', cid: 'A91', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Difteria', cid: 'A36', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Doença aguda pelo vírus Zika', cid: 'A92.8', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Doença aguda pelo vírus Zika em gestante', cid: 'A92.8', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Doença de Chagas aguda', cid: 'B57', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Doença de Creutzfeldt-Jakob', cid: 'A81.0', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Doença invasiva por Haemophilus influenzae', cid: 'A41.3', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Doença meningocócica e outras meningites', cid: 'A39', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Esquistossomose', cid: 'B65', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Evento de saúde pública (ESP) que constitua risco', cid: '', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Febre amarela', cid: 'A95', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Febre de chikungunya', cid: 'A92.0', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Febre do Nilo Ocidental e outras arboviroses', cid: 'A92.3', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Febre hemorrágica (arenavírus, ebola, marburg, lassa)', cid: 'A96', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Febre maculosa e outras riquetsioses', cid: 'A77', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Febre tifoide', cid: 'A01.0', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Hanseníase', cid: 'A30', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Hantavirose', cid: 'B33.4', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Hepatites virais', cid: 'B19', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'HIV/AIDS', cid: 'B24', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'HIV em gestante, parturiente ou puérpera e criança exposta', cid: 'Z21', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Influenza humana por novo subtipo', cid: 'J09', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Intoxicação exógena', cid: 'T65', prazo: 'semanal', grupo: 'ambiental' },
  { nome: 'Leishmaniose tegumentar americana', cid: 'B55.1', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Leishmaniose visceral', cid: 'B55.0', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Leptospirose', cid: 'A27', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Malária', cid: 'B54', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Monkeypox (mpox)', cid: 'B04', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Óbito infantil', cid: '', prazo: 'semanal', grupo: 'outro' },
  { nome: 'Óbito materno', cid: '', prazo: 'semanal', grupo: 'outro' },
  { nome: 'Peste', cid: 'A20', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Poliomielite / paralisia flácida aguda', cid: 'A80', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Raiva humana', cid: 'A82', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Rubéola', cid: 'B06', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Sarampo', cid: 'B05', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Sífilis adquirida', cid: 'A53.9', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Sífilis congênita', cid: 'A50', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Sífilis em gestante', cid: 'O98.1', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Síndrome da rubéola congênita', cid: 'P35.0', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Síndrome respiratória aguda grave (SRAG) por coronavírus / COVID-19', cid: 'U07.1', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Surto (de qualquer natureza, inclusive IRAS e DTHA)', cid: '', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Tétano acidental', cid: 'A35', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Tétano neonatal', cid: 'A33', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Toxoplasmose gestacional e congênita', cid: 'B58', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Tuberculose', cid: 'A15', prazo: 'semanal', grupo: 'infecciosa' },
  { nome: 'Varicela (caso grave internado ou óbito)', cid: 'B01', prazo: 'imediata', grupo: 'infecciosa' },
  { nome: 'Violência doméstica, sexual e/ou autoprovocada', cid: '', prazo: 'semanal', grupo: 'causa_externa' },
  { nome: 'Violência sexual e tentativa de suicídio', cid: '', prazo: 'imediata', grupo: 'causa_externa' },
  { nome: 'Varíola', cid: 'B03', prazo: 'imediata', grupo: 'infecciosa' }
];

const _agravoPorNome = new Map(LISTA_NOTIFICACAO_COMPULSORIA.map(a => [normalizarTexto(a.nome), a]));
function agravoNaLista(nome) { return _agravoPorNome.get(normalizarTexto(nome)) || null; }

/* Precaução indicada por agravo (liga ao vocabulário motivos_precaucao, que já existe). Só os
   transmissíveis em ambiente hospitalar entram aqui; o resto não pede isolamento. */
const PRECAUCAO_POR_AGRAVO = {
  'Tuberculose': 'aerossois',
  'Sarampo': 'aerossois',
  'Varicela (caso grave internado ou óbito)': 'aerossois',
  'Monkeypox (mpox)': 'contato',
  'Doença meningocócica e outras meningites': 'goticulas',
  'Doença invasiva por Haemophilus influenzae': 'goticulas',
  'Coqueluche': 'goticulas',
  'Difteria': 'goticulas',
  'Rubéola': 'goticulas',
  'Influenza humana por novo subtipo': 'goticulas',
  'Síndrome respiratória aguda grave (SRAG) por coronavírus / COVID-19': 'goticulas'
};
const PRECAUCAO_ROTULO = { aerossois: 'Precaução para aerossóis', goticulas: 'Precaução para gotículas', contato: 'Precaução de contato' };

/* ---- Detecção por CULTURA ---- */
/* Microrganismo (vocabulário) → agravo notificável. Conservador: só o que a espécie já basta
   para levantar a suspeita. Meningite é tratada à parte (qualquer germe no líquor). */
const AGRAVOS_POR_MICRORGANISMO = {
  'neisseria meningitidis': 'Doença meningocócica e outras meningites',
  'mycobacterium tuberculosis': 'Tuberculose',
  'haemophilus influenzae': 'Doença invasiva por Haemophilus influenzae'
};
/* Materiais de sítio estéril do SNC → qualquer crescimento sugere meningite/meningococcemia. */
const MATERIAIS_MENINGITE = new Set(['liquor', 'liquido cefalorraquidiano', 'lcr']);

/* Normalização que PRESERVA espaços (ao contrário de normalizarTexto, que os remove para casar
   vocabulário): aqui comparamos frases/nomes com espaço. Reaproveita textoEvolucaoNormalizado. */
function _norm(s) { return textoEvolucaoNormalizado(s); }

function _temGerme(resultado) {
  const r = _norm(resultado);
  return !!r && !/negativ|sem crescimento|ausencia de crescimento|nao houve crescimento/.test(r);
}

/* Devolve o agravo (objeto da LNC) sugerido por uma cultura, ou null. */
function agravoDaCultura(cultura) {
  if (!cultura) return null;
  const micro = _norm(cultura.Microrganismo);
  if (micro) {
    for (const [chave, agravo] of Object.entries(AGRAVOS_POR_MICRORGANISMO)) {
      if (micro.includes(chave)) return agravoNaLista(agravo);
    }
  }
  const material = _norm(cultura.Material);
  const sitio = _norm(cultura.Sitio);
  if ((MATERIAIS_MENINGITE.has(material) || MATERIAIS_MENINGITE.has(sitio)) && (_norm(cultura.Microrganismo) || _temGerme(cultura.Resultado))) {
    return agravoNaLista('Doença meningocócica e outras meningites');
  }
  return null;
}

/* ---- Detecção por EVOLUÇÃO (determinística, negações tratadas) ---- */
/* [agravo, regex, forte]. forte = o médico já NOMEOU a doença/confirmação; fraco = termo
   sugestivo. Reaproveita textoEvolucaoNormalizado e o placeholder de negação de importacao.js. */
/* Palavras-chave das doenças, para tratar a negação NAS DUAS ORDENS ("tuberculose descartada"
   e "descartada tuberculose") e, quando descartada, zerar TODAS as menções dela no texto. */
const _KW_DOENCAS = 'tuberculose|meningite|coqueluche|sarampo|rubeola|dengue|chikungunya|zika|leptospirose|febre amarela|hepatite|sifilis|hanseniase|tetano|difteria|raiva|malaria|covid-?19|covid|srag|colera|varicela|caxumba|botulismo';
const _NEG_ANTES = '(?:sem|nega|negou|negand[oa]|descartad[oa]|afastad[oa]|exclu[ií]d[oa]|ausencia de|nao (?:ha|tem|apresenta)|improvavel)\\s+(?:sinais? de |suspeita de |quadro de |hipotese de )?';
const _NEG_DEPOIS = '\\s+(?:foi |esta |estao |)?(?:descartad[oa]|afastad[oa]|negativ[oa]|exclu[ií]d[oa]|improvavel)';
const _RE_NEGACAO = new RegExp('(?:' + _NEG_ANTES + '(' + _KW_DOENCAS + '))|((?:' + _KW_DOENCAS + '))' + _NEG_DEPOIS, 'g');
/* Contexto de VACINA/imunização não é suspeita de doença ("tomou vacina meningocócica",
   "vacinação contra sarampo em dia"). Inclui as formas morfológicas que os termos de detecção
   casam (meningococica, pneumococica…); a doença mencionada nesse contexto é zerada. */
const _KW_VACINAVEIS = 'meningococ\\w*|meningit\\w*|sarampo|rubeola|varicela|catapora|coqueluche|pertussis|difteria|tetano|febre amarela|influenza|hepatite [abcde]|hepatite|hpv|haemophilus|pneumococ\\w*|covid';
const _RE_VACINA = new RegExp('(?:vacina\\w*|imuniza\\w*|dose\\w*)\\s+(?:de |contra |para |anti-?|da |do |a )?(?:\\w+\\s+){0,2}(' + _KW_VACINAVEIS + ')|(' + _KW_VACINAVEIS + ')\\s+(?:\\w+\\s+){0,2}(?:vacina\\w*|imuniza\\w*|pos-?vacinal)', 'g');
const TERMOS_NOTIFICAVEIS = [
  ['Tuberculose', /\btuberculose\b|\btbc?\b|baar positiv|baciloscopia positiv|\bbk\s*\+|teste rapido molecular.*detectad|geneexpert.*detectad/, true],
  ['Doença meningocócica e outras meningites', /meningite|meningococcemia|meningococcica|liquor (turvo|purulento|com pleocitose)/, true],
  ['Coqueluche', /coqueluche|\bbordetella\b|tosse paroxistica|guincho inspiratorio/, true],
  ['Sarampo', /\bsarampo\b|exantema (morbiliforme|maculopapular).*(febre|koplik)|manchas de koplik/, true],
  ['Rubéola', /\brubeola\b/, true],
  ['Varicela (caso grave internado ou óbito)', /varicela|catapora|\bvvz\b|lesoes vesiculares disseminadas/, true],
  ['Febre de chikungunya', /chikungunya|\bchik\b/, true],
  ['Doença aguda pelo vírus Zika', /\bzika\b/, true],
  ['Dengue (casos)', /\bdengue\b|dengue grave|choque por dengue/, true],
  ['Leptospirose', /leptospirose|\bleptospira\b|sindrome de weil/, true],
  ['Febre amarela', /febre amarela/, true],
  ['Hepatites virais', /hepatite (a|b|c|d|e|viral|aguda)|\banti-?hbc igm\b|\bhbsag\b (reagente|positiv)|anti-?hcv (reagente|positiv)/, true],
  ['HIV/AIDS', /\bhiv\b (reagente|positiv|\+)|\baids\b|\bsida\b|soroconversao para hiv/, true],
  ['Sífilis adquirida', /\bsifilis\b|\bvdrl\b (reagente|positiv)|treponema (reagente|positiv)/, true],
  ['Hanseníase', /hanseniase|\blepra\b|baciloscopia de linfa/, true],
  ['Tétano acidental', /\btetano\b|trismo.*(ferimento|lesao)/, true],
  ['Difteria', /difteria|placas (pseudomembranosas|diftericas)|corynebacterium diphtheriae/, true],
  ['Raiva humana', /\braiva\b|hidrofobia|encefalite rabica/, true],
  ['Malária', /malaria|plasmodium|gota espessa positiv/, true],
  ['Síndrome respiratória aguda grave (SRAG) por coronavírus / COVID-19', /\bcovid\b|covid-?19|sars-?cov-?2|\bsrag\b/, true],
  ['Cólera', /\bcolera\b|vibrio cholerae/, true],
  ['Coqueluche', /\bbordetella pertussis\b/, true],
  ['Botulismo', /botulismo|clostridium botulinum|toxina botulinica/, true],
  ['Febre tifoide', /febre tifoide|salmonella typhi\b/, true],
  ['Doença de Chagas aguda', /doenca de chagas aguda|chagas aguda|trypanosoma cruzi/, true],
  ['Caxumba', /caxumba|parotidite epidemica|\bpapeira\b/, false]
];

/* Devolve { achados: [{ agravo, cid, prazo, forte, trecho }], resumo } para uma evolução. */
function notificaveisNaEvolucao(texto) {
  let t = textoEvolucaoNormalizado(texto);
  /* Doença explicitamente descartada → zera TODAS as suas menções (não só o trecho da negação),
     para uma menção positiva avulsa no mesmo texto não reacender o sinal. */
  const descartadas = new Set();
  let m;
  _RE_NEGACAO.lastIndex = 0;
  while ((m = _RE_NEGACAO.exec(t))) { const d = m[1] || m[2]; if (d) descartadas.add(d); }
  _RE_VACINA.lastIndex = 0;
  while ((m = _RE_VACINA.exec(t))) { const d = m[1] || m[2]; if (d) descartadas.add(d); }
  for (const d of descartadas) t = t.replace(new RegExp('\\b' + d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), ' [negado] ');
  const achados = [];
  const vistos = new Set();
  for (const [agravo, re, forte] of TERMOS_NOTIFICAVEIS) {
    const m = re.exec(t);
    if (!m || vistos.has(agravo)) continue;
    vistos.add(agravo);
    const info = agravoNaLista(agravo);
    const ini = Math.max(0, m.index - 40), fim = Math.min(t.length, m.index + m[0].length + 40);
    achados.push({ agravo, cid: info ? info.cid : '', prazo: info ? info.prazo : '', forte, trecho: '…' + t.slice(ini, fim).trim() + '…' });
  }
  return { achados, resumo: achados.map(a => a.agravo).join('; ') };
}

/* ---- Combinação: um sinal por (paciente, agravo), com a fonte ---- */
/* Entrada: { culturas, evolucoes } (listas do banco). Saída: lista de achados crus — a UI
   junta com o censo para mostrar só internados e cruza com o SINAN. Dedup por prontuário+agravo,
   guardando a fonte mais forte (cultura > evolução forte > evolução fraca) e a data mais recente. */
function detectarNotificaveis(bancos) {
  const culturas = (bancos && bancos.culturas) || [];
  const evolucoes = (bancos && bancos.evolucoes) || [];
  const porChave = new Map();
  const forcaDe = f => (f === 'cultura' ? 3 : f === 'evolucao_forte' ? 2 : 1);
  const registrar = (prontuario, agravoNome, fonte, data, detalhe, textoCompleto) => {
    const pront = normalizarProntuario(prontuario);
    if (!pront || !agravoNome) return;
    const info = agravoNaLista(agravoNome);
    const chave = pront + '|' + normalizarTexto(agravoNome);
    const ante = porChave.get(chave);
    const novo = { prontuario: pront, agravo: agravoNome, cid: info ? info.cid : '', prazo: info ? info.prazo : '',
      precaucao: PRECAUCAO_POR_AGRAVO[agravoNome] || '', fonte, data: data || '', detalhe: detalhe || '', textoCompleto: textoCompleto || '' };
    if (!ante || forcaDe(fonte) > forcaDe(ante.fonte) || (forcaDe(fonte) === forcaDe(ante.fonte) && String(data || '') > String(ante.data || ''))) {
      porChave.set(chave, novo);
    }
  };
  for (const c of culturas) {
    const info = agravoDaCultura(c);
    if (info) registrar(c.Prontuario, info.nome, 'cultura', c.DataColeta || c.DataResultado, c.Microrganismo || c.Material, '');
  }
  for (const e of evolucoes) {
    const r = notificaveisNaEvolucao(e.Texto);
    for (const a of r.achados) registrar(e.Prontuario, a.agravo, a.forte ? 'evolucao_forte' : 'evolucao_fraca', e.DataEvolucao, a.trecho, e.Texto);
  }
  return [...porChave.values()];
}

/* ---- Leitor do export NINDINET do SINAN (.DBF) ----
   O SheetJS lê o .dbf como tabela com os nomes de campo do SinanNet no cabeçalho. Mapeamos o
   ID_AGRAVO (CID10 sem ponto) para o nome do agravo na LNC pelo prefixo mais longo. */
const _CID_AGRAVO = LISTA_NOTIFICACAO_COMPULSORIA
  .filter(a => a.cid)
  .map(a => [a.cid.replace(/[^A-Za-z0-9]/g, '').toUpperCase(), a.nome])
  .sort((x, y) => y[0].length - x[0].length);

function agravoPorCID(cid) {
  const c = String(cid || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!c) return null;
  for (const [pref, nome] of _CID_AGRAVO) if (c.startsWith(pref)) return agravoNaLista(nome);
  return null;
}

/* Devolve { reconhecido, linhas, problemas }. Cada linha traz NomePaciente/Nascimento só para a
   tela RESOLVER o prontuário na importação — a persistência (ui) não grava identificadores. */
function lerNotificacoesSinan(matriz) {
  const linhas = matriz || [];
  let cab = -1, col = null;
  for (let i = 0; i < Math.min(linhas.length, 5); i++) {
    const norm = (linhas[i] || []).map(c => normalizarTexto(c));
    const achar = teste => { const j = norm.findIndex(teste); return j < 0 ? null : j; };
    const iNum = achar(n => n === 'nunotific');
    const iAgravo = achar(n => n === 'idagravo');
    const iNotif = achar(n => n === 'dtnotific');
    if (iNum != null && iAgravo != null && iNotif != null) {
      cab = i;
      col = {
        numero: iNum, agravo: iAgravo, notif: iNotif,
        sintomas: achar(n => n === 'dtsinpri'), nasc: achar(n => n === 'dtnasc'),
        sexo: achar(n => n === 'cssexo'), nome: achar(n => n === 'nmpacient'),
        municipio: achar(n => n === 'idmunicip' || n === 'nmmunicip'),
        unidade: achar(n => n === 'idunidade' || n === 'nmunidade'),
        classif: achar(n => n === 'classifin'), evolucao: achar(n => n === 'evolucao'),
        encerra: achar(n => n === 'dtencerra')
      };
      break;
    }
  }
  if (cab < 0) return { reconhecido: false, linhas: [], problemas: [] };
  const valor = (l, j) => j == null ? '' : String(l[j] == null ? '' : l[j]).trim();
  const saida = [], problemas = [];
  for (const bruta of linhas.slice(cab + 1)) {
    const l = bruta || [];
    const numero = valor(l, col.numero);
    const cid = valor(l, col.agravo);
    if (!numero && !cid) continue;
    const info = agravoPorCID(cid);
    saida.push({
      NumeroSinan: numero,
      CID: cid,
      Agravo: info ? info.nome : (cid ? 'CID ' + cid : ''),
      Prazo: info ? info.prazo : '',
      NaLNC: !!info,
      DataNotificacao: normalizarData(valor(l, col.notif)),
      DataSintomas: normalizarData(valor(l, col.sintomas)),
      Nascimento: normalizarData(valor(l, col.nasc)),
      Sexo: valor(l, col.sexo),
      NomePaciente: valor(l, col.nome),
      Municipio: valor(l, col.municipio),
      Unidade: valor(l, col.unidade),
      Classificacao: valor(l, col.classif),
      Evolucao: valor(l, col.evolucao)
    });
  }
  return { reconhecido: true, linhas: saida, problemas };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LISTA_NOTIFICACAO_COMPULSORIA, PRECAUCAO_POR_AGRAVO, PRECAUCAO_ROTULO,
    AGRAVOS_POR_MICRORGANISMO, agravoNaLista, agravoDaCultura, notificaveisNaEvolucao, detectarNotificaveis,
    agravoPorCID, lerNotificacoesSinan
  };
}
