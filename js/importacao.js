/* Núcleo do importador: mapeamento, normalização, validação e deduplicação.
   Funções puras — usáveis no navegador e nos testes em Node. */

const VALORES_ANTIBIOGRAMA = {
  s: 'S', sensivel: 'S', sen: 'S', sensible: 'S',
  r: 'R', resistente: 'R', res: 'R',
  i: 'I', intermediario: 'I', int: 'I', intermedio: 'I'
};
const VAZIOS_ANTIBIOGRAMA = ['', '-', '--', 'nt', 'naotestado', 'na', 'nr'];

/* Marcador de procedimento excluído da vigilância (memorizado como sinônimo). */
const NAO_CIRURGIA = '__NAO_CIRURGIA__';
const NAO_CULTURA = '__NAO_CULTURA__';
const PALAVRAS_NAO_CIRURGIA = ['partonormal', 'partovaginal', 'cateterismo', 'colonoscopia',
  'gastroduodenoscopia', 'broncoscopia', 'retossigmoidoscopia', 'curativo',
  /* Procedimentos de beira-leito/anestesia que o mapa NHSN chama de "implante de cateter"
     e por isso caíam no regex de prótese — sem ferida operatória, sem busca fonada. */
  'implantedecateter', 'implantacaodecateter', 'catetervenoso', 'cateterdelonga',
  'cateterparahemodialise', 'cateterparaanalgesia', 'bloqueiosprolongados', 'bloqueioprolongado'];

function pareceNaoCirurgia(procedimento) {
  const n = normalizarTexto(procedimento);
  if (PALAVRAS_NAO_CIRURGIA.some(palavra => n.includes(palavra))) return true;
  /* "Endoscopia" solta é exame; "Septoplastia Por VIDEOendoscopia" é cirurgia de verdade.
     O adjetivo ("...endoscópica") não contém a palavra e passa direto. */
  return /(?<!video)endoscopia/.test(n);
}

