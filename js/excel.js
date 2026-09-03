/* Camada de dados: pasta via File System Access API, leitura/gravação de planilhas,
   travas por arquivo e arquivamento de originais. Somente navegador (Chrome/Edge). */

const TRAVA_EXPIRA_MIN = 30;

const bancoLocal = {
  async abrir() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('ccih-app', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('chaves');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async gravar(chave, valor) {
    const db = await this.abrir();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chaves', 'readwrite');
      tx.objectStore('chaves').put(valor, chave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async ler(chave) {
    const db = await this.abrir();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chaves', 'readonly');
      const req = tx.objectStore('chaves').get(chave);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
};

const pasta = {
  handle: null,

  suportada() { return typeof window !== 'undefined' && 'showDirectoryPicker' in window; },

  /* A pasta memorizada é POR CÓPIA do aplicativo (caminho do index.html): o navegador
     compartilha o armazenamento entre TODOS os arquivos locais, então uma segunda cópia
     na mesma máquina (ex.: pendrive de teste com outro hospital) reconectava sozinha no
     banco oficial. As "recentes" continuam compartilhadas de propósito — mostram o nome
     de cada pasta antes de conectar. */
  chaveDaPasta() {
    return 'pastaDados:' + (typeof location !== 'undefined' ? location.pathname : '');
  },

  async escolher() {
    this.handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await this.memorizar(this.handle);
    return this.handle;
  },

  /* Guarda a pasta escolhida e mantém uma lista das últimas usadas, para reconectar
     com um toque e — principalmente — para o usuário ver o NOME da pasta antes de entrar.
     Já aconteceu de conectar sem querer numa pasta de teste vazia e parecer que o banco
     tinha sumido. */
  async memorizar(handle) {
    await bancoLocal.gravar(this.chaveDaPasta(), handle);
    const recentes = (await bancoLocal.ler('pastasRecentes')) || [];
    const semDuplicata = [];
    for (const h of recentes) {
      if (!(await h.isSameEntry(handle))) semDuplicata.push(h);
    }
    await bancoLocal.gravar('pastasRecentes', [handle].concat(semDuplicata).slice(0, 4));
  },

  async recentes() {
    return (await bancoLocal.ler('pastasRecentes')) || [];
  },

  async restaurar() {
    const salvo = await bancoLocal.ler(this.chaveDaPasta());
    if (!salvo) return null;
    const permissao = await salvo.queryPermission({ mode: 'readwrite' });
    if (permissao === 'granted') { this.handle = salvo; return salvo; }
    return { precisaPermissao: salvo };
  },

  /* Pasta sem nenhum arquivo do banco = banco novo. Vale confirmar antes de criar tudo:
     é o sintoma de ter escolhido a pasta errada no seletor. */
  async ehPastaNova() {
    for (const nome of Object.keys(ESQUEMAS)) {
      if (await this.existe(ESQUEMAS[nome].arquivo)) return false;
    }
    return true;
  },

  /* Quantas linhas há nos arquivos principais — mostrado ao conectar para que uma pasta
     errada salte aos olhos antes de qualquer importação. */
  async resumo() {
    const partes = [];
    for (const [nomeEsquema, aba] of [['pacientes', 'pacientes'], ['culturas', 'culturas'], ['cirurgias', 'cirurgias']]) {
      try {
        const banco = await lerBanco(nomeEsquema);
        partes.push(`${(banco[aba] || []).length.toLocaleString('pt-BR')} ${aba}`);
      } catch (e) { /* arquivo ainda não existe */ }
    }
    return partes.join(' · ');
  },

  async reautorizar(handleSalvo) {
    const permissao = await handleSalvo.requestPermission({ mode: 'readwrite' });
    if (permissao === 'granted') { this.handle = handleSalvo; return true; }
    return false;
  },

  async lerArquivo(nome) {
    const fh = await this.handle.getFileHandle(nome);
    const arquivo = await fh.getFile();
    return new Uint8Array(await arquivo.arrayBuffer());
  },

  async existe(nome) {
    try { await this.handle.getFileHandle(nome); return true; }
    catch (e) { return false; }
  },

  /* createWritable grava em arquivo de trabalho e só substitui o original no close() — gravação atômica. */
  async gravarArquivo(nome, dados) {
    const fh = await this.handle.getFileHandle(nome, { create: true });
    const escrita = await fh.createWritable();
    await escrita.write(dados);
    await escrita.close();
  },

  async apagarArquivo(nome) {
    try { await this.handle.removeEntry(nome); } catch (e) { /* já não existe */ }
  },

  async subpasta(caminho) {
    let atual = this.handle;
    for (const parte of caminho.split('/')) {
      atual = await atual.getDirectoryHandle(parte, { create: true });
    }
    return atual;
  }
};

/* Pasta de publicação da página de avaliação (ex.: pasta local sincronizada com o Google Drive). */
const publicacao = {
  handle: null,
  /* Mesma regra da pasta de dados: memorizada por cópia do aplicativo. */
  chave() { return 'pastaPublicacao:' + (typeof location !== 'undefined' ? location.pathname : ''); },
  async restaurar() {
    const salvo = await bancoLocal.ler(this.chave());
    if (!salvo) return null;
    if (await salvo.queryPermission({ mode: 'readwrite' }) === 'granted') { this.handle = salvo; return this.handle; }
    if (await salvo.requestPermission({ mode: 'readwrite' }) === 'granted') { this.handle = salvo; return this.handle; }
    return null;
  },
  async escolher() {
    this.handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await bancoLocal.gravar(this.chave(), this.handle);
    return this.handle;
  },
  async gravar(nome, texto) {
    const fh = await this.handle.getFileHandle(nome, { create: true });
    const escrita = await fh.createWritable();
    await escrita.write(texto);
    await escrita.close();
  }
};

function planilhaParaObjetos(workbook, nomeAba) {
  const aba = workbook.Sheets[nomeAba];
  if (!aba) return [];
  return XLSX.utils.sheet_to_json(aba, { raw: false, defval: '' });
}

/* Cache de leitura por assinatura do arquivo (data de modificação + tamanho).
   Parsear o culturas.xlsx leva ~3 segundos; a cópia devolvida aqui leva ~0,1. Cada tela
   recebe uma CÓPIA para poder alterar à vontade — a cache nunca é entregue por referência.
   Se outro computador gravar o arquivo pela rede, a assinatura muda e a leitura volta ao
   disco sozinha. */
const _cacheBancos = new Map();

async function _assinaturaDe(nomeArquivo) {
  const fh = await pasta.handle.getFileHandle(nomeArquivo);
  const arquivo = await fh.getFile();
  return arquivo.lastModified + '-' + arquivo.size;
}

async function lerBanco(nomeEsquema) {
  const esquema = ESQUEMAS[nomeEsquema];
  let assinatura = null;
  try { assinatura = await _assinaturaDe(esquema.arquivo); } catch (e) { /* arquivo ainda não existe */ }
  const guardado = _cacheBancos.get(nomeEsquema);
  if (guardado && assinatura && guardado.assinatura === assinatura) {
    return structuredClone(guardado.dados);
  }
  const dados = await pasta.lerArquivo(esquema.arquivo);
  const wb = XLSX.read(dados, { type: 'array' });
  const resultado = {};
  for (const nomeAba of Object.keys(esquema.abas)) resultado[nomeAba] = planilhaParaObjetos(wb, nomeAba);
  /* Abas que alguém criou pelo Excel e o esquema não conhece: guardadas cruas para a
     próxima gravação recolocá-las no arquivo em vez de apagá-las. */
  const abasExtras = {};
  for (const nomeAba of wb.SheetNames) {
    if (!esquema.abas[nomeAba]) {
      abasExtras[nomeAba] = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, raw: false, defval: '' });
    }
  }
  _cacheBancos.set(nomeEsquema, { assinatura, dados: resultado, abasExtras });
  return structuredClone(resultado);
}

/* Grava o arquivo de um esquema. `abas` = { nomeAba: [objetos] }.
   Colunas do esquema na ordem do esquema; colunas que alguém acrescentou pelo Excel são
   preservadas depois delas, e abas desconhecidas voltam intactas — gravar um lote novo
   não pode apagar anotações feitas à mão. */
async function gravarBanco(nomeEsquema, abas) {
  const esquema = ESQUEMAS[nomeEsquema];
  const wb = XLSX.utils.book_new();
  for (const nomeAba of Object.keys(esquema.abas)) {
    const doEsquema = esquema.abas[nomeAba];
    const objetos = abas[nomeAba] || [];
    const extras = [];
    const conhecidas = new Set(doEsquema);
    for (const o of objetos) {
      for (const chave of Object.keys(o)) {
        if (!conhecidas.has(chave) && !chave.startsWith('_')) { conhecidas.add(chave); extras.push(chave); }
      }
    }
    const colunas = doEsquema.concat(extras);
    const limpos = objetos.map(o => {
      const limpo = {};
      colunas.forEach(c => { limpo[c] = o[c] == null ? '' : String(o[c]); });
      return limpo;
    });
    const aba = XLSX.utils.json_to_sheet(limpos, { header: colunas });
    XLSX.utils.book_append_sheet(wb, aba, nomeAba);
  }
  const extrasGuardadas = (_cacheBancos.get(nomeEsquema) || {}).abasExtras || {};
  for (const [nomeAba, linhas] of Object.entries(extrasGuardadas)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), nomeAba);
  }
  const saida = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  await pasta.gravarArquivo(esquema.arquivo, saida);
  /* A cache passa a refletir o que acabou de ser gravado, sem reler o arquivo. */
  let assinatura = null;
  try { assinatura = await _assinaturaDe(esquema.arquivo); } catch (e) { /* improvável */ }
  const dados = {};
  for (const nomeAba of Object.keys(esquema.abas)) dados[nomeAba] = abas[nomeAba] || [];
  _cacheBancos.set(nomeEsquema, { assinatura, dados: structuredClone(dados), abasExtras: extrasGuardadas });
}

