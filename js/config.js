/* Config em memória: perfis de importação, aliases e vocabulários (config.xlsx). */

const config = {
  perfis: [],
  aliases: [],
  vocabulario: { setores: [], materiais: [], microrganismos: [], antibioticos: [], topografias: [], procedimentos_nhsn: [] },
  procedimentosNHSN: [],
  /* Catálogo da farmácia: apresentação, princípio ativo e classe. Fica fora de
     `vocabulario` porque tem colunas próprias — `salvar` reescreve os vocabulários como
     lista de nomes e apagaria a classe. */
  antimicrobianos: [],

  async carregar() {
    const dados = await lerBanco('config');
    this.perfis = dados.perfis || [];
    this.aliases = dados.aliases || [];
    this.procedimentosNHSN = dados.procedimentos_nhsn || [];
    this.antimicrobianos = dados.antimicrobianos || [];
    for (const v of Object.keys(this.vocabulario)) {
      this.vocabulario[v] = (dados[v] || []).map(l => l.Nome).filter(Boolean);
    }
  },

  async salvar() {
    /* Antes de gravar, funde com o que está NO DISCO: outra sessão (outro computador na
       pasta da rede) pode ter salvo perfis e sinônimos depois que esta abriu — sobrescrever
       a partir da memória apagava o trabalho dela em silêncio. */
    try {
      const doDisco = await lerBanco('config');
      const meus = new Set(this.perfis.map(p => p.Fingerprint));
      this.perfis = this.perfis.concat((doDisco.perfis || []).filter(p => !meus.has(p.Fingerprint)));
      const aliasChave = a => a.Campo + '|' + normalizarTexto(a.De);
      const meusAliases = new Set(this.aliases.map(aliasChave));
      this.aliases = this.aliases.concat((doDisco.aliases || []).filter(a => !meusAliases.has(aliasChave(a))));
      for (const v of Object.keys(this.vocabulario)) {
        const conhecidos = new Set(this.vocabulario[v].map(normalizarTexto));
        for (const linha of (doDisco[v] || [])) {
          if (linha.Nome && !conhecidos.has(normalizarTexto(linha.Nome))) this.vocabulario[v].push(linha.Nome);
        }
      }
      const meusAtm = new Set(this.antimicrobianos.map(a => normalizarTexto(a.Codigo || a.Apresentacao)));
      this.antimicrobianos = this.antimicrobianos.concat((doDisco.antimicrobianos || [])
        .filter(a => !meusAtm.has(normalizarTexto(a.Codigo || a.Apresentacao))));
    } catch (e) { /* arquivo ainda não existe: primeira gravação */ }
    /* A aba meta (versão do vocabulário, modelo da mensagem de vigilância…) não vive na
       memória do config — vai de volta como está no disco, senão seria apagada aqui. */
    let meta = [];
    try { meta = (await lerBanco('config')).meta || []; } catch (e) { /* primeira gravação */ }
    if (!meta.some(l => l.Chave === 'versao_vocabulario')) {
      meta.push({ Chave: 'versao_vocabulario', Valor: String(VOCAB_VERSAO) });
    }
    const abas = { perfis: this.perfis, aliases: this.aliases, procedimentos_nhsn: this.procedimentosNHSN,
      antimicrobianos: this.antimicrobianos, meta };
    for (const v of Object.keys(this.vocabulario)) {
      if (v === 'procedimentos_nhsn') continue;
      abas[v] = this.vocabulario[v].map(nome => ({ Nome: nome }));
    }
    await gravarBanco('config', abas);
  },

  perfilPorFingerprint(fingerprint) {
    return this.perfis.find(p => p.Fingerprint === fingerprint) || null;
  },

  registrarPerfil(fingerprint, tipo, nome, linhaCabecalho, mapeamento, usuario) {
    this.perfis = this.perfis.filter(p => p.Fingerprint !== fingerprint);
    this.perfis.push({
      Fingerprint: fingerprint,
      Tipo: tipo,
      Nome: nome,
      LinhaCabecalho: String(linhaCabecalho),
      MapeamentoJSON: JSON.stringify(mapeamento.map(m => ({ coluna: m.coluna, cabecalho: m.cabecalho, destino: m.destino }))),
      CriadoPor: usuario,
      CriadoEm: new Date().toISOString().slice(0, 16).replace('T', ' ')
    });
  },

  acrescentarVocabulario(nomeVocab, termo) {
    if (!this.vocabulario[nomeVocab]) this.vocabulario[nomeVocab] = [];
    const existe = this.vocabulario[nomeVocab].some(t => normalizarTexto(t) === normalizarTexto(termo));
    if (existe) return;
    this.vocabulario[nomeVocab].push(termo);
    if (nomeVocab === 'procedimentos_nhsn') {
      this.procedimentosNHSN.push({ Nome: termo, Codigo: '', TempoCorteHoras: '' });
    }
  },

  registrarAlias(nomeVocab, de, para) {
    const ja = this.aliases.some(a => a.Campo === nomeVocab && normalizarTexto(a.De) === normalizarTexto(de));
    if (!ja) this.aliases.push({ Campo: nomeVocab, De: de, Para: para });
  },

  /* Classe farmacológica de um antimicrobiano, para agrupar consumo e resistência por
     classe em vez de droga a droga. Vazio quando o catálogo da farmácia não foi importado. */
  classeDoAntimicrobiano(nome) {
    const alvo = normalizarTexto(nome);
    if (!alvo) return '';
    const achado = this.antimicrobianos.find(a => normalizarTexto(a.Nome) === alvo);
    return achado ? (achado.Classe || '') : '';
  },

  tempoCortePorProcedimento() {
    const mapa = {};
    for (const p of this.procedimentosNHSN) {
      const horas = Number(String(p.TempoCorteHoras || '').replace(',', '.'));
      if (p.Nome && horas) mapa[normalizarTexto(p.Nome)] = horas;
    }
    return mapa;
  }
};
