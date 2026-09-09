/* Camada de leitura de formatos: converte qualquer arquivo aceito numa tabela bruta (linhas × colunas).
   Funções puras sobre ArrayBuffer — usáveis no navegador e nos testes em Node. */

const FORMATOS_TABULARES = ['xlsx', 'xlsm', 'xls', 'csv', 'txt', 'dbf'];

function extensaoDe(nomeArquivo) {
  const m = /\.([a-z0-9]+)$/i.exec(nomeArquivo || '');
  return m ? m[1].toLowerCase() : '';
}

function decodificarTexto(buffer, codificacao) {
  if (codificacao && codificacao !== 'auto') {
    return { texto: new TextDecoder(codificacao).decode(buffer), codificacao };
  }
  try {
    return { texto: new TextDecoder('utf-8', { fatal: true }).decode(buffer), codificacao: 'utf-8' };
  } catch (e) {
    return { texto: new TextDecoder('windows-1252').decode(buffer), codificacao: 'windows-1252' };
  }
}

/* Lê o arquivo bruto. `codificacao`: 'auto' | 'utf-8' | 'windows-1252' | 'cp850' (dbf/csv).
   `opcoes.aba`: nome ou índice da aba (padrão: a primeira).
   `opcoes.todasAsAbas`: junta TODAS as abas de mesmo cabeçalho num só conjunto de linhas —
   é o caso das planilhas de controle da CCIH com uma aba por mês. Abas com cabeçalho
   diferente são deixadas de fora e devolvidas em `abasIgnoradas`, porque concatenar
   colunas que não casam embaralharia os dados em silêncio. */
function lerBruto(buffer, nomeArquivo, codificacao, opcoes) {
  const ext = extensaoDe(nomeArquivo);
  if (!FORMATOS_TABULARES.includes(ext)) {
    throw new Error(`Formato não suportado: .${ext}`);
  }
  let wb, codUsada = codificacao || 'auto';
  if (ext === 'csv' || ext === 'txt') {
    const dec = decodificarTexto(buffer, codificacao);
    codUsada = dec.codificacao;
    wb = XLSX.read(dec.texto, { type: 'string', raw: true, dense: true });
  } else {
    const opcoes = { type: 'array', raw: true, dense: true };
    if (ext === 'dbf') {
      opcoes.codepage = codificacao === 'cp850' ? 850 : (codificacao === 'utf-8' ? 65001 : 1252);
      codUsada = 'codepage ' + opcoes.codepage;
    }
    wb = XLSX.read(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), opcoes);
  }
  const abas = wb.SheetNames;
  const paraLinhas = nome => XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: '' });

  if ((opcoes || {}).todasAsAbas && abas.length > 1) {
    let cabecalho = null, assinatura = null;
    const linhas = [];
    const abasLidas = [], abasIgnoradas = [];
    for (const nome of abas) {
      const daAba = paraLinhas(nome);
      if (!daAba.length) continue;
      const iCab = detectarCabecalho(daAba);
      const corpo = daAba.slice(iCab + 1).filter(l => l.some(c => String(c).trim() !== ''));
      if (!corpo.length) continue;             /* aba de mês ainda não preenchido */
      const daqui = calcularFingerprint(daAba[iCab] || []);
      if (!cabecalho) { cabecalho = daAba[iCab]; assinatura = daqui; }
      else if (daqui !== assinatura) { abasIgnoradas.push(nome); continue; }
      linhas.push(...corpo);
      abasLidas.push(nome);
    }
    if (cabecalho) linhas.unshift(cabecalho);
    return { linhas, nomeArquivo, formato: ext, codificacao: codUsada,
      totalLinhas: linhas.length, abas, abasLidas, abasIgnoradas };
  }

  const escolha = (opcoes || {}).aba;
  const nomeAba = escolha == null ? abas[0]
    : (typeof escolha === 'number' ? abas[escolha] : escolha);
  if (!wb.Sheets[nomeAba]) throw new Error(`Aba não encontrada: ${escolha}`);
  const linhas = paraLinhas(nomeAba);
  return { linhas, nomeArquivo, formato: ext, codificacao: codUsada,
    totalLinhas: linhas.length, abas, abaLida: nomeAba };
}

