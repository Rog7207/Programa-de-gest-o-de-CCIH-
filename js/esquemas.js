/* Esquemas do banco (arquivos Excel) e tipos de relatório do importador. */

const ESQUEMAS = {
  pacientes: {
    arquivo: 'pacientes.xlsx',
    abas: {
      pacientes: ['Prontuario', 'Nome', 'DataNascimento', 'Sexo', 'Telefone', 'CriadoPor', 'CriadoEm'],
      internacoes: ['ID_Internacao', 'Prontuario', 'Atendimento', 'DataInternacao', 'DataAlta', 'SetorAtual', 'Leito', 'Clinica', 'Desfecho', 'Obito', 'CriadoPor', 'CriadoEm'],
      obitos: ['ID_Obito', 'Prontuario', 'Atendimento', 'Nome', 'DataEntrada', 'DataObito', 'Idade', 'Sexo', 'Medico', 'Setor', 'CriadoPor', 'CriadoEm']
    }
  },
  culturas: {
    arquivo: 'culturas.xlsx',
    abas: {
      culturas: ['ID_Cultura', 'IDOrigem', 'Prontuario', 'DataColeta', 'DataResultado', 'Setor', 'Material', 'Sitio', 'Resultado', 'Microrganismo', 'MecanismoResistencia', 'Antibiograma', 'StatusRevisao', 'AvaliacaoCCIH', 'CriadoPor', 'CriadoEm'],
      sensibilidade: ['ID_Cultura', 'Antibiotico', 'Resultado']
    }
  },
  surtos: {
    arquivo: 'surtos.xlsx',
    abas: {
      investigacoes: ['ID_Surto', 'Setor', 'Microrganismo', 'DataInicio', 'DataFim', 'PacientesEnvolvidos',
        'Situacao', 'Hipotese', 'FonteProvavel', 'MedidasAdotadas', 'Conclusao', 'Responsavel',
        'DataAbertura', 'DataEncerramento', 'CriadoPor', 'CriadoEm', 'AtualizadoPor', 'AtualizadoEm'],
      documentos: ['ID_Surto', 'Arquivo', 'Descricao', 'CriadoPor', 'CriadoEm'],
      pacientes_surto: ['ID_Surto', 'Prontuario', 'ID_Cultura', 'DataColeta', 'Observacao']
    }
  },
  sepse: {
    arquivo: 'sepse.xlsx',
    abas: {
      casos: ['ID_Caso', 'Prontuario', 'Setor', 'DataProtocolo', 'DataEntrada', 'DataSaida', 'Desfecho',
        'SepseConfirmada', 'FocoInfeccioso', 'ClassificacaoNEWS', 'SBAR',
        'HoraNEWS', 'HoraNEWSEnf', 'HoraPrescricaoEnf', 'HoraChegadaMedico', 'HoraAntibiotico',
        'MinutosReavaliacaoNEWS', 'MinutosPrescricao', 'MinutosChegadaMedico', 'MinutosAntibiotico',
        'SituacaoAntibiotico', 'AntibioticoAte1h', 'HemoculturaAntesATB', 'SoroFisiologico1h', 'Lactato1h', 'DebitoUrinario1h',
        'O2ConformeProtocolo', 'ConformeProtocolo', 'BundleCompleto', 'Reavaliado1h', 'Reavaliado3h',
        'EvoluidoConfirmado', 'Medico', 'MotivoNaoConformidade', 'Observacoes',
        'ExcluidoIndicadores', 'MotivoExclusao', 'CriadoPor', 'CriadoEm']
    }
  },
  antibioticos: {
    arquivo: 'antibioticos.xlsx',
    abas: {
      prescricoes: ['ID_Prescricao', 'Prontuario', 'Antibiotico', 'Dose', 'Via', 'Frequencia', 'DataInicio', 'DataFim', 'Setor', 'Indicacao', 'UltimaEvolucao', 'Restrito', 'ParecerInfecto', 'CriadoPor', 'CriadoEm'],
      avaliacoes: ['ID_Prescricao', 'Prontuario', 'Antibiotico', 'Indicacao', 'Avaliacao', 'Recomendacao', 'ParecerTexto', 'Avaliador', 'DataDados', 'CriadoEm']
    }
  },
  cirurgias: {
    arquivo: 'cirurgias.xlsx',
    abas: {
      cirurgias: ['ID_Cirurgia', 'Prontuario', 'DataCirurgia', 'Procedimento', 'ProcedimentoNHSN', 'Cirurgiao', 'PotencialContaminacao', 'ASA', 'DuracaoMin', 'IndiceNNIS', 'Atendimento', 'Carater', 'ProfilaxiaAntibiotico', 'ProfilaxiaInicio', 'IntervaloProfilaxia', 'Obito', 'StatusVigilancia', 'VigilanciaPor', 'MensagemEnviadaEm', 'UltimoContato', 'ObservacoesVigilancia', 'ISC', 'TipoISC', 'ID_IRAS', 'InvestigadoPor', 'ValidadoPor', 'ValidadoEm', 'CriadoPor', 'CriadoEm']
    }
  },
  uti: {
    arquivo: 'uti.xlsx',
    abas: {
      visitas: ['ID_Visita', 'Data', 'Setor', 'Leito', 'Prontuario', 'CVC', 'CVC_Qtd', 'CVC_Indicacoes', 'CVC_Retirar', 'VM', 'VM_Indicacao', 'VM_Retirar', 'SVD', 'SVD_Indicacao', 'SVD_Retirar', 'NPT', 'SuspeitaIRAS', 'FocoSuspeito', 'Observacoes', 'CriadoPor', 'CriadoEm'],
      avaliacoes_atb: ['Data', 'Setor', 'Leito', 'Prontuario', 'Antibiotico', 'Indicacao', 'Avaliacao', 'Recomendacao', 'CriadoPor', 'CriadoEm']
    }
  },
  higiene_maos: {
    arquivo: 'higiene_maos.xlsx',
    abas: {
      observacoes: ['ID_Observacao', 'Data', 'Setor', 'Turno', 'Observador', 'Tecnica', 'TipoHigienizacao', 'Categoria', 'Momento', 'Acao', 'DuracaoSegundos', 'Ocorrencia', 'CriadoEm'],
      consumo_alcool: ['Mes', 'Setor', 'Volume_ml']
    }
  },
  iras: {
    arquivo: 'iras.xlsx',
    abas: {
      casos: ['ID_IRAS', 'Prontuario', 'DataInfeccao', 'Topografia', 'CriterioDiagnostico', 'Setor', 'DispositivoAssociado', 'Microrganismo', 'Desfecho', 'StatusInvestigacao', 'NotificadoANVISA', 'ConfirmadoPor', 'ConfirmadoEm', 'CriadoPor', 'CriadoEm']
    }
  },
  dispositivos: {
    arquivo: 'dispositivos.xlsx',
    abas: {
      dispositivos: ['ID_Dispositivo', 'Prontuario', 'Nome', 'Dispositivo', 'Categoria', 'DataInstalacao', 'DataRetirada', 'Status', 'CriadoPor', 'CriadoEm']
    }
  },
  isolamentos: {
    arquivo: 'isolamentos.xlsx',
    abas: {
      precaucoes: ['ID_Precaucao', 'Prontuario', 'Setor', 'Leito', 'TipoPrecaucao', 'Motivo', 'DataInternacao', 'DataInicio', 'DataFim', 'Status', 'VistoEm', 'CriadoPor', 'CriadoEm'],
      decisoes: ['ID_Cultura', 'Prontuario', 'Decisao', 'Justificativa', 'CriadoPor', 'CriadoEm']
    }
  },
  config: {
    arquivo: 'config.xlsx',
    abas: {
      perfis: ['Fingerprint', 'Tipo', 'Nome', 'LinhaCabecalho', 'MapeamentoJSON', 'CriadoPor', 'CriadoEm'],
      aliases: ['Campo', 'De', 'Para'],
      setores: ['Nome'],
      materiais: ['Nome'],
      microrganismos: ['Nome'],
      antibioticos: ['Nome'],
      topografias: ['Nome'],
      focos_sepse: ['Nome'],
      procedimentos_nhsn: ['Nome', 'Codigo', 'TempoCorteHoras'],
      antimicrobianos: ['Nome', 'Classe', 'Grupo', 'Apresentacao', 'Codigo', 'Padronizado'],
      categorias_profissionais: ['Nome'],
      momentos_higiene: ['Nome'],
      motivos_precaucao: ['Nome'],
      meta: ['Chave', 'Valor']
    }
  }
};

