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

/* Lê o arquivo bruto. `codificacao`: 'auto' | 'utf-8' | 'windows-1252' | 'cp850' (dbf/csv). */
function lerBruto(buffer, nomeArquivo, codificacao) {
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
  const aba = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(aba, { header: 1, raw: true, defval: '' });
  return { linhas, nomeArquivo, formato: ext, codificacao: codUsada, totalLinhas: linhas.length };
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

/* Extrai as linhas de texto de um PDF digital (pdf.js), reconstruindo colunas por posição. */
async function extrairLinhasPDF(buffer) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  const doc = await pdfjsLib.getDocument({ data: buffer.slice() }).promise;
  const linhas = [];
  for (let numero = 1; numero <= doc.numPages; numero++) {
    const pagina = await doc.getPage(numero);
    const conteudo = await pagina.getTextContent();
    const porY = [];
    for (const item of conteudo.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = item.transform[5];
      let grupo = porY.find(g => Math.abs(g.y - y) <= 2);
      if (!grupo) { grupo = { y, itens: [] }; porY.push(grupo); }
      grupo.itens.push({ x: item.transform[4], largura: item.width || 0, str: item.str });
    }
    porY.sort((a, b) => b.y - a.y);
    for (const grupo of porY) {
      grupo.itens.sort((a, b) => a.x - b.x);
      let linha = '', fim = null;
      for (const it of grupo.itens) {
        if (fim !== null) {
          const vao = it.x - fim;
          linha += vao > 6 ? '   ' : (vao > 0.8 ? ' ' : '');
        }
        linha += it.str;
        fim = it.x + it.largura;
      }
      linhas.push(linha);
    }
  }
  return linhas;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lerBruto, detectarCabecalho, normalizarTexto, calcularFingerprint, extensaoDe, FORMATOS_TABULARES };
}
