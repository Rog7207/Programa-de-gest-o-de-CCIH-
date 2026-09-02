/* Avaliação remota de antimicrobianos: montagem dos dados, criptografia (AES-GCM
   com senha) e geração da página autocontida do médico. Usável no navegador e em Node. */

const AVALIACAO_ARQUIVO = 'avaliacao-antimicrobianos.html';
const AVALIACAO_AVISO_HORAS = 48;
const AVALIACAO_BLOQUEIO_DIAS = 7;

function paraBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return btoa(s);
}

async function criptografarDados(texto, senha) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
  const chave = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: sal, iterations: 150000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, new TextEncoder().encode(texto)));
  return { sal: paraBase64(sal), iv: paraBase64(iv), dados: paraBase64(cifrado) };
}

/* Reúne os pacientes com antimicrobianos ativos ainda não avaliados, com o contexto
   clínico necessário à avaliação e alertas de incompatibilidade cultura × prescrição. */
function montarDadosAvaliacao(bancos, hoje) {
  const avaliadas = new Set((bancos.avaliacoes || []).map(a => a.ID_Prescricao));
  const nomes = new Map((bancos.pacientes || []).map(p => [normalizarProntuario(p.Prontuario), p.Nome]));
  const sensPorCultura = {};
  (bancos.sensibilidade || []).forEach(s => {
    (sensPorCultura[s.ID_Cultura] = sensPorCultura[s.ID_Cultura] || []).push(s);
  });

  /* O extrato do hospital traz DataFim em TODA linha (janela de validade renovada) —
     ativa é a que ainda não venceu, não a que não tem fim. */
  const naRotina = p => typeof config === 'undefined' || config.ehAtbAvaliado(p.Antibiotico);
  const pendentes = (bancos.prescricoes || []).filter(p =>
    p.Antibiotico && prescricaoAtiva(p, hoje) && naRotina(p) && !avaliadas.has(p.ID_Prescricao));
  const culturasPendentesTodas = (bancos.culturas || []).filter(c =>
    c.StatusRevisao === 'pendente' && c.Microrganismo);

  const porPaciente = new Map();
  for (const p of pendentes) {
    const prontuario = normalizarProntuario(p.Prontuario);
    if (!porPaciente.has(prontuario)) porPaciente.set(prontuario, []);
    porPaciente.get(prontuario).push(p);
  }
  for (const c of culturasPendentesTodas) {
    const prontuario = normalizarProntuario(c.Prontuario);
    if (!porPaciente.has(prontuario)) porPaciente.set(prontuario, []);
  }

  const dias = de => {
    if (!de) return '';
    const n = Math.floor((new Date(hoje) - new Date(de)) / 86400000);
    return isNaN(n) ? '' : n;
  };

  /* Índices por prontuário construídos UMA vez: filtrar as 38 mil culturas dentro do laço
     de pacientes multiplicava o trabalho por paciente pendente. */
  const culturasPorProntuario = new Map();
  for (const c of (bancos.culturas || [])) {
    if (c.StatusRevisao === 'descartada' || !c.Microrganismo) continue;
    const chave = normalizarProntuario(c.Prontuario);
    if (!culturasPorProntuario.has(chave)) culturasPorProntuario.set(chave, []);
    culturasPorProntuario.get(chave).push(c);
  }
  const previasPorProntuario = new Map();
  for (const p of (bancos.prescricoes || [])) {
    if (!String(p.DataFim || '').trim()) continue;
    const chave = normalizarProntuario(p.Prontuario);
    if (!previasPorProntuario.has(chave)) previasPorProntuario.set(chave, []);
    previasPorProntuario.get(chave).push(p);
  }

  const pacientes = [];
  for (const [prontuario, prescricoes] of porPaciente) {
    const culturasPaciente = (culturasPorProntuario.get(prontuario) || []).slice()
      .sort((a, b) => String(b.DataColeta).localeCompare(String(a.DataColeta)))
      .filter((c, i) => c.StatusRevisao === 'pendente' || i < 6)
      .map(c => ({
        id: c.ID_Cultura, pendente: c.StatusRevisao === 'pendente',
        setor: c.Setor, data: c.DataColeta, material: c.Material, micro: c.Microrganismo,
        mecanismo: c.MecanismoResistencia || (typeof inferirMecanismo === 'function'
          ? inferirMecanismo(c.Microrganismo, sensPorCultura[c.ID_Cultura] || []) : ''),
        sens: (sensPorCultura[c.ID_Cultura] || []).map(s => ({ atb: s.Antibiotico, res: s.Resultado }))
      }));

    const previos = (previasPorProntuario.get(prontuario) || []).slice()
      .sort((a, b) => String(b.DataInicio).localeCompare(String(a.DataInicio)))
      .slice(0, 10)
      .map(p => ({ atb: p.Antibiotico, inicio: p.DataInicio, fim: p.DataFim }));

    const alertas = [];
    for (const presc of prescricoes) {
      for (const cult of culturasPaciente) {
        if (cult.sens.some(s => s.res === 'R' && normalizarTexto(s.atb) === normalizarTexto(presc.Antibiotico))) {
          alertas.push(`${cult.micro} resistente a ${presc.Antibiotico} (cultura de ${cult.data})`);
        }
      }
    }
    for (const cult of culturasPaciente) {
      if (cult.mecanismo) alertas.push(`Multirresistente: ${cult.mecanismo} — ${cult.micro} (${cult.data})`);
    }

    const temMismatch = alertas.some(a => a.includes('resistente a'));
    const maiorUso = Math.max(0, ...prescricoes.map(p => Number(dias(p.DataInicio)) || 0));
    pacientes.push({
      prontuario,
      nome: nomes.get(prontuario) || '',
      setor: (prescricoes[0] || {}).Setor || (culturasPaciente[0] || {}).setor || '',
      prioridade: (temMismatch ? 2 : 0) + (alertas.length ? 1 : 0),
      maiorUso,
      alertas: [...new Set(alertas)],
      prescricoes: prescricoes.map(p => ({
        id: p.ID_Prescricao, atb: p.Antibiotico, dose: p.Dose, via: p.Via, freq: p.Frequencia,
        inicio: p.DataInicio, dias: dias(p.DataInicio), indicacao: p.Indicacao, evolucao: p.UltimaEvolucao
      })),
      previos,
      culturas: culturasPaciente
    });
  }
  pacientes.sort((a, b) => b.prioridade - a.prioridade || b.maiorUso - a.maiorUso);
  return { pacientes, totalPrescricoes: pendentes.length, totalCulturas: culturasPendentesTodas.length };
}