function normalizarData(valor) {
  if (valor == null || valor === '') return '';
  if (valor instanceof Date && !isNaN(valor)) {
    return valor.toISOString().slice(0, 10);
  }
  if (typeof valor === 'number') {
    /* Serial do Excel: 700 ≈ 1901. O piso antigo (20000 ≈ out/1954) rejeitava a data de
       nascimento de qualquer paciente idoso — e idoso é justamente a população vigiada. */
    if (valor > 700 && valor < 80000) {
      const d = XLSX.SSF.parse_date_code(valor);
      if (d) return `${String(d.y).padStart(4, '0')}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
    return null;
  }
  const s = String(valor).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(s);
  if (m) {
    let [, dia, mes, ano] = m;
    if (ano.length === 2) ano = (Number(ano) < 30 ? '20' : '19') + ano;
    const nDia = Number(dia), nMes = Number(mes), nAno = Number(ano);
    if (nDia < 1 || nDia > 31 || nMes < 1 || nMes > 12 || nAno < 1900 || nAno > 2100) return null;
    return `${ano}-${String(nMes).padStart(2, '0')}-${String(nDia).padStart(2, '0')}`;
  }
  return null;
}

function normalizarProntuario(valor) {
  let s = String(valor == null ? '' : valor).trim();
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
  return s;
}

function normalizarValorAntibiograma(valor) {
  const n = normalizarTexto(valor);
  if (VAZIOS_ANTIBIOGRAMA.includes(n)) return '';
  return VALORES_ANTIBIOGRAMA[n] || null;
}

function pareceData(valor) {
  const d = normalizarData(valor);
  return d !== null && d !== '';
}

/* Sugere o mapeamento coluna→campo para um tipo de relatório.
   Retorna [{coluna, cabecalho, destino, pontos}] — destino '' = ignorar, '@antibiograma' = coluna de antibiograma. */
function sugerirMapeamento(cabecalhos, linhasDados, tipo) {
  const definicao = TIPOS_RELATORIO[tipo];
  const resultado = cabecalhos.map((cab, i) => ({ coluna: i, cabecalho: String(cab).trim(), destino: '', pontos: 0 }));
  const usados = new Set();

  /* Uma coluna cujo título fala em antibiograma é sempre o antibiograma inteiro num campo só —
     reservada antes da pontuação normal para não ser confundida com "mecanismo de resistência". */
  if (definicao.permiteAntibiograma) {
    resultado.forEach(r => {
      if (normalizarTexto(r.cabecalho).includes('antibiograma')) { r.destino = '@antibiograma_texto'; r.pontos = 3; }
    });
  }

  const candidatos = [];
  cabecalhos.forEach((cab, i) => {
    const n = normalizarTexto(cab);
    if (!n || resultado[i].destino) return;
    definicao.campos.forEach(campo => {
      let pontos = 0;
      if (campo.sinonimos.includes(n)) pontos = 3;
      else if (campo.sinonimos.some(sin => n.startsWith(sin) || sin.startsWith(n) && n.length >= 4)) pontos = 2;
      else if (campo.sinonimos.some(sin => n.includes(sin) && sin.length >= 4)) pontos = 1;
      if (pontos > 0 && campo.tipo === 'data') {
        const amostra = linhasDados.slice(0, 20).map(l => l[i]).filter(v => String(v).trim() !== '');
        if (amostra.length && amostra.filter(pareceData).length >= amostra.length * 0.6) pontos += 1;
      }
      if (pontos > 0) candidatos.push({ coluna: i, campo: campo.id, pontos });
    });
  });
  candidatos.sort((a, b) => b.pontos - a.pontos);
  for (const c of candidatos) {
    if (usados.has(c.campo) || resultado[c.coluna].destino) continue;
    resultado[c.coluna].destino = c.campo;
    resultado[c.coluna].pontos = c.pontos;
    usados.add(c.campo);
  }

  if (definicao.permiteAntibiograma) {
    resultado.forEach(r => {
      if (r.destino || !r.cabecalho) return;
      const amostra = linhasDados.slice(0, 30).map(l => l[r.coluna]).map(normalizarValorAntibiograma);
      const validos = amostra.filter(v => v === 'S' || v === 'R' || v === 'I').length;
      const invalidos = amostra.filter(v => v === null).length;
      if (validos >= 2 && invalidos <= amostra.length * 0.2) r.destino = '@antibiograma';
    });
  }
  return resultado;
}

/* Aplica mapeamento + normalização. Retorna { registros, sensibilidades, problemas }.
   Cada registro guarda _linha (nº na planilha original, 1-based) para mensagens de erro. */
/* ---- Relatórios impressos: faixa de agrupamento e paginação ----

   O relatório de pacientes isolados sai como se fosse para o papel: o setor aparece uma vez,
   numa faixa acima do grupo, e não em cada linha; título e cabeçalho se repetem a cada
   página; e uma linha de paciente pode ser partida ao meio pela quebra de página, com o fim
   dela reaparecendo logo depois do cabeçalho seguinte. Lido cru, isso vira setor vazio,
   linhas-fantasma e um paciente sem a precaução dele.

   Devolve só as linhas de dado, cada uma já com o valor da faixa a que pertence. */
function prepararRelatorio(linhas, linhaCabecalho, definicao, colunasDados, colunaFaixa) {
  const assinatura = celulas => (celulas || []).map(c => normalizarTexto(c)).filter(Boolean).join('|');
  /* Tudo que aparece antes do cabeçalho é enfeite de página. Se reaparecer depois, é a
     mesma coisa repetida na página seguinte — inclusive o próprio cabeçalho. */
  const preambulo = new Set();
  for (let i = 0; i <= linhaCabecalho; i++) {
    const a = assinatura(linhas[i]);
    if (a) preambulo.add(a);
  }
  /* Identidade = os campos que dizem de QUEM é a linha. Não serve usar todos os
     obrigatórios: no relatório de isolados a precaução é obrigatória, e é justamente ela
     que costuma sobrar sozinha do outro lado da quebra de página. */
  const idsIdentidade = definicao.identidade || definicao.campos.filter(c => c.obrigatorio).map(c => c.id);
  const identidade = definicao.campos
    .filter(c => idsIdentidade.includes(c.id) && colunasDados.has(c.coluna))
    .map(c => c.coluna);

  const saida = [];
  let faixaAtual = '';
  for (let i = linhaCabecalho + 1; i < linhas.length; i++) {
    const celulas = linhas[i] || [];
    const preenchidas = [];
    celulas.forEach((c, idx) => { if (String(c == null ? '' : c).trim() !== '') preenchidas.push(idx); });
    if (!preenchidas.length) continue;
    if (preambulo.has(assinatura(celulas))) continue;

    /* Faixa: uma única célula preenchida, fora das colunas de dado — OU exatamente na
       coluna que foi mapeada como o campo da faixa. Quem importa costuma mapear a coluna
       do setor (os nomes estão lá!), e sem esta segunda condição a linha da faixa virava
       "continuação" da linha anterior: cada setor grudava no paciente de cima e o resto
       do grupo ficava sem setor. */
    if (definicao.faixa && preenchidas.length === 1
        && (preenchidas[0] === colunaFaixa || !colunasDados.has(preenchidas[0]))) {
      faixaAtual = String(celulas[preenchidas[0]]).trim().replace(/\s+/g, ' ');
      continue;
    }
    if (!preenchidas.some(idx => colunasDados.has(idx))) continue;  /* rodapé, numeração */

    /* Continuação: nenhum campo obrigatório preenchido, mas há dado nas outras colunas —
       é o rabicho de uma linha partida pela quebra de página. Volta para a linha anterior. */
    const temIdentidade = identidade.some(col => String(celulas[col] == null ? '' : celulas[col]).trim() !== '');
    if (definicao.paginado && identidade.length && !temIdentidade && saida.length) {
      const anterior = saida[saida.length - 1].celulas;
      preenchidas.forEach(idx => {
        if (String(anterior[idx] == null ? '' : anterior[idx]).trim() === '') anterior[idx] = celulas[idx];
      });
      continue;
    }
    saida.push({ celulas: celulas.slice(), faixa: faixaAtual, linha: i + 1 });
  }
  return saida;
}

function normalizarLinhas(linhas, linhaCabecalho, mapeamento, tipo, aliases) {
  const definicao = TIPOS_RELATORIO[tipo];
  const porCampo = {};
  const colunasAntibiograma = [], colunasAntibiogramaTexto = [];
  mapeamento.forEach(m => {
    if (m.destino === '@antibiograma') colunasAntibiograma.push(m);
    else if (m.destino === '@antibiograma_texto') colunasAntibiogramaTexto.push(m);
    else if (m.destino) porCampo[m.destino] = m.coluna;
  });
  const aliasDe = {};
  (aliases || []).forEach(a => { aliasDe[a.Campo + '|' + normalizarTexto(a.De)] = a.Para; });

  const colunasDados = new Set();
  Object.values(porCampo).forEach(c => colunasDados.add(c));
  colunasAntibiograma.concat(colunasAntibiogramaTexto).forEach(m => colunasDados.add(m.coluna));
  const definicaoComColunas = Object.assign({}, definicao, {
    campos: definicao.campos.map(c => Object.assign({}, c, { coluna: porCampo[c.id] }))
  });
  const colunaFaixa = definicao.faixa ? porCampo[definicao.faixa.campo] : undefined;
  const preparadas = prepararRelatorio(linhas, linhaCabecalho, definicaoComColunas, colunasDados, colunaFaixa);

  const registros = [];
  const problemas = [];
  for (const preparada of preparadas) {
    const linha = preparada.celulas;
    const i = preparada.linha - 1;
    const registro = { _linha: preparada.linha, _antibiograma: [] };
    let temDado = false;

    for (const campo of definicao.campos) {
      const coluna = porCampo[campo.id];
      let valor = coluna === undefined ? '' : linha[coluna];
      if (campo.tipo === 'data') {
        const bruto = valor;
        valor = normalizarData(valor);
        if (valor === null) {
          problemas.push({ linha: i + 1, campo: campo.id, valor: String(bruto), motivo: 'data não reconhecida' });
          valor = '';
        }
      } else if (campo.id === 'Prontuario') {
        valor = normalizarProntuario(valor);
      } else if (campo.tipo === 'hora') {
        /* Quando o campo de horário traz texto ("não foi adm atb", "MANTEVE"), o texto é
           guardado: diz por que não existe horário, e essa é a informação que explica o
           indicador de tempo até o antibiótico. */
        const bruto = String(valor == null ? '' : valor).trim();
        valor = horaDeFracao(valor);
        if (!valor && bruto) {
          registro._textosHora = registro._textosHora || {};
          registro._textosHora[campo.id] = bruto;
        }
      } else if (campo.tipo === 'simnao') {
        const resposta = respostaSimNao(valor);
        if (resposta.justificativa) {
          registro._justificativas = registro._justificativas || [];
          registro._justificativas.push(`${campo.rotulo}: ${resposta.justificativa}`);
        }
        valor = resposta.resposta;
      } else {
        valor = String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ');
      }
      if (campo.tipo === 'vocab' && valor) {
        const chave = campo.vocab + '|' + normalizarTexto(valor);
        if (aliasDe[chave]) {
          registro._originais = registro._originais || {};
          registro._originais[campo.id] = valor;
          valor = aliasDe[chave];
        }
      }
      if (valor) temDado = true;
      registro[campo.id] = valor;
    }

    /* O valor da faixa vale para o grupo inteiro, mas nunca sobrescreve o que a própria
       linha trouxe — se um dia o relatório passar a ter a coluna, ela manda. */
    if (definicao.faixa && preparada.faixa && !registro[definicao.faixa.campo]) {
      const campoFaixa = definicao.campos.find(c => c.id === definicao.faixa.campo);
      let valor = preparada.faixa;
      if (campoFaixa && campoFaixa.tipo === 'vocab') {
        const alias = aliasDe[campoFaixa.vocab + '|' + normalizarTexto(valor)];
        if (alias) {
          registro._originais = registro._originais || {};
          registro._originais[campoFaixa.id] = valor;
          valor = alias;
        }
      }
      registro[definicao.faixa.campo] = valor;
    }

    for (const colAtb of colunasAntibiograma) {
      const resultado = normalizarValorAntibiograma(linha[colAtb.coluna]);
      if (resultado === 'S' || resultado === 'R' || resultado === 'I') {
        let atb = colAtb.cabecalho;
        const chave = 'antibioticos|' + normalizarTexto(atb);
        if (aliasDe[chave]) atb = aliasDe[chave];
        registro._antibiograma.push({ Antibiotico: atb, Resultado: resultado });
      } else if (resultado === null && String(linha[colAtb.coluna]).trim() !== '') {
        problemas.push({ linha: i + 1, campo: colAtb.cabecalho, valor: String(linha[colAtb.coluna]), motivo: 'valor de antibiograma não reconhecido' });
      }
    }

    const textosOriginais = [];
    for (const colTexto of colunasAntibiogramaTexto) {
      const bruto = String(linha[colTexto.coluna] == null ? '' : linha[colTexto.coluna]).trim();
      if (bruto) textosOriginais.push(bruto);
      for (const item of extrairAntibiogramaTexto(bruto)) {
        let atb = item.Antibiotico;
        const chave = 'antibioticos|' + normalizarTexto(atb);
        if (aliasDe[chave]) atb = aliasDe[chave];
        registro._antibiograma.push({ Antibiotico: atb, Resultado: item.Resultado });
      }
    }

    /* O banco guarda o antibiograma nos dois formatos: linha a linha em `sensibilidade`
       e inteiro no campo `Antibiograma` — texto original quando veio num campo só,
       texto remontado quando veio numa coluna por antibiótico. */
    if (definicao.permiteAntibiograma) {
      registro.Antibiograma = textosOriginais.length
        ? textosOriginais.join(' | ')
        : textoAntibiograma(registro._antibiograma);
      if (registro.Antibiograma) temDado = true;
    }

    if (temDado) registros.push(registro);
  }

  /* Observações de higiene não têm identificador: duas linhas iguais no mesmo dia são duas
     oportunidades diferentes, não uma repetida. Numerar as iguais dentro do lote dá a cada
     uma identidade própria — a reimportação do mesmo arquivo case linha a linha, e o mês
     seguinte entra inteiro em vez de sumir na deduplicação. */
  if (definicao.numerarRepetidas) {
    const semOcorrencia = definicao.chaveNatural.filter(c => c !== 'Ocorrencia');
    const contador = new Map();
    for (const registro of registros) {
      const chave = semOcorrencia.map(c => normalizarTexto(registro[c])).join('|');
      const n = (contador.get(chave) || 0) + 1;
      contador.set(chave, n);
      registro.Ocorrencia = n;
    }
  }
  return { registros, problemas };
}

/* Remonta o antibiograma a partir de um campo de texto único. Aceita os dois jeitos
   que os laboratórios escrevem:
     "Amicacina: S; Gentamicina - Resistente; Meropenem R"     (um par por trecho)
     "Resistente: Amicacina, Cefepima | Sensível: Meropenem"   (um rótulo para uma lista) */
function extrairAntibiogramaTexto(texto) {
  const s = String(texto == null ? '' : texto).trim();
  if (!s) return [];
  const itens = [];
  const vistos = new Set();
  const acrescentar = (nome, resultado) => {
    nome = String(nome).replace(/^[\s\-–,;]+|[\s\-–,;.]+$/g, '').trim();
    if (!nome || !['S', 'R', 'I'].includes(resultado)) return;
    const chave = normalizarTexto(nome);
    if (!chave || vistos.has(chave)) return;
    vistos.add(chave);
    itens.push({ Antibiotico: nome, Resultado: resultado });
  };

  /* Divide primeiro nos separadores fortes; a vírgula só separa quando não há nenhum deles
     (senão "Piperacilina + Tazobactam" e afins continuariam inteiros, mas "A, B, C" não). */
  const separadorForte = /[;|\n]/.test(s) ? /[;|\n]+/ : null;
  for (const bloco of (separadorForte ? s.split(separadorForte) : [s])) {
    const t = bloco.trim();
    if (!t) continue;
    /* Rótulo aplicado a uma lista: "Resistente: A, B, C" */
    const comRotulo = /^(.+?)\s*[:=]\s*(.+)$/.exec(t);
    const rotulo = comRotulo ? normalizarValorAntibiograma(comRotulo[1]) : null;
    if (comRotulo && ['S', 'R', 'I'].includes(rotulo)) {
      comRotulo[2].split(',').forEach(nome => acrescentar(nome, rotulo));
      continue;
    }
    /* Senão, cada trecho separado por vírgula é um par antibiótico→resultado. */
    for (const parte of (separadorForte ? [t] : t.split(','))) {
      const p = parte.trim();
      if (!p) continue;
      const comSinal = /^(.+?)\s*[:=]\s*(.+)$/.exec(p);
      if (comSinal) {
        acrescentar(comSinal[1], normalizarValorAntibiograma(comSinal[2].trim().replace(/\.$/, '')));
        continue;
      }
      const m = /^(.+?)[\s\-–]+([A-Za-zÀ-ú]+)\.?$/.exec(p);
      if (m) acrescentar(m[1], normalizarValorAntibiograma(m[2]));
    }
  }
  return itens;
}

/* Escreve o antibiograma num campo de texto só, para o banco guardar os dois formatos.
   Ex.: [{Amicacina,S},{Cefepima,R}] → "Sensível: Amicacina | Resistente: Cefepima" */
const ROTULO_ANTIBIOGRAMA = { S: 'Sensível', I: 'Intermediário', R: 'Resistente' };
function textoAntibiograma(itens) {
  const grupos = { S: [], I: [], R: [] };
  (itens || []).forEach(i => { if (grupos[i.Resultado]) grupos[i.Resultado].push(i.Antibiotico); });
  return ['S', 'I', 'R']
    .filter(r => grupos[r].length)
    .map(r => ROTULO_ANTIBIOGRAMA[r] + ': ' + grupos[r].join(', '))
    .join(' | ');
}

/* Converte a classificação escrita no relatório de origem para a lista canônica do app.
   Devolve '' quando não reconhece (o valor original fica no campo, para revisão). */
function classificacaoCanonica(valor) {
  const n = normalizarTexto(valor);
  if (!n) return '';
  if (SINONIMOS_CLASSIFICACAO[n]) return SINONIMOS_CLASSIFICACAO[n];
  const exata = CLASSIFICACOES_CULTURA.find(c => normalizarTexto(c) === n);
  return exata || '';
}

/* ---- Triagem automática das culturas ----
   Boa parte do banco não precisa de julgamento clínico nenhum: cultura que não cresceu é
   negativa, swab de vigilância é colonização por definição (é para isso que se colhe), e
   água e leite nem são do paciente. Classificar isso na entrada tira ~3 de cada 4 linhas
   da fila de revisão e do painel, deixando à vista o que pode ser infecção. */

/* Materiais colhidos justamente para procurar portador — nasal, axilar, retal, inguinal,
   e o swab vaginal de rastreio de estreptococo do grupo B na gestante. */
const MATERIAIS_COLONIZACAO = /swab|vigilancia|rastreio|pesquisadesgb|streptococcusdogrupob/;
/* normalizarTexto tira acentos, pontuação E espaços — daí não haver \b nem espaço aqui:
   "Leite humano (controle)" chega como "leitehumanocontrole". */
const MATERIAIS_AGUA = /agua|dialisato|osmose|hemodialise/;
const MATERIAIS_LEITE = /leite|lactario/;
/* Testado contra normalizarTexto, que tira os espaços — as alternativas têm de vir sem eles. */
const RESULTADO_NEGATIVO = /^(negativ|semcrescimento|ausenciadecrescimento|naohouvecrescimento)/;

/* Devolve a classificação de triagem, ou '' quando a cultura precisa de olho humano.
   A ordem importa: água e leite valem mesmo quando cresce algo (um leite contaminado
   continua não sendo infecção de paciente), e negativa vale antes da colonização
   (swab que não cresceu é negativo, não portador). */
function preClassificarCultura(cultura) {
  const material = normalizarTexto(cultura.Material) + ' ' + normalizarTexto(cultura.Sitio);
  if (MATERIAIS_AGUA.test(material)) return 'Água';
  if (MATERIAIS_LEITE.test(material)) return 'Leite';
  const germe = String(cultura.Microrganismo || '').trim();
  const resultado = normalizarTexto(cultura.Resultado);
  if (!germe && (!resultado || RESULTADO_NEGATIVO.test(resultado))) return 'Negativa';
  if (!germe) return '';
  if (MATERIAIS_COLONIZACAO.test(material)) return 'Colonização';
  return '';
}

/* Uma cultura entra no painel e nos relatórios quando pode representar infecção: cresceu
   algo e a triagem não a mandou para o balde de negativas/vigilância/controle ambiental.
   As classificações de infecção dadas por gente (IRAS, admissão, contaminação…) sempre
   passam — só a triagem automática esconde. */
function culturaDoPainel(cultura) {
  if (cultura.StatusRevisao === 'descartada') return false;
  const classe = String(cultura.AvaliacaoCCIH || '').trim();
  if (cultura.StatusRevisao === 'triagem' || CLASSES_TRIAGEM.includes(classe)) return false;
  return !!String(cultura.Microrganismo || '').trim();
}

/* Índice prontuário → datas de abertura de protocolo de sepse. */
function indiceSepse(casos) {
  const indice = new Map();
  for (const caso of (casos || [])) {
    const data = Date.parse(String(caso.DataProtocolo || '').slice(0, 10) + 'T00:00:00Z');
    if (!isFinite(data)) continue;
    const chave = normalizarProntuario(caso.Prontuario);
    if (!chave) continue;
    if (!indice.has(chave)) indice.set(chave, []);
    indice.get(chave).push(data);
  }
  return indice;
}

/* Mesma janela padrão da aba Sepse (± 3 dias): a hemocultura do protocolo é colhida na
   abertura, e duas semanas depois já é outro episódio. Uma cultura de protocolo importa
   mesmo quando negativa — hemocultura negativa é resultado do protocolo, não ruído. */
const JANELA_CULTURA_SEPSE = 3;
function culturaDeProtocoloSepse(cultura, indice, janelaDias) {
  const dias = janelaDias === undefined ? JANELA_CULTURA_SEPSE : janelaDias;
  const datas = indice.get(normalizarProntuario(cultura.Prontuario));
  if (!datas || !datas.length) return false;
  const coleta = Date.parse(String(cultura.DataColeta || '').slice(0, 10) + 'T00:00:00Z');
  if (!isFinite(coleta)) return false;
  return datas.some(d => Math.abs(coleta - d) / 86400000 <= dias);
}

/* Valida registros. Retorna { erros, avisos, termosNovos }.
   termosNovos: { nomeVocab: [valores ainda não cadastrados] } */
function validar(registros, tipo, vocabulario) {
  const definicao = TIPOS_RELATORIO[tipo];
  const erros = [], avisos = [];
  const termosNovos = {};
  const vocabNormalizado = {};
  Object.keys(vocabulario || {}).forEach(v => {
    vocabNormalizado[v] = new Set((vocabulario[v] || []).map(normalizarTexto));
  });

  for (const registro of registros) {
    if (definicao.exigeUmDe && !definicao.exigeUmDe.some(id => String(registro[id] || '').trim())) {
      erros.push({ linha: registro._linha, campo: definicao.exigeUmDe.join('/'), motivo: 'preencha ao menos um: ' + definicao.exigeUmDe.join(' ou ') });
    }
    for (const campo of definicao.campos) {
      const valor = registro[campo.id];
      if (campo.obrigatorio && !valor) {
        erros.push({ linha: registro._linha, campo: campo.id, motivo: `${campo.rotulo} vazio` });
      }
      if (campo.tipo === 'vocab' && valor && !valor.startsWith('__')) {
        const conjunto = vocabNormalizado[campo.vocab];
        if (conjunto && !conjunto.has(normalizarTexto(valor))) {
          termosNovos[campo.vocab] = termosNovos[campo.vocab] || new Map();
          const n = normalizarTexto(valor);
          if (!termosNovos[campo.vocab].has(n)) termosNovos[campo.vocab].set(n, valor);
        }
      }
    }
    const antibioticosConhecidos = vocabNormalizado.antibioticos || new Set();
    for (const item of registro._antibiograma || []) {
      if (!antibioticosConhecidos.has(normalizarTexto(item.Antibiotico))) {
        termosNovos.antibioticos = termosNovos.antibioticos || new Map();
        const n = normalizarTexto(item.Antibiotico);
        if (!termosNovos.antibioticos.has(n)) termosNovos.antibioticos.set(n, item.Antibiotico);
      }
    }
  }
  const termosNovosLista = {};
  Object.keys(termosNovos).forEach(v => { termosNovosLista[v] = [...termosNovos[v].values()]; });
  return { erros, avisos, termosNovos: termosNovosLista };
}

/* Compilada uma vez por prefixo: chaveNaturalDe roda para cada uma das ~40 mil linhas. */
const _regexPrefixo = {};
function regexDePrefixo(prefixo) {
  return _regexPrefixo[prefixo] || (_regexPrefixo[prefixo] = new RegExp('^' + prefixo + '-\\d+$', 'i'));
}

function chaveNaturalDe(registro, tipo) {
  /* Quando o relatório traz o identificador do próprio sistema de origem (ex.: o nº do exame
     no laboratório), ele é a identidade da linha: dois exames do mesmo paciente, no mesmo dia
     e do mesmo material são exames diferentes, e a chave composta os fundiria num só. */
  const campoOrigem = TIPOS_RELATORIO[tipo].chaveOrigem;
  const origem = campoOrigem ? String(registro[campoOrigem] || '').trim() : '';
  /* Um "ID de origem" com a cara dos nossos próprios códigos (CUL-000123) não veio do
     laboratório: veio de uma exportação do próprio banco sendo reimportada. Usá-lo como
     identidade faria a linha nunca colidir com a que já existe — foi assim que um lote
     inteiro do laboratório entrou duas vezes. Nesse caso vale a chave composta. */
  const prefixo = TIPOS_RELATORIO[tipo].prefixoID;
  const ehNossoProprioID = prefixo && regexDePrefixo(prefixo).test(origem);
  if (origem && !ehNossoProprioID) {
    return campoOrigem + '=' + normalizarTexto(origem);
  }
  return TIPOS_RELATORIO[tipo].chaveNatural.map(campo => normalizarTexto(valorDeChave(registro, campo, tipo))).join('|');
}

/* A chave precisa comparar maçã com maçã. Um registro recém-lido do arquivo ainda tem o
   valor cru ("Precaução de Contato", "Adesão: Álcool"); a linha que já está no banco tem o
   valor derivado ("Contato", Acao/TipoHigienizacao). Sem normalizar os dois pelo mesmo
   caminho, reimportar o mesmo arquivo duplicaria tudo. */
function valorDeChave(registro, campo, tipo) {
  if (tipo === 'cirurgias' && campo === 'Procedimento' && registro.ProcedimentoNHSN) return registro.ProcedimentoNHSN;
  if (campo === 'Microrganismo' && registro[campo] === NAO_CULTURA) {
    return (registro._originais && registro._originais.Microrganismo) || registro[campo];
  }
  if (campo === 'Microrganismo') {
    /* O banco guarda o nome já reescrito ("Enterobactéria resistente aos carbapenêmicos"
       vira "Enterobactéria (não identificada)"). A chave precisa aplicar a mesma reescrita
       no registro recém-lido, senão o mesmo exame reimporta como novo para sempre. */
    const separado = separarMecanismoDoNome(registro[campo]);
    if (separado) return separado.nome;
  }
  if (tipo === 'isolamentos' && campo === 'TipoPrecaucao') return tipoPrecaucao(registro[campo]);
  if (tipo === 'higiene_maos' && (campo === 'Acao' || campo === 'TipoHigienizacao')) {
    if (registro[campo]) return registro[campo];
    const derivado = adesaoHigiene(registro.Adesao);
    return campo === 'Acao' ? derivado.acao : derivado.tipo;
  }
  return registro[campo];
}

/* Separa novos × duplicados comparando com os registros existentes no banco. */
function deduplicar(registros, existentes, tipo) {
  const chavesExistentes = new Set(existentes.map(r => chaveNaturalDe(r, tipo)));
  const vistas = new Set();
  const novos = [], duplicados = [], duplicadosInternos = [];
  for (const registro of registros) {
    const chave = chaveNaturalDe(registro, tipo);
    if (chavesExistentes.has(chave)) duplicados.push(registro);
    else if (vistas.has(chave)) duplicadosInternos.push(registro);
    else { vistas.add(chave); novos.push(registro); }
  }
  return { novos, duplicados, duplicadosInternos };
}

/* ---- Protocolo de sepse: normalização da ficha preenchida pelos enfermeiros ---- */

/* As respostas do bundle vêm como "sim", "NÃO", "NÃO, ATRASO NO ATB", "SIM, escalonado
   mero e vanco". A resposta é o começo; o resto é a justificativa, que é justamente o
   material das reuniões do protocolo — por isso volta separada, e não descartada. */
function respostaSimNao(valor) {
  const bruto = String(valor == null ? '' : valor).trim();
  if (!bruto) return { resposta: '', justificativa: '' };
  const m = /^(sim|s|não|nao|nâo|n)\b[\s,.:;/-]*(.*)$/i.exec(bruto.replace(/\s+/g, ' '));
  if (!m) return { resposta: '', justificativa: bruto };
  const inicial = normalizarTexto(m[1]);
  return {
    resposta: (inicial === 'sim' || inicial === 's') ? 'S' : 'N',
    justificativa: m[2].trim()
  };
}

/* Hora do dia guardada pelo Excel como fração (0,4152 = 09:58). */
function horaDeFracao(valor) {
  if (valor === '' || valor == null) return '';
  const n = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
  if (!isFinite(n) || n < 0 || n >= 1) {
    const texto = String(valor).trim();
    return /^\d{1,2}[:h]\d{2}/.test(texto) ? texto.replace('h', ':').padStart(5, '0') : '';
  }
  const minutos = Math.round(n * 24 * 60) % (24 * 60);
  return String(Math.floor(minutos / 60)).padStart(2, '0') + ':' + String(minutos % 60).padStart(2, '0');
}

/* Minutos entre dois horários "HH:MM". Etapa que cai na madrugada seguinte (o protocolo
   abre 23:40 e o antibiótico corre 00:20) daria negativo — nesse caso soma um dia. */
function minutosEntre(inicio, fim) {
  const emMinutos = h => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const a = emMinutos(inicio), b = emMinutos(fim);
  if (a === null || b === null) return '';
  let diferenca = b - a;
  if (diferenca < 0) diferenca += 24 * 60;
  /* Diferença acima de 12 h quase sempre é erro de digitação, não etapa demorada. */
  return diferenca > 12 * 60 ? '' : diferenca;
}

/* "SETOR 05", "Setor  8", "setor 8" → "Setor 5" / "Setor 8". */
function setorDeSepse(valor) {
  const bruto = String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ');
  const m = /^setor\s*0*(\d+)$/i.exec(bruto);
  return m ? 'Setor ' + m[1] : bruto;
}

const DESFECHOS_SEPSE = [
  [/obito|obto|falec/, 'Óbito'],
  [/transf/, 'Transferência'],
  [/uti|cti/, 'UTI'],
  [/alta/, 'Alta hospitalar'],
  [/intern|intrenad/, 'Internação']
];
function desfechoDeSepse(valor) {
  const n = normalizarTexto(valor);
  if (!n) return '';
  for (const [padrao, canonico] of DESFECHOS_SEPSE) {
    if (padrao.test(n)) return canonico;
  }
  return String(valor).trim();
}

const FOCOS_SEPSE = [
  [/pulmon|pulma|pumonar|pneumon|respirat|traqueo|pneumotorax/, 'Pulmonar'],
  [/abdom|entero|biliar|colecist/, 'Abdominal'],
  [/urinar|urolog|itu/, 'Urinário'],
  [/cutane|pele|partesmoles|celulite|erisipel|fasci|tegumentar|feridaoperatoria|infeccaodafo|infeccaodefo/, 'Cutâneo / partes moles'],
  [/hematolog|neutropen/, 'Hematológico'],
  [/pielonefrite/, 'Urinário'],
  [/corrente|bacteremia|hemocult/, 'Corrente sanguínea'],
  [/snc|meningit|nervoso/, 'Sistema nervoso central'],
  [/osteo|artrit|articular|osso|femur/, 'Osteoarticular'],
  [/cateter|cvc/, 'Cateter'],
  [/descartad|descrtad|naoconfirmad|semmudanca|semmudar|semcriterio|semcritério/, 'Sepse descartada'],
  [/semfoco|indetermin|ideterm|ideterteminad|naoidentific|semregistro|naoregistrad|naopreenchid|naoespecificad|naodetermin|semdesfecho/, 'Sem foco definido']
];
function focoDeSepse(valor) {
  const n = normalizarTexto(valor);
  if (!n) return '';
  for (const [padrao, canonico] of FOCOS_SEPSE) {
    if (padrao.test(n)) return canonico;
  }
  return String(valor).trim();
}

/* O campo do horário do antibiótico costuma trazer a conduta em vez da hora. Reduzir esse
   texto livre a poucas situações permite contar quantos protocolos sequer tiveram
   antibiótico novo — sem isso, o tempo até o antibiótico fica sem denominador honesto. */
const RAIZES_ANTIBIOTICO = /mero|vanco|cefepim|ceftriax|ceftazidim|piperacilin|tazo|amicacin|clindamicin|azitromicin|polimixin|linezolid|metronidazol|ampicilin|oxacilin|gentamicin|ciproflox|levoflox|fluconazol|tigeciclin|ertapenem|imipenem|sulfameto|colistin|daptomicin|teicoplanin|anfotericin|amoxicilin|cefazolin|aztreonam/;
function situacaoAntibiotico(texto) {
  const n = normalizarTexto(texto);
  if (!n) return '';
  if (/naofoiadm|naoadm|naoreceb|semprescricao|semadm|sematb|^nao$/.test(n)) return 'Não administrado';
  if (/mantev|mantid|manter|semmudanc|semalterac|naoescalon|jaestavaemuso|jaemuso/.test(n)) return 'Mantido o mesmo antibiótico';
  if (/escalon|trocad|modificad|ampliad/.test(n)) return 'Escalonado';
  /* Enfermeiro escreveu o nome do antibiótico no lugar da hora: houve antibiótico,
     só não dá para medir o tempo. */
  if (RAIZES_ANTIBIOTICO.test(n)) return 'Antibiótico registrado sem horário';
  return 'Outro registro';
}

/* Preenche o que dá para calcular a partir dos horários e junta as justificativas
   espalhadas pelas colunas do bundle numa só. */
function enriquecerSepse(linha, justificativas) {
  linha.MinutosReavaliacaoNEWS = minutosEntre(linha.HoraNEWS, linha.HoraNEWSEnf);
  linha.MinutosPrescricao = minutosEntre(linha.HoraNEWSEnf, linha.HoraPrescricaoEnf);
  linha.MinutosChegadaMedico = minutosEntre(linha.HoraNEWS, linha.HoraChegadaMedico);
  linha.MinutosAntibiotico = minutosEntre(linha.HoraNEWS, linha.HoraAntibiotico);
  const motivos = (justificativas || []).filter(Boolean);
  linha.MotivoNaoConformidade = [...new Set(motivos)].join(' · ');
  return linha;
}

/* Nomes que o laboratório usa quando não identificou a espécie mas quer sinalizar a
   resistência. O nome carrega duas informações; o banco guarda cada uma no seu campo,
   senão o mesmo germe aparece como microrganismos diferentes conforme o perfil e a
   contagem de multirresistentes fica muda. */
const MECANISMO_NO_NOME = {
  enterobacteriaresistenteaoscarbapenemicos: { nome: 'Enterobactéria (não identificada)', mecanismo: 'ERC' },
  bgnnfoxidasenegativaeresistenteaoscarbapenemicos: { nome: 'BGN-NF oxidase negativa', mecanismo: 'BGN-NF resistente aos carbapenêmicos' },
  bgnnfoxidasepositivaeresistenteaoscarbapenemicos: { nome: 'BGN-NF oxidase positiva', mecanismo: 'BGN-NF resistente aos carbapenêmicos' },
  bgnnfresistenteaoscarbapenemicos: { nome: 'BGN-NF: Bacilo Gram Negativo, Não Fermentador', mecanismo: 'BGN-NF resistente aos carbapenêmicos' }
};
function separarMecanismoDoNome(microrganismo) {
  return MECANISMO_NO_NOME[normalizarTexto(microrganismo)] || null;
}

/* ---- Higiene das mãos ----
   O Vigispec grava numa coluna só o que foi feito na oportunidade: "Álcool", "Sabonete" ou
   "Perdida". São duas informações espremidas em uma — se houve higienização (o numerador
   da adesão) e com quê (o insumo). Separar as duas é o que permite calcular adesão e, ao
   mesmo tempo, ver se o setor usa álcool ou pia. */
const ADESAO_HIGIENE = {
  alcool: { acao: 'Higienizou', tipo: 'Álcool' },
  preparacaoalcoolica: { acao: 'Higienizou', tipo: 'Álcool' },
  alcoolgel: { acao: 'Higienizou', tipo: 'Álcool' },
  gel: { acao: 'Higienizou', tipo: 'Álcool' },
  sabonete: { acao: 'Higienizou', tipo: 'Sabonete' },
  aguaesabao: { acao: 'Higienizou', tipo: 'Sabonete' },
  sabao: { acao: 'Higienizou', tipo: 'Sabonete' },
  higienizou: { acao: 'Higienizou', tipo: '' },
  sim: { acao: 'Higienizou', tipo: '' },
  perdida: { acao: 'Não higienizou', tipo: '' },
  oportunidadeperdida: { acao: 'Não higienizou', tipo: '' },
  naohigienizou: { acao: 'Não higienizou', tipo: '' },
  nao: { acao: 'Não higienizou', tipo: '' }
};
function adesaoHigiene(valor) {
  const n = normalizarTexto(valor);
  if (!n) return { acao: '', tipo: '' };
  if (ADESAO_HIGIENE[n]) return ADESAO_HIGIENE[n];
  /* Redação nova: mantém o texto como está em vez de inventar uma adesão que não se sabe. */
  return { acao: '', tipo: String(valor).trim() };
}

/* Os 5 momentos da OMS, na ordem. O miniapp grava o número (o observador toca "3" à beira
   do leito); o Vigispec grava a frase inteira. As duas formas viram a mesma frase aqui —
   senão o mesmo momento apareceria duas vezes no painel, uma como "3" e outra por extenso. */
const MOMENTOS_OMS = [
  'Antes do contato com paciente',
  'Antes de realizar procedimento',
  'Após risco de exposição a fluidos corporais',
  'Após contato com paciente',
  'Após contato com áreas próxima ao paciente'
];
const SINONIMOS_MOMENTO = {
  antesdetocaropaciente: MOMENTOS_OMS[0], antesdocontatocompaciente: MOMENTOS_OMS[0],
  antesdeprocedimentoasseptico: MOMENTOS_OMS[1], antesderealizarprocedimento: MOMENTOS_OMS[1],
  antesdeprocedimento: MOMENTOS_OMS[1],
  aposriscodeexposicaoafluidos: MOMENTOS_OMS[2], aposriscodeexposicaoafluidoscorporais: MOMENTOS_OMS[2],
  apostocaropaciente: MOMENTOS_OMS[3], aposcontatocompaciente: MOMENTOS_OMS[3],
  apostocarareasproximas: MOMENTOS_OMS[4], aposcontatocomareasproximaaopaciente: MOMENTOS_OMS[4],
  aposcontatocomareasproximasaopaciente: MOMENTOS_OMS[4]
};
function momentoCanonico(valor) {
  const bruto = String(valor == null ? '' : valor).trim();
  if (!bruto) return '';
  const numero = /^([1-5])\b/.exec(bruto);
  if (numero) return MOMENTOS_OMS[Number(numero[1]) - 1];
  const n = normalizarTexto(bruto);
  if (SINONIMOS_MOMENTO[n]) return SINONIMOS_MOMENTO[n];
  const exato = MOMENTOS_OMS.find(m => normalizarTexto(m) === n);
  return exato || bruto;
}

/* "Técnico de enfermagem" (miniapp) e "Técnico Enfermagem" (Vigispec) são a mesma gente. */
const SINONIMOS_CATEGORIA = {
  tecnicodeenfermagem: 'Técnico Enfermagem', tecnicoenfermagem: 'Técnico Enfermagem',
  tecnicoenf: 'Técnico Enfermagem', tecnico: 'Técnico Enfermagem',
  enfermeiro: 'Enfermeiro', enfermeira: 'Enfermeiro', enf: 'Enfermeiro',
  medico: 'Médico', medica: 'Médico', med: 'Médico',
  fisioterapeuta: 'Fisioterapeuta', fisio: 'Fisioterapeuta',
  equipemultidisciplinar: 'Equipe Multidisciplinar', multi: 'Equipe Multidisciplinar'
};
function categoriaProfissional(valor) {
  const bruto = String(valor == null ? '' : valor).trim();
  if (!bruto) return '';
  return SINONIMOS_CATEGORIA[normalizarTexto(bruto)] || bruto;
}

/* Põe uma observação de higiene na forma única do banco, venha de onde vier.

   O miniapp e o Vigispec usam os mesmos nomes de coluna para coisas diferentes: no miniapp
   `Acao` guarda o insumo ("Álcool", "Água e sabão") e `TipoHigienizacao` guarda a técnica
   ("Simples", "Cirúrgica"); no Vigispec `Adesão` guarda o insumo e não há técnica. Sem
   conciliar, as observações do celular entram no banco e somem do painel — contam como
   "não higienizou" e criam momentos chamados "1" e "3". */
const ACOES_CANONICAS = ['Higienizou', 'Não higienizou'];
function normalizarObservacaoHigiene(linha) {
  const saida = Object.assign({}, linha);
  const tipoCru = String(linha.TipoHigienizacao || '').trim();
  const ehTecnica = /^(simples|cirurgica)$/.test(normalizarTexto(tipoCru));
  if (ehTecnica) saida.Tecnica = tipoCru;

  if (ACOES_CANONICAS.includes(String(linha.Acao || '').trim())) {
    /* Linha que já está na forma do banco: só não deixar a técnica ocupar o lugar do
       insumo. Reprocessá-la pela adesão apagaria o "Álcool" que já estava certo. */
    saida.TipoHigienizacao = ehTecnica ? '' : tipoCru;
  } else {
    /* A adesão vem em `Adesao` (importação do Vigispec) ou em `Acao` (miniapp). */
    const bruto = String(linha.Adesao || '').trim() || String(linha.Acao || '').trim();
    const derivado = adesaoHigiene(bruto);
    saida.Acao = derivado.acao;
    saida.TipoHigienizacao = derivado.tipo || (ehTecnica ? '' : tipoCru);
  }
  saida.Momento = momentoCanonico(linha.Momento);
  saida.Categoria = categoriaProfissional(linha.Categoria);
  delete saida.Adesao;
  return saida;
}

/* ---- Isolamento ---- */
const PRECAUCOES = {
  contato: 'Contato', precaucaodecontato: 'Contato',
  goticulas: 'Gotículas', precaucaodegoticulas: 'Gotículas',
  aerossois: 'Aerossóis', precaucaodeaerossois: 'Aerossóis',
  respiratoria: 'Aerossóis', precaucaorespiratoria: 'Aerossóis',
  contatogoticulas: 'Contato + Gotículas', precaucaodecontatogoticulas: 'Contato + Gotículas',
  contatoaerossois: 'Contato + Aerossóis', precaucaodecontatoaerossois: 'Contato + Aerossóis',
  padrao: 'Padrão', precaucaopadrao: 'Padrão',
  protetora: 'Protetora', precaucaoprotetora: 'Protetora'
};
function tipoPrecaucao(valor) {
  const n = normalizarTexto(valor);
  if (!n) return '';
  return PRECAUCOES[n] || String(valor).trim().replace(/^Precau[çc][ãa]o\s+(de\s+)?/i, '');
}

/* Data em que o relatório foi tirado. Fica no enfeite acima do cabeçalho ("Impresso em:",
   "< < < 31/08/2026 11:36:52 > > >") — é a data da foto, e não a de nenhum paciente. */
function dataDoRelatorio(linhas, linhaCabecalho) {
  for (let i = 0; i <= linhaCabecalho && i < (linhas || []).length; i++) {
    for (const celula of (linhas[i] || [])) {
      const m = /(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/.exec(String(celula == null ? '' : celula));
      if (m) {
        const data = normalizarData(m[1]);
        if (data) return data;
      }
    }
  }
  return '';
}

/* O relatório de isolados é uma foto do momento, não um histórico: lista quem está isolado
   agora. Quem constava na foto anterior e não consta nesta teve a precaução suspensa — e
   essa data de saída é justamente o que permite contar dias de isolamento. Sem isso o banco
   só cresce e nada nunca termina.

   Só encerra precauções que começaram até a data da foto: uma foto antiga reimportada não
   pode desligar isolamento aberto depois dela. Devolve quantas foram encerradas. */
function encerrarIsolamentosAusentes(existentes, importados, dataFoto) {
  if (!dataFoto) return 0;
  /* Os dois lados passam pela mesma canonização: o arquivo traz "Precaução de Contato" e o
     banco guarda "Contato". Comparar cru faria nenhuma precaução casar — e a primeira
     importação encerraria todo mundo de uma vez. */
  const chaveDe = r => normalizarProntuario(r.Prontuario) + '|' + normalizarTexto(tipoPrecaucao(r.TipoPrecaucao));
  const presentes = new Set(importados.map(chaveDe));
  let encerradas = 0;
  for (const p of existentes) {
    /* Status vazio conta como ativo: as precauções registradas NO APP (revisão de
       pendências) nasciam sem Status e viravam "isoladas eternas" — a foto diária nunca
       as encerrava, a lista de ativos inchava com pacientes de alta e as pendências
       novas sumiam (todo MDR já "parecia isolado"). */
    if ((p.Status && p.Status !== 'ativo') || String(p.DataFim || '').trim()) continue;
    if (String(p.DataInicio || '').slice(0, 10) > dataFoto) continue;
    const chave = chaveDe(p);
    if (presentes.has(chave)) { p.VistoEm = dataFoto; continue; }
    p.DataFim = dataFoto;
    p.Status = 'encerrado';
    encerradas++;
  }
  return encerradas;
}

/* Precaução de quem saiu do hospital encerra sozinha: se o censo mostra ALTA na
   internação que cobria o início da precaução — ou ÓBITO em data igual/posterior — o
   isolamento acaba naquela data. Conservador de propósito: sem internação que case no
   censo, a precaução fica como está (censo atrasado não pode encerrar isolamento vivo);
   internação ainda aberta mantém tudo. */
function encerrarIsolamentosPorSaida(precaucoes, internacoes, indiceObitos, hoje) {
  const porPront = new Map();
  for (const i of (internacoes || [])) {
    const chave = normalizarProntuario(i.Prontuario);
    if (!porPront.has(chave)) porPront.set(chave, []);
    porPront.get(chave).push(i);
  }
  let encerradas = 0;
  const detalhes = [];
  for (const p of (precaucoes || [])) {
    if ((p.Status && p.Status !== 'ativo') || String(p.DataFim || '').trim()) continue;
    const chave = normalizarProntuario(p.Prontuario);
    const inicio = String(p.DataInicio || '').slice(0, 10);
    if (!/^\d{4}-/.test(inicio)) continue;

    let saida = '';
    let motivo = '';
    const dataObito = indiceObitos && indiceObitos.get(chave);
    if (dataObito && dataObito >= inicio) { saida = dataObito; motivo = 'óbito'; }
    if (!saida) {
      for (const i of (porPront.get(chave) || [])) {
        const entrada = String(i.DataInternacao || '').slice(0, 10);
        const alta = String(i.DataAlta || '').slice(0, 10);
        if (!/^\d{4}-/.test(entrada) || entrada > inicio) continue;
        if (!/^\d{4}-/.test(alta)) { saida = ''; motivo = ''; break; } /* internação aberta: fica */
        if (alta >= inicio && (!saida || alta < saida)) { saida = alta; motivo = 'alta'; }
      }
    }
    if (!saida || saida > String(hoje).slice(0, 10)) continue;
    p.DataFim = saida;
    p.Status = 'encerrado';
    encerradas++;
    detalhes.push({ Prontuario: p.Prontuario, quando: saida, motivo });
  }
  return { encerradas, detalhes };
}

/* ---- Catálogo da farmácia ----
   A farmácia cataloga apresentações ("CLORIDRATO DE VANCOMICINA 500MG FA"), não princípios
   ativos. Para o vocabulário do app — que é comparado com o antibiograma do laboratório e
   com a prescrição — interessa "Vancomicina". Tirar o sal, a dose e a forma farmacêutica é
   o que faz as três fontes falarem o mesmo nome. */
const SAIS_DE_MEDICAMENTO = /^(di)?(cloridrato|sulfato|fosfato|succinato|acetato|lactobionato|mesilato|dipropionato|besilato|maleato|nitrato|estearato|palmitato|etilsuccinato|isetionato|tartarato|citrato|dissodico)\s+(de\s+)?/i;
const FORMAS_FARMACEUTICAS = /\b(comp|comprimidos?|caps|capsulas?|fa|amp|ampolas?|fr|susp|suspensao|sol|solucao|cr|creme|pom|pomada|drg|drageas?|xpe|xarope|gts|gotas|inj|injetavel|rev|revestido|liof|po|granulado|sache|oft|colirio|topico|bolsa|seringa|tb|sodico|sodica|potassio|potassica|calcica|benzatina)\b/gi;

/* Associações e abreviações que a farmácia escreve à sua maneira. São testadas contra a
   descrição inteira, antes de qualquer recorte: "CLAV POTASSIO" precisa virar clavulanato, e
   a benzilpenicilina benzatina não pode virar a mesma coisa que a cristalina — são drogas com
   indicações diferentes, e o recorte mecânico apagaria justamente a palavra que as separa. */
const NOMES_DA_FARMACIA = [
  [/benzilpenicilinabenzatina/, 'Benzilpenicilina benzatina'],
  [/benzilpenicilinapotassica/, 'Benzilpenicilina cristalina'],
  [/amoxicilina.*clav/, 'Amoxicilina-clavulanato'],
  [/ceftazidima.*avibactam/, 'Ceftazidima-avibactam'],
  [/imipenem|cilastatina/, 'Imipenem-cilastatina'],
  [/piperacilina.*tazobactam/, 'Piperacilina-tazobactam'],
  [/ampicilina.*sulbactam/, 'Ampicilina-sulbactam'],
  [/sulfametoxazol.*trimetoprima/, 'Sulfametoxazol-trimetoprima'],
  [/colistimetato/, 'Colistina'],
  [/tenofovir.*lamivud/, 'Tenofovir-lamivudina'],
  [/rifam.*ison.*piraz.*etamb/, 'Rifampicina-isoniazida-pirazinamida-etambutol'],
  [/rifampic.*isoniazida/, 'Rifampicina-isoniazida'],
  [/anfotericinablipossomal/, 'Anfotericina B lipossomal'],
  [/sulfadiazinadeprata/, 'Sulfadiazina de prata'],
  [/benzoatodebenzila/, 'Benzoato de benzila'],
  [/bacitracina.*neomicina/, 'Bacitracina-neomicina']
];

function principioAtivo(descricao) {
  const bruto = String(descricao == null ? '' : descricao).trim();
  if (!bruto) return '';
  const normalizado = normalizarTexto(bruto);
  for (const [padrao, nome] of NOMES_DA_FARMACIA) {
    if (padrao.test(normalizado)) return nome;
  }
  /* Associações vêm com "+" no meio: cada parte tem seu nome e sua própria dose. */
  const partes = bruto.split('+').map(parte => {
    let t = parte.trim();
    /* Corta na primeira dose — daí para a frente é concentração e apresentação. */
    t = t.replace(/\s*\d[\d.,]*\s*(mg|mcg|g|ui|ml|%|milhoes|mi)\b.*$/i, '');
    t = t.replace(/\s*\d.*$/, '');
    t = t.replace(SAIS_DE_MEDICAMENTO, '');
    t = t.replace(FORMAS_FARMACEUTICAS, ' ');
    t = t.replace(/[^\wÀ-ÿ\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    return t;
  }).filter(Boolean);
  if (!partes.length) return '';
  return partes.join('-').toLowerCase()
    .replace(/(^|[\s-])([a-zà-ÿ])/g, (m, sep, letra) => sep + letra.toUpperCase());
}

/* ---- Óbitos ----
   O relatório de óbitos é o desfecho que falta às internações. Onde houver a internação
   correspondente (pelo nº de atendimento), ela recebe alta, desfecho e a marca de óbito.

   O que NÃO faz: criar internação para o óbito sem par. Seria inventar pacientes-dia — e um
   período em que o banco só tivesse internações de quem morreu daria letalidade de 100% e
   densidades de infecção absurdas. Esses óbitos ficam na aba própria, servindo de desfecho
   para quem os consultar pelo paciente. */
function aplicarObitos(internacoes, obitos) {
  const porAtendimento = new Map();
  for (const i of (internacoes || [])) {
    const chave = normalizarProntuario(i.Atendimento);
    if (chave) porAtendimento.set(chave, i);
  }
  let atualizadas = 0, semInternacao = 0, jaMarcadas = 0;
  for (const o of (obitos || [])) {
    const internacao = porAtendimento.get(normalizarProntuario(o.Atendimento));
    if (!internacao) { semInternacao++; continue; }
    const data = String(o.DataObito || '').slice(0, 10);
    if (internacao.Obito === 'S' && String(internacao.DataAlta || '').slice(0, 10) === data) { jaMarcadas++; continue; }
    internacao.DataAlta = data;
    internacao.Obito = 'S';
    internacao.Desfecho = 'Óbito';
    atualizadas++;
  }
  return { atualizadas, semInternacao, jaMarcadas };
}

/* ---- Vigilância pós-alta de cirurgias ----
   Quem entra na busca ativa por infecção de sítio cirúrgico depois da alta: cirurgias
   limpas, cesarianas e qualquer procedimento com prótese/implante (nestes a vigilância
   vale até 90 dias, não 30). O relatório do centro cirúrgico HOJE não traz o potencial de
   contaminação — quando passar a trazer, a regra da cirurgia limpa liga sozinha. */
const JANELA_VIGILANCIA = { inicioDias: 30, fimDias: 120, implanteDias: 90 };
const PROCEDIMENTO_COM_IMPLANTE = /protese|artroplastia|implante|marcapasso|osteossintese|osteosintese|\btela\b|valvar/;
const PROCEDIMENTO_CESARIANA = /cesariana|cesarea|cesaria/;

/* Categorias que uma cirurgia pode ter para fins de vigilância pós-alta, e quais delas
   entram pré-marcadas por padrão de fábrica. Cada instituição escolhe as suas nas
   Configurações; lista vazia = padrão. A prioridade importa: prótese ganha de tudo (a
   vigilância dela é mais longa), cesariana ganha do potencial de contaminação (é
   potencialmente contaminada por natureza, mas vigiada por ser cesariana). */
const CATEGORIAS_VIGILANCIA = [
  ['implante', 'Cirurgias com prótese/implante'],
  ['cesariana', 'Cesarianas'],
  ['limpa', 'Cirurgias limpas'],
  ['potencialmente_contaminada', 'Cirurgias potencialmente contaminadas'],
  ['contaminada', 'Cirurgias contaminadas'],
  ['infectada', 'Cirurgias infectadas'],
  ['sem_classificacao', 'Sem classificação de contaminação']
];
const CATEGORIAS_VIGILANCIA_PADRAO = ['implante', 'cesariana', 'limpa'];
const ROTULO_CATEGORIA_VIGILANCIA = Object.fromEntries(CATEGORIAS_VIGILANCIA);

function categoriaDeVigilancia(cirurgia) {
  if (pareceNaoCirurgia(cirurgia.Procedimento) || pareceNaoCirurgia(cirurgia.ProcedimentoNHSN)) {
    return 'nao_cirurgico';
  }
  const texto = normalizarTexto(cirurgia.Procedimento) + ' ' + normalizarTexto(cirurgia.ProcedimentoNHSN);
  if (PROCEDIMENTO_COM_IMPLANTE.test(texto)) return 'implante';
  if (PROCEDIMENTO_CESARIANA.test(texto)) return 'cesariana';
  const potencial = normalizarTexto(cirurgia.PotencialContaminacao);
  if (potencial === 'limpa') return 'limpa';
  if (potencial.includes('potencialmente')) return 'potencialmente_contaminada';
  if (/infectada|suja/.test(potencial)) return 'infectada';
  if (potencial.includes('contaminada')) return 'contaminada';
  return 'sem_classificacao';
}

function classificarParaVigilancia(cirurgia, categoriasVigiadas) {
  const vigiadas = (categoriasVigiadas && categoriasVigiadas.length)
    ? categoriasVigiadas : CATEGORIAS_VIGILANCIA_PADRAO;
  const categoria = categoriaDeVigilancia(cirurgia);
  if (categoria === 'nao_cirurgico') {
    return { marcar: false, motivo: 'não cirúrgico', implante: false, categoria };
  }
  return {
    marcar: vigiadas.includes(categoria),
    motivo: (ROTULO_CATEGORIA_VIGILANCIA[categoria] || categoria).toLowerCase(),
    implante: categoria === 'implante',
    categoria
  };
}

function diasDesde(dataISO, hojeISO) {
  const a = Date.parse(String(dataISO).slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(String(hojeISO).slice(0, 10) + 'T00:00:00Z');
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/* Telefone brasileiro para o wa.me: só dígitos, com o 55 na frente.
   Devolve '' quando o número não tem cara de celular/fixo válido. */
function telefoneWhatsApp(telefone) {
  let d = String(telefone == null ? '' : telefone).replace(/\D/g, '');
  d = d.replace(/^0+/, '');
  if (d.length === 12 || d.length === 13) { if (d.startsWith('55')) return d; return ''; }
  if (d.length === 10 || d.length === 11) return '55' + d;
  return '';
}

/* Preenche {nome}, {procedimento}, {data}… no modelo. Chave desconhecida fica como está,
   visível — melhor um "{campoerrado}" aparente do que texto sumindo em silêncio. */
function mensagemVigilancia(modelo, dados) {
  return String(modelo == null ? '' : modelo).replace(/\{(\w+)\}/g,
    (m, chave) => (dados && dados[chave] != null && dados[chave] !== '') ? String(dados[chave]) : m);
}

function linkWhatsApp(telefone, texto) {
  const tel = telefoneWhatsApp(telefone);
  if (!tel) return '';
  return 'https://wa.me/' + tel + (texto ? '?text=' + encodeURIComponent(texto) : '');
}

/* ---- Antibióticos: cursos, doses e alertas ----

   O extrato do hospital traz JANELAS DE PRESCRIÇÃO renovadas a cada 1-3 dias (toda linha
   tem DataFim). A unidade clínica é o CURSO: as janelas contíguas do mesmo paciente com o
   mesmo antibiótico, fundidas. É o curso que se avalia, é a duração do curso que dispara
   alerta — avaliar linha a linha pediria a mesma avaliação de novo a cada renovação. */

function prescricaoAtiva(prescricao, hojeISO) {
  const fim = String(prescricao.DataFim || '').slice(0, 10);
  if (!fim) return true;
  return fim >= hojeISO;
}

/* "74 mg 8/8h IV" → {quantidade, unidade, vezesDia, mgDia, via}. mgDia só quando a unidade
   é massa — "1 fa 8/8h" depende da apresentação do frasco e fica sem dose diária. */
function analisarDose(texto) {
  const bruto = String(texto == null ? '' : texto).trim();
  if (!bruto) return null;
  const m = /^([\d.,]+)\s*(mg|g|mcg|ui|fa|amp|com|cp|ml|gts)\b/i.exec(bruto);
  if (!m) return null;
  const quantidade = Number(m[1].replace('.', '').replace(',', '.'));
  const unidade = m[2].toLowerCase();
  let vezesDia = null;
  const intervalo = /(\d{1,2})\s*\/\s*\d{1,2}\s*h/i.exec(bruto);
  const aoDia = /(\d)\s*x\s*(ao dia|dia)/i.exec(bruto);
  if (intervalo) vezesDia = Math.round(24 / Number(intervalo[1]));
  else if (aoDia) vezesDia = Number(aoDia[1]);
  const via = (/\b(iv|ev|vo|im|sne|sc|inal)\b/i.exec(bruto) || [])[1];
  let mgDose = null;
  if (unidade === 'mg') mgDose = quantidade;
  else if (unidade === 'g') mgDose = quantidade * 1000;
  else if (unidade === 'mcg') mgDose = quantidade / 1000;
  return {
    quantidade, unidade, vezesDia,
    mgDia: (mgDose != null && vezesDia) ? Math.round(mgDose * vezesDia) : null,
    via: via ? via.toUpperCase() : ''
  };
}

/* Funde as janelas de prescrição em cursos por paciente+antibiótico.
   Emenda com folga de 1 dia: renovação de segunda para a janela que acabou domingo é o
   mesmo curso. Devolve [{Prontuario, Antibiotico, Setor, inicio, fim, dias, ultima, ids}]. */
function cursosDeAntibiotico(prescricoes) {
  const porChave = new Map();
  for (const p of (prescricoes || [])) {
    if (!p.Antibiotico || !/^\d{4}-/.test(String(p.DataInicio))) continue;
    const chave = normalizarProntuario(p.Prontuario) + '|' + normalizarTexto(p.Antibiotico);
    if (!porChave.has(chave)) porChave.set(chave, []);
    porChave.get(chave).push(p);
  }
  const cursos = [];
  for (const lista of porChave.values()) {
    lista.sort((a, b) => String(a.DataInicio).localeCompare(String(b.DataInicio)));
    let atual = null;
    for (const p of lista) {
      const inicio = String(p.DataInicio).slice(0, 10);
      const fim = String(p.DataFim || p.DataInicio).slice(0, 10);
      const emenda = atual && diasDesde(atual.fim, inicio) !== null && diasDesde(atual.fim, inicio) <= 1;
      if (emenda) {
        if (fim > atual.fim) atual.fim = fim;
        atual.ultima = p;
        atual.ids.push(p.ID_Prescricao);
      } else {
        atual = { Prontuario: p.Prontuario, Antibiotico: p.Antibiotico, Setor: p.Setor,
          inicio, fim, ultima: p, ids: [p.ID_Prescricao] };
        cursos.push(atual);
      }
    }
  }
  for (const c of cursos) c.dias = (diasDesde(c.inicio, c.fim) || 0) + 1;
  return cursos;
}

/* Tetos de dose DIÁRIA em mg para ADULTOS — deliberadamente conservadores: só drogas em
   que passar do teto é quase sempre erro de prescrição, não esquema agressivo legítimo.
   Setor neonatal/pediátrico fica FORA do alerta de dose (dose por peso, teto não vale). */
const TETO_DOSE_DIARIA_MG = {
  vancomicina: 4000, meropenem: 6000, cefepima: 6000, ceftriaxona: 4000,
  piperacilinatazobactam: 18000, metronidazol: 4000, clindamicina: 4800,
  linezolida: 1200, ciprofloxacino: 1200, amicacina: 1500
};
const SETOR_PEDIATRICO = /neonatal|pediatr|bercario/;

/* Alertas de antimicrobianos em uso: resistência do germe ao que está correndo, curso
   prolongado e dose acima do teto. Devolve [{tipo, curso, detalhe}] ordenado por gravidade. */
const DIAS_CURSO_PROLONGADO = 10;
function alertasDeAntibioticos(bancos, hojeISO) {
  const cursos = cursosDeAntibiotico((bancos.antibioticos || {}).prescricoes || [])
    .filter(c => String(c.fim) >= hojeISO);
  const sensPorCultura = new Map();
  for (const s of ((bancos.culturas || {}).sensibilidade || [])) {
    if (!sensPorCultura.has(s.ID_Cultura)) sensPorCultura.set(s.ID_Cultura, []);
    sensPorCultura.get(s.ID_Cultura).push(s);
  }
  const culturasPorPaciente = new Map();
  for (const c of ((bancos.culturas || {}).culturas || [])) {
    if (c.StatusRevisao === 'descartada' || !c.Microrganismo) continue;
    const dias = diasDesde(c.DataColeta, hojeISO);
    if (dias === null || dias > 30 || dias < 0) continue;
    const chave = normalizarProntuario(c.Prontuario);
    if (!culturasPorPaciente.has(chave)) culturasPorPaciente.set(chave, []);
    culturasPorPaciente.get(chave).push(c);
  }
  const alertas = [];
  for (const curso of cursos) {
    const atbNorm = normalizarTexto(curso.Antibiotico);
    for (const cultura of (culturasPorPaciente.get(normalizarProntuario(curso.Prontuario)) || [])) {
      const resistente = (sensPorCultura.get(cultura.ID_Cultura) || [])
        .some(s => s.Resultado === 'R' && normalizarTexto(s.Antibiotico) === atbNorm);
      if (resistente) {
        alertas.push({ tipo: 'resistencia', curso,
          detalhe: `${cultura.Microrganismo} resistente a ${curso.Antibiotico} (${cultura.Material || 'cultura'} de ${String(cultura.DataColeta).slice(0, 10)})` });
        break;
      }
    }
    if (curso.dias >= DIAS_CURSO_PROLONGADO) {
      alertas.push({ tipo: 'duracao', curso, detalhe: `${curso.dias} dias de ${curso.Antibiotico} sem interrupção` });
    }
    if (!SETOR_PEDIATRICO.test(normalizarTexto(curso.Setor))) {
      const teto = TETO_DOSE_DIARIA_MG[atbNorm];
      const dose = analisarDose(curso.ultima.Dose);
      if (teto && dose && dose.mgDia && dose.mgDia > teto) {
        alertas.push({ tipo: 'dose', curso,
          detalhe: `${curso.Antibiotico} ${(dose.mgDia / 1000).toFixed(1)} g/dia (teto usual ${(teto / 1000).toFixed(1)} g) — conferir` });
      }
    }
  }
  const peso = { resistencia: 0, dose: 1, duracao: 2 };
  return alertas.sort((a, b) => peso[a.tipo] - peso[b.tipo]);
}

/* Liga uma avaliação feita na visita (paciente+antibiótico+data) à prescrição do extrato:
   preferindo a janela que cobre a data da visita; sem cobertura, a mais recente da mesma
   droga (a visita de hoje avalia a prescrição que está correndo, mesmo que a janela vire
   amanhã). Devolve o ID_Prescricao ou '' quando o paciente não tem a droga no extrato. */
function vincularAvaliacaoAPrescricao(avaliacao, prescricoes) {
  const alvoPaciente = normalizarProntuario(avaliacao.Prontuario);
  const alvoAtb = normalizarTexto(avaliacao.Antibiotico);
  const data = String(avaliacao.Data || avaliacao.DataDados || '').slice(0, 10);
  let maisRecente = null;
  for (const p of (prescricoes || [])) {
    if (normalizarProntuario(p.Prontuario) !== alvoPaciente) continue;
    if (normalizarTexto(p.Antibiotico) !== alvoAtb) continue;
    const inicio = String(p.DataInicio || '').slice(0, 10);
    const fim = String(p.DataFim || '9999-12-31').slice(0, 10);
    if (data && inicio <= data && data <= fim) return p.ID_Prescricao;
    if (!maisRecente || String(p.DataInicio) > String(maisRecente.DataInicio)) maisRecente = p;
  }
  return maisRecente ? maisRecente.ID_Prescricao : '';
}

/* Monta a linha que vai para o banco a partir de um registro já normalizado.
   Usado tanto pelo assistente passo a passo quanto pela importação em lote. */
function montarLinhaImportada(registro, tipo, id, usuario, agora, tempoCorte) {
  const definicao = TIPOS_RELATORIO[tipo];
  const linha = { [definicao.campoID]: id, CriadoPor: usuario, CriadoEm: agora, ...definicao.fixos };
  for (const campo of definicao.campos) {
    if (!campo.paraPacientes) linha[campo.id] = registro[campo.id];
  }
  if (tipo === 'cirurgias') {
    linha.ProcedimentoNHSN = registro.Procedimento;
    linha.Procedimento = (registro._originais && registro._originais.Procedimento) || registro.Procedimento;
    enriquecerCirurgia(linha, tempoCorte);
  } else if (tipo === 'iras') {
    linha.DispositivoAssociado = normalizarDispositivo(registro.DispositivoAssociado);
  } else if (tipo === 'dispositivos') {
    linha.Categoria = categoriaDispositivo(registro.Dispositivo);
  } else if (tipo === 'internacoes') {
    linha.Obito = /obito/.test(normalizarTexto(registro.Desfecho)) ? 'S' : 'N';
  } else if (tipo === 'higiene_maos') {
    Object.assign(linha, normalizarObservacaoHigiene(linha));
    /* Object.assign copia, mas não apaga: a coluna crua da adesão precisa sair à mão. */
    delete linha.Adesao;
    linha.Ocorrencia = registro.Ocorrencia || 1;
  } else if (tipo === 'antimicrobianos') {
    linha.Nome = principioAtivo(registro.Apresentacao);
  } else if (tipo === 'isolamentos') {
    linha.TipoPrecaucao = tipoPrecaucao(registro.TipoPrecaucao);
    linha.VistoEm = registro._vistoEm || String(registro.DataInicio || '').slice(0, 10);
  } else if (tipo === 'sepse') {
    linha.Setor = setorDeSepse(registro.Setor);
    linha.Desfecho = desfechoDeSepse(registro.Desfecho);
    linha.FocoInfeccioso = focoDeSepse(registro.FocoInfeccioso);
    linha.ClassificacaoNEWS = /^\d{1,2}$/.test(String(registro.ClassificacaoNEWS || '').trim())
      ? String(registro.ClassificacaoNEWS).trim() : '';
    linha.SituacaoAntibiotico = situacaoAntibiotico((registro._textosHora || {}).HoraAntibiotico);
    const nota = String(registro.MotivoExclusao || '').trim();
    linha.ExcluidoIndicadores = /retirad|tirar do indicador/i.test(nota) ? 'S' : 'N';
    enriquecerSepse(linha, registro._justificativas);
  } else if (tipo === 'culturas') {
    linha.Antibiograma = registro.Antibiograma || '';
    const classificacao = classificacaoCanonica(registro.AvaliacaoCCIH);
    /* Relatório que já vem classificado pela CCIH entra revisado — não faz sentido
       pedir de novo uma revisão que o serviço já fez. */
    if (classificacao) {
      linha.AvaliacaoCCIH = classificacao;
      linha.StatusRevisao = classificacao === 'Não é cultura' ? 'descartada' : 'avaliada';
    } else {
      /* Sem classificação no relatório, a triagem tenta resolver sozinha. O status fica
         'triagem' (e não 'avaliada') para que se saiba que foi o app, não a CCIH — quem
         revisa continua podendo reclassificar, e a regra pode ser reaplicada sem apagar
         julgamento humano. */
      const triagem = preClassificarCultura(linha);
      linha.AvaliacaoCCIH = triagem;
      linha.StatusRevisao = triagem ? 'triagem' : 'pendente';
    }
    const separado = separarMecanismoDoNome(linha.Microrganismo);
    if (separado) {
      linha.Microrganismo = separado.nome;
      if (!linha.MecanismoResistencia) linha.MecanismoResistencia = separado.mecanismo;
    }
    if (registro.Microrganismo === NAO_CULTURA) {
      linha.Microrganismo = (registro._originais && registro._originais.Microrganismo) || '';
      linha.StatusRevisao = 'descartada';
      linha.AvaliacaoCCIH = 'Não é cultura';
    }
  }
  return linha;
}

function proximoID(existentes, campoID, prefixo) {
  let maior = 0;
  for (const r of existentes) {
    const m = new RegExp('^' + prefixo + '-(\\d+)$').exec(String(r[campoID] || ''));
    if (m) maior = Math.max(maior, Number(m[1]));
  }
  let contador = maior;
  return () => `${prefixo}-${String(++contador).padStart(6, '0')}`;
}

/* Converte o texto do relatório de culturas do laboratório (PDF "Relatório de
   estatística de resultado") numa tabela bruta no formato do importador.
   Sem prontuário no relatório: gera identificador estável nascimento+iniciais. */
function analisarPDFCulturas(linhasTexto) {
  if (!linhasTexto.some(l => /^O\.S\.:/.test(l.trim()))) return null;
  const CABECALHO = ['Prontuario', 'Nome do Paciente', 'Data Coleta', 'Setor', 'Material', 'Resultado', 'Microorganismo', 'Mecanismo', 'Telefone', 'Antibiograma'];
  const saida = [CABECALHO];
  let paciente = null, cultura = null, emAntibiograma = false, emResultado = false;

  /* Identificação do paciente: usa o número do prontuário/atendimento quando o laudo
     traz (o laboratório passou a informar a partir de setembro/2026) e só cai no registro
     provisório nascimento+iniciais quando não vem — nos laudos antigos e nos que
     escaparem. Assim os dois formatos convivem sem trocar o leitor. */
  const identificacaoDoPaciente = p => {
    if (String(p.registro || '').trim()) return String(p.registro).trim();
    const iniciais = String(p.nome || '').trim().split(/\s+/).map(t => t[0] || '').join('').toUpperCase();
    return (p.nasc || '').replace(/\D/g, '') + (iniciais ? '-' + iniciais : '');
  };
  const ROTULO_REGISTRO = /(?:prontu[aá]rio|atendimento|interna[cç][aã]o|registro do paciente|matr[ií]cula)\s*(?:n[º°.]?)?\s*[:\-]?\s*(\d{3,})/i;
  const fecharCultura = () => {
    if (!paciente || !cultura) { cultura = null; return; }
    const resultado = cultura.resultado.replace(/\s+/g, ' ').trim();
    let micro = '', mecanismo = '', classe = 'negativa';
    const m = /~([^~]+)~/.exec(resultado);
    if (m) { micro = m[1].trim(); classe = 'positiva'; }
    else if (/resistentes? aos? carbapen/i.test(resultado) && !/^n[aã]o houve/i.test(resultado)) {
      classe = 'positiva';
      mecanismo = 'Resistente a carbapenêmicos';
      micro = (resultado.split(/resistentes? aos?/i)[0] || '').trim() || 'Bacilo Gram negativo';
    } else if (/houve crescimento de /i.test(resultado) && !/^n[aã]o houve/i.test(resultado)) {
      classe = 'positiva';
      micro = (/houve crescimento de (.+?)(?: na amostra| resistente|\.|$)/i.exec(resultado) || [])[1] || resultado;
      if (/\bMRSA\b/i.test(micro)) { micro = 'Staphylococcus aureus'; mecanismo = 'MRSA'; }
      if (/\bVRE\b/i.test(micro)) { micro = micro.replace(/\s*\(?VRE\)?/i, '').trim() || 'Enterococcus spp'; mecanismo = 'VRE'; }
    } else if (!/^n[aã]o houve/i.test(resultado) && resultado) {
      classe = 'positiva'; micro = resultado.replace(/\.$/, '');
    }
    saida.push([identificacaoDoPaciente(paciente), paciente.nome, cultura.dataColeta, paciente.setor,
      cultura.material, classe, micro, mecanismo, paciente.telefone,
      cultura.antibiograma.map(a => a.nome + ': ' + a.res).join('; ')]);
    cultura = null;
  };

  for (const bruta of linhasTexto) {
    const linha = String(bruta).replace(/\u00a0/g, ' ').trimEnd();
    const t = linha.trim();
    if (!t || /^Relatório de estatística|^Período:|^Idade: 0 à|^Sexo: Masculino \/ Feminino|^Limite:|^Parâmetro\b|^Todos os parâmetros|^Uni\. Coleta|^Emitido em/.test(t)) continue;

    let m = /^O\.S\.:\s*\S+\s+Data:.*?Paciente:\s*(.+)$/.exec(t);
    if (m) {
      fecharCultura();
      paciente = { nome: m[1].trim(), nasc: '', setor: '', telefone: '', registro: '' };
      const registroNaLinha = ROTULO_REGISTRO.exec(t);
      if (registroNaLinha) paciente.registro = registroNaLinha[1];
      emAntibiograma = emResultado = false;
      continue;
    }
    if (!paciente) continue;
    if (!paciente.registro) {
      const registroNaLinha = ROTULO_REGISTRO.exec(t);
      if (registroNaLinha) paciente.registro = registroNaLinha[1];
    }
    m = /Data nasc\.:\s*(\d{2}\/\d{2}\/\d{4})/.exec(t);
    if (m) {
      paciente.nasc = m[1];
      const u = /Unidade coleta:\s*(.+)$/.exec(t);
      if (u) paciente.setor = u[1].trim();
      continue;
    }
    m = /^Telefone:\s*([^A-Z]*?)(?:Endereco|$)/.exec(t);
    if (m) { paciente.telefone = m[1].trim(); continue; }
    if (/^Procedimento:/.test(t)) {
      fecharCultura();
      cultura = { material: '', dataColeta: '', resultado: '', antibiograma: [] };
      emAntibiograma = emResultado = false;
      continue;
    }
    if (!cultura) continue;
    m = /^Material:\s+(.+?)\s{2,}Data coleta:\s*(\d{2}\/\d{2}\/\d{4})/.exec(t);
    if (m) { cultura.material = m[1].trim(); cultura.dataColeta = m[2]; continue; }
    m = /^Grupo:.*?Resultado:\s*(.*)$/.exec(t);
    if (m) { cultura.resultado = m[1]; emResultado = true; emAntibiograma = false; continue; }
    if (/^Antimicrobiano\b/.test(t)) { emAntibiograma = true; emResultado = false; continue; }
    if (emAntibiograma) {
      m = /^(.+?)\s{2,}(Sensível|Sensivel|Resistente|Intermediári\w*|Intermediario)\b/.exec(t);
      if (m) {
        cultura.antibiograma.push({ nome: m[1].replace(/\s*\?\s*/g, '-').trim(), res: m[2] });
        continue;
      }
      emAntibiograma = false;
    }
    if (emResultado && /^[a-zà-ú~]/i.test(t) && !/^(Status|Fonte|Endereco|Sexo|Telefone):/i.test(t)) {
      cultura.resultado += ' ' + t;
      continue;
    }
    emResultado = false;
  }
  fecharCultura();
  return saida.length > 1 ? saida : null;
}

/* Converte o relatório hierárquico de dispositivos invasivos (linha do paciente
   seguida das linhas de dispositivos, datas sem ano) numa tabela plana. */
function analisarInvasivos(linhas) {
  if (!linhas.length || !/dispositivos por per/i.test(String((linhas[0] || [])[0] || ''))) return null;
  let anoFim = null, mesFim = null;
  for (const l of linhas.slice(0, 6)) {
    const m = /To:\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(l.join(' '));
    if (m) { mesFim = Number(m[2]); anoFim = Number(m[3]); }
  }
  const anoDe = mes => (anoFim === null ? '' : (mes > mesFim ? anoFim - 1 : anoFim));
  const dataCompleta = v => {
    const m = /^(\d{2})\/(\d{2})(?:\s+(\d{1,2}:\d{2}))?/.exec(String(v || '').trim());
    if (!m) return '';
    return `${m[1]}/${m[2]}/${anoDe(Number(m[2]))}`;
  };
  const saida = [['Nome', 'Dispositivo', 'Data Instalacao', 'Data Retirada', 'Status']];
  let paciente = '';
  for (const linha of linhas) {
    const nome = String(linha[1] || '').trim();
    const dispositivo = String(linha[2] || '').trim();
    const instalacao = String(linha[5] || '').trim();
    if (nome && !dispositivo && !/^paciente$/i.test(nome)) { paciente = nome; continue; }
    if (dispositivo && /\d{2}\/\d{2}/.test(instalacao) && paciente) {
      saida.push([paciente, dispositivo, dataCompleta(instalacao), dataCompleta(linha[8]), String(linha[10] || '').trim()]);
    }
  }
  return saida.length > 1 ? saida : null;
}

function categoriaDispositivo(nome) {
  const n = normalizarTexto(nome);
  if (n.includes('venosocentral') || n.includes('insercaoperiferica') || n.includes('umbilical')) return 'CVC';
  if (n.includes('ventilacao')) return 'VM';
  if (n.includes('vesical')) return 'SVD';
  if (n.includes('venosoperiferico')) return 'CVP';
  if (n.includes('arterial')) return 'PAI';
  if (n.includes('nasoenteral') || n.includes('nasogastrica')) return 'SNE';
  return 'Outro';
}

/* Aplica o relatório de altas sobre as internações existentes (elo: nº do atendimento). */
function aplicarAltas(internacoes, registros) {
  const porAtendimento = new Map();
  for (const i of internacoes) {
    const chave = String(i.Atendimento || '').trim();
    if (chave) porAtendimento.set(chave, i);
  }
  let atualizadas = 0, semCorrespondencia = 0, semMudanca = 0;
  for (const r of registros) {
    const alvo = porAtendimento.get(String(r.Atendimento || '').trim());
    if (!alvo) { semCorrespondencia++; continue; }
    let mudou = false;
    if (r.DataAlta && alvo.DataAlta !== r.DataAlta) { alvo.DataAlta = r.DataAlta; mudou = true; }
    if (r.Desfecho && alvo.Desfecho !== r.Desfecho) { alvo.Desfecho = r.Desfecho; mudou = true; }
    const obito = normalizarTexto(r.Obito) === 's' || /obito/.test(normalizarTexto(r.Desfecho)) ? 'S' : (r.Obito ? 'N' : '');
    if (obito && alvo.Obito !== obito) { alvo.Obito = obito; mudou = true; }
    if (mudou) atualizadas++; else semMudanca++;
  }
  return { atualizadas, semCorrespondencia, semMudanca };
}

/* Reimportação de internações: a mesma internação (atendimento+prontuário) que
   reaparece com alta/desfecho/setor novos atualiza a linha existente. */
function atualizarInternacoesExistentes(internacoes, registros) {
  const chaveDe = r => normalizarTexto(r.Atendimento) + '|' + normalizarTexto(normalizarProntuario(r.Prontuario));
  const porChave = new Map(internacoes.map(i => [chaveDe(i), i]));
  let atualizadas = 0;
  for (const r of registros) {
    const alvo = porChave.get(chaveDe(r));
    if (!alvo) continue;
    let mudou = false;
    for (const campo of ['DataAlta', 'Desfecho', 'SetorAtual', 'Leito', 'Clinica']) {
      const valor = String(r[campo] || '').trim();
      if (valor && alvo[campo] !== valor) { alvo[campo] = valor; mudou = true; }
    }
    if (mudou) {
      alvo.Obito = /obito/.test(normalizarTexto(alvo.Desfecho)) ? 'S' : 'N';
      atualizadas++;
    }
  }
  return atualizadas;
}

/* Auto-reparo: cirurgias antigas gravadas sem prontuário (antes da cascata de
   identificação) são consertadas na próxima importação — ou removidas se irreparáveis. */
function repararCirurgiasSemIdentificacao(cirurgias, internacoes) {
  const mapa = new Map();
  for (const i of internacoes || []) {
    const atendimento = String(i.Atendimento || '').trim();
    if (atendimento) mapa.set(atendimento, normalizarProntuario(i.Prontuario));
  }
  let reparadas = 0, removidas = 0;
  const resultado = [];
  for (const cirurgia of cirurgias || []) {
    if (String(cirurgia.Prontuario || '').trim()) { resultado.push(cirurgia); continue; }
    const atendimento = String(cirurgia.Atendimento || '').replace(/\D/g, '');
    const real = atendimento && mapa.get(atendimento);
    if (real) { cirurgia.Prontuario = real; reparadas++; resultado.push(cirurgia); }
    else if (atendimento) { cirurgia.Prontuario = 'AT-' + atendimento; reparadas++; resultado.push(cirurgia); }
    else removidas++;
  }
  return { cirurgias: resultado, reparadas, removidas };
}

function resolverProntuarioPorAtendimento(registros, internacoes) {
  const mapa = new Map();
  for (const i of internacoes) {
    const chave = String(i.Atendimento || '').trim();
    if (chave) mapa.set(chave, normalizarProntuario(i.Prontuario));
  }
  let resolvidos = 0;
  for (const r of registros) {
    if (!String(r.Prontuario || '').trim() && r.Atendimento && mapa.has(String(r.Atendimento).trim())) {
      r.Prontuario = mapa.get(String(r.Atendimento).trim());
      resolvidos++;
    }
  }
  return resolvidos;
}

function resolverProntuarioPorNome(registros, pacientes) {
  const porNome = new Map();
  for (const p of pacientes) {
    const chave = normalizarTexto(p.Nome);
    if (!chave) continue;
    porNome.set(chave, porNome.has(chave) ? null : normalizarProntuario(p.Prontuario));
  }
  let resolvidos = 0;
  for (const r of registros) {
    if (String(r.Prontuario || '').trim()) continue;
    const achado = porNome.get(normalizarTexto(r.Nome || r.NomePaciente));
    if (achado) { r.Prontuario = achado; resolvidos++; }
  }
  return resolvidos;
}

/* Internações de um paciente que cobrem uma data, com folga de alguns dias nas pontas
   (exame colhido no dia da alta é rotina). */
function internacoesNaData(internacoes, dataISO, folgaDias) {
  const folga = (folgaDias === undefined ? 1 : folgaDias) * 86400000;
  const alvo = Date.parse(String(dataISO).slice(0, 10) + 'T00:00:00Z');
  if (!isFinite(alvo)) return [];
  return (internacoes || []).filter(i => {
    const inicio = Date.parse(String(i.DataInternacao).slice(0, 10) + 'T00:00:00Z');
    if (!isFinite(inicio)) return false;
    const alta = String(i.DataAlta || '').slice(0, 10);
    const fim = alta ? Date.parse(alta + 'T00:00:00Z') : Infinity;
    if (!isFinite(fim) && alta) return false;
    return alvo >= inicio - folga && alvo <= (fim === Infinity ? Infinity : fim + folga);
  });
}

/* Descobre a que internação pertence um exame identificado só pelo nome do paciente.
   O cadastro é indexado por número de atendimento — a mesma pessoa tem um número por
   internação —, então casar só por nome é ambíguo: quem desempata é a internação que
   estava aberta na data da coleta. Devolve o número dessa internação, ou '' quando o
   nome não bate com ninguém ou quando duas internações cobrem a mesma data. */
function resolverPorNomeEData(nome, dataColeta, indice, folgaDias) {
  const candidatos = indice.get(normalizarTexto(nome)) || [];
  if (!candidatos.length) return { prontuario: '', motivo: 'nome sem correspondência' };
  const cobrem = internacoesNaData(candidatos, dataColeta, folgaDias);
  const distintos = [...new Set(cobrem.map(i => normalizarProntuario(i.Prontuario)))];
  if (distintos.length === 1) return { prontuario: distintos[0], motivo: 'internação na data' };
  if (distintos.length > 1) return { prontuario: '', motivo: 'mais de uma internação na data' };
  return { prontuario: '', motivo: 'nenhuma internação cobre a data' };
}

/* Índice nome → internações, para não varrer o banco a cada exame. */
function indicePorNome(pacientes, internacoes) {
  const nomeDe = new Map();
  for (const p of pacientes || []) {
    const chave = normalizarProntuario(p.Prontuario);
    if (chave && String(p.Nome || '').trim()) nomeDe.set(chave, normalizarTexto(p.Nome));
  }
  const indice = new Map();
  for (const i of internacoes || []) {
    const nome = nomeDe.get(normalizarProntuario(i.Prontuario));
    if (!nome) continue;
    if (!indice.has(nome)) indice.set(nome, []);
    indice.get(nome).push(i);
  }
  return indice;
}

/* O hospital usa dois números para a mesma pessoa: o prontuário (do paciente) e o
   atendimento (da internação). Quem digita à beira do leito informa o que está na pulseira,
   que ora é um, ora é outro. Este índice permite procurar nos dois espaços. */
function indiceDeIdentificacao(pacientes, internacoes) {
  const porProntuarioCadastro = new Map();
  (pacientes || []).forEach(p => {
    const chave = normalizarProntuario(p.Prontuario);
    if (chave && !porProntuarioCadastro.has(chave)) porProntuarioCadastro.set(chave, p);
  });
  const porProntuarioInternacao = new Map();
  const porAtendimento = new Map();
  (internacoes || []).forEach(i => {
    const pront = normalizarProntuario(i.Prontuario);
    const atend = normalizarProntuario(i.Atendimento);
    if (pront) {
      if (!porProntuarioInternacao.has(pront)) porProntuarioInternacao.set(pront, []);
      porProntuarioInternacao.get(pront).push(i);
    }
    if (atend) {
      if (!porAtendimento.has(atend)) porAtendimento.set(atend, []);
      porAtendimento.get(atend).push(i);
    }
  });
  return { porProntuarioCadastro, porProntuarioInternacao, porAtendimento };
}

/* Identifica o paciente a partir do número anotado e da data do registro. Tenta, em ordem:
   o cadastro; a internação pelo prontuário; a internação pelo atendimento. Entre várias
   internações, fica a que cobre a data — é o mesmo desempate usado nas culturas.
   Devolve sempre um objeto, com `encontrado: false` quando não dá para identificar, para
   a tela poder dizer "não está no cadastro" em vez de mostrar um nome vazio. */
function identificarPaciente(numero, data, indice) {
  const chave = normalizarProntuario(numero);
  if (!chave) return { encontrado: false, prontuario: '', nome: '', origem: 'sem número' };

  const noCadastro = indice.porProntuarioCadastro.get(chave);
  const escolher = lista => {
    if (!lista || !lista.length) return null;
    const cobrem = internacoesNaData(lista, data, 1);
    return cobrem[0] || lista[lista.length - 1];
  };
  const internacao = escolher(indice.porProntuarioInternacao.get(chave))
    || escolher(indice.porAtendimento.get(chave));

  if (noCadastro && String(noCadastro.Nome || '').trim()) {
    return {
      encontrado: true, prontuario: chave, nome: noCadastro.Nome,
      internacao, origem: 'cadastro'
    };
  }
  if (internacao) {
    const doAtendimento = indice.porProntuarioCadastro.get(normalizarProntuario(internacao.Atendimento));
    const doProntuario = indice.porProntuarioCadastro.get(normalizarProntuario(internacao.Prontuario));
    const registro = (doAtendimento && doAtendimento.Nome ? doAtendimento : null)
      || (doProntuario && doProntuario.Nome ? doProntuario : null);
    return {
      encontrado: !!(registro && registro.Nome), prontuario: chave,
      nome: registro ? registro.Nome : '', internacao,
      origem: 'internação'
    };
  }
  return { encontrado: false, prontuario: chave, nome: '', origem: 'não encontrado' };
}

/* Unificação de pacientes: pseudo-registro (nascimento+iniciais, gerado do PDF do
   laboratório) casado com o prontuário verdadeiro vindo dos demais relatórios. */
function ehPseudoProntuario(prontuario) {
  const s = String(prontuario || '').trim();
  return /^\d{8}-[A-ZÀ-Ú]+$/.test(s) || /^AT-\d+$/.test(s);
}

function sugerirUnificacoes(pacientes) {
  const pseudos = pacientes.filter(p => ehPseudoProntuario(p.Prontuario) && String(p.Nome || '').trim()
    && p.Descartado !== 'S');
  const reais = pacientes.filter(p => !ehPseudoProntuario(p.Prontuario) && String(p.Nome || '').trim());
  const porNome = new Map();
  for (const r of reais) {
    const chave = normalizarTexto(r.Nome);
    if (!porNome.has(chave)) porNome.set(chave, []);
    porNome.get(chave).push(r);
  }
  const sugestoes = [];
  for (const pseudo of pseudos) {
    const candidatos = porNome.get(normalizarTexto(pseudo.Nome)) || [];
    if (candidatos.length === 1) {
      sugestoes.push({ de: pseudo.Prontuario, para: candidatos[0].Prontuario, nome: pseudo.Nome });
    }
  }
  return sugestoes;
}

/* "Não é paciente internado": o registro provisório (pseudo-prontuário do laboratório ou
   do centro cirúrgico) é marcado como descartado e o que ele carregava sai dos dados
   válidos — culturas e cirurgias viram 'descartada'. NADA é apagado: o descarte fica
   assinado no cadastro e a reversão devolve tudo como 'pendente', para revisão humana
   (uma cultura que já era descartada antes volta como pendente na reversão — melhor
   reaparecer na fila do que sumir dado válido). */
function descartarRegistroProvisorio(bancoPacientes, bancoCulturas, bancoCirurgias, prontuario, autor, quando) {
  const chave = normalizarProntuario(prontuario);
  const cadastro = ((bancoPacientes || {}).pacientes || [])
    .find(p => normalizarProntuario(p.Prontuario) === chave);
  if (!cadastro) throw new Error('Registro não encontrado no cadastro.');
  if (!ehPseudoProntuario(cadastro.Prontuario)) {
    throw new Error('Só registros provisórios (laboratório/centro cirúrgico) podem ser descartados.');
  }
  cadastro.Descartado = 'S';
  cadastro.DescartadoPor = autor;
  cadastro.DescartadoEm = quando;
  let culturas = 0, cirurgias = 0;
  for (const c of ((bancoCulturas || {}).culturas || [])) {
    if (normalizarProntuario(c.Prontuario) !== chave || c.StatusRevisao === 'descartada') continue;
    c.StatusRevisao = 'descartada';
    culturas++;
  }
  for (const c of ((bancoCirurgias || {}).cirurgias || [])) {
    if (normalizarProntuario(c.Prontuario) !== chave || c.StatusVigilancia === 'descartada') continue;
    c.StatusVigilancia = 'descartada';
    c.ObservacoesVigilancia = acrescentarObservacao(c.ObservacoesVigilancia, '',
      'Registro provisório descartado: não é paciente internado.', autor, quando);
    cirurgias++;
  }
  return { culturas, cirurgias };
}

function reverterDescarteProvisorio(bancoPacientes, bancoCulturas, bancoCirurgias, prontuario, autor, quando) {
  const chave = normalizarProntuario(prontuario);
  const cadastro = ((bancoPacientes || {}).pacientes || [])
    .find(p => normalizarProntuario(p.Prontuario) === chave);
  if (!cadastro) throw new Error('Registro não encontrado no cadastro.');
  cadastro.Descartado = '';
  cadastro.DescartadoPor = '';
  cadastro.DescartadoEm = '';
  let culturas = 0, cirurgias = 0;
  for (const c of ((bancoCulturas || {}).culturas || [])) {
    if (normalizarProntuario(c.Prontuario) !== chave || c.StatusRevisao !== 'descartada') continue;
    c.StatusRevisao = 'pendente';
    culturas++;
  }
  for (const c of ((bancoCirurgias || {}).cirurgias || [])) {
    if (normalizarProntuario(c.Prontuario) !== chave || c.StatusVigilancia !== 'descartada') continue;
    c.StatusVigilancia = 'pendente';
    c.ObservacoesVigilancia = acrescentarObservacao(c.ObservacoesVigilancia, '',
      'Descarte revertido: registro volta aos dados válidos como pendente.', autor, quando);
    cirurgias++;
  }
  return { culturas, cirurgias };
}

/* Distância de edição limitada (para pegar erros de digitação). */
function distanciaEdicao(a, b, maxima) {
  if (Math.abs(a.length - b.length) > maxima) return maxima + 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (atual[j] < menor) menor = atual[j];
    }
    if (menor > maxima) return maxima + 1;
    anterior = atual;
  }
  return anterior[b.length];
}

/* Sugere unificações dentro de um vocabulário: variantes sp/spp, prefixo "Isolado:",
   sufixo "na amostra analisada", iguais a menos de caixa/acentos e erros de digitação. */
/* Entre grafias equivalentes, qual manter. Ordem de preferência: termo já oficial do
   vocabulário → nomenclatura binomial correta (Gênero espécie, sem ponto final) →
   o mais usado no banco. Sem isso a unificação levava "Escherichia coli" (755 culturas)
   para "Escherichia Coli" (54), só porque essa vinha antes na ordem alfabética. */
function melhorGrafia(grupo, setOficiais, frequencias) {
  const binomial = t => /^[A-ZÀ-Ü][a-zà-ü-]+( [a-zà-ü][a-zà-ü-]*)+$/.test(t);
  const nota = t => (setOficiais.has(normalizarTexto(t)) ? 100 : 0)
    + (binomial(t) ? 10 : 0)
    + (/\.$/.test(t) ? -5 : 0);
  return grupo.slice().sort((a, b) => {
    const diferenca = nota(b) - nota(a);
    if (diferenca) return diferenca;
    const fa = (frequencias && frequencias[a]) || 0, fb = (frequencias && frequencias[b]) || 0;
    return fb - fa;
  })[0];
}

function sugerirUnificacoesVocabulario(termos, oficiais, frequencias) {
  const setOficiais = new Set((oficiais || []).map(normalizarTexto));
  const porNormalizado = new Map();
  for (const t of termos) {
    const n = normalizarTexto(t);
    if (!porNormalizado.has(n)) porNormalizado.set(n, []);
    porNormalizado.get(n).push(t);
  }
  const sugestoes = [];
  const sugerir = (de, para, regra) => {
    if (de !== para && !sugestoes.some(s => s.de === de)) sugestoes.push({ de, para, regra });
  };
  const acharTermo = n => {
    const lista = porNormalizado.get(n);
    if (!lista) return null;
    return melhorGrafia(lista, setOficiais, frequencias);
  };

  for (const [n, grupo] of porNormalizado) {
    if (grupo.length > 1) {
      const canonico = melhorGrafia(grupo, setOficiais, frequencias);
      grupo.forEach(t => sugerir(t, canonico, 'iguais a menos de caixa/acentos'));
    }
  }
  for (const t of termos) {
    const n = normalizarTexto(t);
    if (setOficiais.has(n)) continue;
    if (n.endsWith('sp') && !n.endsWith('spp')) {
      const alvo = acharTermo(n + 'p');
      if (alvo) { sugerir(t, alvo, 'variante sp → spp'); continue; }
    }
    if (n.startsWith('isolado')) {
      const alvo = acharTermo(n.replace(/^isolado/, ''));
      if (alvo) { sugerir(t, alvo, 'prefixo "Isolado:"'); continue; }
    }
    if (n.endsWith('naamostraanalisada')) {
      const alvo = acharTermo(n.replace(/naamostraanalisada$/, ''));
      if (alvo) { sugerir(t, alvo, 'sufixo "na amostra analisada"'); continue; }
    }
    if (!t.includes(' ')) {
      for (const outro of termos) {
        if (outro === t) continue;
        const primeiro = normalizarTexto(String(outro).split(/\s+/)[0]);
        /* Distância 2 só em termos longos: Eritromicina↔Azitromicina distam 2 letras
           e são drogas diferentes — em nomes curtos, só 1 letra trocada conta. */
        const tolerancia = Math.min(n.length, primeiro.length) >= 14 ? 2 : 1;
        if (primeiro.length >= 8 && distanciaEdicao(n, primeiro, tolerancia) <= tolerancia && n !== primeiro) {
          /* A direção vem da melhor grafia, não da ordem da lista — senão "Biópsia"
             (33 usos) era mandada para "Biópsias" (1 uso) e o par voltava invertido. */
          const canonico = melhorGrafia([t, outro], setOficiais, frequencias);
          sugerir(canonico === t ? outro : t, canonico, 'possível erro de digitação — confirme');
          break;
        }
      }
    }
  }
  return sugestoes;
}

/* Auditoria de vocabulário: as sugestões automáticas de sempre MAIS uma varredura por
   distância de edição sobre o termo inteiro, para pegar erro de digitação em termos
   compostos ("lavado bronco alveolar") e variantes de sufixo ("Linezolide"). Distância 1
   sempre conta; 2 só em termos longos (≥14 letras) — senão Eritromicina↔Azitromicina,
   drogas diferentes a 2 letras uma da outra, viraria par. Por isso mesmo, nada aqui é
   aplicado sozinho: a regra marca o par como "confirme" e a decisão é humana. */
function auditarVocabulario(termos, oficiais, frequencias) {
  const sugestoes = sugerirUnificacoesVocabulario(termos, oficiais, frequencias);
  const cobertos = new Set(sugestoes.map(s => normalizarTexto(s.de)));
  const setOficiais = new Set((oficiais || []).map(normalizarTexto));
  const lista = [...new Set(termos.map(t => String(t == null ? '' : t).trim()).filter(Boolean))];
  for (let i = 0; i < lista.length; i++) {
    for (let j = i + 1; j < lista.length; j++) {
      const a = normalizarTexto(lista[i]), b = normalizarTexto(lista[j]);
      if (!a || !b || a === b) continue;
      const tolerancia = Math.min(a.length, b.length) >= 14 ? 2 : 1;
      if (distanciaEdicao(a, b, tolerancia) > tolerancia) continue;
      const para = melhorGrafia([lista[i], lista[j]], setOficiais, frequencias);
      const de = para === lista[i] ? lista[j] : lista[i];
      if (cobertos.has(normalizarTexto(de))) continue;
      sugestoes.push({ de, para, regra: 'termos quase iguais — confirme antes de unificar' });
      cobertos.add(normalizarTexto(de));
    }
  }
  return sugestoes;
}

/* Diário de observações da vigilância: cada registro entra numa linha nova, datado e
   assinado — nada se sobrescreve. Quem valida a infecção depois precisa ler a conversa
   inteira: o relato do paciente, a avaliação de quem ligou e o que vier depois. */
function acrescentarObservacao(atual, rotulo, texto, autor, quando) {
  const limpo = String(texto == null ? '' : texto).trim();
  const base = String(atual == null ? '' : atual).trim();
  if (!limpo) return base;
  const entrada = `[${quando} — ${autor}] ${rotulo ? rotulo + ': ' : ''}${limpo}`;
  return base ? base + '\n' + entrada : entrada;
}

/* Prontuário → data do óbito (a mais antiga registrada), unindo a aba de óbitos e as
   internações cujo desfecho foi óbito. Óbito registrado sem data entra com data vazia.
   É a base da exclusão automática na vigilância pós-alta. */
function indiceDeObitos(bancoPacientes) {
  const indice = new Map();
  const anotar = (prontuario, data) => {
    const chave = normalizarProntuario(prontuario);
    if (!chave) return;
    const dia = String(data || '').slice(0, 10);
    const valida = /^\d{4}-/.test(dia) ? dia : '';
    const atual = indice.get(chave);
    if (atual === undefined) { indice.set(chave, valida); return; }
    if (valida && (!atual || valida < atual)) indice.set(chave, valida);
  };
  for (const o of ((bancoPacientes || {}).obitos || [])) anotar(o.Prontuario, o.DataObito);
  for (const i of ((bancoPacientes || {}).internacoes || [])) {
    if (i.Obito === 'S' || normalizarTexto(i.Desfecho).includes('obito')) anotar(i.Prontuario, i.DataAlta);
  }
  return indice;
}

/* Morreu depois de operar → a vigilância pós-alta encerra sozinha (não há quem contatar).
   Óbito com data ANTERIOR à cirurgia é inconsistência de dados, não desfecho — não
   encerra nada. Óbito sem data conta: morto não recebe mensagem. */
function faleceuAposCirurgia(cirurgia, indiceObitos) {
  const chave = normalizarProntuario(cirurgia.Prontuario);
  if (!indiceObitos.has(chave)) return false;
  const dataObito = indiceObitos.get(chave);
  if (!dataObito) return true;
  return dataObito >= String(cirurgia.DataCirurgia || '').slice(0, 10);
}

/* Sugestão de equivalência no de-para de termos novos: dicionário de domínio
   (sangue → Hemocultura) + similaridade por palavras (KLEB PNEUMONIAE → Klebsiella pneumoniae). */
const EQUIVALENCIAS_VOCAB = {
  materiais: {
    sangue: 'Hemocultura', urina: 'Urocultura', lcr: 'Líquor', liquidocefalorraquidiano: 'Líquor',
    tecido: 'Fragmento de tecido', fragmento: 'Fragmento de tecido', biopsia: 'Fragmento de tecido',
    aspiradotraqueal: 'Secreção traqueal', cateter: 'Ponta de cateter'
  }
};

function tokensDe(texto) {
  return String(texto == null ? '' : texto).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).filter(t => t.length >= 3);
}

function sugerirEquivalente(termo, existentes, vocab) {
  const n = normalizarTexto(termo);
  if (!n || !existentes || !existentes.length) return null;
  const dicionario = EQUIVALENCIAS_VOCAB[vocab] || {};
  for (const [chave, alvo] of Object.entries(dicionario)) {
    if (n.includes(chave) || chave.includes(n)) {
      const oficial = existentes.find(e => normalizarTexto(e) === normalizarTexto(alvo));
      if (oficial) return oficial;
    }
  }
  const tokens = tokensDe(termo);
  if (!tokens.length) return null;
  let melhor = null, melhorPontos = 0;
  for (const existente of existentes) {
    const tokensExistente = tokensDe(existente);
    let pontos = 0;
    for (const t of tokens) {
      if (tokensExistente.includes(t)) pontos += 2;
      else if (t.length >= 4 && tokensExistente.some(te => te.startsWith(t) || (t.startsWith(te) && te.length >= 4))) pontos += 1;
    }
    if (pontos > melhorPontos) { melhorPontos = pontos; melhor = existente; }
  }
  return melhorPontos >= 2 ? melhor : null;
}

/* Enriquecimento da linha de cirurgia: ASA numérico, classe de contaminação,
   duração a partir das horas e índice NNIS quando há dados completos. */
function enriquecerCirurgia(linha, tempoCortePorNome) {
  const mapaASA = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
  const asaTexto = normalizarTexto(linha.ASA);
  const asaM = /(iv|v|i{1,3}|[1-5])$/.exec(asaTexto) || /^(iv|i{1,3})(?=[^iv]|$)/.exec(asaTexto) || /^(v)(?=[^iv]|$)/.exec(asaTexto.length <= 3 ? asaTexto : '');
  const asa = asaM ? (mapaASA[asaM[1]] || Number(asaM[1])) : null;
  if (asa) linha.ASA = String(asa);

  const nc = normalizarTexto(linha.PotencialContaminacao);
  let classe = '';
  if (nc.includes('limpacontaminada') || nc.includes('potencial')) classe = 'Potencialmente contaminada';
  else if (nc.includes('infectada') || nc.includes('suja')) classe = 'Infectada';
  else if (nc.includes('contaminada')) classe = 'Contaminada';
  else if (nc.includes('limpa')) classe = 'Limpa';
  if (classe) linha.PotencialContaminacao = classe;

  let duracao = Number(String(linha.DuracaoMin).replace(',', '.'));
  if ((!duracao || isNaN(duracao)) && linha.HoraInicio && linha.HoraFim) {
    const minutosDe = h => {
      const s = String(h).trim();
      const m = /^(\d{1,2})[:h](\d{2})/.exec(s) || /\s(\d{1,2})[:h](\d{2})/.exec(s);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const inicio = minutosDe(linha.HoraInicio), fim = minutosDe(linha.HoraFim);
    if (inicio != null && fim != null) {
      duracao = fim - inicio;
      if (duracao < 0) duracao += 1440;
    }
  }
  if (duracao && !isNaN(duracao)) linha.DuracaoMin = String(Math.round(duracao));

  const obito = normalizarTexto(linha.Obito);
  if (obito === 's' || obito === 'sim' || /(obito|falec|morte|morto)/.test(obito)) {
    linha.Obito = 'S';
    linha.StatusVigilancia = 'não se aplica (óbito)';
  } else if (obito) {
    linha.Obito = 'N';
  }

  const tempoCorte = tempoCortePorNome ? tempoCortePorNome[normalizarTexto(linha.ProcedimentoNHSN)] : undefined;
  if (asa && classe && duracao && tempoCorte) {
    const pontos = (asa >= 3 ? 1 : 0)
      + (classe === 'Contaminada' || classe === 'Infectada' ? 1 : 0)
      + (duracao > tempoCorte * 60 ? 1 : 0);
    linha.IndiceNNIS = String(pontos);
  }
  return linha;
}

function normalizarDispositivo(valor) {
  const n = normalizarTexto(valor);
  if (!n) return '';
  if (['nenhum', 'nao', 'sem'].some(x => n === x || n.startsWith(x))) return 'Nenhum';
  if (n.includes('cvc') || n.includes('venoso') || (n.includes('cateter') && n.includes('central'))) return 'CVC';
  if (n.includes('vm') || n.includes('ventila') || n.includes('tuboorotraqueal') || n.includes('traqueostomia')) return 'VM';
  if (n.includes('svd') || n.includes('sonda') || n.includes('vesical')) return 'SVD';
  return String(valor).trim();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizarData, normalizarProntuario, normalizarValorAntibiograma,
    sugerirMapeamento, normalizarLinhas, validar, deduplicar, chaveNaturalDe, proximoID,
    analisarPDFCulturas, ehPseudoProntuario, sugerirUnificacoes, sugerirUnificacoesVocabulario, auditarVocabulario, distanciaEdicao,
    indiceDeObitos, faleceuAposCirurgia, acrescentarObservacao,
    descartarRegistroProvisorio, reverterDescarteProvisorio,
    analisarInvasivos, categoriaDispositivo, aplicarAltas, atualizarInternacoesExistentes, NAO_CIRURGIA, NAO_CULTURA, pareceNaoCirurgia, repararCirurgiasSemIdentificacao, resolverProntuarioPorAtendimento, resolverProntuarioPorNome,
    enriquecerCirurgia, normalizarDispositivo, extrairAntibiogramaTexto, sugerirEquivalente,
    textoAntibiograma, classificacaoCanonica, montarLinhaImportada, separarMecanismoDoNome, melhorGrafia,
    respostaSimNao, horaDeFracao, minutosEntre, setorDeSepse, desfechoDeSepse, focoDeSepse, enriquecerSepse,
    internacoesNaData, resolverPorNomeEData, indicePorNome, indiceDeIdentificacao, identificarPaciente,
    situacaoAntibiotico,
    preClassificarCultura, culturaDoPainel, indiceSepse, culturaDeProtocoloSepse, JANELA_CULTURA_SEPSE,
    prepararRelatorio, adesaoHigiene, tipoPrecaucao, encerrarIsolamentosAusentes, encerrarIsolamentosPorSaida, dataDoRelatorio, vincularAvaliacaoAPrescricao,
    momentoCanonico, categoriaProfissional, normalizarObservacaoHigiene, MOMENTOS_OMS,
    principioAtivo, aplicarObitos,
    classificarParaVigilancia, categoriaDeVigilancia, CATEGORIAS_VIGILANCIA, CATEGORIAS_VIGILANCIA_PADRAO,
    diasDesde, telefoneWhatsApp, mensagemVigilancia, linkWhatsApp, JANELA_VIGILANCIA,
    prescricaoAtiva, analisarDose, cursosDeAntibiotico, alertasDeAntibioticos, DIAS_CURSO_PROLONGADO, TETO_DOSE_DIARIA_MG
  };
}