/* Aumente quando os vocabulários de fábrica mudarem — dispara a fusão nas pastas existentes. */
const VOCAB_VERSAO = 6;

/* Onde cada vocabulário aparece nos dados — usado pela unificação de termos. */
const VOCAB_APLICACAO = {
  materiais: [['culturas', 'culturas', 'Material']],
  microrganismos: [['culturas', 'culturas', 'Microrganismo'], ['iras', 'casos', 'Microrganismo']],
  antibioticos: [['culturas', 'sensibilidade', 'Antibiotico'], ['antibioticos', 'prescricoes', 'Antibiotico'],
    ['antibioticos', 'avaliacoes', 'Antibiotico'], ['uti', 'avaliacoes_atb', 'Antibiotico']],
  setores: [['sepse', 'casos', 'Setor'], ['culturas', 'culturas', 'Setor'], ['antibioticos', 'prescricoes', 'Setor'],
    ['pacientes', 'internacoes', 'SetorAtual'], ['iras', 'casos', 'Setor'],
    ['isolamentos', 'precaucoes', 'Setor'], ['uti', 'visitas', 'Setor'], ['higiene_maos', 'observacoes', 'Setor']],
  topografias: [['iras', 'casos', 'Topografia']],
  focos_sepse: [['sepse', 'casos', 'FocoInfeccioso']],
  procedimentos_nhsn: [['cirurgias', 'cirurgias', 'ProcedimentoNHSN']],
  categorias_profissionais: [['higiene_maos', 'observacoes', 'Categoria']],
  momentos_higiene: [['higiene_maos', 'observacoes', 'Momento']],
  motivos_precaucao: [['isolamentos', 'precaucoes', 'Motivo']]
};

/* Classificações que a CCIH dá a uma cultura. A lista é única para o app inteiro:
   revisão de culturas, página remota dos médicos e importação de relatórios já classificados. */
const CLASSIFICACOES_CULTURA = [
  'Presente na admissão', 'IRAS', 'Bacteremia secundária', 'Colonização', 'Contaminação',
  'Repetição', 'Informativa', 'Negativa', 'Água', 'Leite', 'Não é cultura'
];

/* Classificações que o app atribui sozinho na triagem (ver preClassificarCultura) e que,
   por não representarem infecção do paciente, ficam fora do painel e dos relatórios até
   que se peça para incluí-las. Nenhuma delas depende de julgamento clínico: ou a cultura
   não cresceu, ou o material é de vigilância, ou nem é do paciente (água, leite). */
const CLASSES_TRIAGEM = ['Negativa', 'Colonização', 'Água', 'Leite'];

/* Como cada relatório de origem escreve as classificações acima. */
const SINONIMOS_CLASSIFICACAO = {
  'admissao': 'Presente na admissão', 'presentenaadmissao': 'Presente na admissão',
  'comunitaria': 'Presente na admissão', 'infeccaocomunitaria': 'Presente na admissão',
  'iras': 'IRAS', 'infeccaohospitalar': 'IRAS', 'ih': 'IRAS',
  'bacteremiasecundaria': 'Bacteremia secundária',
  'colonizacao': 'Colonização', 'contaminacao': 'Contaminação',
  'repeticao': 'Repetição', 'informativo': 'Informativa', 'informativa': 'Informativa',
  'negativa': 'Negativa', 'negativo': 'Negativa', 'semcrescimento': 'Negativa',
  'agua': 'Água', 'controledeagua': 'Água', 'aguacontrole': 'Água',
  'leite': 'Leite', 'leitematerno': 'Leite', 'leitehumano': 'Leite',
  'leitehumanocontrole': 'Leite', 'controledeleite': 'Leite',
  'bacterioscopia': 'Não é cultura', 'baar': 'Não é cultura', 'naoecultura': 'Não é cultura'
};

const VOCAB_ROTULOS = {
  setores: 'Setores',
  materiais: 'Materiais',
  microrganismos: 'Microrganismos',
  antibioticos: 'Antibióticos',
  topografias: 'Topografias de IRAS',
  focos_sepse: 'Focos infecciosos (sepse)',
  procedimentos_nhsn: 'Procedimentos cirúrgicos (NHSN)',
  categorias_profissionais: 'Categorias profissionais (higiene das mãos)',
  momentos_higiene: 'Momentos da higiene das mãos',
  motivos_precaucao: 'Motivos de isolamento'
};