/* Página autocontida do médico avaliador. Os dados só existem cifrados dentro dela. */
function gerarHTMLAvaliacao(cifrado, meta) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CCIH — Avaliação de antimicrobianos</title>
<style>
* { box-sizing: border-box; } body { font-family: system-ui, sans-serif; margin: 0; background: #f2f4f7; color: #1f2933; }
header { background: #14532d; color: #fff; padding: 14px 16px; }
header h1 { font-size: 18px; margin: 0; } header p { margin: 2px 0 0; font-size: 12px; opacity: .8; }
main { padding: 12px; max-width: 760px; margin: 0 auto; }
.cartao { background: #fff; border: 1px solid #dde3ea; border-radius: 10px; padding: 14px; margin-bottom: 12px; }
label { display: block; font-size: 13px; color: #61707f; margin-top: 8px; }
input, select, textarea { width: 100%; font-size: 15px; padding: 9px; border: 1px solid #c3ccd6; border-radius: 8px; background: #fff; font-family: inherit; }
button { font-size: 15px; font-weight: 600; border-radius: 8px; padding: 11px 14px; border: none; cursor: pointer; }
.principal { background: #14532d; color: #fff; width: 100%; margin-top: 10px; }
.secundario { background: #fff; color: #14532d; border: 1px solid #14532d; }
.paciente { cursor: pointer; }
.paciente h3 { margin: 0; font-size: 16px; }
.selo { display: inline-block; background: #e8f3ec; color: #14532d; border-radius: 10px; padding: 2px 8px; font-size: 12px; margin: 2px 4px 0 0; }
.selo-alerta { background: #fbe9e7; color: #b03a2e; }
.selo-ok { background: #cfe3d6; }
.aviso { border-radius: 8px; padding: 10px 12px; margin: 10px 0; font-size: 14px; }
.aviso-amarelo { background: #fdf3dd; border: 1px solid #e5b95c; }
.aviso-vermelho { background: #fbe9e7; border: 1px solid #d98177; }
.aviso-verde { background: #e8f3ec; border: 1px solid #7ddca3; }
.suave { color: #61707f; font-size: 13px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 6px 0; }
th { text-align: left; padding: 4px 6px; border-bottom: 2px solid #dde3ea; font-size: 11px; text-transform: uppercase; color: #61707f; }
td { padding: 4px 6px; border-bottom: 1px solid #eef1f5; vertical-align: top; }
.res-R { color: #b03a2e; font-weight: 700; }
.bloco-presc { border-left: 3px solid #cfe3d6; padding-left: 10px; margin: 10px 0; }
.evolucao { background: #f7f9f8; border-radius: 8px; padding: 10px; font-size: 14px; white-space: pre-wrap; }
.oculto { display: none; }
</style>
</head>
<body>
<header><h1>Avaliação de antimicrobianos — CCIH</h1><p id="cabecalhoInfo"></p></header>
<main id="principal"><div class="cartao" id="telaSenha">
  <p>Dados clínicos protegidos. Digite a senha fornecida pela CCIH:</p>
  <input type="password" id="senha" autocomplete="off">
  <button class="principal" id="abrir">Abrir avaliação</button>
  <p class="suave" id="erroSenha"></p>
</div></main>
<script>
var META = ${JSON.stringify(meta)};
var CIFRADO = ${JSON.stringify(cifrado)};
var INDICACOES = ['Pneumonia', 'ITU', 'Infecção de pele e partes moles', 'Infecção abdominal', 'Corrente sanguínea / sepse', 'Sítio cirúrgico', 'Meningite / SNC', 'Profilaxia', 'Outros'];
var AVALIACOES = ['Correto', 'Parcialmente correto', 'Incorreto'];
var RECOMENDACOES = ['Manter', 'Suspender', 'Modificar', 'Ajustar dose'];
var FOCOS = ['Pulmonar / PAV', 'Urinário', 'Corrente sanguínea / cateter', 'Sítio cirúrgico', 'Pele e partes moles', 'Abdominal', 'SNC', 'Sem foco definido', 'Outros'];
var CLASSIFICACOES_CULTURA = ['Presente na admissão', 'IRAS', 'Bacteremia secundária', 'Colonização', 'Contaminação', 'Repetição', 'Não é cultura'];
var TOPOGRAFIAS = ['IPCS com confirmação laboratorial', 'IPCS clínica', 'Pneumonia associada à ventilação mecânica (PAV)', 'Pneumonia não associada à VM', 'Traqueobronquite', 'ITU associada a cateter vesical', 'ITU não associada a cateter', 'ISC incisional superficial', 'ISC incisional profunda', 'ISC de órgão/espaço', 'Infecção de pele e partes moles', 'Enterocolite por C. difficile', 'Gastroenterite', 'Meningite/ventriculite', 'Sinusite', 'Conjuntivite', 'Endometrite', 'Endocardite', 'Osteomielite'];
var DISPOSITIVOS = ['Nenhum', 'CVC', 'VM', 'SVD'];
var CHAVE_LOCAL = 'ccih.avaliacao.' + META.geradoEm;
var dados = null;
var respostas = JSON.parse(localStorage.getItem(CHAVE_LOCAL) || '{}');
var suspeitas = JSON.parse(localStorage.getItem(CHAVE_LOCAL + '.susp') || '{}');
var respostasCultura = JSON.parse(localStorage.getItem(CHAVE_LOCAL + '.cult') || '{}');

function $(id) { return document.getElementById(id); }
function el(tag, attrs, filhos) {
  var e = document.createElement(tag);
  attrs = attrs || {};
  for (var k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  (filhos || []).forEach(function (f) {
    if (f == null) return;
    e.appendChild(f.nodeType ? f : document.createTextNode(f));
  });
  return e;
}
function deBase64(b64) {
  var bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

var idadeHoras = (Date.now() - new Date(META.geradoEm).getTime()) / 3600000;
$('cabecalhoInfo').textContent = 'Dados extraídos em ' + new Date(META.geradoEm).toLocaleString('pt-BR')
  + ' — confirme no prontuário antes de mudar conduta.';
if (idadeHoras > META.bloqueioDias * 24) {
  $('principal').innerHTML = '';
  $('principal').appendChild(el('div', { class: 'aviso aviso-vermelho' },
    ['Esta página tem mais de ' + META.bloqueioDias + ' dias e foi bloqueada por segurança. Peça à CCIH uma versão atualizada.']));
}

$('abrir').addEventListener('click', abrir);
$('senha').addEventListener('keydown', function (e) { if (e.key === 'Enter') abrir(); });

async function abrir() {
  try {
    var material = await crypto.subtle.importKey('raw', new TextEncoder().encode($('senha').value), 'PBKDF2', false, ['deriveKey']);
    var chave = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: deBase64(CIFRADO.sal), iterations: 150000, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    var aberto = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deBase64(CIFRADO.iv) }, chave, deBase64(CIFRADO.dados));
    dados = JSON.parse(new TextDecoder().decode(aberto));
    desenhar();
  } catch (e) {
    $('erroSenha').textContent = 'Senha incorreta.';
  }
}

function totalRespostas() { return Object.keys(respostas).length; }
function gravarLocal() {
  localStorage.setItem(CHAVE_LOCAL, JSON.stringify(respostas));
  localStorage.setItem(CHAVE_LOCAL + '.susp', JSON.stringify(suspeitas));
  localStorage.setItem(CHAVE_LOCAL + '.cult', JSON.stringify(respostasCultura));
}

function desenhar() {
  var raiz = $('principal');
  raiz.innerHTML = '';
  if (idadeHoras > META.avisoHoras) {
    raiz.appendChild(el('div', { class: 'aviso aviso-amarelo' },
      ['Atenção: dados com mais de ' + Math.round(idadeHoras) + ' horas.']));
  }
  var topo = el('div', { class: 'cartao' }, [
    el('label', {}, ['Seu nome (avaliador)']),
    el('input', { type: 'text', id: 'avaliador', value: localStorage.getItem('ccih.avaliador') || '' }),
    el('p', { class: 'suave' }, [dados.pacientes.length + ' pacientes com antimicrobianos pendentes de avaliação. Toque no paciente para avaliar.'])
  ]);
  raiz.appendChild(topo);
  dados.pacientes.forEach(function (p, i) { raiz.appendChild(cartaoPaciente(p, i)); });
  var rodape = el('div', { class: 'cartao' }, [
    el('button', { class: 'principal', id: 'exportar', onclick: exportar }, ['Exportar avaliações (' + totalRespostas() + ')']),
    el('p', { class: 'suave', id: 'statusExporte' }, [])
  ]);
  raiz.appendChild(rodape);
}

function cartaoPaciente(p, i) {
  var avaliadasDoPaciente = p.prescricoes.filter(function (x) { return respostas[x.id]; }).length;
  var cabecalho = el('div', { class: 'paciente' }, [
    el('h3', {}, [p.nome ? p.nome + ' ' : '', '(' + p.prontuario + ')' + (p.setor ? ' · ' + p.setor : '')]),
    el('div', {}, (suspeitas[p.prontuario] ? [el('span', { class: 'selo selo-alerta' }, ['SUSPEITA DE IRAS: ' + suspeitas[p.prontuario].FocoSuspeito])] : [])
      .concat(p.alertas.map(function (a) { return el('span', { class: 'selo selo-alerta' }, [a]); }))
      .concat(p.prescricoes.map(function (x) { return el('span', { class: 'selo' + (respostas[x.id] ? ' selo-ok' : '') }, [x.atb + ' — ' + (x.dias === '' ? '?' : x.dias) + ' d' + (respostas[x.id] ? ' ✓' : '')]); }))
      .concat(p.culturas.filter(function (x) { return x.pendente; }).map(function (x) { return el('span', { class: 'selo' + (respostasCultura[x.id] ? ' selo-ok' : '') }, ['cultura: ' + x.micro + (respostasCultura[x.id] ? ' ✓' : '')]); })))
  ]);
  var detalhe = el('div', { class: 'oculto' });
  cabecalho.addEventListener('click', function () {
    if (detalhe.classList.contains('oculto')) { detalhe.classList.remove('oculto'); montarDetalhe(detalhe, p); }
    else detalhe.classList.add('oculto');
  });
  return el('div', { class: 'cartao' }, [cabecalho, detalhe]);
}

function montarDetalhe(alvo, p) {
  alvo.innerHTML = '';
  alvo.appendChild(blocoSuspeita(p));
  p.prescricoes.forEach(function (presc) { alvo.appendChild(blocoPrescricao(p, presc)); });
  if (p.previos.length) {
    alvo.appendChild(el('p', { class: 'suave' }, ['Antimicrobianos prévios: ' + p.previos.map(function (x) { return x.atb + ' (' + x.inicio + ' a ' + x.fim + ')'; }).join(' · ')]));
  }
  p.culturas.forEach(function (c) {
    var tabela = el('table', {}, [el('tbody', {}, c.sens.map(function (s) {
      return el('tr', {}, [el('td', {}, [s.atb]), el('td', { class: s.res === 'R' ? 'res-R' : '' }, [s.res])]);
    }))]);
    alvo.appendChild(el('div', {}, [
      el('p', {}, [el('strong', {}, [c.micro]), ' — ' + c.material + ', ' + c.data + (c.mecanismo ? ' · ' + c.mecanismo : '')]),
      c.sens.length ? tabela : el('p', { class: 'suave' }, ['sem antibiograma']),
      c.pendente ? blocoCultura(p, c) : null
    ]));
  });
}

function blocoSuspeita(p) {
  var atual = suspeitas[p.prontuario];
  var caixa = el('input', { type: 'checkbox' }, []);
  caixa.style.cssText = 'width:20px;height:20px';
  if (atual) caixa.checked = true;
  var selFoco = seletor(FOCOS, atual ? atual.FocoSuspeito : null);
  var linhaFoco = el('span', { class: atual ? '' : 'oculto' }, [el('label', {}, ['Foco suspeito']), selFoco]);
  var aplicar = function () {
    if (caixa.checked) {
      linhaFoco.className = '';
      suspeitas[p.prontuario] = { Prontuario: p.prontuario, FocoSuspeito: selFoco.value };
    } else {
      linhaFoco.className = 'oculto';
      delete suspeitas[p.prontuario];
    }
    gravarLocal();
  };
  caixa.addEventListener('change', aplicar);
  selFoco.addEventListener('change', aplicar);
  var rotulo = el('label', {}, []);
  rotulo.style.cssText = 'display:flex;align-items:center;gap:8px;font-weight:600;color:#b03a2e;margin:0';
  rotulo.appendChild(caixa);
  rotulo.appendChild(document.createTextNode(' Notificar suspeita de IRAS à CCIH'));
  return el('div', { class: 'bloco-presc' }, [rotulo, linhaFoco]);
}

function blocoCultura(p, c) {
  var resposta = respostasCultura[c.id] || {};
  var selClasse = seletor(CLASSIFICACOES_CULTURA, resposta.Classificacao);
  var selTopo = seletor(TOPOGRAFIAS, resposta.Topografia);
  var selDisp = seletor(DISPOSITIVOS, resposta.Dispositivo);
  var linhaIras = el('span', { class: resposta.Classificacao === 'IRAS' ? '' : 'oculto' },
    [el('label', {}, ['Sítio da IRAS']), selTopo, el('label', {}, ['Dispositivo associado']), selDisp]);
  selClasse.addEventListener('change', function () { linhaIras.className = selClasse.value === 'IRAS' ? '' : 'oculto'; });
  var estado = el('p', { class: 'suave' }, [resposta.Classificacao ? 'Classificação salva ✓ (editável até exportar)' : '']);
  return el('div', { class: 'bloco-presc' }, [
    el('label', {}, ['Classificar esta cultura (pendente de revisão)']), selClasse, linhaIras,
    el('button', { class: 'secundario', onclick: function () {
      respostasCultura[c.id] = {
        ID_Cultura: c.id, Prontuario: p.prontuario, Classificacao: selClasse.value,
        Topografia: selClasse.value === 'IRAS' ? selTopo.value : '',
        Dispositivo: selClasse.value === 'IRAS' ? selDisp.value : ''
      };
      gravarLocal();
      estado.textContent = 'Classificação salva ✓ (editável até exportar)';
    } }, ['Salvar classificação da cultura']),
    estado
  ]);
}

function blocoPrescricao(p, presc) {
  var resposta = respostas[presc.id] || {};
  var selInd = seletor(INDICACOES, resposta.Indicacao || presc.indicacao);
  var selAval = seletor(AVALIACOES, resposta.Avaliacao);
  var selRec = seletor(RECOMENDACOES, resposta.Recomendacao);
  var parecer = el('textarea', { rows: 2, placeholder: 'parecer / orientações (opcional)' }, []);
  parecer.value = resposta.ParecerTexto || '';
  var estado = el('p', { class: 'suave' }, [resposta.Avaliacao ? 'Avaliação salva ✓ (editável até exportar)' : '']);
  var bloco = el('div', { class: 'bloco-presc' }, [
    el('p', {}, [el('strong', {}, [presc.atb]),
      ' ' + [presc.dose, presc.via, presc.freq].filter(Boolean).join(' · ')
      + ' — início ' + (presc.inicio || '?') + (presc.dias === '' ? '' : ' (' + presc.dias + ' dias)')]),
    presc.indicacao ? el('p', { class: 'suave' }, ['Justificativa da prescrição: ' + presc.indicacao]) : null,
    presc.evolucao ? el('div', { class: 'evolucao' }, [presc.evolucao]) : null,
    el('label', {}, ['Indicação']), selInd,
    el('label', {}, ['Avaliação']), selAval,
    el('label', {}, ['Recomendação da CCIH']), selRec,
    el('label', {}, ['Parecer']), parecer,
    el('button', { class: 'secundario', onclick: function () {
      respostas[presc.id] = {
        ID_Prescricao: presc.id, Prontuario: p.prontuario, Antibiotico: presc.atb,
        Indicacao: selInd.value, Avaliacao: selAval.value, Recomendacao: selRec.value,
        ParecerTexto: parecer.value.trim()
      };
      gravarLocal();
      estado.textContent = 'Avaliação salva ✓ (editável até exportar)';
      $('exportar').textContent = 'Exportar avaliações (' + totalRespostas() + ')';
    } }, ['Salvar avaliação deste antibiótico']),
    estado
  ]);
  return bloco;
}

function seletor(opcoes, valor) {
  return el('select', {}, opcoes.map(function (o) {
    var op = el('option', { value: o }, [o]);
    if (o === valor) op.setAttribute('selected', '');
    return op;
  }));
}

function csvCampo(v) { v = String(v == null ? '' : v); return /[;"\\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function avisar(texto, erro) {
  var s = $('statusExporte');
  s.style.cssText = 'font-weight:600;color:' + (erro ? '#b03a2e' : '#14532d');
  s.textContent = texto;
}
async function exportar() {
  var avaliador = $('avaliador').value.trim();
  if (!avaliador) { avisar('Preencha seu nome antes de exportar.', true); return; }
  if (!totalRespostas() && !Object.keys(suspeitas).length && !Object.keys(respostasCultura).length) { avisar('Nenhuma avaliação, classificação ou suspeita salva ainda.', true); return; }
  localStorage.setItem('ccih.avaliador', avaliador);
  var agora = new Date().toISOString().slice(0, 16).replace('T', ' ');
  var colunas = ['ID_Prescricao', 'Prontuario', 'Antibiotico', 'Indicacao', 'Avaliacao', 'Recomendacao', 'ParecerTexto', 'Avaliador', 'DataDados', 'CriadoEm'];
  var linhas = Object.keys(respostas).map(function (id) {
    var r = respostas[id];
    r.Avaliador = avaliador; r.DataDados = META.geradoEm; r.CriadoEm = agora;
    return colunas.map(function (c) { return csvCampo(r[c]); }).join(';');
  });
  var texto = '##ccih-miniapp;tipo=avaliacao_atb;versao=1\\n##avaliacoes\\n' + colunas.join(';') + '\\n' + linhas.join('\\n') + '\\n';
  var chavesSuspeita = Object.keys(suspeitas);
  if (chavesSuspeita.length) {
    texto += '##suspeitas\\nProntuario;FocoSuspeito;Avaliador;DataDados;CriadoEm\\n';
    texto += chavesSuspeita.map(function (k) {
      var s = suspeitas[k];
      return [s.Prontuario, s.FocoSuspeito, avaliador, META.geradoEm, agora].map(csvCampo).join(';');
    }).join('\\n') + '\\n';
  }
  var chavesCult = Object.keys(respostasCultura);
  if (chavesCult.length) {
    texto += '##culturas_avaliadas\\nID_Cultura;Prontuario;Classificacao;Topografia;Dispositivo;Avaliador;DataDados;CriadoEm\\n';
    texto += chavesCult.map(function (k) {
      var r = respostasCultura[k];
      return [r.ID_Cultura, r.Prontuario, r.Classificacao, r.Topografia, r.Dispositivo, avaliador, META.geradoEm, agora].map(csvCampo).join(';');
    }).join('\\n') + '\\n';
  }
  var nome = 'AVAL_ATB_' + new Date().toISOString().slice(0, 10) + '_' + avaliador.replace(/[^A-Za-z0-9]+/g, '-') + '.csv';
  try {
    var a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\\uFEFF' + texto);
    a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    avisar('Arquivo "' + nome + '" salvo em Downloads. Anexe num e-mail para ' + META.emailDestino);
    var ancora = document.createElement('a');
    ancora.href = 'mailto:' + META.emailDestino + '?subject=' + encodeURIComponent('CCIH — ' + nome);
    ancora.textContent = 'Abrir e-mail já endereçado';
    ancora.style.cssText = 'display:block;margin-top:6px;color:#14532d;font-weight:700';
    $('statusExporte').appendChild(ancora);
    ancora.click();
  } catch (e) {
    avisar('Não foi possível exportar: ' + e.message, true);
  }
}
</script>
</body>
</html>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { montarDadosAvaliacao, criptografarDados, gerarHTMLAvaliacao, AVALIACAO_ARQUIVO, AVALIACAO_AVISO_HORAS, AVALIACAO_BLOQUEIO_DIAS };
}
