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
 *      PLANILHA_ID = <id da planilha>
 *      SEGREDO     = <uma frase longa; a mesma que vai em Configurações do aplicativo>
 *      PASTA_ID    = <opcional: id de uma pasta do Drive para guardar cópia dos CSVs>
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

/* ---------- Lado do servidor (Apps Script) ---------------------------------------------- */

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

/* POST do miniapp: { segredo, nome, conteudo } — conteudo é o pacote CSV. */
function doPost(e) {
  try {
    var dados = JSON.parse(e.postData.contents);
    if (!dados.segredo || dados.segredo !== propriedade('SEGREDO')) return resposta({ ok: false, erro: 'segredo inválido' });
    var nome = String(dados.nome || 'ccih.csv').replace(/[^\w.\-]+/g, '_');
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
    if (!p.segredo || p.segredo !== propriedade('SEGREDO')) return texto('##erro;segredo inválido', 403);
    var tipo = String(p.tipo || '');
    if (tipo === 'ping') {
      var abas = planilha().getSheets().map(function (s) { return s.getName() + ' (' + Math.max(0, s.getLastRow() - 1) + ')'; });
      return resposta({ ok: true, planilha: planilha().getName(), abas: abas });
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