/* Vocabulários iniciais gravados na criação do config.xlsx */
const VOCABULARIO_INICIAL = {
  focos_sepse: [
    'Pulmonar', 'Abdominal', 'Urinário', 'Cutâneo / partes moles', 'Corrente sanguínea',
    'Sistema nervoso central', 'Osteoarticular', 'Hematológico', 'Cateter', 'Outro', 'Sem foco definido',
    'Sepse descartada'
  ],
  materiais: [
    'Hemocultura', 'Urocultura', 'Secreção traqueal', 'Lavado broncoalveolar',
    'Ponta de cateter', 'Líquor', 'Ferida operatória', 'Swab de vigilância',
    'Líquido pleural', 'Líquido ascítico', 'Escarro', 'Fezes', 'Secreção de partes moles',
    'Swab vaginal (pesquisa de SGB)', 'Fragmento de tecido', 'Outros'
  ],
  microrganismos: [
    'Staphylococcus aureus', 'Staphylococcus epidermidis', 'Staphylococcus haemolyticus',
    'Staphylococcus saprophyticus', 'Staphylococcus lugdunensis', 'Staphylococcus coagulase-negativo',
    'Enterococcus faecalis', 'Enterococcus faecium', 'Enterococcus spp',
    'Streptococcus pneumoniae', 'Streptococcus pyogenes (grupo A)', 'Streptococcus agalactiae (grupo B)',
    'Streptococcus grupo viridans', 'Streptococcus spp', 'Listeria monocytogenes', 'Corynebacterium spp',
    'Escherichia coli', 'Klebsiella pneumoniae', 'Klebsiella oxytoca', 'Klebsiella aerogenes',
    'Enterobacter cloacae (complexo)', 'Serratia marcescens', 'Proteus mirabilis', 'Proteus vulgaris',
    'Morganella morganii', 'Citrobacter freundii', 'Citrobacter koseri', 'Providencia stuartii',
    'Providencia rettgeri', 'Salmonella spp', 'Shigella spp',
    'Pseudomonas aeruginosa', 'Pseudomonas putida', 'Acinetobacter baumannii',
    'Stenotrophomonas maltophilia', 'Burkholderia cepacia (complexo)', 'Elizabethkingia meningoseptica',
    'Haemophilus influenzae', 'Moraxella catarrhalis', 'Neisseria meningitidis', 'Neisseria gonorrhoeae',
    'Clostridioides difficile', 'Bacteroides fragilis',
    'Mycobacterium tuberculosis', 'Micobactéria não tuberculosa',
    'Candida albicans', 'Candida glabrata', 'Candida tropicalis', 'Candida parapsilosis',
    'Candida krusei', 'Candida auris', 'Candida spp', 'Aspergillus spp', 'Cryptococcus neoformans', 'Fusarium spp',
    'Staphylococcus spp', 'Klebsiella spp', 'Enterobacter spp', 'Proteus spp', 'Citrobacter spp',
    'Providencia spp', 'Serratia spp', 'Pseudomonas spp', 'Acinetobacter spp', 'Escherichia spp',
    'Haemophilus spp', 'Neisseria spp', 'Bacteroides spp', 'Morganella spp',
    'Bacilo Gram negativo (não identificado)'
  ],
  antibioticos: [
    'Amicacina', 'Amoxicilina', 'Amoxicilina-clavulanato', 'Ampicilina', 'Ampicilina-sulbactam',
    'Aztreonam', 'Cefalotina', 'Cefazolina', 'Cefepima', 'Cefoxitina', 'Ceftazidima',
    'Ceftazidima-avibactam', 'Ceftriaxona', 'Cefuroxima', 'Ciprofloxacino', 'Clindamicina',
    'Colistina', 'Daptomicina', 'Ertapenem', 'Eritromicina', 'Gentamicina', 'Imipenem',
    'Levofloxacino', 'Linezolida', 'Meropenem', 'Metronidazol', 'Nitrofurantoína', 'Norfloxacino',
    'Oxacilina', 'Penicilina', 'Piperacilina-tazobactam', 'Polimixina B', 'Rifampicina',
    'Sulfametoxazol-trimetoprima', 'Teicoplanina', 'Tigeciclina', 'Vancomicina'
  ],
  /* Os 5 momentos da OMS, com a redação do Vigispec — é como o observador vê na tela. */
  momentos_higiene: [
    'Antes do contato com paciente', 'Antes de realizar procedimento',
    'Após risco de exposição a fluidos corporais', 'Após contato com paciente',
    'Após contato com áreas próxima ao paciente'
  ],
  categorias_profissionais: [
    'Médico', 'Enfermeiro', 'Técnico Enfermagem', 'Fisioterapeuta', 'Equipe Multidisciplinar',
    'Nutricionista', 'Farmacêutico', 'Higienização', 'Estudante', 'Outro'
  ],
  motivos_precaucao: [
    'Bactéria Identificada resistente aos carbapenêmicos',
    'Bactéria Identificada resistente aos carbapenêmicos (Swab de vigilância)',
    'Staphylococcus aureus Resistente a Oxacilina',
    'Enterococo resistente à vancomicina',
    'Provenientes de Outra Instituição de Saúde e outras condições',
    'Tuberculose Notificada', 'Tuberculose Suspeita',
    'Vírus Influenza', 'Vírus Adenovírus', 'Vírus Sincicial Respiratório',
    'COVID-19', 'Diarreia infecciosa', 'Escabiose', 'Meningite', 'Outro'
  ],
  setores: [],
  topografias: [
    'IPCS com confirmação laboratorial', 'IPCS clínica',
    'Pneumonia associada à ventilação mecânica (PAV)', 'Pneumonia não associada à VM',
    'Traqueobronquite', 'ITU associada a cateter vesical', 'ITU não associada a cateter',
    'ISC incisional superficial', 'ISC incisional profunda', 'ISC de órgão/espaço',
    'Infecção de pele e partes moles', 'Enterocolite por C. difficile', 'Gastroenterite',
    'Meningite/ventriculite', 'Sinusite', 'Conjuntivite', 'Endometrite', 'Endocardite', 'Osteomielite'
  ],
  /* Categorias de procedimento do NHSN traduzidas. TempoCorteHoras = ponto de corte de duração
     (percentil 75) usado no índice NNIS — conferir/completar na aba procedimentos_nhsn do config.xlsx. */
  procedimentos_nhsn: [
    { Nome: 'Apendicectomia', Codigo: 'APPY', TempoCorteHoras: '1' },
    { Nome: 'Cesariana', Codigo: 'CSEC', TempoCorteHoras: '1' },
    { Nome: 'Colecistectomia', Codigo: 'CHOL', TempoCorteHoras: '2' },
    { Nome: 'Cirurgia de cólon', Codigo: 'COLO', TempoCorteHoras: '3' },
    { Nome: 'Cirurgia de reto', Codigo: 'REC', TempoCorteHoras: '' },
    { Nome: 'Cirurgia de intestino delgado', Codigo: 'SB', TempoCorteHoras: '3' },
    { Nome: 'Cirurgia gástrica', Codigo: 'GAST', TempoCorteHoras: '3' },
    { Nome: 'Cirurgia de vias biliares/fígado/pâncreas', Codigo: 'BILI', TempoCorteHoras: '' },
    { Nome: 'Laparotomia exploradora', Codigo: 'XLAP', TempoCorteHoras: '' },
    { Nome: 'Herniorrafia', Codigo: 'HER', TempoCorteHoras: '2' },
    { Nome: 'Esplenectomia', Codigo: 'SPLE', TempoCorteHoras: '' },
    { Nome: 'Cirurgia cardíaca', Codigo: 'CARD', TempoCorteHoras: '5' },
    { Nome: 'Revascularização do miocárdio', Codigo: 'CBGB', TempoCorteHoras: '5' },
    { Nome: 'Cirurgia torácica', Codigo: 'THOR', TempoCorteHoras: '3' },
    { Nome: 'Bypass vascular periférico', Codigo: 'PVBY', TempoCorteHoras: '' },
    { Nome: 'Craniotomia', Codigo: 'CRAN', TempoCorteHoras: '4' },
    { Nome: 'Derivação ventricular (shunt)', Codigo: 'VSHN', TempoCorteHoras: '1' },
    { Nome: 'Laminectomia', Codigo: 'LAM', TempoCorteHoras: '2' },
    { Nome: 'Artrodese de coluna', Codigo: 'FUSN', TempoCorteHoras: '4' },
    { Nome: 'Artroplastia de quadril', Codigo: 'HPRO', TempoCorteHoras: '2' },
    { Nome: 'Artroplastia de joelho', Codigo: 'KPRO', TempoCorteHoras: '2' },
    { Nome: 'Redução aberta de fratura', Codigo: 'FX', TempoCorteHoras: '' },
    { Nome: 'Amputação de membro', Codigo: 'AMP', TempoCorteHoras: '' },
    { Nome: 'Histerectomia abdominal', Codigo: 'HYST', TempoCorteHoras: '2' },
    { Nome: 'Histerectomia vaginal', Codigo: 'VHYS', TempoCorteHoras: '2' },
    { Nome: 'Cirurgia de ovário', Codigo: 'OVRY', TempoCorteHoras: '' },
    { Nome: 'Prostatectomia', Codigo: 'PRST', TempoCorteHoras: '4' },
    { Nome: 'Nefrectomia', Codigo: 'NEPH', TempoCorteHoras: '' },
    { Nome: 'Mastectomia', Codigo: 'MAST', TempoCorteHoras: '3' },
    { Nome: 'Tireoidectomia', Codigo: 'THYR', TempoCorteHoras: '' },
    { Nome: 'Cirurgia de cabeça e pescoço', Codigo: 'NECK', TempoCorteHoras: '' }
  ]
};

