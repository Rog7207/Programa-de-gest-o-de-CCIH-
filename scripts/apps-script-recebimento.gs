/**
 * CCIH — Recebimento dos miniapps numa PLANILHA DO GOOGLE (versão 2, 03/10/2026).
 *
 * Os miniapps (higiene das mãos, decisão de ATB, visita à UTI, avaliação de antimicrobianos)
 * enviam o mesmo pacote CSV de sempre ("##ccih-miniapp;tipo=...;versao=..." + seções
 * "##aba"). Este script grava cada linha numa aba da planilha (uma aba por tipo.aba, ex.:
 * "higiene_maos.observacoes"), sem duplicar reenvios, e devolve ao aplicativo da CCIH, por
 * GET, o que chegou desde uma data — no MESMO formato de pacote, que o aplicativo já sabe
 * ingerir. A planilha fica no Drive da CCIH (espelhada), legível por qualquer pessoa da
 * equipe; o aplicativo sincroniza com um clique, sem importar arquivo.
 *
 * COMO IMPLANTAR (uma única vez, ~5 minutos), logado como a conta Google da CCIH:
 * 1. Crie uma planilha no Google Sheets (ex.: "CCIH — Miniapps") e copie o ID da URL
 *    (o trecho entre /d/ e /edit).
 * 2. https://script.google.com → Novo projeto → apague o conteúdo e cole este arquivo.
 * 3. Menu ⚙ "Configurações do projeto" → "Propriedades do script" → adicione:
 *      PLANILHA_ID       = <id da planilha>
 *      SEGREDO           = <uma frase longa; a mesma que vai em Configurações do aplicativo>
 *      PASTA_MINIAPPS_ID = <id da pasta do Drive onde os miniapps ficam para o tablet abrir>
 *      PASTA_ID          = <opcional: id de uma pasta do Drive para guardar cópia dos CSVs>
 *    (id de pasta = trecho da URL depois de /folders/)
 * 4. "Implantar" → "Nova implantação" → tipo "App da Web":
 *      Executar como: Eu · Quem pode acessar: Qualquer pessoa → Implantar → autorizar.
 * 5. Copie a "URL do app da Web" (termina em /exec) e cole, com o SEGREDO, em
 *    Configurações → "☁ Planilha do Google (miniapps)" do aplicativo. Depois grave de novo
 *    os miniapps na pasta espelhada (eles levam a URL e o segredo dentro).
 * Para atualizar o código depois: "Implantar" → "Gerenciar implantações" → ✎ → Nova versão.
 */

/* ---------- Pacote CSV dos miniapps (funções puras; testadas em scripts/testes.js) ------ */

/* Divide um texto CSV com ";" em linhas de campos, respeitando aspas ("" = aspa literal) e
   quebras de linha dentro de campo entre aspas. */
function dividirCSV(texto) {
  var linhas = [], campos = [], campo = '', aspas = false;
  var t = String(texto == null ? '' : texto).replace(/^﻿/, '');
  for (var i = 0; i < t.length; i++) {
    var c = t[i];
    if (aspas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ';') { campos.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      campos.push(campo); linhas.push(campos); campos = []; campo = '';
    } else campo += c;
  }
  if (campo !== '' || campos.length) { campos.push(campo); linhas.push(campos); }
  return linhas.filter(function (l) { return l.some(function (x) { return String(x).trim() !== ''; }); });
}

/* "##ccih-miniapp;tipo=higiene_maos;versao=3\n##observacoes\ncol;col\n..." →
   { tipo, versao, abas: { observacoes: [ {col: valor, ...}, ... ] } } ou null. */