/* Heurística: acha a linha de cabeçalho (relatórios costumam ter título/logotipo antes). */
function detectarCabecalho(linhas) {
  const limite = Math.min(linhas.length, 30);
  let melhor = 0, melhorPontos = -1;
  for (let i = 0; i < limite; i++) {
    const linha = linhas[i] || [];
    const preenchidas = linha.filter(c => String(c).trim() !== '');
    if (preenchidas.length < 2) continue;
    const textuais = preenchidas.filter(c => typeof c === 'string' && !/^[\d\s.,/:-]+$/.test(c));
    const distintas = new Set(preenchidas.map(c => String(c).trim().toLowerCase())).size;
    const proxima = (linhas[i + 1] || []).filter(c => String(c).trim() !== '');
    let pontos = textuais.length + distintas / preenchidas.length;
    if (proxima.length >= preenchidas.length * 0.5) pontos += 2;
    if (pontos > melhorPontos) { melhorPontos = pontos; melhor = i; }
  }
  return melhor;
}

function normalizarTexto(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

function calcularFingerprint(cabecalhos) {
  const base = cabecalhos.map(normalizarTexto).filter(Boolean).join('|');
  let h = 5381;
  for (let i = 0; i < base.length; i++) h = ((h << 5) + h + base.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/* Lê o PDF (pdf.js) devolvendo a estrutura CRUA: páginas → linhas → itens com posição x.
   Guardar o x é o que permite recortar tabela por coluna; e guardar a divisão de PÁGINAS é
   obrigatório em relatório de sistema, onde a largura das colunas se adapta ao conteúdo e
   muda de uma página para outra. Achatar tudo numa lista só de texto — como fazíamos —
   destrói as duas informações. */
async function extrairPaginasPDF(buffer) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  const doc = await pdfjsLib.getDocument({ data: buffer.slice() }).promise;
  const paginas = [];
  for (let numero = 1; numero <= doc.numPages; numero++) {
    const pagina = await doc.getPage(numero);
    /* disableCombineTextItems: sem isso o pdf.js junta trechos vizinhos num item só, e num
       relatório em colunas o nome do cirurgião vinha colado ao do anestesista numa única
       string — sem nenhuma coordenada onde cortar. Com a opção ligada cada trecho mantém o
       seu x, que é o que permite recortar por coluna. */
    const conteudo = await pagina.getTextContent({ disableCombineTextItems: true });
    /* As coordenadas do item vêm no espaço do PDF, SEM a rotação da página. Num relatório
       em paisagem (/Rotate 90) isso troca linhas por colunas: os rótulos "Cirurgião",
       "Anestesista" e "Tipo Anest" saíam todos no mesmo x, cada um num y — e nenhuma tabela
       era reconhecida. A viewport aplica a rotação e devolve a posição como o olho vê, com
       y crescendo para BAIXO. */
    const viewport = pagina.getViewport({ scale: 1 });
    const porY = [];
    for (const item of conteudo.items) {
      if (!item.str || !item.str.trim()) continue;
      const m = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const x = m[4], y = m[5];
      let grupo = porY.find(g => Math.abs(g.y - y) <= 2);
      if (!grupo) { grupo = { y, itens: [] }; porY.push(grupo); }
      grupo.itens.push({ x, largura: item.width || 0, str: item.str });
    }
    porY.sort((a, b) => a.y - b.y);
    porY.forEach(g => g.itens.sort((a, b) => a.x - b.x));
    paginas.push(porY);
  }
  return paginas;
}

/* Junta os itens de uma linha num texto só, com espaçamento aproximado pelo vão. */
function linhaDeItens(itens) {
  let linha = '', fim = null;
  for (const it of (itens || [])) {
    if (fim !== null) {
      const vao = it.x - fim;
      linha += vao > 6 ? '   ' : (vao > 0.8 ? ' ' : '');
    }
    linha += it.str;
    fim = it.x + it.largura;
  }
  return linha;
}

/* Extrai as linhas de texto de um PDF digital, achatadas. Mantido para os leitores que já
   trabalham assim (culturas); quem precisa de coluna usa extrairPaginasPDF. */
async function extrairLinhasPDF(buffer) {
  const paginas = await extrairPaginasPDF(buffer);
  const linhas = [];
  for (const pagina of paginas) for (const grupo of pagina) linhas.push(linhaDeItens(grupo.itens));
  return linhas;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lerBruto, detectarCabecalho, normalizarTexto, calcularFingerprint, extensaoDe, FORMATOS_TABULARES, linhaDeItens };
}