/* Tipos de relatório externo que o importador aceita. */
const TIPOS_RELATORIO = {
  culturas: {
    rotulo: 'Culturas (laboratório)',
    destino: 'culturas',
    abaDestino: 'culturas',
    prefixoID: 'CUL',
    campoID: 'ID_Cultura',
    permiteAntibiograma: true,
    chaveNatural: ['Prontuario', 'DataColeta', 'Material', 'Microrganismo'],
    chaveOrigem: 'IDOrigem',
    campos: [
      { id: 'IDOrigem', rotulo: 'ID do exame no laboratório', tipo: 'texto', sinonimos: ['idcultura', 'idexame', 'idamostra', 'codigoexame', 'numeroexame', 'numeroamostra', 'requisicao', 'pedido', 'idorigem'] },
      { id: 'Prontuario', rotulo: 'Prontuário', obrigatorio: true, tipo: 'texto', sinonimos: ['prontuario', 'pront', 'nprontuario', 'numprontuario', 'registro', 'matricula', 'codigopaciente', 'codpaciente', 'atendimento'] },
      { id: 'NomePaciente', rotulo: 'Nome do paciente', tipo: 'texto', paraPacientes: true, sinonimos: ['nome', 'paciente', 'nomepaciente', 'nomedopaciente'] },
      { id: 'Telefone', rotulo: 'Telefone', tipo: 'texto', paraPacientes: true, sinonimos: ['telefone', 'fone', 'celular', 'contato'] },
      { id: 'DataColeta', rotulo: 'Data da coleta', obrigatorio: true, tipo: 'data', sinonimos: ['datacoleta', 'dtcoleta', 'coleta', 'datadacoleta', 'dataexame', 'dtexame'] },
      { id: 'DataResultado', rotulo: 'Data do resultado', tipo: 'data', sinonimos: ['dataresultado', 'dtresultado', 'dataliberacao', 'dtliberacao', 'liberacao'] },
      { id: 'Setor', rotulo: 'Setor', tipo: 'vocab', vocab: 'setores', sinonimos: ['setor', 'unidade', 'clinica', 'setorsolicitante', 'localizacao'] },
      { id: 'Material', rotulo: 'Material', obrigatorio: true, tipo: 'vocab', vocab: 'materiais', sinonimos: ['material', 'amostra', 'especime', 'tipoamostra', 'sitio', 'exame'] },
      { id: 'Resultado', rotulo: 'Resultado', tipo: 'texto', sinonimos: ['resultado', 'conclusao'] },
      { id: 'Microrganismo', rotulo: 'Microrganismo', tipo: 'vocab', vocab: 'microrganismos', sinonimos: ['microrganismo', 'microorganismo', 'germe', 'bacteria', 'agente', 'micro'] },
      { id: 'Sitio', rotulo: 'Sítio (agrupado)', tipo: 'texto', sinonimos: ['sitio', 'sitioagrupado', 'sitiodecoleta', 'sitiocoleta', 'sitioinfeccao', 'focoagrupado'] },
      { id: 'MecanismoResistencia', rotulo: 'Mecanismo de resistência', tipo: 'texto', sinonimos: ['mecanismo', 'mecanismoresistencia', 'resistencia', 'fenotipo', 'perfilresistencia'] },
      { id: 'AvaliacaoCCIH', rotulo: 'Classificação da CCIH', tipo: 'texto', sinonimos: ['classificacao', 'classificacaoccih', 'avaliacao', 'avaliacaoccih', 'conclusaoccih', 'classificacaofinal'] }
    ],
    fixos: { StatusRevisao: 'pendente' }
  },
  sepse: {
    rotulo: 'Protocolo de sepse (ficha de investigação)',
    destino: 'sepse',
    abaDestino: 'casos',
    prefixoID: 'SEP',
    campoID: 'ID_Caso',
    permiteAntibiograma: false,
    chaveNatural: ['Prontuario', 'DataProtocolo'],
    campos: [
      { id: 'Prontuario', rotulo: 'Prontuário', obrigatorio: true, tipo: 'texto', sinonimos: ['registro', 'prontuario', 'pront', 'matricula', 'atendimento'] },
      { id: 'NomePaciente', rotulo: 'Nome do paciente', tipo: 'texto', paraPacientes: true, sinonimos: ['nome', 'paciente', 'nomepaciente'] },
      { id: 'Setor', rotulo: 'Setor', tipo: 'vocab', vocab: 'setores', sinonimos: ['setor', 'unidade'] },
      { id: 'DataProtocolo', rotulo: 'Data do protocolo', obrigatorio: true, tipo: 'data', sinonimos: ['datadoprotocolo', 'dataprotocolo', 'dataabertura', 'data'] },
      { id: 'DataEntrada', rotulo: 'Entrada hospitalar', tipo: 'data', sinonimos: ['entrada', 'dataentrada', 'datadeentrada', 'internacao'] },
      { id: 'DataSaida', rotulo: 'Saída hospitalar', tipo: 'data', sinonimos: ['datadasaidahospitalar', 'datasaida', 'saidahospitalar', 'saida'] },
      { id: 'Desfecho', rotulo: 'Desfecho', tipo: 'texto', sinonimos: ['desfechogeral', 'desfecho'] },
      { id: 'SepseConfirmada', rotulo: 'Confirmou a sepse', tipo: 'simnao', sinonimos: ['confirmouasepse', 'confirmousepse', 'sepseconfirmada'] },
      { id: 'FocoInfeccioso', rotulo: 'Foco infeccioso', tipo: 'vocab', vocab: 'focos_sepse', sinonimos: ['focoinfeccioso', 'foco', 'sitioinfeccioso'] },
      { id: 'ClassificacaoNEWS', rotulo: 'Classificação NEWS', tipo: 'texto', sinonimos: ['classificacaonews', 'news', 'escorenews', 'pontuacaonews'] },
      { id: 'SBAR', rotulo: 'Comunicação SBAR aberta', tipo: 'simnao', sinonimos: ['comunicacaosbaraberta', 'sbar', 'comunicacaosbar'] },
      { id: 'HoraNEWS', rotulo: 'Horário do NEWS', tipo: 'hora', sinonimos: ['horariodonews', 'horanews'] },
      { id: 'HoraNEWSEnf', rotulo: 'Horário do NEWS pelo enfermeiro', tipo: 'hora', sinonimos: ['horariodonewsenf', 'horariodonewsenfermeiro', 'horanewsenf'] },
      { id: 'HoraPrescricaoEnf', rotulo: 'Horário da prescrição do enfermeiro', tipo: 'hora', sinonimos: ['horariodaprescricaoenf', 'horariodaprescricao', 'horaprescricao'] },
      { id: 'HoraChegadaMedico', rotulo: 'Horário de chegada do médico', tipo: 'hora', sinonimos: ['horariochegadamedico', 'horariodachegadadomedico', 'horachegadamedico'] },
      { id: 'HoraAntibiotico', rotulo: 'Horário do antibiótico', tipo: 'hora', sinonimos: ['horariodaadministracaodoantibiotico', 'horarioantibiotico', 'horaantibiotico'] },
      { id: 'AntibioticoAte1h', rotulo: 'Antibiótico em até 1 hora', tipo: 'simnao', sinonimos: ['recebeuantibioticoemmenosde1hora', 'recebeuantibioticoemmenosde1horacontardo1', 'antibioticoem1hora', 'atbem1hora'] },
      { id: 'ConformeProtocolo', rotulo: 'De acordo com o protocolo', tipo: 'simnao', sinonimos: ['deacordocomoprotocolo', 'conformeprotocolo'] },
      { id: 'O2ConformeProtocolo', rotulo: 'O2 conforme protocolo', tipo: 'simnao', sinonimos: ['o2conformeprotocolo', 'oxigenioconformeprotocolo'] },
      { id: 'HemoculturaAntesATB', rotulo: 'Hemoculturas antes do antibiótico', tipo: 'simnao', sinonimos: ['coletadoashemoculturasantesdoantibioticos', 'hemoculturaantesdoantibiotico', 'hemoculturas'] },
      { id: 'SoroFisiologico1h', rotulo: 'Volume na 1ª hora', tipo: 'simnao', sinonimos: ['500mldesfna1hora', '500mldesfna1horaacontardohorariodonew', 'expansaovolemica', 'volumena1hora'] },
      { id: 'Lactato1h', rotulo: 'Lactato na 1ª hora', tipo: 'simnao', sinonimos: ['lactatovistoem1hora', 'lactatovistoem1horacontardohorariodonews', 'lactatoem1hora', 'lactato'] },
      { id: 'DebitoUrinario1h', rotulo: 'Débito urinário na 1ª hora', tipo: 'simnao', sinonimos: ['medicaododebitona1hora', 'debitourinario', 'medicaodedebito'] },
      { id: 'BundleCompleto', rotulo: 'Bundle completo', tipo: 'simnao', sinonimos: ['bundlecompleto', 'pacotecompleto'] },
      { id: 'EvoluidoConfirmado', rotulo: 'Evoluído sepse confirmada/descartada', tipo: 'simnao', sinonimos: ['evoluidosepseconfirmadadescartada', 'evoluido'] },
      { id: 'Reavaliado1h', rotulo: 'Reavaliado na 1ª hora', tipo: 'simnao', sinonimos: ['reavaliado1hora', 'reavaliado1hora1', 'reavaliadonaprimeirahora'] },
      { id: 'Reavaliado3h', rotulo: 'Reavaliado na 3ª hora', tipo: 'simnao', sinonimos: ['reavaliado3hora', 'reavaliado3hora1', 'reavaliadonaterceirahora'] },
      { id: 'Medico', rotulo: 'Médico', tipo: 'texto', sinonimos: ['medico', 'medicoresponsavel'] },
      { id: 'Observacoes', rotulo: 'Observações', tipo: 'texto', sinonimos: ['observacoes', 'observacao'] },
      { id: 'MotivoExclusao', rotulo: 'Nota de exclusão dos indicadores', tipo: 'texto', sinonimos: ['motivoexclusao', 'excluirindicador'] }
    ],
    fixos: {}
  },
  antibioticos: {
    rotulo: 'Antibióticos prescritos',
    destino: 'antibioticos',
    abaDestino: 'prescricoes',
    prefixoID: 'PRE',
    campoID: 'ID_Prescricao',
    permiteAntibiograma: false,
    chaveNatural: ['Prontuario', 'Antibiotico', 'DataInicio'],
    campos: [
      { id: 'Prontuario', rotulo: 'Prontuário', obrigatorio: true, tipo: 'texto', sinonimos: ['prontuario', 'pront', 'nprontuario', 'numprontuario', 'registro', 'matricula', 'codigopaciente', 'codpaciente', 'atendimento'] },
      { id: 'NomePaciente', rotulo: 'Nome do paciente', tipo: 'texto', paraPacientes: true, sinonimos: ['nome', 'paciente', 'nomepaciente', 'nomedopaciente'] },
      { id: 'Antibiotico', rotulo: 'Antibiótico', obrigatorio: true, tipo: 'vocab', vocab: 'antibioticos', sinonimos: ['antibiotico', 'antimicrobiano', 'atb', 'medicamento', 'droga', 'farmaco', 'item'] },
      { id: 'Dose', rotulo: 'Dose', tipo: 'texto', sinonimos: ['dose', 'dosagem'] },
      { id: 'Via', rotulo: 'Via', tipo: 'texto', sinonimos: ['via', 'viaadm', 'viaadministracao'] },
      { id: 'Frequencia', rotulo: 'Frequência', tipo: 'texto', sinonimos: ['frequencia', 'freq', 'intervalo', 'posologia', 'aprazamento'] },
      { id: 'DataInicio', rotulo: 'Data de início', obrigatorio: true, tipo: 'data', sinonimos: ['datainicio', 'dtinicio', 'inicio', 'dataprescricao', 'dtprescricao'] },
      { id: 'DataFim', rotulo: 'Data de fim', tipo: 'data', sinonimos: ['datafim', 'dtfim', 'fim', 'datasuspensao', 'dtsuspensao', 'termino'] },
      { id: 'Setor', rotulo: 'Setor', tipo: 'vocab', vocab: 'setores', sinonimos: ['setor', 'unidade', 'clinica', 'localizacao'] },
      { id: 'Indicacao', rotulo: 'Indicação', tipo: 'texto', sinonimos: ['indicacao', 'justificativa', 'motivo'] },
      { id: 'UltimaEvolucao', rotulo: 'Última evolução', tipo: 'texto', sinonimos: ['evolucao', 'ultimaevolucao', 'evolucaomedica', 'historia', 'quadroclinico'] }
    ],
    fixos: { Restrito: '', ParecerInfecto: '' }
  },
  internacoes: {
    rotulo: 'Internações (censo)',
    destino: 'pacientes',
    abaDestino: 'internacoes',
    prefixoID: 'INT',
    campoID: 'ID_Internacao',
    permiteAntibiograma: false,
    chaveNatural: ['Atendimento', 'Prontuario', 'DataInternacao'],
    campos: [
      { id: 'Prontuario', rotulo: 'Prontuário', obrigatorio: true, tipo: 'texto', sinonimos: ['prontuario', 'numerodoprontuario', 'nprontuario', 'numprontuario', 'registro', 'matricula'] },
      { id: 'NomePaciente', rotulo: 'Nome do paciente', tipo: 'texto', paraPacientes: true, sinonimos: ['nome', 'paciente', 'nomepaciente', 'nomedopaciente'] },
      { id: 'Sexo', rotulo: 'Sexo', tipo: 'texto', paraPacientes: true, sinonimos: ['sexo'] },
      { id: 'DataNascimento', rotulo: 'Data de nascimento', tipo: 'data', paraPacientes: true, sinonimos: ['datanascimento', 'datanasc', 'dtnascimento', 'nascimento', 'datadenascimento'] },
      { id: 'Atendimento', rotulo: 'Nº do atendimento', tipo: 'texto', sinonimos: ['atendimento', 'numerodoatendimento', 'nratendimento', 'atend'] },
      { id: 'DataInternacao', rotulo: 'Data de entrada', obrigatorio: true, tipo: 'data', sinonimos: ['datadaentrada', 'dataentrada', 'dtentrada', 'datainternacao', 'entrada', 'admissao'] },
      { id: 'DataAlta', rotulo: 'Data da alta', tipo: 'data', sinonimos: ['datadaalta', 'dataalta', 'dtalta', 'alta', 'saida'] },
      { id: 'SetorAtual', rotulo: 'Setor', tipo: 'vocab', vocab: 'setores', sinonimos: ['setor', 'setordeatendimento', 'unidade', 'setoratual'] },
      { id: 'Leito', rotulo: 'Leito', tipo: 'texto', sinonimos: ['leito', 'numeroleito'] },
      { id: 'Clinica', rotulo: 'Clínica', tipo: 'texto', sinonimos: ['clinica', 'nomedaclinica', 'especialidade'] },
      { id: 'Desfecho', rotulo: 'Motivo da alta', tipo: 'texto', sinonimos: ['motivodealta', 'motivoalta', 'desfecho', 'dsmotivoalta'] }
    ],
    fixos: { Obito: '' }
  },
  altas: {
    rotulo: 'Altas (atualiza internações pelo atendimento)',
    destino: 'pacientes',
    abaDestino: 'internacoes',
    modo: 'atualizar_internacoes',
    prefixoID: 'INT',
    campoID: 'ID_Internacao',
    permiteAntibiograma: false,
    chaveNatural: ['Atendimento', 'DataAlta'],
    campos: [
      { id: 'Atendimento', rotulo: 'Nº do atendimento', obrigatorio: true, tipo: 'texto', sinonimos: ['atendimento', 'nratendimento', 'numerodoatendimento', 'atend'] },
      { id: 'DataAlta', rotulo: 'Data da alta', obrigatorio: true, tipo: 'data', sinonimos: ['dtalta', 'dataalta', 'datadaalta'] },
      { id: 'Desfecho', rotulo: 'Motivo da alta', tipo: 'texto', sinonimos: ['dsmotivoalta', 'motivodealta', 'motivoalta'] },
      { id: 'Obito', rotulo: 'Óbito (S/N)', tipo: 'texto', sinonimos: ['ieobito', 'obito'] }
    ],
    fixos: {}
  },
  cirurgias: {
    rotulo: 'Cirurgias realizadas',
    destino: 'cirurgias',
    abaDestino: 'cirurgias',
    prefixoID: 'CIR',
    campoID: 'ID_Cirurgia',
    permiteAntibiograma: false,
    chaveNatural: ['Prontuario', 'DataCirurgia', 'Procedimento'],
    exigeUmDe: ['Prontuario', 'Atendimento'],
    campos: [
      { id: 'Prontuario', rotulo: 'Prontuário', tipo: 'texto', sinonimos: ['prontuario', 'pront', 'nprontuario', 'numprontuario', 'registro', 'matricula', 'codigopaciente', 'codpaciente'] },
      { id: 'Atendimento', rotulo: 'Nº do atendimento', tipo: 'texto', sinonimos: ['atendimento', 'atend', 'nratendimento', 'numerodoatendimento'] },
      { id: 'NomePaciente', rotulo: 'Nome do paciente', tipo: 'texto', paraPacientes: true, sinonimos: ['nome', 'paciente', 'nomepaciente', 'nomedopaciente'] },
      { id: 'Telefone', rotulo: 'Telefone (vigilância pós-alta)', tipo: 'texto', paraPacientes: true, sinonimos: ['telefone', 'fone', 'celular', 'contato', 'telefonecontato', 'telefonepaciente'] },
      { id: 'DataCirurgia', rotulo: 'Data da cirurgia', obrigatorio: true, tipo: 'data', sinonimos: ['datacirurgia', 'datadacirurgia', 'dtcirurgia', 'datarealizacao', 'data', 'inicioreal'] },
      { id: 'Procedimento', rotulo: 'Procedimento', obrigatorio: true, tipo: 'vocab', vocab: 'procedimentos_nhsn', sinonimos: ['procedimento', 'descricaocirurgia', 'procedimentorealizado', 'descricaoprocedimento', 'nomedacirurgia'] },
      { id: 'Cirurgiao', rotulo: 'Cirurgião', tipo: 'texto', sinonimos: ['cirurgiao', 'medico', 'responsavel', 'equipe', 'cirurgiaoresponsavel'] },
      { id: 'PotencialContaminacao', rotulo: 'Potencial de contaminação', tipo: 'texto', sinonimos: ['potencialcontaminacao', 'potencialdecontaminacao', 'contaminacao', 'classificacaodaferida', 'ferida', 'potencial'] },
      { id: 'ASA', rotulo: 'ASA', tipo: 'texto', sinonimos: ['asa', 'classificacaoasa', 'riscoanestesico'] },
      { id: 'DuracaoMin', rotulo: 'Duração (minutos)', tipo: 'texto', sinonimos: ['duracao', 'duracaomin', 'tempocirurgico', 'tempo', 'duracaominutos'] },
      { id: 'HoraInicio', rotulo: 'Hora de início', tipo: 'texto', sinonimos: ['horainicio', 'horarioinicio', 'inicio', 'horainicial', 'iniciodoprocedimento'] },
      { id: 'HoraFim', rotulo: 'Hora de término', tipo: 'texto', sinonimos: ['horafim', 'horariofim', 'fim', 'termino', 'horafinal'] },
      { id: 'Carater', rotulo: 'Caráter (urgência/eletiva)', tipo: 'texto', sinonimos: ['carater', 'caraterdacirurgia', 'caratercirurgia'] },
      { id: 'ProfilaxiaAntibiotico', rotulo: 'Profilaxia — antibiótico', tipo: 'texto', sinonimos: ['antibiotico', 'antibioticoprofilaxia', 'profilaxia'] },
      { id: 'ProfilaxiaInicio', rotulo: 'Profilaxia — início adm.', tipo: 'texto', sinonimos: ['inicioadm', 'iniciodaadm', 'inicioadministracao'] },
      { id: 'IntervaloProfilaxia', rotulo: 'Intervalo antibiótico', tipo: 'texto', sinonimos: ['intervaloantibiotico', 'intervaloatb'] },
      { id: 'Obito', rotulo: 'Óbito / desfecho', tipo: 'texto', sinonimos: ['obito', 'desfecho', 'evolucao', 'tipodealta', 'motivoalta', 'motivodaalta', 'situacao', 'condicaoalta', 'statusalta'] }
    ],
    fixos: { ProcedimentoNHSN: '', IndiceNNIS: '', StatusVigilancia: 'pendente', ISC: '', TipoISC: '' }
  },
  dispositivos: {
    rotulo: 'Dispositivos invasivos',
    destino: 'dispositivos',
    abaDestino: 'dispositivos',
    prefixoID: 'DIS',
    campoID: 'ID_Dispositivo',
    permiteAntibiograma: false,
    chaveNatural: ['Nome', 'Dispositivo', 'DataInstalacao'],
    campos: [
      { id: 'Nome', rotulo: 'Nome do paciente', obrigatorio: true, tipo: 'texto', sinonimos: ['nome', 'paciente', 'nomedopaciente'] },
      { id: 'Prontuario', rotulo: 'Prontuário', tipo: 'texto', sinonimos: ['prontuario'] },
      { id: 'Dispositivo', rotulo: 'Dispositivo', obrigatorio: true, tipo: 'texto', sinonimos: ['dispositivo'] },
      { id: 'DataInstalacao', rotulo: 'Data de instalação', obrigatorio: true, tipo: 'data', sinonimos: ['datainstalacao', 'dtinstalacao', 'instalacao'] },
      { id: 'DataRetirada', rotulo: 'Data de retirada', tipo: 'data', sinonimos: ['dataretirada', 'dtretirada', 'retirada'] },
      { id: 'Status', rotulo: 'Status', tipo: 'texto', sinonimos: ['status', 'situacao'] }
    ],
    fixos: { Categoria: '' }
  },
  iras: {
    rotulo: 'Casos de IRAS (outro sistema)',
    destino: 'iras',
    abaDestino: 'casos',
    prefixoID: 'IRA',
    campoID: 'ID_IRAS',
    permiteAntibiograma: false,
    chaveNatural: ['Prontuario', 'DataInfeccao', 'Topografia'],
    campos: [
      { id: 'Prontuario', rotulo: 'Prontuário', obrigatorio: true, tipo: 'texto', sinonimos: ['prontuario', 'pront', 'nprontuario', 'numprontuario', 'registro', 'matricula', 'codigopaciente', 'codpaciente', 'atendimento'] },
      { id: 'NomePaciente', rotulo: 'Nome do paciente', tipo: 'texto', paraPacientes: true, sinonimos: ['nome', 'paciente', 'nomepaciente', 'nomedopaciente'] },
      { id: 'DataInfeccao', rotulo: 'Data da infecção', obrigatorio: true, tipo: 'data', sinonimos: ['datainfeccao', 'datadainfeccao', 'datadiagnostico', 'dtinfeccao', 'data'] },
      { id: 'Topografia', rotulo: 'Topografia', obrigatorio: true, tipo: 'vocab', vocab: 'topografias', sinonimos: ['topografia', 'sitio', 'tipodeinfeccao', 'tipoinfeccao', 'infeccao', 'topografiainfeccao', 'sitioinfeccao'] },
      { id: 'CriterioDiagnostico', rotulo: 'Critério diagnóstico', tipo: 'texto', sinonimos: ['criterio', 'criteriodiagnostico', 'criteriosdiagnosticos'] },
      { id: 'Setor', rotulo: 'Setor', tipo: 'vocab', vocab: 'setores', sinonimos: ['setor', 'unidade', 'clinica', 'localizacao'] },
      { id: 'DispositivoAssociado', rotulo: 'Dispositivo associado', tipo: 'texto', sinonimos: ['dispositivo', 'dispositivoassociado', 'dispositivoinvasivo'] },
      { id: 'Microrganismo', rotulo: 'Microrganismo', tipo: 'vocab', vocab: 'microrganismos', sinonimos: ['microrganismo', 'microorganismo', 'germe', 'bacteria', 'agente', 'micro'] },
      { id: 'Desfecho', rotulo: 'Desfecho', tipo: 'texto', sinonimos: ['desfecho', 'evolucao', 'resultado'] }
    ],
    fixos: { StatusInvestigacao: 'confirmado', NotificadoANVISA: '' }
  },
  obitos: {
    rotulo: 'Óbitos (desfecho das internações)',
    destino: 'pacientes',
    abaDestino: 'obitos',
    prefixoID: 'OBI',
    campoID: 'ID_Obito',
    permiteAntibiograma: false,
    chaveNatural: ['Atendimento', 'DataObito'],
    campos: [
      { id: 'Atendimento', rotulo: 'Atendimento', obrigatorio: true, tipo: 'texto', sinonimos: ['atendimento', 'natendimento', 'numeroatendimento', 'internacao', 'prontuario', 'registro'] },
      { id: 'Nome', rotulo: 'Nome do paciente', tipo: 'texto', sinonimos: ['paciente', 'nome', 'nomepaciente', 'nomedopaciente'] },
      { id: 'DataEntrada', rotulo: 'Entrada hospitalar', tipo: 'data', sinonimos: ['dataentrada', 'entrada', 'datainternacao', 'internacao', 'admissao'] },
      { id: 'DataObito', rotulo: 'Data do óbito', obrigatorio: true, tipo: 'data', sinonimos: ['dataobito', 'obito', 'dataoobito', 'datadoobito', 'falecimento'] },
      { id: 'Idade', rotulo: 'Idade', tipo: 'texto', sinonimos: ['idade', 'anos'] },
      { id: 'Sexo', rotulo: 'Sexo', tipo: 'texto', sinonimos: ['sexo', 'genero'] },
      { id: 'Medico', rotulo: 'Médico', tipo: 'texto', sinonimos: ['medico', 'medicoresponsavel', 'assistente'] },
      { id: 'Setor', rotulo: 'Setor', tipo: 'vocab', vocab: 'setores', sinonimos: ['setor', 'unidade', 'clinica', 'localizacao'] }
    ],
    fixos: { Prontuario: '' }
  },
  antimicrobianos: {
    rotulo: 'Catálogo de antimicrobianos (farmácia)',
    destino: 'config',
    abaDestino: 'antimicrobianos',
    prefixoID: 'ATM',
    /* A identidade é o código do material no sistema da farmácia — nosso ID nunca é usado,
       porque o campo `Codigo` vem preenchido do arquivo e sobrescreve o gerado. */
    campoID: 'Codigo',
    chaveOrigem: 'Codigo',
    permiteAntibiograma: false,
    chaveNatural: ['Apresentacao'],
    campos: [
      { id: 'Codigo', rotulo: 'Código do material', tipo: 'texto', sinonimos: ['cdmaterialestoque', 'codigo', 'codmaterial', 'cdmaterial'] },
      { id: 'Apresentacao', rotulo: 'Descrição / apresentação', obrigatorio: true, tipo: 'texto', sinonimos: ['dsmaterialestoquemestre', 'dsmaterialestoque', 'descricao', 'material', 'medicamento', 'produto'] },
      { id: 'Grupo', rotulo: 'Grupo (subgrupo do material)', tipo: 'texto', sinonimos: ['dssubgrupomaterial', 'subgrupo', 'grupo'] },
      { id: 'Classe', rotulo: 'Classe farmacológica', tipo: 'texto', sinonimos: ['dsclassematerial', 'classe', 'classematerial'] },
      { id: 'Padronizado', rotulo: 'Padronizado', tipo: 'texto', sinonimos: ['iepadronizado', 'padronizado'] }
    ]
  },
  higiene_maos: {
    rotulo: 'Higiene das mãos (observações)',
    destino: 'higiene_maos',
    abaDestino: 'observacoes',
    prefixoID: 'HIG',
    campoID: 'ID_Observacao',
    permiteAntibiograma: false,
    /* Duas observações idênticas no mesmo dia são normais — dois técnicos, mesmo momento,
       mesma ação. `Ocorrencia` numera as repetições dentro do lote para que a reimportação
       do mesmo arquivo case linha a linha em vez de colapsar tudo numa só. */
    chaveNatural: ['Data', 'Setor', 'Turno', 'Categoria', 'Momento', 'Acao', 'TipoHigienizacao', 'Ocorrencia'],
    numerarRepetidas: true,
    campos: [
      { id: 'Data', rotulo: 'Data', obrigatorio: true, tipo: 'data', sinonimos: ['data', 'dataobservacao', 'dtobservacao', 'dataoportunidade'] },
      { id: 'Setor', rotulo: 'Setor', obrigatorio: true, tipo: 'vocab', vocab: 'setores', sinonimos: ['setor', 'unidade', 'local', 'clinica'] },
      { id: 'Turno', rotulo: 'Turno', tipo: 'texto', sinonimos: ['turno', 'periodo'] },
      { id: 'Categoria', rotulo: 'Categoria profissional', tipo: 'vocab', vocab: 'categorias_profissionais', sinonimos: ['profissional', 'categoria', 'categoriaprofissional', 'funcao', 'cargo'] },
      { id: 'Momento', rotulo: 'Momento', obrigatorio: true, tipo: 'vocab', vocab: 'momentos_higiene', sinonimos: ['momento', 'momentoomsn', 'oportunidade', 'indicacao'] },
      { id: 'Adesao', rotulo: 'Adesão (o que foi feito)', obrigatorio: true, tipo: 'texto', sinonimos: ['adesao', 'acao', 'resultado', 'higienizacao', 'conduta'] },
      { id: 'Observador', rotulo: 'Observador', tipo: 'texto', sinonimos: ['observador', 'auditor', 'responsavel'] },
      { id: 'DuracaoSegundos', rotulo: 'Duração (segundos)', tipo: 'texto', sinonimos: ['duracao', 'duracaosegundos', 'tempo', 'segundos'] }
    ]
  },
  isolamentos: {
    rotulo: 'Pacientes em isolamento (foto do momento)',
    destino: 'isolamentos',
    abaDestino: 'precaucoes',
    prefixoID: 'PRE',
    campoID: 'ID_Precaucao',
    permiteAntibiograma: false,
    chaveNatural: ['Prontuario', 'TipoPrecaucao', 'DataInicio'],
    /* O setor não vem na linha do paciente: vem numa faixa acima do grupo, como no
       relatório impresso. Ver `faixaDeSetor` em importacao.js. */
    faixa: { campo: 'Setor' },
    /* Relatório paginado: repete título e cabeçalho a cada página e às vezes parte uma
       linha ao meio, deixando o fim dela logo depois do cabeçalho seguinte. */
    paginado: true,
    identidade: ['Prontuario', 'NomePaciente'],
    campos: [
      { id: 'Prontuario', rotulo: 'Atendimento / prontuário', obrigatorio: true, tipo: 'texto', sinonimos: ['atendimento', 'prontuario', 'pront', 'registro', 'matricula', 'codigopaciente'] },
      { id: 'NomePaciente', rotulo: 'Nome do paciente', tipo: 'texto', paraPacientes: true, sinonimos: ['paciente', 'nome', 'nomepaciente', 'nomedopaciente'] },
      { id: 'Setor', rotulo: 'Setor', tipo: 'vocab', vocab: 'setores', sinonimos: ['setor', 'unidade', 'clinica', 'localizacao'] },
      { id: 'Leito', rotulo: 'Leito', tipo: 'texto', sinonimos: ['leito', 'cama', 'quarto'] },
      { id: 'TipoPrecaucao', rotulo: 'Precaução', obrigatorio: true, tipo: 'texto', sinonimos: ['precaucao', 'tipoprecaucao', 'tipodeprecaucao', 'isolamento'] },
      { id: 'Motivo', rotulo: 'Motivo do isolamento', tipo: 'vocab', vocab: 'motivos_precaucao', sinonimos: ['motivoisolamento', 'motivo', 'indicacao', 'causa'] },
      { id: 'DataInternacao', rotulo: 'Data da internação', tipo: 'data', sinonimos: ['internacao', 'datainternacao', 'dtinternacao', 'admissao'] },
      { id: 'DataInicio', rotulo: 'Início do isolamento', obrigatorio: true, tipo: 'data', sinonimos: ['isolamento', 'datainicio', 'dtinicio', 'inicio', 'dataisolamento'] }
    ],
    fixos: { Status: 'ativo', DataFim: '' }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ESQUEMAS, TIPOS_RELATORIO, VOCABULARIO_INICIAL, VOCAB_ROTULOS, VOCAB_VERSAO, VOCAB_APLICACAO,
    CLASSIFICACOES_CULTURA, CLASSES_TRIAGEM, SINONIMOS_CLASSIFICACAO };
}