function abasIniciais(nomeEsquema) {
  const abas = {};
  if (nomeEsquema === 'config') {
    Object.keys(VOCABULARIO_INICIAL).forEach(v => {
      abas[v] = VOCABULARIO_INICIAL[v].map(item => typeof item === 'string' ? { Nome: item } : item);
    });
    abas.meta = [{ Chave: 'versao_vocabulario', Valor: String(VOCAB_VERSAO) }];
  }
  return abas;
}

/* Confere a pasta inteira ANTES de criar ou migrar qualquer arquivo: sem isto, uma pasta
   escolhida por engano ganhava um banco novo em folha antes de o erro aparecer. Lê só os
   nomes das abas (bookSheets), então é barato mesmo no culturas.xlsx grande. */
async function conferirBancoDaPasta() {
  for (const nomeEsquema of Object.keys(ESQUEMAS)) {
    const esquema = ESQUEMAS[nomeEsquema];
    if (!await pasta.existe(esquema.arquivo)) continue;
    const wb = XLSX.read(await pasta.lerArquivo(esquema.arquivo), { type: 'array', bookSheets: true });
    if (!Object.keys(esquema.abas).some(aba => wb.SheetNames.includes(aba))) {
      throw new Error(`"${esquema.arquivo}" existe nesta pasta, mas não é um arquivo do banco da CCIH`
        + ` (abas encontradas: ${wb.SheetNames.join(', ') || 'nenhuma'}).`
        + ' Provavelmente a pasta escolhida não é a pasta de dados. Nada foi criado nem alterado.');
    }
  }
}

