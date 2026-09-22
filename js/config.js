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
  /* Rotina da instituição: quais antibióticos entram na avaliação rotineira e quais
     mecanismos de multirresistência disparam alerta/isolamento. LISTA VAZIA = TUDO —
     quem nunca configurou continua vendo o comportamento completo. */
  rotina: { atbAvaliados: [], mdrMonitorados: [], vigilanciaCategorias: [] },
  /* Equipe: [{Nome, Funcao (chave de FUNCOES_CCIH), CadaDias}] — uma linha por função. */
  profissionais: [],
  /* Grupos de setores para os relatórios padrão: [{Grupo, Setor}] — uma linha por membro
     (ex.: "UTIs" reúne o CTI e a UTI Neonatal). */
  gruposSetores: [],
  /* Conciliação com o Tasy (decisão da CCIH do HNSC, 22/09/2026): a partir desta data só o
     caso DIGITADO no Tasy conta nos relatórios; antes dela, o confirmado vale. Guardada na aba
     meta do config.xlsx (chave conciliacao_desde). */
  conciliacaoDesde: '2026-07-01',

  async carregar() {
    const dados = await lerBanco('config');
    this.perfis = dados.perfis || [];
    this.aliases = dados.aliases || [];
    this.procedimentosNHSN = dados.procedimentos_nhsn || [];
    this.antimicrobianos = dados.antimicrobianos || [];
    this.profissionais = dados.profissionais || [];
    this.gruposSetores = dados.grupos_setores || [];
    this.rotina = {
      atbAvaliados: (dados.atb_avaliados || []).map(l => l.Nome).filter(Boolean),
      mdrMonitorados: (dados.mdr_monitorados || []).map(l => l.Nome).filter(Boolean),
      vigilanciaCategorias: (dados.vigilancia_categorias || []).map(l => l.Nome).filter(Boolean)
    };
    for (const v of Object.keys(this.vocabulario)) {
      this.vocabulario[v] = (dados[v] || []).map(l => l.Nome).filter(Boolean);
    }
    const metaConciliacao = (dados.meta || []).find(l => l.Chave === 'conciliacao_desde');
    if (metaConciliacao && /^\d{4}-\d{2}-\d{2}$/.test(String(metaConciliacao.Valor || ''))) this.conciliacaoDesde = String(metaConciliacao.Valor);
    this.garantirCategoriasDeProcedimento();
  },

  /* O vocabulário de procedimentos é a lista de categorias do classificador: toda categoria
     que ele pode gravar em ProcedimentoNHSN precisa existir aqui (com o código NHSN e o
     tempo de corte padrão), senão a cirurgia importada aparece como termo desconhecido e o
     NNIS perde o corte. Não apaga nada do que a instituição já tem. */
  garantirCategoriasDeProcedimento() {
    if (typeof categoriasDeProcedimento !== 'function') return;
    const padrao = {};
    for (const p of (VOCABULARIO_INICIAL.procedimentos_nhsn || [])) padrao[p.Codigo] = p.TempoCorteHoras;
    const conhecidos = new Set(this.procedimentosNHSN.map(p => normalizarTexto(p.Nome)));
    for (const cat of categoriasDeProcedimento()) {
      if (conhecidos.has(normalizarTexto(cat.Nome))) {
        /* Já existe: só completa código/corte vazios. */
        const atual = this.procedimentosNHSN.find(p => normalizarTexto(p.Nome) === normalizarTexto(cat.Nome));
        if (!atual.Codigo && cat.Codigo) atual.Codigo = cat.Codigo;
        if (!atual.TempoCorteHoras && cat.Codigo && padrao[cat.Codigo]) atual.TempoCorteHoras = padrao[cat.Codigo];
        continue;
      }
      conhecidos.add(normalizarTexto(cat.Nome));
      this.procedimentosNHSN.push({ Nome: cat.Nome, Codigo: cat.Codigo, TempoCorteHoras: (cat.Codigo && padrao[cat.Codigo]) || '' });
    }
    const nomes = new Set(this.vocabulario.procedimentos_nhsn.map(normalizarTexto));
    for (const p of this.procedimentosNHSN) {
      if (p.Nome && !nomes.has(normalizarTexto(p.Nome))) { nomes.add(normalizarTexto(p.Nome)); this.vocabulario.procedimentos_nhsn.push(p.Nome); }
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
    const linhaConciliacao = meta.find(l => l.Chave === 'conciliacao_desde');
    if (linhaConciliacao) linhaConciliacao.Valor = this.conciliacaoDesde;
    else meta.push({ Chave: 'conciliacao_desde', Valor: this.conciliacaoDesde });
    const abas = { perfis: this.perfis, aliases: this.aliases, procedimentos_nhsn: this.procedimentosNHSN,
      antimicrobianos: this.antimicrobianos, meta,
      atb_avaliados: this.rotina.atbAvaliados.map(n => ({ Nome: n })),
      mdr_monitorados: this.rotina.mdrMonitorados.map(n => ({ Nome: n })),
      vigilancia_categorias: this.rotina.vigilanciaCategorias.map(n => ({ Nome: n })),
      /* Profissionais e grupos de setores NÃO passam pela fusão com o disco: a tela de
         edição é uma só, e a fusão impediria excluir alguém (o disco ressuscitaria a
         linha apagada). Vale a regra de quem salvou por último. */
      profissionais: this.profissionais,
      grupos_setores: this.gruposSetores };
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

  /* [nome do grupo] → [setores], na ordem em que os grupos foram criados. */
  gruposDeSetores() {
    const mapa = new Map();
    for (const linha of this.gruposSetores) {
      const grupo = String(linha.Grupo || '').trim(), setor = String(linha.Setor || '').trim();
      if (!grupo || !setor) continue;
      if (!mapa.has(grupo)) mapa.set(grupo, []);
      if (!mapa.get(grupo).includes(setor)) mapa.get(grupo).push(setor);
    }
    return mapa;
  },

  nomesDaEquipe() {
    return [...new Set(this.profissionais.map(p => String(p.Nome || '').trim()).filter(Boolean))];
  },

  funcoesDe(nome) {
    const alvo = normalizarTexto(nome);
    return this.profissionais.filter(p => normalizarTexto(p.Nome) === alvo && p.Funcao);
  },

  /* Vazio = avalia tudo (instituição que não configurou nada). */
  ehAtbAvaliado(antibiotico) {
    const lista = (this.rotina || {}).atbAvaliados || [];
    if (!lista.length) return true;
    return lista.some(n => normalizarTexto(n) === normalizarTexto(antibiotico));
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