function analisarPacoteTexto(texto) {
  var linhas = String(texto == null ? '' : texto).replace(/^﻿/, '').split(/\r?\n/);
  if (!linhas[0] || linhas[0].indexOf('##ccih-miniapp') !== 0) return null;
  var meta = {};
  linhas[0].split(';').slice(1).forEach(function (par) {
    var p = par.split('='); if (p[0]) meta[p[0].trim()] = (p[1] || '').trim();
  });
  var abas = {}, atual = null, buffer = [];
  var fechar = function () {
    if (atual === null) return;
    var tabela = dividirCSV(buffer.join('\n'));
    var colunas = tabela.length ? tabela[0].map(function (c) { return String(c).trim(); }) : [];
    abas[atual] = tabela.slice(1).map(function (campos) {
      var o = {};
      colunas.forEach(function (col, j) { if (col) o[col] = campos[j] == null ? '' : String(campos[j]); });
      return o;
    });
  };
  for (var i = 1; i < linhas.length; i++) {
    if (linhas[i].indexOf('##') === 0) { fechar(); atual = linhas[i].slice(2).trim(); buffer = []; }
    else if (atual !== null) buffer.push(linhas[i]);
  }
  fechar();
  return { tipo: meta.tipo || '', versao: meta.versao || '', abas: abas };
}

function csvCampo(v) {
  v = String(v == null ? '' : v);
  return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

/* O inverso: { tipo, versao, abas } → texto do pacote, no formato que o aplicativo ingere. */
function montarPacoteTexto(tipo, versao, abas) {
  var saida = '##ccih-miniapp;tipo=' + tipo + ';versao=' + (versao || '1') + '\n';
  Object.keys(abas || {}).forEach(function (aba) {
    var linhas = abas[aba] || [];
    saida += '##' + aba + '\n';
    if (!linhas.length) return;
    var colunas = [];
    linhas.forEach(function (l) { Object.keys(l).forEach(function (k) { if (colunas.indexOf(k) < 0) colunas.push(k); }); });
    saida += colunas.join(';') + '\n';
    linhas.forEach(function (l) { saida += colunas.map(function (c) { return csvCampo(l[c]); }).join(';') + '\n'; });
  });
  return saida;
}

/* Chave de deduplicação de uma linha: o conteúdo das colunas do miniapp, normalizado. O
   mesmo registro reenviado (o miniapp mantém o dia editável por 24 h) cai na mesma chave e
   não entra duas vezes; um registro editado muda a chave e entra como linha nova — o
   aplicativo resolve essa atualização pela chave natural dele (paciente-dia, ID). */
var COLUNAS_DO_SERVIDOR = ['RecebidoEm', 'Arquivo', 'Versao', 'Chave'];
function chaveDaLinha(linha) {
  var partes = Object.keys(linha).filter(function (k) { return COLUNAS_DO_SERVIDOR.indexOf(k) < 0; }).sort()
    .map(function (k) { return k + '=' + String(linha[k] == null ? '' : linha[k]).trim(); });
  return partes.join('|');
}

/* ---------- Busca do paciente nos internados (miniapp de decisão de ATB) ----------------
   O aplicativo publica a lista de internados de hoje (prontuário, nome, setor, leito) numa
   aba privada da planilha; o médico, no celular, digita número ou parte do nome e recebe só
   os melhores resultados — a lista nunca vai inteira para a página. A busca exige a "senha
   dos médicos" (hash guardado nas propriedades), conferida aqui no servidor. */
function normalizarBusca(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
/* q só de dígitos → prontuário/atendimento igual (primeiro) ou que começa pelos dígitos;
   q texto → nome que contém TODAS as palavras (quem começa pela primeira vem antes). */
function filtrarInternados(lista, q, max) {
  var termo = normalizarBusca(q);
  max = max || 8;
  if (!termo) return [];
  var res = [];
  if (/^[\d\s]+$/.test(termo)) {
    var digitos = termo.replace(/\D/g, '');
    if (digitos.length < 2) return [];
    (lista || []).forEach(function (p) {
      var pr = String(p.prontuario || '').replace(/\D/g, ''), at = String(p.atendimento || '').replace(/\D/g, '');
      if (pr === digitos || (at && at === digitos)) res.push({ p: p, peso: 0 });
      else if (pr.indexOf(digitos) === 0 || (at && at.indexOf(digitos) === 0)) res.push({ p: p, peso: 1 });
    });
  } else {
    var palavras = termo.split(' ').filter(Boolean);
    if (palavras.join('').length < 3) return [];
    (lista || []).forEach(function (p) {
      var nome = normalizarBusca(p.nome);
      if (!nome) return;
      if (palavras.every(function (w) { return nome.indexOf(w) >= 0; })) res.push({ p: p, peso: nome.indexOf(palavras[0]) === 0 ? 0 : 1 });
    });
  }
  var numerica = /^[\d\s]+$/.test(termo);
  res.sort(function (a, b) {
    if (a.peso !== b.peso) return a.peso - b.peso;
    return numerica ? String(a.p.prontuario).localeCompare(String(b.p.prontuario))
      : normalizarBusca(a.p.nome).localeCompare(normalizarBusca(b.p.nome));
  });
  return res.slice(0, max).map(function (r) { return r.p; });
}

/* ---------- Lado do servidor (Apps Script) ---------------------------------------------- */

function hashTexto(s) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s == null ? '' : s), Utilities.Charset.UTF_8));
}