async function garantirEstrutura() {
  await conferirBancoDaPasta();
  for (const nomeEsquema of Object.keys(ESQUEMAS)) {
    const esquema = ESQUEMAS[nomeEsquema];
    if (await pasta.existe(esquema.arquivo)) {
      await migrarSeNecessario(nomeEsquema);
    } else {
      await gravarBanco(nomeEsquema, abasIniciais(nomeEsquema));
    }
  }
  await pasta.subpasta('importados');
}

/* Migração de esquema: quando o app evolui (aba ou coluna nova), atualiza o arquivo
   existente preservando os dados. No config, os vocabulários novos de fábrica são
   fundidos aos existentes sem apagar termos acrescentados ou editados pelo usuário. */
async function migrarSeNecessario(nomeEsquema) {
  const esquema = ESQUEMAS[nomeEsquema];
  const dados = await pasta.lerArquivo(esquema.arquivo);
  /* Para decidir se precisa migrar bastam os cabeçalhos — parsear as 38 mil linhas do
     culturas.xlsx só para olhar a primeira era o grosso do tempo de abertura. O config é a
     exceção (a decisão lê a aba meta inteira), e é pequeno. */
  const soCabecalho = nomeEsquema === 'config' ? {} : { sheetRows: 2 };
  const wb = XLSX.read(dados, { type: 'array', ...soCabecalho });
  /* Arquivo com o nome certo mas sem nenhuma aba do esquema não é banco da CCIH — é
     coincidência de nome (uma planilha de amostra, um relatório solto). Migrar por cima
     apagaria o conteúdo dele, então a conexão para aqui e explica. */
  if (!Object.keys(esquema.abas).some(aba => wb.Sheets[aba])) {
    throw new Error(`"${esquema.arquivo}" existe nesta pasta, mas não é um arquivo do banco da CCIH`
      + ` (abas encontradas: ${wb.SheetNames.join(', ') || 'nenhuma'}).`
      + ' Provavelmente a pasta escolhida não é a pasta de dados. Nada foi alterado.');
  }
  let precisa = false;
  for (const nomeAba of Object.keys(esquema.abas)) {
    const aba = wb.Sheets[nomeAba];
    if (!aba) { precisa = true; continue; }
    const cabecalho = ((XLSX.utils.sheet_to_json(aba, { header: 1 })[0]) || []).map(String);
    if (esquema.abas[nomeAba].some(c => !cabecalho.includes(c))) precisa = true;
  }
  if (nomeEsquema === 'config') {
    const metaLinhas = wb.Sheets.meta ? XLSX.utils.sheet_to_json(wb.Sheets.meta) : [];
    const versao = (metaLinhas.find(l => l.Chave === 'versao_vocabulario') || {}).Valor;
    if (Number(versao) !== VOCAB_VERSAO) precisa = true;
  }
  if (!precisa) return false;
  /* Só agora vale a pena parsear tudo — a migração é rara. */
  const wbCompleto = nomeEsquema === 'config' ? wb : XLSX.read(dados, { type: 'array' });
  const iniciais = abasIniciais(nomeEsquema);
  const abas = {};
  for (const nomeAba of Object.keys(esquema.abas)) {
    if (nomeAba === 'meta') { abas.meta = iniciais.meta; continue; }
    const existentes = planilhaParaObjetos(wbCompleto, nomeAba);
    if (nomeEsquema === 'config' && iniciais[nomeAba]) {
      const conhecidos = new Set(existentes.map(l => normalizarTexto(l.Nome)));
      const novos = iniciais[nomeAba].filter(l => l.Nome && !conhecidos.has(normalizarTexto(l.Nome)));
      abas[nomeAba] = existentes.concat(novos);
    } else {
      abas[nomeAba] = existentes;
    }
  }
  await gravarBanco(nomeEsquema, abas);
  return true;
}