var COLUNAS_INTERNADOS = ['prontuario', 'nome', 'setor', 'leito', 'atendimento', 'dataInternacao'];
/* Substitui a aba "internados" pela lista recebida e guarda o hash da senha dos médicos. */
function publicarInternados(dados) {
  var lista = dados.internados || [];
  var ss = planilha();
  var folha = ss.getSheetByName('internados') || ss.insertSheet('internados');
  folha.clearContents();
  var valores = [COLUNAS_INTERNADOS].concat(lista.map(function (p) { return COLUNAS_INTERNADOS.map(function (c) { return p[c] == null ? '' : String(p[c]); }); }));
  folha.getRange(1, 1, valores.length, COLUNAS_INTERNADOS.length).setValues(valores);
  folha.setFrozenRows(1);
  var props = PropertiesService.getScriptProperties();
  var agora = new Date().toISOString().slice(0, 16).replace('T', ' ');
  props.setProperty('INTERNADOS_EM', agora);
  if (dados.senhaBusca) props.setProperty('SENHA_BUSCA_HASH', hashTexto(dados.senhaBusca));
  return { ok: true, total: lista.length, atualizadoEm: agora, senhaDefinida: Boolean(dados.senhaBusca || props.getProperty('SENHA_BUSCA_HASH')) };
}

function lerInternados() {
  var folha = planilha().getSheetByName('internados');
  if (!folha || folha.getLastRow() < 2) return [];
  var valores = folha.getDataRange().getValues();
  var colunas = valores[0].map(String);
  return valores.slice(1).map(function (v) {
    var o = {};
    colunas.forEach(function (c, j) { o[c] = v[j] == null ? '' : String(v[j]); });
    return o;
  });
}

/* ?tipo=buscar&q=...&chave=<senha dos médicos> → até 8 internados. */
function buscarInternados(p) {
  var hash = propriedade('SENHA_BUSCA_HASH');
  if (!hash) return { ok: false, erro: 'senha dos médicos ainda não definida pela CCIH' };
  if (!p.chave || hashTexto(p.chave) !== hash) return { ok: false, erro: 'senha inválida' };
  var resultados = filtrarInternados(lerInternados(), p.q, 8).map(function (x) {
    return { prontuario: x.prontuario, nome: x.nome, setor: x.setor, leito: x.leito };
  });
  return { ok: true, resultados: resultados, atualizadoEm: propriedade('INTERNADOS_EM') };
}

/* ?app=decisao-atb → serve o miniapp publicado na pasta do Drive por https (é assim que
   ele roda no iPhone, onde arquivo baixado não executa). */
function servirMiniapp(nome) {
  if (!/^[\w-]{1,40}$/.test(nome)) return HtmlService.createHtmlOutput('<p>Miniapp inválido.</p>');
  var pastaId = propriedade('PASTA_MINIAPPS_ID');
  if (!pastaId) return HtmlService.createHtmlOutput('<p>PASTA_MINIAPPS_ID não definida no script.</p>');
  var arquivos = DriveApp.getFolderById(pastaId).getFilesByName(nome + '.html');
  if (!arquivos.hasNext()) return HtmlService.createHtmlOutput('<p>Miniapp "' + nome + '" ainda não publicado pela CCIH.</p>');
  var html = arquivos.next().getBlob().getDataAsString('UTF-8');
  return HtmlService.createHtmlOutput(html).setTitle('CCIH — ' + nome)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function propriedade(nome, padrao) {
  try { return PropertiesService.getScriptProperties().getProperty(nome) || padrao || ''; }
  catch (e) { return padrao || ''; }
}

function planilha() {
  var id = propriedade('PLANILHA_ID');
  if (!id) throw new Error('Defina a propriedade do script PLANILHA_ID.');
  return SpreadsheetApp.openById(id);
}

function nomeDaAba(tipo, aba) { return (tipo + '.' + aba).slice(0, 99); }

/* Grava as linhas de uma aba do pacote na aba correspondente da planilha. Cabeçalho =
   colunas do miniapp + colunas do servidor; coluna nova é acrescentada no fim. */
function gravarLinhas(tipo, versao, aba, linhas, nomeArquivo) {
  if (!linhas.length) return { novas: 0, repetidas: 0 };
  var ss = planilha();
  var nome = nomeDaAba(tipo, aba);
  var folha = ss.getSheetByName(nome) || ss.insertSheet(nome);
  var colunas = folha.getLastRow() ? folha.getRange(1, 1, 1, folha.getLastColumn()).getValues()[0].map(String) : [];
  var novasColunas = [];
  linhas.forEach(function (l) { Object.keys(l).forEach(function (k) { if (colunas.indexOf(k) < 0 && novasColunas.indexOf(k) < 0) novasColunas.push(k); }); });
  COLUNAS_DO_SERVIDOR.forEach(function (k) { if (colunas.indexOf(k) < 0 && novasColunas.indexOf(k) < 0) novasColunas.push(k); });
  if (novasColunas.length) {
    colunas = colunas.concat(novasColunas);
    folha.getRange(1, 1, 1, colunas.length).setValues([colunas]).setFontWeight('bold');
    folha.setFrozenRows(1);
  }
  var iChave = colunas.indexOf('Chave');
  var existentes = {};
  if (folha.getLastRow() > 1) {
    folha.getRange(2, iChave + 1, folha.getLastRow() - 1, 1).getValues().forEach(function (v) { existentes[String(v[0])] = true; });
  }
  var agora = new Date().toISOString().slice(0, 19).replace('T', ' ');
  var paraGravar = [], repetidas = 0;
  linhas.forEach(function (l) {
    var chave = chaveDaLinha(l);
    if (existentes[chave]) { repetidas++; return; }
    existentes[chave] = true;
    var completa = {}; Object.keys(l).forEach(function (k) { completa[k] = l[k]; });
    completa.RecebidoEm = agora; completa.Arquivo = nomeArquivo || ''; completa.Versao = versao || ''; completa.Chave = chave;
    paraGravar.push(colunas.map(function (c) { return completa[c] == null ? '' : completa[c]; }));
  });
  if (paraGravar.length) folha.getRange(folha.getLastRow() + 1, 1, paraGravar.length, colunas.length).setValues(paraGravar);
  return { novas: paraGravar.length, repetidas: repetidas };
}

/* Publicação de um miniapp pelo APLICATIVO (acao=publicar): grava/sobrescreve o arquivo
   HTML na pasta PASTA_MINIAPPS_ID do Drive da CCIH, de onde o tablet abre. Os computadores
   da CCIH são terminais sem cliente do Drive — este é o único caminho do PC para o Drive.
   Sobrescrever mantém o id do arquivo (atalhos e links do tablet continuam valendo). */
function publicarMiniapp(nome, conteudo) {
  var pastaId = propriedade('PASTA_MINIAPPS_ID');
  if (!pastaId) return { ok: false, erro: 'Defina a propriedade do script PASTA_MINIAPPS_ID (pasta do Drive para os miniapps).' };
  var pasta = DriveApp.getFolderById(pastaId);
  var existentes = pasta.getFilesByName(nome);
  var arquivo;
  if (existentes.hasNext()) {
    arquivo = existentes.next();
    arquivo.setContent(String(conteudo || ''));
    while (existentes.hasNext()) existentes.next().setTrashed(true);   /* duplicata antiga */
  } else {
    arquivo = pasta.createFile(nome, String(conteudo || ''), 'text/html');
  }
  return { ok: true, nome: nome, id: arquivo.getId(), url: arquivo.getUrl(), pasta: pasta.getName(), bytes: String(conteudo || '').length };
}

/* POST do miniapp: { segredo, nome, conteudo } — conteudo é o pacote CSV.
   POST do aplicativo: { segredo, acao: 'publicar', nome, conteudo } — conteudo é o HTML. */
function doPost(e) {
  try {
    var dados = JSON.parse(e.postData.contents);
    if (!dados.segredo || dados.segredo !== propriedade('SEGREDO')) return resposta({ ok: false, erro: 'segredo inválido' });
    var nome = String(dados.nome || 'ccih.csv').replace(/[^\w.\-]+/g, '_');
    if (dados.acao === 'publicar') return resposta(publicarMiniapp(nome, dados.conteudo));
    if (dados.acao === 'publicar-internados') return resposta(publicarInternados(dados));
    var pacote = analisarPacoteTexto(dados.conteudo);
    if (!pacote) return resposta({ ok: false, erro: 'não é um pacote de miniapp' });
    var totais = {};
    Object.keys(pacote.abas).forEach(function (aba) {
      totais[aba] = gravarLinhas(pacote.tipo, pacote.versao, aba, pacote.abas[aba], nome);
    });
    /* Cópia do CSV original na pasta do Drive, se configurada (registro bruto). */
    var pastaId = propriedade('PASTA_ID');
    if (pastaId) { try { DriveApp.getFolderById(pastaId).createFile(nome, String(dados.conteudo || ''), 'text/csv'); } catch (err) { /* opcional */ } }
    return resposta({ ok: true, nome: nome, tipo: pacote.tipo, totais: totais });
  } catch (erro) {
    return resposta({ ok: false, erro: String(erro) });
  }
}

/* GET do aplicativo: ?segredo=...&tipo=higiene_maos[&desde=AAAA-MM-DD] → pacote CSV com o
   que chegou desde a data (RecebidoEm), sem as colunas do servidor. ?tipo=ping → status. */
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    /* Sem segredo: a página do miniapp (pública, sem dado de paciente) e a busca de
       internados (protegida pela senha dos médicos). */
    if (p.app) return servirMiniapp(String(p.app));
    if (String(p.tipo || '') === 'buscar') return resposta(buscarInternados(p));
    if (!p.segredo || p.segredo !== propriedade('SEGREDO')) return texto('##erro;segredo inválido', 403);
    var tipo = String(p.tipo || '');
    if (tipo === 'ping') {
      var abas = planilha().getSheets().map(function (s) { return s.getName() + ' (' + Math.max(0, s.getLastRow() - 1) + ')'; });
      var pastaMiniapps = '';
      try { var pid = propriedade('PASTA_MINIAPPS_ID'); if (pid) pastaMiniapps = DriveApp.getFolderById(pid).getName(); } catch (err) { pastaMiniapps = '(PASTA_MINIAPPS_ID inválida)'; }
      return resposta({ ok: true, planilha: planilha().getName(), abas: abas, pastaMiniapps: pastaMiniapps,
        internadosEm: propriedade('INTERNADOS_EM'), senhaBuscaDefinida: Boolean(propriedade('SENHA_BUSCA_HASH')) });
    }
    var desde = String(p.desde || '');
    var ss = planilha();
    var saida = {}, versao = '1';
    ss.getSheets().forEach(function (folha) {
      var nome = folha.getName();
      if (nome.indexOf(tipo + '.') !== 0 || folha.getLastRow() < 2) return;
      var aba = nome.slice(tipo.length + 1);
      var valores = folha.getDataRange().getValues();
      var colunas = valores[0].map(String);
      var iRec = colunas.indexOf('RecebidoEm'), iVer = colunas.indexOf('Versao');
      saida[aba] = [];
      valores.slice(1).forEach(function (v) {
        var recebido = iRec >= 0 ? String(v[iRec]) : '';
        if (desde && recebido && recebido.slice(0, 10) < desde) return;
        if (iVer >= 0 && v[iVer]) versao = String(v[iVer]);
        var o = {};
        colunas.forEach(function (c, j) {
          if (COLUNAS_DO_SERVIDOR.indexOf(c) >= 0 || !c) return;
          var x = v[j];
          o[c] = x instanceof Date ? x.toISOString().slice(0, 10) : (x == null ? '' : String(x));
        });
        saida[aba].push(o);
      });
    });
    return texto(montarPacoteTexto(tipo, versao, saida));
  } catch (erro) {
    return texto('##erro;' + String(erro));
  }
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function texto(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT);
}