/* Confere se as colunas esperadas existem (alguém pode ter mexido pelo Excel). */
async function validarEsquema(nomeEsquema) {
  const esquema = ESQUEMAS[nomeEsquema];
  const dados = await pasta.lerArquivo(esquema.arquivo);
  const wb = XLSX.read(dados, { type: 'array', sheetRows: 2 });
  const avisos = [];
  for (const nomeAba of Object.keys(esquema.abas)) {
    const aba = wb.Sheets[nomeAba];
    if (!aba) { avisos.push(`aba "${nomeAba}" não encontrada em ${esquema.arquivo}`); continue; }
    const linhas = XLSX.utils.sheet_to_json(aba, { header: 1 });
    const cabecalho = (linhas[0] || []).map(String);
    for (const coluna of esquema.abas[nomeAba]) {
      if (!cabecalho.includes(coluna)) avisos.push(`coluna "${coluna}" ausente na aba "${nomeAba}" de ${esquema.arquivo}`);
    }
  }
  return avisos;
}

/* ---- Travas por arquivo ---- */

function nomeTrava(nomeEsquema) { return ESQUEMAS[nomeEsquema].arquivo + '.trava.json'; }

/* Token da sessão: duas máquinas com o MESMO nome de usuário (comum: "Rogerio" em dois
   computadores) precisam se enxergar como sessões diferentes — comparar só o nome fazia a
   trava ser invisível justamente para quem mais importa. */
const TOKEN_SESSAO = Math.random().toString(36).slice(2) + Date.now().toString(36);

async function verificarTrava(nomeEsquema, usuario) {
  try {
    const dados = await pasta.lerArquivo(nomeTrava(nomeEsquema));
    const trava = JSON.parse(new TextDecoder().decode(dados));
    if (trava.token === TOKEN_SESSAO) return null;
    const renovada = new Date(trava.renovadaEm).getTime();
    /* Data ilegível = trava quebrada: tratar como expirada, senão ela bloqueia para sempre. */
    if (!isFinite(renovada)) return { expirada: true, trava };
    const idadeMin = (Date.now() - renovada) / 60000;
    if (idadeMin > TRAVA_EXPIRA_MIN) return { expirada: true, trava };
    return { ativa: true, trava };
  } catch (e) {
    return null;
  }
}

async function criarTrava(nomeEsquema, usuario) {
  const trava = { usuario, token: TOKEN_SESSAO, inicio: new Date().toISOString(), renovadaEm: new Date().toISOString() };
  await pasta.gravarArquivo(nomeTrava(nomeEsquema), new TextEncoder().encode(JSON.stringify(trava)));
}

/* Depois de criar, confirma que a trava no disco é a NOSSA: duas sessões podem passar pela
   verificação ao mesmo tempo e ambas criarem — a que perdeu a corrida precisa recuar. */
async function confirmarTrava(nomeEsquema) {
  try {
    const dados = await pasta.lerArquivo(nomeTrava(nomeEsquema));
    const trava = JSON.parse(new TextDecoder().decode(dados));
    return trava.token === TOKEN_SESSAO;
  } catch (e) { return false; }
}

async function liberarTrava(nomeEsquema) {
  await pasta.apagarArquivo(nomeTrava(nomeEsquema));
}

/* ---- Arquivamento do relatório bruto importado ---- */

async function arquivarOriginal(arquivo) {
  const mes = new Date().toISOString().slice(0, 7);
  const destino = await pasta.subpasta('importados/' + mes);
  const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const fh = await destino.getFileHandle(`${carimbo}_${arquivo.name}`, { create: true });
  const escrita = await fh.createWritable();
  await escrita.write(await arquivo.arrayBuffer());
  await escrita.close();
}
