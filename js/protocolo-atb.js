/* Decisão de antibioticoterapia empírica — núcleo puro (roda em Node, testável).
   As regras vêm do "Protocolo de Tratamento Empírico de Infecções na Emergência" da
   instituição (validado pela CCIH); o motor cruza a resposta do protocolo com os dados LOCAIS do
   banco: histórico do paciente (MDR, antibióticos e internações recentes) e o
   antibiograma acumulado do hospital. TUDO é apoio à decisão: a sugestão sai com a
   justificativa visível e nunca substitui o julgamento do médico assistente.

   Estrutura: cada síndrome tem `perguntas` (o que a tela pergunta) e `decidir(r)` —
   função pura que devolve { esquemas: [{rotulo, posologia, drogas}], exames, avisos }.
   `drogas` são nomes canônicos normalizáveis, usados para cruzar com o antibiograma. */

const REVISAO_PROTOCOLO_ATB = 'Reavaliação obrigatória em 48–72h com as culturas: desescalonar para menor '
  + 'espectro, migrar para via oral (paciente estável e afebril) ou suspender se culturas negativas '
  + 'sem outra justificativa clínica.';

const VANCO = 'Vancomicina 15–20 mg/kg IV de 8/8h ou 12/12h';

/* Definição única de "risco de MRSA" (CCIH, 06/09/2026; ATS/IDSA 2019 e IDSA 2014):
   marcar "sim" se qualquer um. Cada síndrome acrescenta os seus reforços. A pergunta
   `ajuda` aparece na tela abaixo do rótulo. */
const RISCO_MRSA_BASE = [
  'MRSA prévio: infecção ou colonização nos últimos 12 meses',
  'Internação ≥ 48 h, cirurgia ou antibiótico IV nos últimos 90 dias',
  'Hemodiálise, institucionalizado (ILPI) ou usuário de droga injetável',
  'Falha de beta-lactâmico em curso'
];
const riscoMRSA = (id, reforcos) => ({ id, rotulo: 'Risco de MRSA', tipo: 'sim_nao',
  ajuda: ['Marcar "sim" se qualquer um:', ...RISCO_MRSA_BASE, ...reforcos.map(r => r + ' (neste sítio)')] });

const PROTOCOLO_ATB = {
  /* Um protocolo por público (decisão de 03/10/2026): emergência adulto, UTI/nosocomial,
     gestante, pediatria — cada um com dono, versão e adendos próprios (PROTOCOLOS_ATB, no
     fim do arquivo). Este é o da emergência adulto. */
  id: 'emergencia-adulto', rotulo: 'Emergência — adulto', homologado: true,
  fonte: 'Protocolo de Tratamento Empírico de Infecções na Emergência — SCIH',
  /* Alterações de conduta validadas pela CCIH depois do documento original. Cada uma é
     uma decisão registrada aqui até ser incorporada ao texto do protocolo. */
  adendos: [
    { data: '2026-09-05', texto: 'Pneumonia aspirativa: ceftriaxona quando não há abscesso pulmonar; ampicilina-sulbactam '
      + 'reservada à aspirativa com abscesso (4 doses/dia — praticidade pesa na adesão).' },
    { data: '2026-09-05', texto: 'Pielonefrite/ITU em homem com TFG < 30: amicacina deixa de ser empírico de escolha '
      + '(nefrotoxicidade). Risco ESBL → ertapenem 1 g IV 1x/dia; alergia a beta-lactâmicos → levofloxacino com dose '
      + 'ajustada; ciprofloxacino VO ajustado para 24/24h.' },
    { data: '2026-09-06', texto: 'Função renal: a primeira dose é sempre plena; o ajuste começa na segunda dose, '
      + 'pela tabela de correção exibida junto do esquema. Nível sérico de vancomicina/amicacina quando disponível; '
      + 'sem dosagem, corrigir pela tabela e acompanhar creatinina.' },
    { data: '2026-09-06', texto: 'Risco de MRSA definido (MRSA prévio em 12 meses; internação/cirurgia/ATB IV em 90 dias; '
      + 'hemodiálise, ILPI ou droga injetável; falha de beta-lactâmico) com reforços por sítio — sem mudança de conduta.' },
    { data: '2026-09-06', texto: 'Pé diabético infectado acrescentado como síndrome (classificação IWGDF/IDSA 2023): leve VO, '
      + 'moderada ceftriaxona + metronidazol, grave piperacilina-tazobactam + vancomicina; vancomicina associada se risco de MRSA.' },
    { data: '2026-09-06', texto: 'Teicoplanina (12 mg/kg 12/12h × 3, depois 1x/dia, IV ou IM) como opção de transição em todo '
      + 'esquema com vancomicina fora do SNC — curso prolongado, alta precoce, ausência de dosagem sérica.' }
  ],
  publico: 'Adultos e adolescentes (>14 anos) com infecção presente na admissão (<48h de internação). '
    + 'Sepse com foco conhecido segue o protocolo institucional de sepse.',
  sindromes: [

    {
      id: 'urinario', rotulo: 'Foco urinário',
      germes: ['Escherichia coli', 'Klebsiella pneumoniae', 'Proteus mirabilis', 'Enterococcus spp'],
      perguntas: [
        /* O protocolo só chama de "cistite simples" a da mulher; ITU em homem, mesmo baixa,
           segue o caminho da pielonefrite (cultura antes da dose, esquema do tratamento 2º). */
        { id: 'sexo', rotulo: 'Paciente', tipo: 'escolha', opcoes: [['mulher', 'Mulher'], ['homem', 'Homem']] },
        { id: 'apresentacao', rotulo: 'Apresentação', tipo: 'escolha', opcoes: [
          ['cistite', 'Cistite (sintomas baixos, sem febre/dor lombar)'], ['pielonefrite', 'Pielonefrite']] },
        { id: 'internacao', rotulo: 'Necessita internação ou via oral inviável', tipo: 'sim_nao' },
        { id: 'riscoEsbl', rotulo: 'Risco ESBL: internação, antimicrobiano ou procedimento urológico nos últimos 90 dias', tipo: 'sim_nao' },
        { id: 'alergiaBL', rotulo: 'Alergia a beta-lactâmicos', tipo: 'sim_nao' },
        { id: 'tfgBaixa', rotulo: 'TFG < 30 mL/min', tipo: 'sim_nao' }
      ],
      decidir(r) {
        const cistiteSimples = r.apresentacao === 'cistite' && r.sexo !== 'homem';
        const ituHomemBaixa = r.apresentacao === 'cistite' && r.sexo === 'homem';
        const exames = cistiteSimples
          ? ['Cistite simples em mulher: diagnóstico clínico — não coletar exames de rotina.']
          : ['Urina tipo 1 (EAS) e urocultura com antibiograma ANTES da primeira dose.',
             '2 pares de hemoculturas se instabilidade hemodinâmica ou febre alta com calafrios.'];
        const avisosBase = ituHomemBaixa
          ? ['ITU em homem: o protocolo trata como ITU complicada (mesmo esquema da pielonefrite; nitrofurantoína/fosfomicina não se aplicam).']
          : [];
        if (cistiteSimples) {
          const esquemas = [];
          if (!r.tfgBaixa) esquemas.push({ rotulo: '1ª escolha', posologia: 'Nitrofurantoína 100 mg VO 12/12h por 5 dias', drogas: ['nitrofurantoina'] });
          esquemas.push({ rotulo: r.tfgBaixa ? '1ª escolha (TFG < 30: nitrofurantoína contraindicada)' : 'Alternativa',
            posologia: 'Fosfomicina trometamol 3 g VO, dose única', drogas: ['fosfomicina'] });
          esquemas.push({ rotulo: 'Segunda linha oral', posologia: 'Amoxicilina + Clavulanato 875/125 mg VO 12/12h por 5–7 dias', drogas: ['amoxicilinaacidoclavulanico'] });
          return { esquemas, exames, avisos: [] };
        }
        /* Adendo CCIH 05/09/2026: com TFG < 30 a amicacina sai do empírico. */
        const levoAjustado = 'Levofloxacino 750 mg IV no 1º dia, depois 750 mg a cada 48h (TFG 20–49) ou 500 mg a cada 48h (TFG < 20)';
        if (r.riscoEsbl) {
          const avisoEsbl = 'Risco ESBL assumido (internação/ATB/procedimento urológico em 90 dias).';
          if (r.tfgBaixa) {
            return { esquemas: [{ rotulo: 'Risco ESBL com TFG < 30', posologia: 'Ertapenem 1 g IV 1x/dia', drogas: ['ertapenem'] }],
              exames, avisos: [...avisosBase, avisoEsbl,
                'TFG < 30: amicacina evitada (nefrotoxicidade). Ertapenem cobre ESBL, não cobre Pseudomonas nem enterococo.'] };
          }
          return { esquemas: [{ rotulo: 'Risco ESBL', posologia: 'Amicacina 15 mg/kg IV 1x/dia', drogas: ['amicacina'] }],
            exames, avisos: [...avisosBase, avisoEsbl] };
        }
        if (r.alergiaBL) {
          if (r.tfgBaixa) {
            return { esquemas: [{ rotulo: 'Alergia a beta-lactâmicos com TFG < 30', posologia: levoAjustado, drogas: ['levofloxacino'] }],
              exames, avisos: [...avisosBase, 'TFG < 30: amicacina evitada (nefrotoxicidade). Se a quinolona não for opção, '
                + 'amicacina só em dose única com nível sérico — discutir com a CCIH.'] };
          }
          return { esquemas: [
            { rotulo: 'Alergia a beta-lactâmicos', posologia: 'Levofloxacino 750 mg IV 1x/dia', drogas: ['levofloxacino'] },
            { rotulo: 'Alternativa', posologia: 'Amicacina 15 mg/kg IV 1x/dia', drogas: ['amicacina'] }], exames, avisos: avisosBase };
        }
        if (r.internacao) {
          return { esquemas: [{ rotulo: ituHomemBaixa ? 'ITU em homem, internado' : 'Pielonefrite internada',
            posologia: 'Ceftriaxona 2 g IV 1x/dia', drogas: ['ceftriaxona'] }], exames, avisos: avisosBase };
        }
        const estavel = ituHomemBaixa ? 'ITU em homem, estável (VO)' : 'Pielonefrite estável (VO)';
        if (r.tfgBaixa) {
          return { esquemas: [
            { rotulo: estavel + ' — TFG < 30', posologia: 'Ciprofloxacino 500 mg VO 24/24h por 7 dias', drogas: ['ciprofloxacino'] },
            { rotulo: 'Alternativa', posologia: levoAjustado.replace('IV', 'VO'), drogas: ['levofloxacino'] }],
            exames, avisos: [...avisosBase, 'TFG < 30: doses de quinolona ajustadas à função renal.'] };
        }
        return { esquemas: [
          { rotulo: estavel, posologia: 'Ciprofloxacino 500 mg VO 12/12h por 7 dias', drogas: ['ciprofloxacino'] },
          { rotulo: 'Alternativa', posologia: 'Levofloxacino 750 mg VO 1x/dia por 5 dias', drogas: ['levofloxacino'] }], exames, avisos: avisosBase };
      }
    },

    {
      id: 'respiratorio', rotulo: 'Trato respiratório (PAC)',
      germes: ['Streptococcus pneumoniae', 'Haemophilus influenzae', 'Moraxella catarrhalis'],
      perguntas: [
        { id: 'gravidade', rotulo: 'Gravidade', tipo: 'escolha', opcoes: [
          ['leve', 'Leve a moderada, via oral viável'], ['internacao', 'Internação (enfermaria/UTI)']] },
        { id: 'comorbAtb90', rotulo: 'Comorbidades ou antibiótico nos últimos 90 dias', tipo: 'sim_nao' },
        { id: 'alergiaBLM', rotulo: 'Alergia a beta-lactâmicos/macrolídeos', tipo: 'sim_nao' },
        { id: 'aspirativa', rotulo: 'Pneumonia aspirativa', tipo: 'sim_nao' },
        { id: 'abscesso', rotulo: 'Abscesso pulmonar (na aspirativa)', tipo: 'sim_nao' },
        { id: 'riscoPseudomonas', rotulo: 'Risco para Pseudomonas (bronquiectasias, fibrose cística)', tipo: 'sim_nao' },
        riscoMRSA('riscoMRSA', ['Pós-influenza', 'Pneumonia cavitária/necrosante', 'Empiema'])
      ],
      decidir(r) {
        const exames = r.gravidade === 'leve'
          ? ['PAC leve: não coletar exames microbiológicos.']
          : ['2 pares de hemoculturas e cultura de escarro (se boa qualidade) antes do ATB.',
             'Derrame parapneumônico: toracocentese diagnóstica imediata (bioquímica, Gram, cultura).'];
        const esquemas = [];
        const avisos = [];
        if (r.alergiaBLM) {
          esquemas.push({ rotulo: 'Alergia a beta-lactâmicos/macrolídeos', posologia: 'Levofloxacino 750 mg IV/VO 1x/dia por 5 dias', drogas: ['levofloxacino'] });
          esquemas.push({ rotulo: 'Alternativa', posologia: 'Moxifloxacino 400 mg IV/VO 1x/dia por 5–7 dias', drogas: ['moxifloxacino'] });
        } else if (r.riscoPseudomonas) {
          esquemas.push({ rotulo: 'Risco de Pseudomonas', posologia: 'Piperacilina + Tazobactam 4,5 g IV 6/6h + Azitromicina 500 mg IV 1x/dia', drogas: ['piperacilinatazobactam', 'azitromicina'] });
        } else if (r.aspirativa && r.abscesso) {
          /* Adendo CCIH 05/09/2026: cobertura anaeróbia só quando há abscesso. */
          esquemas.push({ rotulo: 'Aspirativa com abscesso pulmonar', posologia: 'Ampicilina + Sulbactam 1,5–3 g IV 6/6h', drogas: ['ampicilinasulbactam'] });
        } else if (r.aspirativa) {
          esquemas.push({ rotulo: 'Pneumonia aspirativa sem abscesso', posologia: 'Ceftriaxona 2 g IV 1x/dia', drogas: ['ceftriaxona'] });
        } else if (r.gravidade === 'internacao') {
          esquemas.push({ rotulo: 'PAC internada (enfermaria/UTI)', posologia: 'Ceftriaxona 2 g IV 1x/dia + Azitromicina 500 mg IV/VO 1x/dia por 7 dias', drogas: ['ceftriaxona', 'azitromicina'] });
        } else if (r.comorbAtb90) {
          esquemas.push({ rotulo: 'Com comorbidades ou ATB em 90 dias', posologia: 'Amoxicilina + Clavulanato 875/125 mg VO 12/12h + Azitromicina 500 mg VO 1x/dia por 7 dias', drogas: ['amoxicilinaacidoclavulanico', 'azitromicina'] });
        } else {
          esquemas.push({ rotulo: 'Paciente hígido, sem ATB recente', posologia: 'Amoxicilina 1 g VO 8/8h por 5–7 dias', drogas: ['amoxicilina'] });
          esquemas.push({ rotulo: 'Alternativa', posologia: 'Azitromicina 500 mg VO 1x/dia por 5 dias', drogas: ['azitromicina'] });
        }
        if (r.riscoMRSA) {
          esquemas.push({ rotulo: 'Risco de MRSA hospitalar — ASSOCIAR', posologia: VANCO, drogas: ['vancomicina'] });
          avisos.push('Risco de MRSA: vancomicina associada ao esquema básico.');
        }
        return { esquemas, exames, avisos };
      }
    },

    {
      id: 'pele', rotulo: 'Pele e partes moles',
      germes: ['Streptococcus pyogenes', 'Staphylococcus aureus'],
      perguntas: [
        { id: 'tipo', rotulo: 'Tipo de infecção', tipo: 'escolha', opcoes: [
          ['nao_purulenta', 'Não purulenta (celulite/erisipela)'], ['purulenta', 'Purulenta (abscesso / suspeita CA-MRSA)'],
          ['necrosante', 'Necrosante (ex.: Fournier)']] },
        { id: 'grave', rotulo: 'Quadro grave / necessidade de internação', tipo: 'sim_nao' },
        riscoMRSA('riscoMRSAHosp', ['Abscessos múltiplos ou recorrentes', 'Ferida operatória (IRAS)', 'Infecção purulenta grave']),
        { id: 'alergiaBL', rotulo: 'Alergia a beta-lactâmicos', tipo: 'sim_nao' }
      ],
      decidir(r) {
        const exames = ['Erisipela/celulite típica: diagnóstico clínico, sem culturas de rotina.',
          'Quadros graves ou de origem hospitalar: 2 pares de hemoculturas.',
          'Abscesso/lesão purulenta: incisão e drenagem (conduta principal); enviar tecido/aspirado profundo '
          + 'para Gram e cultura (evitar swab superficial). Revisar vacinação antitetânica.'];
        if (r.tipo === 'necrosante') {
          return { esquemas: [{ rotulo: 'Infecção necrosante', posologia: 'Piperacilina + Tazobactam 4,5 g IV 6/6h + ' + VANCO, drogas: ['piperacilinatazobactam', 'vancomicina'] }],
            exames, avisos: ['Infecção necrosante: avaliação cirúrgica imediata é parte do tratamento.'] };
        }
        if (r.alergiaBL) {
          return { esquemas: [
            { rotulo: 'Alergia a beta-lactâmicos', posologia: 'Clindamicina 600 mg IV 8/8h', drogas: ['clindamicina'] },
            { rotulo: 'Alternativa', posologia: VANCO, drogas: ['vancomicina'] }], exames, avisos: [] };
        }
        if (r.riscoMRSAHosp) {
          return { esquemas: [{ rotulo: 'Risco MRSA hospitalar / falha prévia / IRAS', posologia: VANCO + ' (máx. 2 g por infusão)', drogas: ['vancomicina'] }], exames, avisos: [] };
        }
        if (r.grave) {
          return { esquemas: [
            { rotulo: 'Quadro grave comunitário', posologia: 'Ceftriaxona 2 g IV 1x/dia', drogas: ['ceftriaxona'] },
            { rotulo: 'Alternativa', posologia: 'Oxacilina 2 g IV 4/4h', drogas: ['oxacilina'] }], exames, avisos: [] };
        }
        if (r.tipo === 'purulenta') {
          return { esquemas: [
            { rotulo: 'Purulenta leve-moderada (CA-MRSA)', posologia: 'Sulfametoxazol + Trimetoprima 800/160 mg VO 12/12h por 5–7 dias', drogas: ['sulfametoxazoltrimetoprima'] },
            { rotulo: 'Alternativa', posologia: 'Doxiciclina 100 mg VO 12/12h por 5–7 dias', drogas: ['doxiciclina'] }], exames, avisos: [] };
        }
        return { esquemas: [
          { rotulo: 'Não purulenta leve-moderada', posologia: 'Cefalexina 500 mg–1 g VO 6/6h por 7–10 dias', drogas: ['cefalexina'] },
          { rotulo: 'Alternativa', posologia: 'Amoxicilina 500 mg–1 g VO 8/8h por 7–10 dias', drogas: ['amoxicilina'] }], exames, avisos: [] };
      }
    },

    {
      /* Acrescentado pela CCIH em 06/09/2026 (não consta do documento original). Classificação
         IWGDF/IDSA 2023; esquemas seguem a padronização da casa e a preferência por 1x/dia. */
      id: 'pe_diabetico', rotulo: 'Pé diabético infectado',
      germes: ['Staphylococcus aureus', 'Streptococcus spp', 'Escherichia coli', 'Klebsiella pneumoniae', 'Pseudomonas aeruginosa'],
      perguntas: [
        { id: 'gravidade', rotulo: 'Gravidade (IWGDF/IDSA)', tipo: 'escolha', opcoes: [
          ['leve', 'Leve — eritema ≤ 2 cm da úlcera, só pele/subcutâneo, sem sinais sistêmicos'],
          ['moderada', 'Moderada — eritema > 2 cm ou estrutura profunda (abscesso, fasciíte, osteomielite, artrite), sem sinais sistêmicos'],
          ['grave', 'Grave — sinais sistêmicos (SIRS) ou instabilidade']] },
        { id: 'osteomielite', rotulo: 'Suspeita de osteomielite (osso exposto, probe-to-bone positivo, úlcera > 2 cm ou > 6 semanas, imagem)', tipo: 'sim_nao' },
        riscoMRSA('riscoMRSA', ['Úlcera crônica com antibióticos repetidos', 'Amputação ou cirurgia prévia no pé']),
        { id: 'alergiaBL', rotulo: 'Alergia a beta-lactâmicos', tipo: 'sim_nao' }
      ],
      decidir(r) {
        const exames = ['Cultura de tecido profundo APÓS desbridamento (curetagem/biópsia) — swab superficial não orienta.',
          'Radiografia do pé em todos; probe-to-bone; PCR/VHS. Osteomielite: biópsia óssea antes do ATB se estável.',
          'Moderada/grave: 2 pares de hemoculturas. Avaliar perfusão (pulsos/ITB) e necessidade de desbridamento/drenagem — parte do tratamento.'];
        const avisos = [];
        if (r.osteomielite) avisos.push('Osteomielite suspeita: tratamento prolongado (≥ 6 semanas sem ressecção) — discutir com CCIH e ortopedia/vascular.');
        const esquemas = [];
        if (r.gravidade === 'grave') {
          if (r.alergiaBL) {
            esquemas.push({ rotulo: 'Grave, alergia a beta-lactâmicos', posologia: VANCO + ' + Ciprofloxacino 400 mg IV 12/12h + Metronidazol 500 mg IV 8/8h', drogas: ['vancomicina', 'ciprofloxacino', 'metronidazol'] });
          } else {
            esquemas.push({ rotulo: 'Grave (sinais sistêmicos)', posologia: 'Piperacilina + Tazobactam 4,5 g IV 6/6h + ' + VANCO, drogas: ['piperacilinatazobactam', 'vancomicina'] });
          }
          avisos.push('Grave: cobertura ampla (Gram-positivos, Gram-negativos, anaeróbios, MRSA) até cultura profunda — desescalonar em 48–72h.');
        } else if (r.gravidade === 'moderada') {
          if (r.alergiaBL) {
            esquemas.push({ rotulo: 'Moderada, alergia a beta-lactâmicos', posologia: 'Ciprofloxacino 400 mg IV 12/12h + Clindamicina 600 mg IV 8/8h', drogas: ['ciprofloxacino', 'clindamicina'] });
          } else {
            esquemas.push({ rotulo: 'Moderada', posologia: 'Ceftriaxona 2 g IV 1x/dia + Metronidazol 500 mg IV 8/8h', drogas: ['ceftriaxona', 'metronidazol'] });
            esquemas.push({ rotulo: 'Alternativa', posologia: 'Ampicilina + Sulbactam 3 g IV 6/6h', drogas: ['ampicilinasulbactam'] });
          }
          if (r.riscoMRSA) {
            esquemas.push({ rotulo: 'Risco de MRSA — ASSOCIAR', posologia: VANCO, drogas: ['vancomicina'] });
          }
        } else {
          if (r.alergiaBL) {
            esquemas.push({ rotulo: 'Leve, alergia a beta-lactâmicos', posologia: 'Clindamicina 300–450 mg VO 8/8h por 1–2 semanas', drogas: ['clindamicina'] });
          } else if (r.riscoMRSA) {
            esquemas.push({ rotulo: 'Leve com risco de MRSA', posologia: 'Sulfametoxazol + Trimetoprima 800/160 mg VO 12/12h por 1–2 semanas (+ Cefalexina se celulite estreptocócica)', drogas: ['sulfametoxazoltrimetoprima'] });
            esquemas.push({ rotulo: 'Alternativa', posologia: 'Doxiciclina 100 mg VO 12/12h por 1–2 semanas', drogas: ['doxiciclina'] });
          } else {
            esquemas.push({ rotulo: 'Leve', posologia: 'Cefalexina 500 mg–1 g VO 6/6h por 1–2 semanas', drogas: ['cefalexina'] });
            esquemas.push({ rotulo: 'Alternativa', posologia: 'Amoxicilina + Clavulanato 875/125 mg VO 12/12h por 1–2 semanas', drogas: ['amoxicilinaacidoclavulanico'] });
          }
        }
        return { esquemas, exames, avisos };
      }
    },

    {
      id: 'snc', rotulo: 'SNC (meningoencefalite bacteriana)',
      germes: ['Streptococcus pneumoniae', 'Neisseria meningitidis', 'Haemophilus influenzae'],
      perguntas: [
        { id: 'listeria', rotulo: 'Idade > 50 anos, gestante ou imunocomprometido', tipo: 'sim_nao' },
        { id: 'posNeuro', rotulo: 'Pós-neurocirurgia, derivação ou trauma craniano (IRAS)', tipo: 'sim_nao' }
      ],
      decidir(r) {
        const exames = ['Punção lombar imediata (salvo contraindicação): quimiocitológico, bioquímica, Gram, cultura; '
          + 'glicemia sérica simultânea.', '2 pares de hemoculturas imediatamente.',
          'NÃO atrasar o ATB por logística da PL. Isolamento respiratório nas primeiras 24h e notificação imediata à SCIH/NHE.'];
        if (r.posNeuro) {
          return { esquemas: [{ rotulo: 'Pós-neurocirurgia/derivação/TCE', posologia: 'Ceftazidima 2 g IV 8/8h + ' + VANCO, drogas: ['ceftazidima', 'vancomicina'] }], exames, avisos: [] };
        }
        const esquemas = [
          { rotulo: 'Corticoterapia adjuvante', posologia: 'Dexametasona 0,15 mg/kg IV 6/6h por 4 dias — primeira dose antes ou junto do ATB', drogas: [] },
          { rotulo: 'Esquema padrão', posologia: 'Ceftriaxona 2 g IV 12/12h + ' + VANCO, drogas: ['ceftriaxona', 'vancomicina'] }];
        if (r.listeria) {
          esquemas.push({ rotulo: 'Cobertura de Listeria — ASSOCIAR', posologia: 'Ampicilina 2 g IV 4/4h', drogas: ['ampicilina'] });
        }
        return { esquemas, exames, avisos: [] };
      }
    },

    {
      id: 'abdominal', rotulo: 'Intra-abdominal',
      germes: ['Escherichia coli', 'Klebsiella pneumoniae'],
      perguntas: [
        { id: 'alergiaBL', rotulo: 'Alergia a beta-lactâmicos', tipo: 'sim_nao' },
        { id: 'riscoMDR', rotulo: 'Risco de multirresistência (ESBL / IRAS)', tipo: 'sim_nao' }
      ],
      decidir(r) {
        const exames = ['Leve/moderado com controle cirúrgico rápido: sem culturas.',
          'Grave/peritonite difusa: 2 pares de hemoculturas.',
          'Drenagem cirúrgica/abscesso: líquido peritoneal para Gram e cultura (pode semear em frasco de hemocultura, rotulado).'];
        if (r.riscoMDR) {
          return { esquemas: [{ rotulo: 'Risco de multirresistência (ESBL/IRAS)', posologia: 'Piperacilina + Tazobactam 4,5 g IV 6/6h', drogas: ['piperacilinatazobactam'] }], exames, avisos: [] };
        }
        if (r.alergiaBL) {
          return { esquemas: [{ rotulo: 'Alergia a beta-lactâmicos', posologia: 'Ciprofloxacino 400 mg IV 12/12h + Metronidazol 500 mg IV 8/8h', drogas: ['ciprofloxacino', 'metronidazol'] }], exames, avisos: [] };
        }
        return { esquemas: [
          { rotulo: 'Infecção comunitária', posologia: 'Ceftriaxona 2 g IV 1x/dia + Metronidazol 500 mg IV 8/8h (6/6h se peritonite grave)', drogas: ['ceftriaxona', 'metronidazol'] },
          { rotulo: 'Transição VO (alta)', posologia: 'Amoxicilina + Clavulanato 875/125 mg VO 12/12h', drogas: ['amoxicilinaacidoclavulanico'] }], exames, avisos: [] };
      }
    },

    {
      id: 'osteoarticular', rotulo: 'Osteoarticular (artrite séptica / osteomielite)',
      germes: ['Staphylococcus aureus', 'Streptococcus spp'],
      perguntas: [
        { id: 'idosoComorb', rotulo: 'Idoso, diabético ou comorbidades crônicas', tipo: 'sim_nao' },
        { id: 'posTrauma', rotulo: 'Pós-trauma ou procedimento cirúrgico prévio (IRAS)', tipo: 'sim_nao',
          ajuda: ['Inclui prótese ou material de síntese e pós-operatório recente — risco de MRSA e Pseudomonas.'] },
        { id: 'alergiaBL', rotulo: 'Alergia a beta-lactâmicos', tipo: 'sim_nao' },
        { id: 'riscoGramNeg', rotulo: 'Fator de risco para Gram-negativos', tipo: 'sim_nao' }
      ],
      decidir(r) {
        const exames = ['2 pares de hemoculturas obrigatórios para todos.',
          'Artrite séptica: artrocentese imediata — celularidade, glicose, Gram, cultura (pode semear em frasco de hemocultura).',
          'Osteomielite: biópsia óssea/fragmento profundo em centro cirúrgico (evitar secreção de fístula superficial).'];
        if (r.posTrauma) {
          return { esquemas: [{ rotulo: 'Pós-trauma / pós-operatório (risco MRSA/Pseudomonas)', posologia: 'Ceftazidima 2 g IV 8/8h + ' + VANCO, drogas: ['ceftazidima', 'vancomicina'] }], exames, avisos: [] };
        }
        if (r.alergiaBL) {
          const esquemas = [
            { rotulo: 'Alergia a beta-lactâmicos', posologia: 'Clindamicina 600 mg IV 8/8h', drogas: ['clindamicina'] },
            { rotulo: 'Alternativa', posologia: 'Vancomicina 15–20 mg/kg IV 12/12h', drogas: ['vancomicina'] }];
          if (r.riscoGramNeg) esquemas.push({ rotulo: 'Risco de Gram-negativos — ASSOCIAR', posologia: 'Ciprofloxacino 400 mg IV 12/12h', drogas: ['ciprofloxacino'] });
          return { esquemas, exames, avisos: [] };
        }
        if (r.idosoComorb) {
          return { esquemas: [
            { rotulo: 'Idoso/diabético/comorbidades', posologia: 'Ceftriaxona 2 g IV 1x/dia', drogas: ['ceftriaxona'] },
            { rotulo: 'Alternativa', posologia: 'Ampicilina + Sulbactam 3 g IV 6/6h', drogas: ['ampicilinasulbactam'] }], exames, avisos: [] };
        }
        return { esquemas: [{ rotulo: 'Adulto jovem e hígido', posologia: 'Oxacilina 2 g IV 4/4h', drogas: ['oxacilina'] }], exames, avisos: [] };
      }
    },

    {
      id: 'biliar', rotulo: 'Trato biliar (colecistite/colangite)',
      germes: ['Escherichia coli', 'Klebsiella pneumoniae', 'Enterococcus spp'],
      perguntas: [
        { id: 'grave', rotulo: 'Quadro grave, colangite supurativa obstrutiva ou manipulação biliar prévia', tipo: 'sim_nao' },
        { id: 'alergiaBL', rotulo: 'Alergia a beta-lactâmicos', tipo: 'sim_nao' }
      ],
      decidir(r) {
        const exames = ['2 pares de hemoculturas se colangite ou repercussão sistêmica (febre/calafrios).',
          'CPRE/cirurgia biliar: enviar bile aspirada para cultura.'];
        if (r.grave) {
          return { esquemas: [{ rotulo: 'Grave / obstrutiva / manipulação prévia', posologia: 'Piperacilina + Tazobactam 4,5 g IV 6/6h', drogas: ['piperacilinatazobactam'] }], exames, avisos: [] };
        }
        if (r.alergiaBL) {
          return { esquemas: [{ rotulo: 'Alergia a beta-lactâmicos', posologia: 'Ciprofloxacino 400 mg IV 12/12h + Metronidazol 500 mg IV 8/8h', drogas: ['ciprofloxacino', 'metronidazol'] }], exames, avisos: [] };
        }
        return { esquemas: [
          { rotulo: 'Leve-moderado comunitário', posologia: 'Ceftriaxona 2 g IV 1x/dia + Metronidazol 500 mg IV 8/8h', drogas: ['ceftriaxona', 'metronidazol'] },
          { rotulo: 'Monoterapia alternativa', posologia: 'Ampicilina + Sulbactam 3 g IV 6/6h', drogas: ['ampicilinasulbactam'] }], exames, avisos: [] };
      }
    },

    {
      id: 'sepse_fi', rotulo: 'Sepse de foco indeterminado',
      germes: ['Escherichia coli', 'Klebsiella pneumoniae', 'Staphylococcus aureus'],
      perguntas: [
        { id: 'riscoMDR', rotulo: 'Fatores de risco para multirresistentes / IRAS', tipo: 'sim_nao' },
        { id: 'choque', rotulo: 'Choque séptico', tipo: 'sim_nao' }
      ],
      decidir(r) {
        const exames = ['2 pares de hemoculturas de sítios diferentes IMEDIATAMENTE — meta: coleta e primeira dose na 1ª hora.',
          'Exames rápidos conforme suspeita (urina 1, RX tórax, TC) sem postergar o antibiótico.'];
        if (r.riscoMDR) {
          return { esquemas: [
            { rotulo: 'Com risco de MDR/IRAS', posologia: 'Piperacilina + Tazobactam 4,5 g IV 6/6h + ' + VANCO, drogas: ['piperacilinatazobactam', 'vancomicina'] },
            { rotulo: 'Alternativa', posologia: 'Cefepima 2 g IV 8/8h + ' + VANCO, drogas: ['cefepima', 'vancomicina'] }], exames, avisos: [] };
        }
        const posologia = 'Ceftriaxona 2 g IV 1x/dia' + (r.choque ? ' — considerar dose de ataque 2 g IV 12/12h no primeiro dia (choque séptico)' : '');
        return { esquemas: [{ rotulo: 'Sepse comunitária pura', posologia, drogas: ['ceftriaxona'] }], exames, avisos: [] };
      }
    }
  ]
};

/* ---- Teicoplanina para curso prolongado (CCIH, 06/09/2026) ----
   Todo esquema com vancomicina fora do SNC ganha a opção de transição: 1x/dia, IM possível,
   menos nefrotóxica e menos dependente de nível sérico (que a casa não tem). Não é o
   empírico inicial — a carga de 3 dias atrasa o alvo; entra quando o curso vai ser longo
   (osteomielite, pé diabético, prótese) ou para alta precoce. Aplicado por embrulho sobre
   `decidir`, para valer em toda síndrome sem duplicar a regra. */
const TEICOPLANINA = { rotulo: 'Curso prolongado (≥ 2 semanas) ou transição para 1x/dia / IM',
  posologia: 'Teicoplanina 12 mg/kg IV ou IM 12/12h por 3 doses, depois 12 mg/kg 1x/dia (no lugar da vancomicina; não em SNC)',
  drogas: ['teicoplanina'] };
for (const sindrome of PROTOCOLO_ATB.sindromes) {
  if (sindrome.id === 'snc') continue;
  const original = sindrome.decidir;
  sindrome.decidir = function (r) {
    const decisao = original.call(this, r);
    if (decisao.esquemas.some(e => (e.drogas || []).includes('vancomicina'))) decisao.esquemas.push(TEICOPLANINA);
    return decisao;
  };
}

/* ---- Ajuste à função renal ----
   Regra do protocolo (CCIH, 06/09/2026): a PRIMEIRA dose é sempre plena — dose de ataque —
   qualquer que seja a função renal; o ajuste começa na segunda dose. Faixas em TFG/ClCr
   (mL/min), adulto. Só constam as drogas dos esquemas que precisam de ajuste; as demais
   (ceftriaxona, metronidazol, azitromicina, clindamicina, doxiciclina, oxacilina,
   moxifloxacino, fosfomicina) não ajustam. Referência: bula/Sanford — conferir com a
   farmácia em diálise. */
const ORIENTACAO_RENAL = 'Primeira dose sempre plena (dose de ataque), qualquer que seja a função renal. '
  + 'O ajuste começa na SEGUNDA dose, pela TFG/ClCr. Vancomicina e amicacina: nível sérico QUANDO DISPONÍVEL; '
  + 'sem dosagem, corrigir pela tabela e acompanhar creatinina a cada 48 h.';

const AJUSTE_RENAL = {
  vancomicina: { rotulo: 'Vancomicina', nota: 'Ataque 20–25 mg/kg (máx. 2 g). Se houver dosagem: vale 15–20 mg/L antes da 4ª dose. '
    + 'Sem dosagem: tabela + creatinina a cada 48 h.', faixas: [
    ['> 90', '15–20 mg/kg 8/8h a 12/12h'], ['50–90', '15–20 mg/kg 12/12h'], ['30–49', '15–20 mg/kg 24/24h'],
    ['15–29', '15–20 mg/kg 48/48h'], ['< 15 / diálise', 'ataque 15–20 mg/kg; depois 500 mg–1 g após cada sessão de diálise']] },
  amicacina: { rotulo: 'Amicacina', nota: '1ª dose 15 mg/kg plena. Se houver dosagem: vale < 5 mg/L antes de redosar. '
    + 'Sem dosagem: tabela, curso curto (≤ 5–7 dias) e creatinina a cada 48 h; com TFG < 30 preferir alternativa.', faixas: [
    ['≥ 60', '15 mg/kg 24/24h'], ['40–59', '15 mg/kg 36/36h'], ['20–39', '15 mg/kg 48/48h'],
    ['10–19', '7,5 mg/kg 48/48h'], ['< 10 / diálise', '7,5 mg/kg após cada sessão de diálise']] },
  ciprofloxacino: { rotulo: 'Ciprofloxacino', faixas: [
    ['≥ 30', 'sem ajuste'], ['5–29', 'IV 400 mg 24/24h · VO 250–500 mg 24/24h'], ['diálise', 'como 5–29, dose após a sessão']] },
  levofloxacino: { rotulo: 'Levofloxacino', faixas: [
    ['≥ 50', '750 mg 24/24h'], ['20–49', '750 mg 48/48h'], ['10–19 / diálise', '750 mg no 1º dia, depois 500 mg 48/48h']] },
  piperacilinatazobactam: { rotulo: 'Piperacilina-tazobactam', faixas: [
    ['> 40', '4,5 g 6/6h'], ['20–40', '3,375 g 6/6h'], ['< 20', '2,25 g 6/6h'], ['diálise', '2,25 g 8/8h + 0,75 g após a sessão']] },
  cefepima: { rotulo: 'Cefepima', faixas: [
    ['> 60', '2 g 8/8h'], ['30–60', '2 g 12/12h'], ['11–29', '2 g 24/24h'], ['< 11 / diálise', '1 g 24/24h (após a sessão)']] },
  ceftazidima: { rotulo: 'Ceftazidima', faixas: [
    ['> 50', '2 g 8/8h'], ['31–50', '1 g 12/12h'], ['16–30', '1 g 24/24h'], ['6–15', '500 mg 24/24h'], ['< 6 / diálise', '500 mg 48/48h (1 g após a sessão)']] },
  meropenem: { rotulo: 'Meropenem', faixas: [
    ['> 50', '1 g 8/8h'], ['26–50', '1 g 12/12h'], ['10–25', '500 mg 12/12h'], ['< 10 / diálise', '500 mg 24/24h (após a sessão)']] },
  ertapenem: { rotulo: 'Ertapenem', faixas: [
    ['> 30', '1 g 24/24h'], ['≤ 30 / diálise', '500 mg 24/24h (+150 mg após a sessão se a dose foi < 6h antes)']] },
  ampicilina: { rotulo: 'Ampicilina', faixas: [
    ['> 50', '2 g 4/4h'], ['10–50', '2 g 6/6h a 12/12h'], ['< 10 / diálise', '2 g 12/12h a 24/24h (após a sessão)']] },
  ampicilinasulbactam: { rotulo: 'Ampicilina-sulbactam', faixas: [
    ['≥ 30', '1,5–3 g 6/6h'], ['15–29', '1,5–3 g 12/12h'], ['5–14 / diálise', '1,5–3 g 24/24h (após a sessão)']] },
  amoxicilinaacidoclavulanico: { rotulo: 'Amoxicilina-clavulanato', faixas: [
    ['≥ 30', '875/125 mg 12/12h'], ['10–29', 'não usar 875 mg: 500/125 mg 12/12h'], ['< 10 / diálise', '500/125 mg 24/24h (após a sessão)']] },
  sulfametoxazoltrimetoprima: { rotulo: 'Sulfametoxazol-trimetoprima', faixas: [
    ['> 30', 'dose plena'], ['15–30', 'metade da dose'], ['< 15', 'evitar']] },
  cefalexina: { rotulo: 'Cefalexina', faixas: [
    ['≥ 60', '500 mg–1 g 6/6h'], ['30–59', 'máx. 1 g 8/8h'], ['15–29', '250–500 mg 8/8h a 12/12h'], ['5–14 / diálise', '250–500 mg 24/24h (após a sessão)']] },
  nitrofurantoina: { rotulo: 'Nitrofurantoína', faixas: [['≥ 30', '100 mg 12/12h'], ['< 30', 'contraindicada']] },
  teicoplanina: { rotulo: 'Teicoplanina', nota: 'As 3 doses de ataque (12/12h) não se ajustam; ajustar a partir do 4º dia.', faixas: [
    ['> 60', '12 mg/kg 24/24h'], ['40–60', '12 mg/kg 48/48h'], ['< 40 / diálise', '12 mg/kg 72/72h']] }
};

/* Tabela de ajuste só das drogas presentes nos esquemas sugeridos. */
/* ---- Fluxos baseados em PCDT/manuais do Ministério da Saúde (03/10/2026) ----
   Pedido da CCIH: IST e tuberculose já têm documento nacional confiável, então entram
   agora — mas cada fluxo leva `homologacao: 'pendente'` até a CCIH do HNSC homologar: a
   tela avisa o médico, e a homologação vira adendo. Fontes:
   - PCDT para Atenção Integral às Pessoas com IST — MS, 2022 (atualizações 2024).
   - PCDT para Profilaxia Pós-Exposição de Risco (PEP) à infecção pelo HIV, IST e hepatites
     virais — MS, 2021/2024.
   - Manual de Recomendações para o Controle da Tuberculose no Brasil — MS, 2019 (2ª ed.
     atualizada) e Nota Informativa sobre o 3HP (ILTB), 2021. */
const FONTE_PCDT_IST = 'PCDT IST — Ministério da Saúde, 2022 (atualização 2024)';
const FONTE_PCDT_PEP = 'PCDT PEP (HIV, IST e hepatites) — Ministério da Saúde, 2021/2024';
const FONTE_MANUAL_TB = 'Manual de Recomendações para o Controle da Tuberculose no Brasil — MS, 2019; NI 3HP 2021';
const BENZATINA_DU = { rotulo: 'Sífilis recente (primária, secundária, latente recente < 1 ano)',
  posologia: 'Benzilpenicilina benzatina 2,4 milhões UI IM, dose única (1,2 milhão UI em cada glúteo)', drogas: ['penicilinabenzatina'] };
const BENZATINA_3 = { rotulo: 'Sífilis tardia (latente tardia, duração ignorada, terciária)',
  posologia: 'Benzilpenicilina benzatina 2,4 milhões UI IM, 1x/semana por 3 semanas (total 7,2 milhões UI). Intervalo máximo de 14 dias entre doses — passou disso, reiniciar.',
  drogas: ['penicilinabenzatina'] };
const EXAMES_IST_BASE = [
  'Testes rápidos: sífilis, HIV, hepatite B e hepatite C — oferecer a toda pessoa com IST.',
  'Convocar e tratar parcerias sexuais dos últimos 60–90 dias (ou da última parceria); orientar abstinência até fim do tratamento de ambos.'
];
const AVISO_GESTANTE_IST = 'Gestante: condutas, drogas permitidas e seguimento são do protocolo de GESTANTES — este fluxo é só orientação inicial.';

/* Comprimidos do 4-em-1 (RHZE 150/75/400/275) e do 2-em-1 (RH 150/75) por faixa de peso,
   adultos e ≥ 10 anos — tabela do Manual MS 2019. */
function comprimidosTB(faixaPeso) {
  return { '20-35': 2, '36-50': 3, '51-70': 4, '>70': 5 }[faixaPeso] || 4;
}

const SINDROMES_PCDT = [
  {
    id: 'ist_sifilis', rotulo: 'IST — Sífilis adquirida', germes: ['Treponema pallidum'],
    fonte: FONTE_PCDT_IST, homologacao: 'pendente',
    perguntas: [
      { id: 'estagio', rotulo: 'Estágio clínico', tipo: 'escolha', opcoes: [
        ['recente', 'Recente: primária (cancro duro), secundária (lesões cutâneo-mucosas) ou latente recente (< 1 ano)'],
        ['tardia', 'Tardia: latente tardia (> 1 ano), duração ignorada ou terciária'],
        ['neuro', 'Neurossífilis, sífilis ocular ou otossífilis']],
        ajuda: ['Latente = só sorologia reagente, sem sintomas. Sem data confiável de infecção → tratar como tardia.'] },
      { id: 'alergiaPenicilina', rotulo: 'Alergia a penicilina (confirmada)', tipo: 'sim_nao' },
      { id: 'gestante', rotulo: 'Gestante', tipo: 'sim_nao' },
      { id: 'hiv', rotulo: 'Pessoa vivendo com HIV', tipo: 'sim_nao' }
    ],
    decidir(r) {
      const exames = [
        'Teste rápido treponêmico + VDRL/RPR (título basal para o seguimento).',
        ...EXAMES_IST_BASE,
        'Seguimento com VDRL/RPR em 3, 6 e 12 meses (resposta = queda de 2 diluições em até 6 meses).',
        'Punção lombar se sintomas neurológicos/oculares/auditivos, sífilis terciária, ou PVHIV com VDRL ≥ 1:32 ou CD4 ≤ 350 sem resposta ao tratamento.'
      ];
      const avisos = ['Reação de Jarisch-Herxheimer (febre, mialgia, piora das lesões nas primeiras 24 h) é esperada: sintomáticos, não suspender.',
        'Notificação compulsória (sífilis adquirida).'];
      if (r.gestante) avisos.unshift(AVISO_GESTANTE_IST + ' Na gestante só benzilpenicilina trata o feto: alergia → dessensibilização, nunca doxiciclina.');
      if (r.hiv) avisos.push('PVHIV: mesmo esquema; seguimento sorológico mais próximo (3/6/9/12 meses) e limiar baixo para punção lombar.');
      if (r.estagio === 'neuro') {
        return { esquemas: [
          { rotulo: 'Neurossífilis / ocular / otossífilis', posologia: 'Benzilpenicilina potássica (cristalina) 18–24 milhões UI/dia IV, em 3–4 milhões UI de 4/4h (ou infusão contínua), por 14 dias', drogas: ['penicilinacristalina'] },
          { rotulo: 'Alternativa', posologia: 'Ceftriaxona 2 g IV 1x/dia por 10–14 dias', drogas: ['ceftriaxona'] }],
          exames: [...exames, 'LCR: celularidade, proteína e VDRL; repetir em 6 meses até normalizar.'], avisos };
      }
      const tardia = r.estagio === 'tardia';
      if (r.alergiaPenicilina && !r.gestante) {
        return { esquemas: [{ rotulo: (tardia ? 'Sífilis tardia' : 'Sífilis recente') + ' — alergia a penicilina',
          posologia: tardia ? 'Doxiciclina 100 mg VO 12/12h por 30 dias' : 'Doxiciclina 100 mg VO 12/12h por 15 dias', drogas: ['doxiciclina'] }],
          exames, avisos: [...avisos, 'Alternativa tem menos evidência: seguimento sorológico rigoroso; se possível, confirmar a alergia e dessensibilizar.'] };
      }
      return { esquemas: [tardia ? BENZATINA_3 : BENZATINA_DU], exames,
        avisos: [...avisos, 'Parcerias: benzatina 2,4 milhões UI IM dose única mesmo com teste negativo, se exposição nos últimos 90 dias.'] };
    }
  },
  {
    id: 'ist_corrimento_uretral', rotulo: 'IST — Corrimento uretral / cervicite', germes: ['Neisseria gonorrhoeae', 'Chlamydia trachomatis'],
    fonte: FONTE_PCDT_IST, homologacao: 'pendente',
    perguntas: [
      { id: 'quadro', rotulo: 'Quadro', tipo: 'escolha', opcoes: [['uretrite', 'Corrimento uretral (uretrite)'], ['cervicite', 'Cervicite (corrimento cervical, colo friável)']] },
      { id: 'laboratorio', rotulo: 'Laboratório', tipo: 'escolha', opcoes: [
        ['sem', 'Sem resultado / abordagem sindrômica'], ['gono', 'Gonococo identificado (bacterioscopia/cultura/biologia molecular)'], ['clamidia', 'Só clamídia identificada']] },
      { id: 'persistente', rotulo: 'Uretrite persistente ou recorrente após tratamento correto', tipo: 'sim_nao' },
      { id: 'gestante', rotulo: 'Gestante', tipo: 'sim_nao' }
    ],
    decidir(r) {
      const exames = ['Se disponível: bacterioscopia (Gram) do corrimento e biologia molecular para gonococo/clamídia — não atrasar o tratamento.', ...EXAMES_IST_BASE];
      const avisos = r.gestante ? [AVISO_GESTANTE_IST] : [];
      if (r.persistente) {
        return { esquemas: [
          { rotulo: 'Uretrite persistente — Trichomonas vaginalis', posologia: 'Metronidazol 2 g VO, dose única', drogas: ['metronidazol'] },
          { rotulo: 'Uretrite persistente — Mycoplasma genitalium', posologia: 'Azitromicina 500 mg VO no 1º dia, depois 250 mg VO 1x/dia por mais 4 dias', drogas: ['azitromicina'] }],
          exames, avisos: [...avisos, 'Confirmar adesão e retratamento da parceria antes de assumir falha. Persistindo, encaminhar à referência.'] };
      }
      if (r.laboratorio === 'clamidia') {
        return { esquemas: [
          { rotulo: 'Clamídia', posologia: 'Azitromicina 1 g VO, dose única', drogas: ['azitromicina'] },
          { rotulo: 'Alternativa (não gestante)', posologia: 'Doxiciclina 100 mg VO 12/12h por 7 dias', drogas: ['doxiciclina'] }], exames, avisos };
      }
      return { esquemas: [{ rotulo: r.quadro === 'cervicite' ? 'Cervicite (gonococo + clamídia)' : 'Uretrite (gonococo + clamídia)',
        posologia: 'Ceftriaxona 500 mg IM, dose única + Azitromicina 1 g VO, dose única', drogas: ['ceftriaxona', 'azitromicina'] }],
        exames, avisos: [...avisos, 'Tratar parcerias com o mesmo esquema. Gonococo: notificar falha terapêutica (vigilância de resistência).'] };
    }
  },
  {
    id: 'ist_corrimento_vaginal', rotulo: 'IST — Corrimento vaginal', germes: ['Candida spp', 'Gardnerella vaginalis', 'Trichomonas vaginalis'],
    fonte: FONTE_PCDT_IST, homologacao: 'pendente',
    perguntas: [
      { id: 'tipo', rotulo: 'Quadro predominante', tipo: 'escolha', opcoes: [
        ['candidiase', 'Candidíase: prurido, corrimento branco grumoso, sem odor, pH < 4,5'],
        ['vaginose', 'Vaginose bacteriana: corrimento homogêneo acinzentado com odor de peixe, pH > 4,5, sem inflamação'],
        ['tricomoniase', 'Tricomoníase: corrimento amarelo-esverdeado bolhoso, odor, colpite ("colo em framboesa"), pH > 4,5']] },
      { id: 'recorrente', rotulo: 'Recorrente (≥ 4 episódios/ano)', tipo: 'sim_nao' },
      { id: 'gestante', rotulo: 'Gestante', tipo: 'sim_nao' }
    ],
    decidir(r) {
      const exames = ['Exame especular, pH vaginal e, se disponível, exame a fresco/Gram (teste das aminas).', 'Candidíase e vaginose NÃO são IST: parcerias não precisam de tratamento; tricomoníase é — tratar parceria.'];
      const avisos = r.gestante ? [AVISO_GESTANTE_IST] : [];
      if (r.tipo === 'candidiase') {
        if (r.recorrente) return { esquemas: [{ rotulo: 'Candidíase recorrente', posologia: 'Fluconazol 150 mg VO nos dias 1, 4 e 7; depois 150 mg VO 1x/semana por 6 meses', drogas: ['fluconazol'] }],
          exames: [...exames, 'Recorrente: cultura com identificação de espécie (C. glabrata não responde a azólicos), glicemia, revisar imunossupressão.'],
          avisos: [...avisos, 'Gestante: fluconazol oral contraindicado — só tratamento tópico.'] };
        const esquemas = [{ rotulo: 'Candidíase vulvovaginal', posologia: 'Miconazol creme 2%, 1 aplicador (5 g) intravaginal à noite por 7 noites', drogas: ['miconazol'] }];
        if (!r.gestante) esquemas.push({ rotulo: 'Alternativa oral', posologia: 'Fluconazol 150 mg VO, dose única', drogas: ['fluconazol'] });
        return { esquemas, exames, avisos };
      }
      if (r.tipo === 'vaginose') {
        return { esquemas: [
          { rotulo: r.recorrente ? 'Vaginose bacteriana recorrente' : 'Vaginose bacteriana', posologia: r.recorrente ? 'Metronidazol 500 mg VO 12/12h por 10–14 dias' : 'Metronidazol 500 mg VO 12/12h por 7 dias', drogas: ['metronidazol'] },
          { rotulo: 'Alternativa tópica', posologia: 'Metronidazol gel vaginal 0,75%, 1 aplicador (5 g) à noite por 5 noites', drogas: ['metronidazol'] }],
          exames, avisos: [...avisos, 'Evitar álcool durante e 24 h após o metronidazol.'] };
      }
      return { esquemas: [
        { rotulo: 'Tricomoníase', posologia: 'Metronidazol 500 mg VO 12/12h por 7 dias', drogas: ['metronidazol'] },
        { rotulo: 'Alternativa', posologia: 'Metronidazol 2 g VO, dose única', drogas: ['metronidazol'] }],
        exames, avisos: [...avisos, 'Tratar a parceria (metronidazol 2 g VO dose única) e rastrear outras IST.', 'Evitar álcool durante e 24 h após o metronidazol.'] };
    }
  },
  {
    id: 'ist_dip', rotulo: 'IST — Doença inflamatória pélvica (DIP)', germes: ['Neisseria gonorrhoeae', 'Chlamydia trachomatis', 'Anaeróbios'],
    fonte: FONTE_PCDT_IST, homologacao: 'pendente',
    perguntas: [
      { id: 'internacao', rotulo: 'Critério de internação presente', tipo: 'sim_nao',
        ajuda: ['Abscesso tubo-ovariano', 'Gestante', 'Sem melhora após 72 h de tratamento ambulatorial', 'Intolerância à via oral / baixa adesão provável', 'Quadro grave (febre alta, vômitos, peritonite) ou emergência cirúrgica não excluída (apendicite, gravidez ectópica)'] },
      { id: 'gestante', rotulo: 'Gestante', tipo: 'sim_nao' }
    ],
    decidir(r) {
      const exames = ['Teste de gravidez (excluir ectópica), hemograma, PCR/VHS, EAS.', 'Ultrassonografia pélvica/transvaginal se massa anexial ou dor intensa (abscesso tubo-ovariano).',
        'Pesquisa de gonococo/clamídia (endocérvice) quando disponível — não atrasar o tratamento.', ...EXAMES_IST_BASE,
        'DIU: não precisa ser removido de rotina; remover se não houver melhora em 72 h.'];
      const avisos = [r.gestante ? AVISO_GESTANTE_IST + ' Gestante com DIP = internação.' : null,
        'Critérios mínimos: dor pélvica + dor à mobilização do colo OU dor anexial OU dor uterina — tratar sem esperar exames.',
        'Parcerias dos últimos 60 dias: ceftriaxona 500 mg IM + azitromicina 1 g VO, dose única.'].filter(Boolean);
      if (r.internacao || r.gestante) {
        return { esquemas: [
          { rotulo: 'DIP — hospitalar', posologia: 'Ceftriaxona 1 g IV 1x/dia + Doxiciclina 100 mg VO 12/12h + Metronidazol 400 mg IV 12/12h; completar 14 dias (passar a VO após 24–48 h de melhora)', drogas: ['ceftriaxona', 'doxiciclina', 'metronidazol'] },
          { rotulo: 'Alternativa hospitalar', posologia: 'Clindamicina 900 mg IV 8/8h + Gentamicina 3–5 mg/kg IV 1x/dia; depois doxiciclina 100 mg VO 12/12h até 14 dias', drogas: ['clindamicina', 'gentamicina', 'doxiciclina'] }],
          exames, avisos: [...avisos, 'Abscesso tubo-ovariano ≥ 7 cm ou sem resposta em 72 h: avaliar drenagem/cirurgia.', r.gestante ? 'Gestante: doxiciclina contraindicada — discutir esquema com obstetrícia/CCIH.' : null].filter(Boolean) };
      }
      return { esquemas: [{ rotulo: 'DIP — ambulatorial',
        posologia: 'Ceftriaxona 500 mg IM, dose única + Doxiciclina 100 mg VO 12/12h por 14 dias + Metronidazol 500 mg VO 12/12h por 14 dias', drogas: ['ceftriaxona', 'doxiciclina', 'metronidazol'] }],
        exames, avisos: [...avisos, 'Reavaliar em 72 h: sem melhora → internar.'] };
    }
  },
  {
    id: 'ist_ulcera_genital', rotulo: 'IST — Úlcera genital', germes: ['Treponema pallidum', 'Haemophilus ducreyi', 'Herpes simplex'],
    fonte: FONTE_PCDT_IST, homologacao: 'pendente',
    perguntas: [
      { id: 'vesiculas', rotulo: 'Lesões vesiculosas ou úlceras rasas dolorosas agrupadas (sugere herpes)', tipo: 'sim_nao' },
      { id: 'primeiroEpisodio', rotulo: 'Primeiro episódio (se herpes)', tipo: 'sim_nao' },
      { id: 'duracao', rotulo: 'Duração da úlcera', tipo: 'escolha', opcoes: [['menos4', 'Menos de 4 semanas'], ['mais4', '4 semanas ou mais']] },
      { id: 'gestante', rotulo: 'Gestante', tipo: 'sim_nao' }
    ],
    decidir(r) {
      const exames = ['Teste rápido treponêmico + VDRL/RPR (a úlcera primária pode ter sorologia ainda negativa — tratar assim mesmo).', ...EXAMES_IST_BASE];
      const avisos = r.gestante ? [AVISO_GESTANTE_IST] : [];
      if (r.vesiculas) {
        return { esquemas: [
          { rotulo: r.primeiroEpisodio ? 'Herpes genital — 1º episódio' : 'Herpes genital — recorrência',
            posologia: r.primeiroEpisodio ? 'Aciclovir 400 mg VO 8/8h por 7–10 dias' : 'Aciclovir 400 mg VO 8/8h por 5 dias', drogas: ['aciclovir'] }],
          exames: [...exames, 'Herpes: diagnóstico clínico; PCR/cultura da vesícula se disponível.'],
          avisos: [...avisos, 'Iniciar nas primeiras 72 h dos sintomas; ≥ 6 recorrências/ano → supressão (aciclovir 400 mg 12/12h por 6 meses).', 'Gestante: aciclovir é permitido; recorrência no termo orienta via de parto — obstetrícia.'] };
      }
      const esquemas = [BENZATINA_DU, { rotulo: 'Cancro mole (H. ducreyi) — tratar junto', posologia: 'Azitromicina 1 g VO, dose única (alternativa: ceftriaxona 500 mg IM, dose única)', drogas: ['azitromicina'] }];
      if (r.duracao === 'mais4') {
        esquemas.push({ rotulo: 'Úlcera ≥ 4 semanas — linfogranuloma venéreo / donovanose', posologia: 'Doxiciclina 100 mg VO 12/12h por 21 dias (donovanose: até cicatrização completa)', drogas: ['doxiciclina'] });
        return { esquemas, exames: [...exames, 'Úlcera ≥ 4 semanas: biópsia da borda (excluir neoplasia e donovanose) e encaminhar.'],
          avisos: [...avisos, r.gestante ? 'Gestante: doxiciclina contraindicada — azitromicina 1 g VO 1x/semana por 3 semanas para donovanose/LGV.' : null].filter(Boolean) };
      }
      return { esquemas, exames, avisos: [...avisos, 'Abordagem sindrômica da úlcera sem vesículas: sífilis + cancro mole na primeira consulta, sem esperar sorologia.'] };
    }
  },
  {
    id: 'ist_profilaxia_violencia', rotulo: 'IST — Profilaxia após violência sexual', germes: [],
    fonte: FONTE_PCDT_PEP, homologacao: 'pendente',
    perguntas: [
      { id: 'ate72h', rotulo: 'Exposição há 72 h ou menos', tipo: 'sim_nao' },
      { id: 'hbvVacinado', rotulo: 'Esquema vacinal de hepatite B completo', tipo: 'sim_nao' },
      { id: 'gestante', rotulo: 'Gestante', tipo: 'sim_nao' }
    ],
    decidir(r) {
      const esquemas = [
        { rotulo: 'Profilaxia de IST não virais (dose única, na primeira consulta)',
          posologia: 'Benzilpenicilina benzatina 2,4 milhões UI IM + Ceftriaxona 500 mg IM + Azitromicina 1 g VO + Metronidazol 2 g VO', drogas: ['penicilinabenzatina', 'ceftriaxona', 'azitromicina', 'metronidazol'] }];
      const avisos = ['Atendimento é emergência: acolhimento, notificação compulsória (violência) e registro para fins legais; não condicionar a boletim de ocorrência.',
        'Metronidazol pode ser adiado se náuseas com a PEP para HIV.'];
      if (r.ate72h) {
        esquemas.push({ rotulo: 'PEP para HIV (iniciar o quanto antes, até 72 h)', posologia: 'Tenofovir 300 mg + Lamivudina 300 mg (1 cp) + Dolutegravir 50 mg, VO 1x/dia por 28 dias', drogas: ['tenofovir', 'lamivudina', 'dolutegravir'] });
      } else avisos.push('Mais de 72 h: PEP para HIV não indicada — testar HIV agora e repetir em 30 e 90 dias.');
      if (!r.hbvVacinado) {
        esquemas.push({ rotulo: 'Hepatite B', posologia: 'Vacina hepatite B (iniciar/completar esquema) + Imunoglobulina anti-hepatite B 0,06 mL/kg IM, até 14 dias da exposição', drogas: [] });
      }
      if (r.gestante) avisos.unshift(AVISO_GESTANTE_IST + ' PEP para HIV é permitida na gestação.');
      else avisos.push('Contracepção de emergência: levonorgestrel 1,5 mg VO dose única, até 120 h (quanto antes melhor).');
      return { esquemas,
        exames: ['Testes rápidos HIV, sífilis, hepatites B e C e teste de gravidez na admissão; repetir HIV/sífilis em 30 e 90 dias; hepatites em 90 e 180 dias.',
          'Encaminhar ao serviço de referência em violência sexual para seguimento e apoio psicossocial.'], avisos };
    }
  },
  {
    id: 'tb_tratamento', rotulo: 'Tuberculose — iniciar tratamento', germes: ['Mycobacterium tuberculosis'],
    fonte: FONTE_MANUAL_TB, homologacao: 'pendente',
    perguntas: [
      { id: 'forma', rotulo: 'Forma clínica', tipo: 'escolha', opcoes: [
        ['pulmonar', 'Pulmonar ou extrapulmonar (exceto SNC e osteoarticular)'], ['meningo', 'Meningoencefálica'], ['osteo', 'Osteoarticular']] },
      { id: 'peso', rotulo: 'Peso', tipo: 'escolha', opcoes: [['20-35', '20 a 35 kg'], ['36-50', '36 a 50 kg'], ['51-70', '51 a 70 kg'], ['>70', 'mais de 70 kg']] },
      { id: 'hiv', rotulo: 'Pessoa vivendo com HIV', tipo: 'sim_nao' },
      { id: 'hepatopatia', rotulo: 'Hepatopatia grave ou transaminases > 3× com sintomas / > 5× sem sintomas', tipo: 'sim_nao' },
      { id: 'gestante', rotulo: 'Gestante', tipo: 'sim_nao' },
      { id: 'retratamento', rotulo: 'Retratamento (recidiva ou reingresso após abandono)', tipo: 'sim_nao' }
    ],
    decidir(r) {
      const cp = comprimidosTB(r.peso);
      const prolongada = r.forma === 'meningo' || r.forma === 'osteo';
      const exames = ['Escarro: teste rápido molecular (TRM-TB), baciloscopia e cultura com teste de sensibilidade (2 amostras); extrapulmonar: material do sítio para cultura/histopatologia.',
        'Radiografia de tórax; teste rápido de HIV para TODO caso de TB; hepatograma, creatinina, glicemia e hemograma basais.',
        'Notificação compulsória (SINAN) e tratamento diretamente observado (TDO) na atenção primária; investigar contatos.',
        'Internado com TB pulmonar/laríngea: isolamento respiratório (quarto privativo, máscara N95/PFF2) até 2 semanas de tratamento efetivo com melhora clínica.'];
      const avisos = [];
      if (r.hepatopatia) {
        return { esquemas: [{ rotulo: 'Hepatopatia grave', posologia: 'NÃO iniciar o esquema básico: encaminhar à referência terciária para esquema especial (ex.: estreptomicina + etambutol + levofloxacino, com reintrodução monitorada)', drogas: [] }],
          exames, avisos: ['Esquema básico contraindicado na hepatopatia grave; a referência define o esquema e a monitorização de enzimas.'] };
      }
      if (r.retratamento) avisos.push('Retratamento: iniciar o esquema básico e aguardar cultura + teste de sensibilidade; TRM-TB com resistência à rifampicina → referência terciária (TB-MDR).');
      if (r.hiv) avisos.push('PVHIV: tratar a TB primeiro. Iniciar TARV em até 2 semanas se CD4 < 50 (meningoencefálica: só após 8 semanas), senão até 8 semanas. Com rifampicina, dolutegravir 50 mg 12/12h. Piridoxina 50 mg/dia.');
      if (r.gestante) avisos.push('Gestante: o esquema básico (RHZE) é seguro e deve ser iniciado; piridoxina 50 mg/dia. Seguimento conjunto com o protocolo de GESTANTES.');
      const faseIntensiva = `Fase intensiva (2 meses): RHZE 150/75/400/275 mg — ${cp} comprimido(s) VO 1x/dia em jejum`;
      const faseManutencao = `Fase de manutenção (${prolongada ? '10' : '4'} meses): RH 150/75 mg — ${cp} comprimido(s) VO 1x/dia`;
      const esquemas = [{ rotulo: prolongada ? `Esquema básico prolongado — 2RHZE/10RH (12 meses), ${r.peso || 'peso'}` : `Esquema básico — 2RHZE/4RH (6 meses), ${r.peso || 'peso'}`,
        posologia: faseIntensiva + '; ' + faseManutencao, drogas: ['rifampicina', 'isoniazida', 'pirazinamida', 'etambutol'] }];
      if (r.forma === 'meningo') {
        esquemas.push({ rotulo: 'Corticoide associado (meningoencefálica)', posologia: 'Prednisona 1–2 mg/kg/dia VO por 4 semanas (ou dexametasona 0,3–0,4 mg/kg/dia IV nos casos graves, 4–8 semanas), com redução gradual nas 4 semanas seguintes', drogas: [] });
        exames.push('LCR: celularidade, proteína, glicose, TRM-TB/cultura; imagem de SNC.');
      }
      avisos.push('Reavaliar em 15 dias e mensalmente: adesão, efeitos adversos (hepatotoxicidade, neuropatia, acuidade visual com etambutol) e baciloscopia de controle mensal na TB pulmonar.');
      return { esquemas, exames, avisos };
    }
  },
  {
    id: 'tb_iltb', rotulo: 'Tuberculose — infecção latente (ILTB): tratamento preventivo', germes: ['Mycobacterium tuberculosis'],
    fonte: FONTE_MANUAL_TB, homologacao: 'pendente',
    perguntas: [
      { id: 'indicacao', rotulo: 'Indicação', tipo: 'escolha', opcoes: [
        ['contato', 'Contato de TB pulmonar com PT ≥ 5 mm ou IGRA positivo (ou PVHIV/imunossuprimido contato, independentemente do teste)'],
        ['hiv', 'PVHIV com PT ≥ 5 mm, IGRA positivo, contato ou cicatriz radiológica sem tratamento prévio'],
        ['imunossupressao', 'Pré-imunossupressão (anti-TNF, transplante, corticoide ≥ 15 mg/dia prednisona > 1 mês) com PT ≥ 5 mm/IGRA positivo'],
        ['outros', 'Outras indicações com PT ≥ 10 mm (silicose, diabetes, IRC em diálise, neoplasia, profissionais de saúde…)']] },
      { id: 'maior50OuHepatopata', rotulo: 'Idade ≥ 50 anos, hepatopatia ou intolerância prévia à isoniazida', tipo: 'sim_nao' },
      { id: 'gestante', rotulo: 'Gestante', tipo: 'sim_nao' },
      { id: 'inibidorProtease', rotulo: 'Em uso de inibidor de protease ou outra droga com interação com rifamicinas', tipo: 'sim_nao' }
    ],
    decidir(r) {
      const exames = ['Antes de tratar ILTB, EXCLUIR TB ativa: sintomas (tosse, febre, sudorese, emagrecimento) e radiografia de tórax normal.',
        'Teste rápido de HIV; hepatograma basal se ≥ 50 anos, hepatopatia, etilismo ou PVHIV.'];
      const avisos = ['Notificar o tratamento da ILTB (ficha própria) e acompanhar mensalmente adesão e hepatotoxicidade.'];
      const esquemas = [];
      const rifampicina = { rotulo: 'Rifampicina 4 meses (4R)', posologia: 'Rifampicina 600 mg VO 1x/dia por 4 meses (120 doses, em até 6 meses)', drogas: ['rifampicina'] };
      const isoniazida = { rotulo: 'Isoniazida 9 meses (9H)', posologia: 'Isoniazida 5–10 mg/kg/dia (máx. 300 mg) VO 1x/dia por 9 meses (270 doses, em até 12 meses)', drogas: ['isoniazida'] };
      const tresHP = { rotulo: 'Rifapentina + isoniazida semanal (3HP)', posologia: 'Rifapentina 900 mg + Isoniazida 900 mg VO 1x/semana por 12 semanas (12 doses, em até 15 semanas)', drogas: ['rifapentina', 'isoniazida'] };
      if (r.gestante) {
        esquemas.push(isoniazida);
        avisos.push('Gestante: isoniazida (com piridoxina 50 mg/dia) é o esquema indicado; adiar para após o parto se possível, exceto PVHIV ou contato recente. 3HP não é indicado na gestação.');
        return { esquemas, exames, avisos: [...avisos, AVISO_GESTANTE_IST.replace('IST', 'ILTB').replace('condutas, drogas permitidas e seguimento são do protocolo de GESTANTES — este fluxo é só orientação inicial.', 'seguimento com o protocolo de GESTANTES.')] };
      }
      if (r.inibidorProtease) {
        esquemas.push(isoniazida);
        avisos.push('Rifamicinas interagem com inibidores de protease e outras drogas: isoniazida é o esquema indicado.');
        return { esquemas, exames, avisos };
      }
      if (r.maior50OuHepatopata) esquemas.push(rifampicina, tresHP, isoniazida);
      else esquemas.push(tresHP, rifampicina, isoniazida);
      avisos.push('Escolha pela adesão: 3HP (12 doses) e 4R (120 doses) têm maior conclusão que 9H. 3HP: ≥ 2 anos, não em gestantes; PVHIV só com TARV compatível (dolutegravir 50 mg/dia é compatível).');
      if (r.indicacao === 'hiv') avisos.push('PVHIV: tratar ILTB independentemente de PT/IGRA se contato recente ou cicatriz radiológica sem tratamento prévio.');
      return { esquemas, exames, avisos };
    }
  }
];
PROTOCOLO_ATB.sindromes.push(...SINDROMES_PCDT);

/* ============================================================================
   Protocolos de UTI Adulto e complemento da Emergência (05/10/2026)
   Fontes (documentos do HNSC criados pela CCIH): "Protocolo de Tratamento de
   Infecções em UTI Adulto" e "Protocolo de Tratamento de Infecções — Emergência e
   Hospitalistas" (base SSC 2026, IDSA AMR 2026, SBI 2025, PCDT MS).

   REGRA DO HNSC (decisão de 05/10/2026): ceftazidima-avibactam e aztreonam NÃO são
   padronizados. Onde o esquema ideal os usaria, o protocolo entrega o plano disponível
   (polimixina B, tigeciclina, amicacina, ampicilina-sulbactam, carbapenêmico) e marca o
   esquema com asterisco, com a observação `naoPadronizado(...)` em avisos. */
function naoPadronizado(drogas) {
  return '* Em casos graves, discutir com a CCIH o uso de ' + drogas + ', que não é padronizada no HNSC.';
}

/* Cobertura empírica do gram-negativo em UTI pela colonização/risco conhecido, já com a
   substituição das drogas não padronizadas. `sitio`: 'abdominal' acrescenta anaeróbio;
   'urinario' prefere colistina à polimixina B (concentração urinária); 'pulmonar' etc. só
   muda avisos. Devolve { esquemas: [{rotulo, posologia, drogas}], avisos: [] }. */
function coberturaGramNegativoUTI(colonizacao, sitio, choqueOuRisco) {
  const anaerobio = sitio === 'abdominal' ? ' + Metronidazol 500 mg IV 8/8h' : '';
  const dAna = sitio === 'abdominal' ? ['metronidazol'] : [];
  if (colonizacao === 'kpc') {
    return { esquemas: [{ rotulo: 'KPC conhecida — esquema do HNSC *', posologia: 'Polimixina B (ataque 2–2,5 mg/kg, depois 1,25–1,5 mg/kg IV 12/12h) + Meropenem 2 g IV 8/8h em infusão de 3 h (se CIM de carbapenêmico baixa) ou + Amicacina 25–30 mg/kg/dia' + anaerobio, drogas: ['polimixinab', 'meropenem', 'amicacina'].concat(dAna) }],
      avisos: [naoPadronizado('ceftazidima-avibactam'), 'Combinação sempre com infectologista/CCIH; ajustar pela microdiluição (polimixina) e pelo sinergismo quando disponível.'] };
  }
  if (colonizacao === 'ndm') {
    return { esquemas: [{ rotulo: 'NDM (ou KPC+NDM) conhecida — esquema do HNSC *', posologia: 'Polimixina B (ataque 2–2,5 mg/kg, depois 1,25–1,5 mg/kg IV 12/12h) em combinação + Amicacina 25–30 mg/kg/dia ou Tigeciclina 200 mg e depois 100 mg IV 12/12h (conforme sítio e sinergismo)' + anaerobio, drogas: ['polimixinab', 'amicacina', 'tigeciclina'].concat(dAna) }],
      avisos: [naoPadronizado('ceftazidima-avibactam + aztreonam'), 'MBL: combinação guiada por sinergismo, com infectologista. Notificar NDM à CCIH (vigilância de surto).'] };
  }
  if (colonizacao === 'crab') {
    return { esquemas: [{ rotulo: 'Acinetobacter resistente (CRAB) conhecido', posologia: 'Ampicilina-sulbactam em alta dose (9 g IV 8/8h — 9 g de sulbactam/dia, infusão 4 h) + Polimixina B (ataque, depois 1,25–1,5 mg/kg 12/12h) ou + Tigeciclina 200/100 mg' + anaerobio, drogas: ['ampicilinasulbactam', 'polimixinab', 'tigeciclina'].concat(dAna) }],
      avisos: ['Ampicilina-sulbactam em alta dose é a base contra CRAB (SBI 2025). Precaução de contato e comunicar a CCIH (surto).'] };
  }
  if (colonizacao === 'pseudo') {
    return { esquemas: [{ rotulo: 'Pseudomonas resistente (DTR) conhecido — esquema do HNSC *', posologia: 'Polimixina B (ataque, depois 1,25–1,5 mg/kg 12/12h) ± Amicacina 25–30 mg/kg/dia' + anaerobio, drogas: ['polimixinab', 'amicacina'].concat(dAna) }],
      avisos: [naoPadronizado('ceftolozano-tazobactam, ceftazidima-avibactam ou imipenem-relebactam'), 'Pseudomonas KPC+VIM: os novos β-lactâmicos falham — esquema com infectologista e notificação de surto.'] };
  }
  if (colonizacao === 'esbl') {
    return { esquemas: [{ rotulo: 'ESBL conhecida', posologia: (choqueOuRisco ? 'Meropenem 2 g IV 8/8h (infusão 3 h)' : 'Ertapenem 1 g IV 1x/dia (estável, sem hipoalbuminemia); Meropenem se grave') + anaerobio, drogas: ['meropenem', 'ertapenem'].concat(dAna) }], avisos: [] };
  }
  /* Sem colonização conhecida: risco/choque decide carbapenêmico × antipseudomonas. */
  return choqueOuRisco
    ? { esquemas: [{ rotulo: 'Risco de MDR ou choque (sem colonização conhecida)', posologia: 'Meropenem 2 g IV 8/8h (infusão 3 h)' + anaerobio, drogas: ['meropenem'].concat(dAna) }],
        avisos: ['No choque séptico hospitalar, a cobertura ampla vale mesmo sem colonização conhecida; descalonar em 48–72 h pelo teste fenotípico e cultura.'] }
    : { esquemas: [{ rotulo: 'Sem risco de MDR, sem choque', posologia: 'Cefepima 2 g IV 8/8h (infusão 3 h) ou Piperacilina-tazobactam 4,5 g IV 6/6h (infusão 3–4 h)' + anaerobio, drogas: ['cefepima', 'piperacilinatazobactam'].concat(dAna) }], avisos: [] };
}

/* Pergunta de colonização/risco de MDR reutilizada nas síndromes de UTI. */
const COLONIZACAO_UTI = { id: 'colonizacao', rotulo: 'Colonização ou infecção prévia conhecida (swab de vigilância ou cultura ≤ 90 dias)', tipo: 'escolha', opcoes: [
  ['nenhuma', 'Nenhuma conhecida / desconhecida'],
  ['esbl', 'Enterobactérias ESBL'],
  ['kpc', 'KPC (carbapenemase de classe A)'],
  ['ndm', 'NDM ou KPC+NDM (metalo-β-lactamase)'],
  ['crab', 'Acinetobacter resistente (CRAB)'],
  ['pseudo', 'Pseudomonas resistente (DTR)']],
  ajuda: ['Colonização/infecção pelo agente nos últimos 90 dias é o fator mais forte e, sozinho, justifica a cobertura.',
    'O teste imunocromatográfico de carbapenemase (≈15 min do frasco positivo) permite o primeiro ajuste no mesmo dia.'] };
const AVISO_TIMEOUT_UTI = 'Reavaliação obrigatória em 48–72 h (time-out): culturas, teste fenotípico, clínica e procalcitonina — descalonar, ajustar ou suspender. Dose de ataque plena mesmo na lesão renal aguda das primeiras 24–48 h.';
const EXAMES_UTI_BASE = ['2 pares de hemocultura e cultura do sítio provável antes da 1ª dose (sem atrasar mais de 45 min).',
  'Betalactâmicos: 1ª dose em bolus (ataque) e manutenção em infusão prolongada (SSC 2026).'];

const SINDROMES_UTI = [
  {
    id: 'pav_pah', rotulo: 'Pneumonia hospitalar / associada à VM (PAV/PAH)', germes: ['Pseudomonas aeruginosa', 'Klebsiella pneumoniae', 'Acinetobacter baumannii', 'Staphylococcus aureus'],
    perguntas: [COLONIZACAO_UTI, { id: 'choque', rotulo: 'Choque séptico ou sepse grave', tipo: 'sim_nao' }, riscoMRSA('riscoMRSA', ['Pneumonia necrosante/cavitária', 'Ferida/cateter infectado'])],
    decidir(r) {
      const gn = coberturaGramNegativoUTI(r.colonizacao, 'pulmonar', r.choque || r.colonizacao !== 'nenhuma');
      const esquemas = gn.esquemas.slice();
      if (r.riscoMRSA) esquemas.push({ rotulo: 'Cobertura de MRSA (risco presente)', posologia: 'Linezolida 600 mg IV 12/12h (preferir na pneumonia) ou Vancomicina por AUC 400–600', drogas: ['linezolida', 'vancomicina'] });
      return { esquemas, exames: ['Aspirado traqueal quantitativo antes da 1ª dose; 2 pares de hemocultura.', ...EXAMES_UTI_BASE.slice(1)],
        avisos: [...gn.avisos, 'Sem nebulização de antibiótico de rotina. Duração 7 dias (IDSA/ATS 2016); estender se empiema, abscesso ou necrose.', AVISO_TIMEOUT_UTI] };
    }
  },
  {
    id: 'corrente_sanguinea', rotulo: 'Corrente sanguínea / cateter (UTI)', germes: ['Staphylococcus aureus', 'Staphylococcus epidermidis', 'Klebsiella pneumoniae', 'Pseudomonas aeruginosa', 'Candida spp'],
    perguntas: [COLONIZACAO_UTI, { id: 'choque', rotulo: 'Choque séptico', tipo: 'sim_nao' },
      { id: 'candida', rotulo: 'Critério para antifúngico empírico (NPT/cateter femoral, colonização multifocal por Candida, cirurgia abdominal recorrente)', tipo: 'sim_nao' }],
    decidir(r) {
      const gn = r.colonizacao === 'nenhuma'
        ? { esquemas: [{ rotulo: 'Empírico sem colonização', posologia: 'Vancomicina (ataque 20–35 mg/kg, depois por AUC) + ' + (r.choque ? 'Meropenem 2 g IV 8/8h' : 'Cefepima 2 g IV 8/8h'), drogas: ['vancomicina', r.choque ? 'meropenem' : 'cefepima'] }], avisos: [] }
        : (() => { const c = coberturaGramNegativoUTI(r.colonizacao, 'corrente', true); return { esquemas: [{ rotulo: 'Vancomicina + ' + c.esquemas[0].rotulo, posologia: 'Vancomicina por AUC + ' + c.esquemas[0].posologia, drogas: ['vancomicina', ...c.esquemas[0].drogas] }], avisos: c.avisos }; })();
      const esquemas = gn.esquemas.slice();
      if (r.candida) esquemas.push({ rotulo: 'Antifúngico empírico', posologia: 'Anidulafungina 200 mg e depois 100 mg/dia (ou micafungina/caspofungina)', drogas: ['anidulafungina'] });
      return { esquemas, exames: ['2 pares de hemocultura de sítios diferentes antes da 1ª dose.', ...EXAMES_UTI_BASE.slice(1)],
        avisos: [...gn.avisos, 'Retirar o cateter se S. aureus, Pseudomonas, Candida ou choque. S. aureus na hemocultura nunca é contaminante: seguir o pacote da bacteremia por S. aureus (eco, hemoculturas de controle, duração 14 d da 1ª negativa).', AVISO_TIMEOUT_UTI] };
    }
  },
  {
    id: 'itu_cateter_uti', rotulo: 'ITU associada a cateter (UTI)', germes: ['Escherichia coli', 'Klebsiella pneumoniae', 'Pseudomonas aeruginosa', 'Enterococcus spp'],
    perguntas: [COLONIZACAO_UTI, { id: 'choque', rotulo: 'Sepse grave / choque', tipo: 'sim_nao' }],
    decidir(r) {
      let esquemas, avisos = [];
      if (r.colonizacao === 'kpc') { esquemas = [{ rotulo: 'ITU por KPC — esquema do HNSC *', posologia: 'Colistina 300 mg CBA de ataque, depois 300–360 mg CBA/dia em 2 doses (preferível à polimixina B na ITU) + Amicacina 25–30 mg/kg/dia se cistite por KPC sensível', drogas: ['colistina', 'amicacina'] }]; avisos = [naoPadronizado('ceftazidima-avibactam'), 'Polimixina B tem baixa concentração urinária — na ITU preferir colistina.']; }
      else if (r.colonizacao === 'ndm' || r.colonizacao === 'pseudo' || r.colonizacao === 'crab') { const c = coberturaGramNegativoUTI(r.colonizacao, 'urinario', true); esquemas = c.esquemas; avisos = [...c.avisos, 'Na ITU, preferir colistina à polimixina B (concentração urinária); amicacina é boa opção se sensível.']; }
      else { const c = coberturaGramNegativoUTI(r.colonizacao, 'urinario', r.choque); esquemas = c.esquemas; avisos = c.avisos; }
      return { esquemas, exames: ['Trocar o cateter e colher urocultura da NOVA sonda antes da 1ª dose; hemoculturas se febril.', ...EXAMES_UTI_BASE.slice(1)],
        avisos: [...avisos, 'Amicacina é alternativa na cistite por KPC sensível. Duração 7 dias; estender em abscesso renal/prostático.', AVISO_TIMEOUT_UTI] };
    }
  },
  {
    id: 'intra_abdominal_uti', rotulo: 'Intra-abdominal hospitalar / pós-operatória (UTI)', germes: ['Escherichia coli', 'Klebsiella pneumoniae', 'Enterococcus spp', 'Bacteroides spp', 'Candida spp'],
    perguntas: [COLONIZACAO_UTI, { id: 'choque', rotulo: 'Choque séptico', tipo: 'sim_nao' },
      { id: 'candida', rotulo: 'Critério para antifúngico (reabordagens, fístula ou deiscência de anastomose, NPT)', tipo: 'sim_nao' }],
    decidir(r) {
      const gn = coberturaGramNegativoUTI(r.colonizacao, 'abdominal', r.choque || r.colonizacao !== 'nenhuma');
      const esquemas = gn.esquemas.slice();
      if (r.candida) esquemas.push({ rotulo: 'Antifúngico empírico', posologia: 'Anidulafungina 200 mg e depois 100 mg/dia', drogas: ['anidulafungina'] });
      return { esquemas, exames: ['Hemoculturas + cultura do líquido abdominal (controle de foco).', ...EXAMES_UTI_BASE.slice(1)],
        avisos: [...gn.avisos, 'O controle de foco (cirurgia/drenagem) é o tratamento principal; antibiótico 4 dias após foco controlado (STOP-IT). Pip-tazo cobre E. faecalis; esquemas com polimixina/ceftazidima-avibactam NÃO cobrem anaeróbios — manter metronidazol.', AVISO_TIMEOUT_UTI] };
    }
  },
  {
    id: 'pac_grave_uti', rotulo: 'PAC grave na admissão (UTI)', germes: ['Streptococcus pneumoniae', 'Legionella pneumophila', 'Staphylococcus aureus', 'Haemophilus influenzae'],
    perguntas: [{ id: 'choque', rotulo: 'Choque séptico', tipo: 'sim_nao' }, { id: 'pseudomonas', rotulo: 'Fator de risco para Pseudomonas (bronquiectasia, ATB IV recente, VM prolongada)', tipo: 'sim_nao' }, riscoMRSA('riscoMRSA', ['Pós-influenza', 'Pneumonia necrosante/cavitária', 'Empiema'])],
    decidir(r) {
      const esquemas = [r.pseudomonas
        ? { rotulo: 'PAC grave com risco de Pseudomonas', posologia: 'Cefepima 2 g IV 8/8h ou Piperacilina-tazobactam 4,5 g IV 6/6h + Azitromicina 500 mg/dia', drogas: ['cefepima', 'piperacilinatazobactam', 'azitromicina'] }
        : { rotulo: 'PAC grave', posologia: 'Ceftriaxona 2 g IV 1x/dia + Azitromicina 500 mg IV/dia', drogas: ['ceftriaxona', 'azitromicina'] }];
      if (r.riscoMRSA) esquemas.push({ rotulo: 'Cobertura de MRSA', posologia: 'Vancomicina por AUC ou Linezolida 600 mg 12/12h', drogas: ['vancomicina', 'linezolida'] });
      return { esquemas, exames: ['2 pares de hemocultura, antígenos urinários de pneumococo e Legionella, aspirado/escarro; teste para influenza/SARS-CoV-2 na sazonalidade.'],
        avisos: ['Oseltamivir 75 mg 12/12h na sazonalidade. Hidrocortisona na PAC grave com choque (SSC 2026). Duração 5 dias após estabilidade (ATS 2025).', AVISO_TIMEOUT_UTI] };
    }
  },
  {
    id: 'ferida_necrosante_uti', rotulo: 'Ferida operatória profunda / partes moles necrosante (UTI)', germes: ['Streptococcus pyogenes', 'Staphylococcus aureus', 'Clostridium spp', 'Enterobacterales'],
    perguntas: [COLONIZACAO_UTI, { id: 'necrosante', rotulo: 'Infecção necrosante (dor desproporcional, crepitação, bolhas, toxemia)', tipo: 'sim_nao' }],
    decidir(r) {
      const base = r.colonizacao === 'nenhuma'
        ? { esquemas: [{ rotulo: 'Ferida profunda / necrosante', posologia: 'Vancomicina por AUC + Piperacilina-tazobactam 4,5 g 6/6h + Clindamicina 900 mg IV 8/8h', drogas: ['vancomicina', 'piperacilinatazobactam', 'clindamicina'] }], avisos: [] }
        : (() => { const c = coberturaGramNegativoUTI(r.colonizacao, 'partes-moles', true); return { esquemas: [{ rotulo: 'Vancomicina + ' + c.esquemas[0].rotulo + ' + clindamicina', posologia: 'Vancomicina por AUC + ' + c.esquemas[0].posologia + ' + Clindamicina 900 mg IV 8/8h', drogas: ['vancomicina', ...c.esquemas[0].drogas, 'clindamicina'] }], avisos: c.avisos }; })();
      return { esquemas: base.esquemas, exames: ['Hemoculturas e cultura de tecido profundo.', ...EXAMES_UTI_BASE.slice(1)],
        avisos: [...base.avisos, 'Desbridamento cirúrgico IMEDIATO (não espera imagem). Clindamicina para supressão de toxina. Manter até cessarem os desbridamentos e haver estabilidade.', AVISO_TIMEOUT_UTI] };
    }
  },
  {
    id: 'ventriculite_uti', rotulo: 'Ventriculite / meningite pós-neurocirúrgica (UTI)', germes: ['Staphylococcus aureus', 'Staphylococcus epidermidis', 'Enterobacterales', 'Pseudomonas aeruginosa', 'Acinetobacter baumannii'],
    perguntas: [COLONIZACAO_UTI, { id: 'choque', rotulo: 'Sepse grave / choque', tipo: 'sim_nao' }],
    decidir(r) {
      const esquemas = [{ rotulo: 'Ventriculite pós-neurocirúrgica', posologia: 'Vancomicina por AUC + ' + (r.colonizacao === 'nenhuma' ? 'Cefepima 2 g IV 8/8h' : 'Meropenem 2 g IV 8/8h'), drogas: ['vancomicina', r.colonizacao === 'nenhuma' ? 'cefepima' : 'meropenem'] }];
      let avisos = [];
      if (r.colonizacao === 'crab' || r.colonizacao === 'kpc' || r.colonizacao === 'ndm' || r.colonizacao === 'pseudo') {
        esquemas.push({ rotulo: 'Gram-negativo resistente no SNC — associar', posologia: 'Polimixina B IV + Polimixina B intraventricular 5 mg (50.000 UI) 1x/dia, além da dose IV', drogas: ['polimixinab'] });
        if (r.colonizacao !== 'crab') avisos.push(naoPadronizado('ceftazidima-avibactam (± aztreonam na NDM)'));
      }
      return { esquemas, exames: ['Líquor (celularidade, bioquímica, Gram, cultura) + hemoculturas.', ...EXAMES_UTI_BASE.slice(1)],
        avisos: [...avisos, 'Retirar ou trocar a DVE/derivação. Meropenem 2 g 8/8h no SNC. Duração 10–14 dias após a última cultura de líquor negativa (gram-negativo: alguns usam 21 dias).', AVISO_TIMEOUT_UTI] };
    }
  },
  {
    id: 'neutropenia_febril_uti', rotulo: 'Neutropenia febril em UTI', germes: ['Pseudomonas aeruginosa', 'Enterobacterales', 'Staphylococcus spp', 'Candida spp'],
    perguntas: [COLONIZACAO_UTI, { id: 'instavel', rotulo: 'Instabilidade hemodinâmica', tipo: 'sim_nao' }, { id: 'vanco', rotulo: 'Cateter infectado, pele/partes moles, pneumonia ou instabilidade', tipo: 'sim_nao' }],
    decidir(r) {
      const gn = r.colonizacao === 'nenhuma'
        ? { esquemas: [{ rotulo: r.instavel ? 'Neutropenia febril com instabilidade' : 'Neutropenia febril', posologia: r.instavel ? 'Meropenem 2 g IV 8/8h' : 'Cefepima 2 g IV 8/8h ou Piperacilina-tazobactam 4,5 g 6/6h', drogas: [r.instavel ? 'meropenem' : 'cefepima'] }], avisos: [] }
        : coberturaGramNegativoUTI(r.colonizacao, 'neutropenia', true);
      const esquemas = gn.esquemas.slice();
      if (r.vanco) esquemas.push({ rotulo: 'Associar vancomicina', posologia: 'Vancomicina por AUC 400–600', drogas: ['vancomicina'] });
      return { esquemas, exames: ['2 pares de hemocultura (incluindo do cateter) antes da 1ª dose — antibiótico em até 1 h.'],
        avisos: [...gn.avisos, 'Vancomicina só se cateter, pele, pneumonia ou instabilidade. Antifúngico (equinocandina) nos critérios da seção própria. Reavaliar diariamente.', AVISO_TIMEOUT_UTI] };
    }
  },
  {
    id: 'sepse_sem_foco_uti', rotulo: 'Sepse hospitalar sem foco definido (UTI)', germes: ['Enterobacterales', 'Pseudomonas aeruginosa', 'Staphylococcus aureus'],
    perguntas: [COLONIZACAO_UTI, { id: 'candida', rotulo: 'Critério para antifúngico empírico (choque + colonização multifocal/cirurgia abdominal/NPT/BDG+)', tipo: 'sim_nao' }],
    decidir(r) {
      const gn = r.colonizacao === 'nenhuma'
        ? { esquemas: [{ rotulo: 'Sepse hospitalar sem foco', posologia: 'Meropenem 2 g IV 8/8h + Vancomicina por AUC', drogas: ['meropenem', 'vancomicina'] }], avisos: [] }
        : (() => { const c = coberturaGramNegativoUTI(r.colonizacao, 'sepse', true); return { esquemas: [{ rotulo: c.esquemas[0].rotulo + ' + vancomicina', posologia: c.esquemas[0].posologia + ' + Vancomicina por AUC', drogas: [...c.esquemas[0].drogas, 'vancomicina'] }], avisos: c.avisos }; })();
      const esquemas = gn.esquemas.slice();
      if (r.candida) esquemas.push({ rotulo: 'Antifúngico empírico', posologia: 'Anidulafungina 200 mg e depois 100 mg/dia', drogas: ['anidulafungina'] });
      return { esquemas, exames: ['2 pares de hemocultura, urina, lactato, imagem dirigida — buscar foco ativamente.', ...EXAMES_UTI_BASE.slice(1)],
        avisos: [...gn.avisos, 'Antibiótico em até 1 h no choque. Buscar foco e reavaliar em 48 h; descalonar pelo teste fenotípico e cultura.', AVISO_TIMEOUT_UTI] };
    }
  }
];
SINDROMES_UTI.forEach(s => { s.fonte = 'Protocolo de Tratamento de Infecções em UTI Adulto — CCIH HNSC'; });

/* ---- Complemento da Emergência: síndromes que FALTAVAM no protocolo original (05/10/2026).
   O original já cobria SNC (meningoencefalite bacteriana), intra-abdominal, trato biliar,
   osteoarticular e sepse de foco indeterminado — esses ficam como estão. Aqui entram só os
   que não existiam: encefalite herpética, neutropenia febril, bacteremia por S. aureus,
   endocardite empírica e endêmicas do Sul. ---- */
const SINDROMES_EMERGENCIA_EXTRA = [
  {
    id: 'encefalite', rotulo: 'Encefalite (suspeita de herpes)', germes: ['Herpes simplex vírus'],
    perguntas: [],
    decidir() {
      return { esquemas: [{ rotulo: 'Encefalite herpética — imediato', posologia: 'Aciclovir 10 mg/kg (peso ideal) IV 8/8h', drogas: ['aciclovir'] }],
        exames: ['PCR para HSV no líquor; repetir se o 1º for negativo e a suspeita alta. Considerar arboviroses e raiva.'],
        avisos: ['Iniciar imediatamente, sem esperar PCR. Hidratar; ajuste renal (nefro/neurotoxicidade). Duração 14–21 dias se confirmada.'] };
    }
  },
  {
    id: 'neutropenia_febril_emerg', rotulo: 'Neutropenia febril', germes: ['Pseudomonas aeruginosa', 'Enterobacterales', 'Staphylococcus spp'],
    perguntas: [{ id: 'instavel', rotulo: 'Instabilidade ou colonização por ESBL', tipo: 'sim_nao' }, { id: 'vanco', rotulo: 'Cateter infectado, pele, pneumonia ou instabilidade', tipo: 'sim_nao' }, { id: 'alergiaGrave', rotulo: 'Alergia grave a beta-lactâmicos', tipo: 'sim_nao' }],
    decidir(r) {
      const esquemas = [r.alergiaGrave
        ? { rotulo: 'Neutropenia febril — alergia grave', posologia: 'Aztreonam 2 g IV 8/8h + Vancomicina por AUC (ou Levofloxacino + Clindamicina conforme gravidade)', drogas: ['aztreonam', 'vancomicina'] }
        : (r.instavel
          ? { rotulo: 'Neutropenia febril com instabilidade/ESBL', posologia: 'Meropenem 2 g IV 8/8h', drogas: ['meropenem'] }
          : { rotulo: 'Neutropenia febril', posologia: 'Cefepima 2 g IV 8/8h ou Piperacilina-tazobactam 4,5 g 6/6h — antibiótico em até 1 h', drogas: ['cefepima', 'piperacilinatazobactam'] })];
      if (r.vanco) esquemas.push({ rotulo: 'Associar vancomicina', posologia: 'Vancomicina por AUC', drogas: ['vancomicina'] });
      return { esquemas, exames: ['2 pares de hemocultura (incluindo cateter) antes da 1ª dose.'],
        avisos: ['Vancomicina só se cateter, pele, pneumonia ou instabilidade. MASCC ≥ 21: considerar alta com amoxicilina-clavulanato + ciprofloxacino. Duração até 48 h afebril e recuperação neutrofílica (ABHH 2024).'] };
    }
  },
  {
    id: 'bacteremia_saureus', rotulo: 'Bacteremia por S. aureus', germes: ['Staphylococcus aureus'],
    perguntas: [{ id: 'fase', rotulo: 'Resultado do antibiograma', tipo: 'escolha', opcoes: [['empirico', 'Antes do antibiograma (empírico)'], ['mssa', 'MSSA (sensível à oxacilina)'], ['mrsa', 'MRSA']] },
      { id: 'grave', rotulo: 'Sepse grave', tipo: 'sim_nao' }, { id: 'pneumonia', rotulo: 'Pneumonia presente', tipo: 'sim_nao' }],
    decidir(r) {
      let esquemas;
      if (r.fase === 'mssa') esquemas = [{ rotulo: 'MSSA (trocar da vancomicina)', posologia: 'Cefazolina 2 g IV 8/8h ou Oxacilina 2 g IV 4/4h (oxacilina se foco no SNC)', drogas: ['cefazolina', 'oxacilina'] }];
      else if (r.fase === 'mrsa') esquemas = [{ rotulo: 'MRSA', posologia: r.pneumonia ? 'Vancomicina por AUC 400–600 (daptomicina NÃO serve na pneumonia)' : 'Vancomicina por AUC 400–600 ou Daptomicina 8–10 mg/kg/dia', drogas: ['vancomicina'].concat(r.pneumonia ? [] : ['daptomicina']) }];
      else esquemas = [{ rotulo: 'Empírico (antes do antibiograma)', posologia: 'Vancomicina 25–30 mg/kg de ataque, depois por AUC' + (r.grave ? ' + Cefazolina 2 g 8/8h até o resultado' : ''), drogas: ['vancomicina'].concat(r.grave ? ['cefazolina'] : []) }];
      return { esquemas, exames: ['Hemoculturas de controle: 2 pares 48 h após a 1ª positiva e a cada 24–48 h até negativar.', 'Ecocardiograma transtorácico em todos; transesofágico se prótese/dispositivo, valvopatia, bacteremia persistente, embolia ou múltiplos focos.'],
        avisos: ['S. aureus na hemocultura NUNCA é contaminante e sempre pede busca de endocardite — avaliação do infectologista/CCIH. Retirar cateter venoso central e drenar focos. Trocar vancomicina por cefazolina/oxacilina assim que MSSA (vancomicina é inferior no MSSA). Duração: 14 dias da 1ª hemocultura negativa se foco profundo excluído; 4–6 semanas se endocardite, foco metastático ou persistência.'] };
    }
  },
  {
    id: 'endocardite', rotulo: 'Endocardite — esquema empírico', germes: ['Staphylococcus aureus', 'Streptococcus spp', 'Enterococcus faecalis'],
    perguntas: [{ id: 'cenario', rotulo: 'Cenário', tipo: 'escolha', opcoes: [['nativa', 'Valva nativa ou prótese há mais de 12 meses, comunitária'], ['protese', 'Prótese há menos de 12 meses ou relacionada à assistência (cateter, hemodiálise)']] },
      { id: 'alergiaGrave', rotulo: 'Alergia grave a beta-lactâmicos', tipo: 'sim_nao' }],
    decidir(r) {
      let esquemas;
      if (r.alergiaGrave) esquemas = [{ rotulo: 'Endocardite — alergia grave a beta-lactâmicos', posologia: 'Vancomicina por AUC + Gentamicina 3 mg/kg/dia' + (r.cenario === 'protese' ? ' + Rifampicina 900 mg/dia em 3 doses (prótese, iniciada 3–5 dias depois)' : ''), drogas: ['vancomicina', 'gentamicina'].concat(r.cenario === 'protese' ? ['rifampicina'] : []) }];
      else if (r.cenario === 'protese') esquemas = [{ rotulo: 'Prótese < 12 meses ou relacionada à assistência', posologia: 'Vancomicina por AUC + Gentamicina 3 mg/kg/dia + Rifampicina 900 mg/dia em 3 doses (iniciada 3–5 dias depois)', drogas: ['vancomicina', 'gentamicina', 'rifampicina'] }];
      else esquemas = [{ rotulo: 'Valva nativa / prótese > 12 meses, comunitária', posologia: 'Ampicilina 2 g IV 4/4h + Oxacilina 2 g IV 4/4h + Gentamicina 3 mg/kg/dia (ou Ampicilina 2 g 4/4h + Ceftriaxona 2 g 12/12h)', drogas: ['ampicilina', 'oxacilina', 'gentamicina', 'ceftriaxona'] }];
      return { esquemas, exames: ['Colher 3 pares de hemocultura com intervalo antes da 1ª dose, se o paciente estiver estável.'],
        avisos: ['Avaliação do infectologista/CCIH em todo caso. Ajustar gentamicina pela função renal e suspendê-la assim que o agente for conhecido, salvo indicação específica. Discutir cedo com a cirurgia cardíaca (transferência faz parte do tratamento). Fontes: IDSA/ESCMID 2026, ESC 2023, AHA 2026.'] };
    }
  },
  {
    id: 'febre_exposicao', rotulo: 'Febre aguda com exposição (endêmicas do Sul)', germes: ['Leptospira', 'Rickettsia', 'vírus da dengue', 'hantavírus', 'influenza'],
    perguntas: [{ id: 'exposicao', rotulo: 'Exposição / quadro predominante', tipo: 'escolha', opcoes: [
      ['lepto', 'Água de enchente, lama, esgoto ou roedores (leptospirose)'],
      ['maculosa', 'Carrapato, mata, capivara ou cavalo (febre maculosa)'],
      ['dengue', 'Mosquito e epidemia local (dengue)'],
      ['hanta', 'Galpão/paiol/mata com roedores silvestres + dispneia (hantavirose)'],
      ['influenza', 'Síndrome gripal / SRAG (influenza)'],
      ['indefinida', 'Febre com plaquetopenia e exposição duvidosa']] },
      { id: 'grave', rotulo: 'Sinais de gravidade (icterícia/oligúria/hemoptise; sinais de alarme; SRAG)', tipo: 'sim_nao' }],
    decidir(r) {
      const notif = 'Notificação compulsória.';
      if (r.exposicao === 'lepto') return { esquemas: [r.grave
          ? { rotulo: 'Leptospirose grave', posologia: 'Penicilina cristalina 1,5 milhão UI IV 6/6h, Ampicilina 1 g IV 6/6h ou Ceftriaxona 1–2 g/dia por 7 dias', drogas: ['penicilinacristalina', 'ampicilina', 'ceftriaxona'] }
          : { rotulo: 'Leptospirose leve', posologia: 'Doxiciclina 100 mg VO 12/12h ou Amoxicilina 500 mg 8/8h por 5–7 dias', drogas: ['doxiciclina', 'amoxicilina'] }],
        exames: ['qPCR precoce (NT 6/2026); hemograma, função renal, enzimas hepáticas.'],
        avisos: ['Tratar na suspeita — não esperar exame. Gravidade (icterícia rubínica, oligúria, hemoptise, plaquetopenia): internar, UTI e diálise precoce. ' + notif] };
      if (r.exposicao === 'maculosa') return { esquemas: [{ rotulo: 'Febre maculosa', posologia: 'Doxiciclina 100 mg VO/IV 12/12h em qualquer idade, na suspeita (criança < 45 kg: 2,2 mg/kg 12/12h)', drogas: ['doxiciclina'] }],
        exames: ['Sorologia/PCR não devem atrasar o tratamento.'],
        avisos: ['Tratar na suspeita — a doença mata quando o antibiótico espera o exame. Duração 7 dias ou até 3 dias sem febre. No Sul predomina R. parkeri. ' + notif] };
      if (r.exposicao === 'dengue') return { esquemas: [{ rotulo: 'Dengue — sem antibiótico', posologia: 'Hidratação pelo grupo de risco (A/B/C/D). Sem AINE nem AAS.', drogas: [] }],
        exames: ['Hemograma seriado (hematócrito e plaquetas), prova do laço.'],
        avisos: ['Sem antibiótico. Sinais de alarme (dor abdominal intensa, vômitos, sangramento de mucosa, letargia, hepatomegalia, hematócrito subindo com plaquetas caindo): internar (grupo C/D). ' + notif] };
      if (r.exposicao === 'hanta') return { esquemas: [{ rotulo: 'Hantavirose — suporte', posologia: 'Sem antiviral (ribavirina não indicada). Suporte intensivo; tratar como leptospirose até o diagnóstico.', drogas: [] }],
        exames: ['Hemograma (hemoconcentração, plaquetopenia), RX de tórax.'],
        avisos: ['UTI precoce, ventilação protetora, fluidos com cautela e droga vasoativa cedo. Letalidade 25–44% — transferir com médico. ' + notif] };
      if (r.exposicao === 'influenza') return { esquemas: [{ rotulo: 'Influenza (SRAG ou síndrome gripal com fator de risco)', posologia: 'Oseltamivir 75 mg VO 12/12h por 5 dias, mesmo após 48 h e sem esperar exame', drogas: ['oseltamivir'] }],
        exames: ['Painel viral/RT-PCR não deve atrasar o oseltamivir.'],
        avisos: ['Pico de maio a agosto no Sul. Isolamento por gotículas. Mais tempo em imunossuprimido. ' + notif] };
      return { esquemas: [{ rotulo: 'Febre + plaquetopenia, exposição duvidosa', posologia: 'Doxiciclina 100 mg VO 12/12h (cobre leptospirose e riquetsiose); associar Ceftriaxona 1–2 g/dia se houver sepse', drogas: ['doxiciclina', 'ceftriaxona'] }],
        exames: ['qPCR de leptospirose, sorologias; hemograma e função renal.'],
        avisos: ['Doxiciclina empírica cobre leptospirose e riquetsiose ao mesmo tempo. ' + notif] };
    }
  }
];
SINDROMES_EMERGENCIA_EXTRA.forEach(s => { s.fonte = s.fonte || 'Protocolo de Infecções — Emergência e Hospitalistas, CCIH HNSC'; });
PROTOCOLO_ATB.sindromes.push(...SINDROMES_EMERGENCIA_EXTRA);

/* ---- Situações específicas da Emergência (05/10/2026): mordeduras, tétano, raiva e
   acidente com material biológico. Violência sexual e tuberculose já existem como fluxos. ---- */
const SINDROMES_ESPECIFICAS = [
  {
    id: 'mordedura', rotulo: 'Mordedura — antibiótico', germes: ['Pasteurella spp', 'Staphylococcus aureus', 'anaeróbios orais', 'Capnocytophaga'],
    perguntas: [
      { id: 'tipo', rotulo: 'Tipo de mordedura', tipo: 'escolha', opcoes: [['cao', 'Cão'], ['gato', 'Gato'], ['humano', 'Humana']] },
      { id: 'infectada', rotulo: 'Infecção já estabelecida (dor, edema, secreção, celulite)', tipo: 'sim_nao' },
      { id: 'fatorRisco', rotulo: 'Fator de risco para profilaxia', tipo: 'sim_nao', ajuda: ['Ferimento em mão, face ou genitais', 'Lesão profunda ou perto de osso/articulação', 'Edema importante', 'Imunossupressão, asplenia ou cirrose'] },
      { id: 'alergiaGrave', rotulo: 'Alergia grave a beta-lactâmicos', tipo: 'sim_nao' }
    ],
    decidir(r) {
      const avisos = ['Lavar a ferida com água e sabão em abundância — primeiro passo. Avaliar profilaxia de RAIVA e de TÉTANO (fluxos próprios).', 'Evitar sutura primária de mordedura na mão.'];
      if (r.infectada) {
        return { esquemas: [r.alergiaGrave
          ? { rotulo: 'Mordedura infectada — alergia grave', posologia: 'Doxiciclina 100 mg VO 12/12h, ou Sulfametoxazol-trimetoprima + Clindamicina, por 7–14 dias', drogas: ['doxiciclina', 'sulfametoxazoltrimetoprima', 'clindamicina'] }
          : { rotulo: 'Mordedura infectada', posologia: 'Amoxicilina-clavulanato 875/125 mg VO 12/12h por 7–14 dias (IV se grave: ampicilina-sulbactam 3 g 6/6h)', drogas: ['amoxicilinaacidoclavulanico', 'ampicilinasulbactam'] }], exames: ['Cultura de secreção profunda se infecção estabelecida; hemocultura se toxemia.'], avisos };
      }
      const indicada = r.tipo === 'gato' || r.tipo === 'humano' || r.fatorRisco;
      if (!indicada) return { esquemas: [{ rotulo: 'Mordedura de cão sem fator de risco', posologia: 'Sem antibiótico de rotina: lavar, desbridar se necessário e observar.', drogas: [] }], exames: [], avisos };
      return { esquemas: [r.alergiaGrave
        ? { rotulo: 'Profilaxia — alergia grave', posologia: 'Doxiciclina 100 mg VO 12/12h, ou Sulfametoxazol-trimetoprima + Clindamicina, por 3–5 dias', drogas: ['doxiciclina', 'sulfametoxazoltrimetoprima', 'clindamicina'] }
        : { rotulo: 'Profilaxia antibiótica (indicada)', posologia: 'Amoxicilina-clavulanato 875/125 mg VO 12/12h por 3–5 dias', drogas: ['amoxicilinaacidoclavulanico'] }], exames: [], avisos };
    }
  },
  {
    id: 'tetano', rotulo: 'Profilaxia do tétano', germes: ['Clostridium tetani'],
    perguntas: [
      { id: 'historia', rotulo: 'História vacinal', tipo: 'escolha', opcoes: [
        ['incerta', 'Incerta ou menos de 3 doses'], ['recente', '≥ 3 doses, última há menos de 5 anos'],
        ['intermediaria', '≥ 3 doses, última há 5–10 anos'], ['antiga', '≥ 3 doses, última há mais de 10 anos']] },
      { id: 'ferimento', rotulo: 'Ferimento', tipo: 'escolha', opcoes: [['limpo', 'Limpo e superficial'],
        ['altorisco', 'Alto risco (profundo, sujo, puntiforme, corpo estranho, desvitalizado, queimadura, mordedura, fratura exposta)']] },
      { id: 'imunossup', rotulo: 'Imunossupressão ou ferimento muito contaminado', tipo: 'sim_nao' }
    ],
    decidir(r) {
      const alto = r.ferimento === 'altorisco';
      const avisos = ['Lavar a ferida; a profilaxia não substitui o desbridamento.'];
      let posologia;
      if (r.historia === 'incerta') posologia = alto ? 'Vacina dT + Imunoglobulina antitetânica 250 UI IM (ou soro 5.000 UI) em local diferente; completar o esquema vacinal' : 'Vacina dT e completar o esquema vacinal';
      else if (r.historia === 'recente') posologia = 'Nada (esquema completo e recente)';
      else if (r.historia === 'intermediaria') posologia = alto ? 'Reforço com dT' : 'Nada';
      else posologia = alto ? 'Reforço com dT' + (r.imunossup ? ' + Imunoglobulina antitetânica (imunossupressão ou ferimento muito contaminado)' : '') : 'Reforço com dT';
      return { esquemas: [{ rotulo: 'Conduta antitetânica', posologia, drogas: [] }], exames: [], avisos };
    }
  },
  {
    id: 'raiva', rotulo: 'Profilaxia da raiva', germes: ['vírus da raiva'],
    perguntas: [
      { id: 'animal', rotulo: 'Animal', tipo: 'escolha', opcoes: [
        ['cao_gato_obs', 'Cão ou gato passível de observação por 10 dias'],
        ['cao_gato_susp', 'Cão ou gato não observável, morto, desaparecido ou suspeito'],
        ['morcego_silvestre', 'Morcego ou outro silvestre (inclusive domiciliado)'],
        ['herbivoro', 'Herbívoro (bovino, equino)']] },
      { id: 'gravidade', rotulo: 'Exposição', tipo: 'escolha', opcoes: [
        ['leve', 'Leve (mordedura superficial em tronco/membros, lambedura em pele íntegra)'],
        ['grave', 'Grave (cabeça/face/pescoço/mãos/pés/mucosas, profunda/múltipla, lambedura de mucosa)']] }
    ],
    decidir(r) {
      const avisos = ['Lavar a ferida com água e sabão em abundância. Vacina nos dias 0, 3, 7 e 14 (IM no deltoide, nunca no glúteo). Soro antirrábico 40 UI/kg ou imunoglobulina 20 UI/kg, infiltrado na lesão, até 7 dias após a 1ª dose da vacina. Em falta de soro, seguir a nota técnica estadual vigente (RS/POA 2025).', 'Notificação compulsória.'];
      const grave = r.gravidade === 'grave' || r.animal === 'morcego_silvestre';
      let posologia;
      if (r.animal === 'cao_gato_obs') posologia = grave ? 'Observar o animal por 10 dias; iniciar vacina se adoecer, morrer ou desaparecer' : 'Observar o animal por 10 dias; sem profilaxia se continuar sadio';
      else if (r.animal === 'cao_gato_susp') posologia = grave ? 'Vacina + soro antirrábico (ou imunoglobulina)' : 'Vacina';
      else if (r.animal === 'morcego_silvestre') posologia = 'Sempre grave: Vacina + soro antirrábico (ou imunoglobulina)';
      else posologia = grave ? 'Vacina + soro antirrábico (ou imunoglobulina)' : 'Avaliar contato e epidemiologia local; vacina conforme avaliação';
      return { esquemas: [{ rotulo: 'Conduta antirrábica', posologia, drogas: [] }], exames: [], avisos };
    }
  },
  {
    id: 'material_biologico', rotulo: 'Acidente com material biológico (PEP)', germes: [],
    fonte: 'PCDT PEP (HIV, IST e hepatites) — Ministério da Saúde, 2021/2024',
    perguntas: [
      { id: 'ate72h', rotulo: 'Exposição há 72 h ou menos', tipo: 'sim_nao' },
      { id: 'fonte', rotulo: 'Fonte (paciente-origem)', tipo: 'escolha', opcoes: [
        ['positiva', 'HIV positivo conhecido'], ['desconhecida', 'Desconhecida ou não testável'], ['negativa', 'HIV negativo']] },
      { id: 'hbvImune', rotulo: 'Esquema vacinal de hepatite B completo com anti-HBs ≥ 10', tipo: 'sim_nao' }
    ],
    decidir(r) {
      const esquemas = [];
      const avisos = ['Lavar o local com água e sabão (mucosa: soro fisiológico); não espremer nem usar cáustico. Notificar (CAT/ficha de acidente de trabalho).'];
      if (r.fonte === 'negativa') {
        esquemas.push({ rotulo: 'Fonte HIV negativa', posologia: 'PEP para HIV NÃO indicada. Avaliar hepatites B e C conforme a fonte.', drogas: [] });
      } else if (r.ate72h) {
        esquemas.push({ rotulo: 'PEP para HIV (iniciar o quanto antes, até 72 h)', posologia: 'Tenofovir 300 mg + Lamivudina 300 mg (1 cp) + Dolutegravir 50 mg, VO 1x/dia por 28 dias', drogas: ['tenofovir', 'lamivudina', 'dolutegravir'] });
      } else {
        esquemas.push({ rotulo: 'Mais de 72 h', posologia: 'PEP para HIV não indicada após 72 h. Testar HIV agora e repetir em 30 e 90 dias.', drogas: [] });
      }
      if (!r.hbvImune && r.fonte !== 'negativa') esquemas.push({ rotulo: 'Hepatite B', posologia: 'Vacina (iniciar/completar) + Imunoglobulina anti-hepatite B 0,06 mL/kg IM, até 7–14 dias, se fonte HBsAg+ ou de alto risco', drogas: [] });
      return { esquemas, exames: ['Testes rápidos HIV, hepatites B e C da fonte e do acidentado na admissão; repetir HIV em 30 e 90 dias; hepatites conforme o PCDT.'], avisos };
    }
  }
];
SINDROMES_ESPECIFICAS.forEach(s => { s.fonte = s.fonte || 'Protocolo de Infecções — Emergência e Hospitalistas, CCIH HNSC'; });
PROTOCOLO_ATB.sindromes.push(...SINDROMES_ESPECIFICAS);

/* ---- Troca IV → VO (critérios IVOS + equivalências), do protocolo de Emergência ---- */
const TROCA_IV_VO = {
  criterios: [
    'Sinais e sintomas melhorando e NEWS2 em queda',
    'Temperatura entre 36 e 38 °C nas últimas 24 h',
    'Tubo digestivo funcionante, sem vômitos nem má-absorção, deglutição segura ou sonda',
    'Existe opção oral adequada ao agente e ao sítio'
  ],
  excecoes: ['Endocardite', 'Meningite', 'Bacteremia por S. aureus', 'Osteomielite', 'Artrite séptica', 'Empiema', 'Abscesso não drenado', 'Infecção necrosante'],
  equivalencias: [
    { iv: 'Ceftriaxona (PAC, pielonefrite, abdome)', vo: 'Amoxicilina-clavulanato 875/125 mg 12/12h; ou quinolona/SMX-TMP pela cultura', biodisp: 'Moderada' },
    { iv: 'Ampicilina-sulbactam / amoxicilina-clavulanato IV', vo: 'Amoxicilina-clavulanato 875/125 mg 12/12h', biodisp: 'Moderada' },
    { iv: 'Cefazolina / oxacilina (pele)', vo: 'Cefalexina 500 mg–1 g 6/6h', biodisp: 'Boa' },
    { iv: 'Levofloxacino IV', vo: 'Levofloxacino VO, mesma dose', biodisp: '≈ 99%' },
    { iv: 'Ciprofloxacino 400 mg IV 12/12h', vo: 'Ciprofloxacino 500–750 mg VO 12/12h', biodisp: '70–80%' },
    { iv: 'Metronidazol IV', vo: 'Metronidazol VO, mesma dose', biodisp: '≈ 100%' },
    { iv: 'Clindamicina IV', vo: 'Clindamicina 300–450 mg VO 6–8/8h', biodisp: '≈ 90%' },
    { iv: 'Sulfametoxazol-trimetoprima IV', vo: 'SMX-TMP VO, mesma dose', biodisp: '≈ 90%' },
    { iv: 'Linezolida IV', vo: 'Linezolida VO, mesma dose', biodisp: '≈ 100%' },
    { iv: 'Fluconazol IV', vo: 'Fluconazol VO, mesma dose', biodisp: '≈ 90%' },
    { iv: 'Doxiciclina IV', vo: 'Doxiciclina VO, mesma dose', biodisp: '≈ 90%' }
  ],
  notas: ['Avaliar a troca em até 48 h da 1ª dose IV (critérios IVOS). A via oral encurta a internação e reduz infecção de cateter.',
    'Quinolonas e doxiciclina: tomar separadas de cálcio, ferro, magnésio e antiácidos.',
    'Sem opção oral e paciente estável: avaliar OPAT (ceftriaxona, ertapenem, teicoplanina ou daptomicina em dose única diária).']
};
PROTOCOLO_ATB.adendos.push({ data: '2026-10-05', texto: 'Protocolo de Emergência/Hospitalistas complementado (documento da CCIH, 04/10/2026) com o que faltava: '
  + 'encefalite herpética, neutropenia febril, bacteremia por S. aureus, endocardite empírica, endêmicas do Sul '
  + '(leptospirose, febre maculosa, dengue, hantavirose, influenza) e situações específicas (mordedura, tétano, raiva, acidente com material biológico). '
  + 'SNC, intra-abdominal, trato biliar, osteoarticular e sepse de foco indeterminado já existiam e foram mantidos.' });

/* ---- Coleção de protocolos (03/10/2026) ----
   Públicos diferentes, donos diferentes, versões diferentes: emergência adulto (acima),
   UTI/nosocomial, gestante e pediatria. Os três últimos nascem vazios — recebem os
   documentos de cada serviço quando a CCIH os homologar. O miniapp é um por protocolo. */
const PROTOCOLOS_ATB = {
  'emergencia-adulto': PROTOCOLO_ATB,
  'uti-nosocomial': {
    id: 'uti-nosocomial', rotulo: 'UTI — adulto', homologado: true,
    fonte: 'Protocolo de Tratamento de Infecções em UTI Adulto — CCIH HNSC (base SSC 2026, IDSA AMR 2026, SBI 2025)',
    adendos: [{ data: '2026-10-05', texto: 'Ceftazidima-avibactam e aztreonam não são padronizados no HNSC: onde o esquema ideal '
      + 'os usaria (KPC, NDM, Pseudomonas DTR, OXA-48), o protocolo entrega o plano disponível (polimixina B, tigeciclina, amicacina, '
      + 'ampicilina-sulbactam, carbapenêmico) e marca o esquema com asterisco — em casos graves, discutir o uso das drogas não padronizadas com a CCIH.' }],
    publico: 'Adulto em UTI/CTI com suspeita de infecção bacteriana ou fúngica. Choque séptico ou infecção adquirida na UTI. '
      + 'Premissas: KPC endêmica com NDM em ascensão, CRAB frequente e testes moleculares lentos — a decisão empírica se apoia em risco e colonização conhecida.',
    sindromes: SINDROMES_UTI
  },
  'gestante': {
    id: 'gestante', rotulo: 'Gestantes e puérperas', homologado: false,
    fonte: '(documento a definir pela CCIH com a obstetrícia)', adendos: [],
    publico: 'Gestantes e puérperas: ITU e bacteriúria assintomática, sífilis gestacional, corioamnionite, endometrite, mastite, profilaxia para estreptococo do grupo B.',
    sindromes: []
  },
  'pediatria': {
    id: 'pediatria', rotulo: 'Pediatria e neonatologia', homologado: false,
    fonte: '(documento a definir pela CCIH com a pediatria/neonatologia)', adendos: [],
    publico: 'Crianças e recém-nascidos: doses por peso, sepse neonatal precoce/tardia, pneumonia, ITU, meningite, celulite.',
    sindromes: []
  }
};

function ajusteRenalDosEsquemas(esquemas) {
  const drogas = [...new Set((esquemas || []).flatMap(e => e.drogas || []))];
  return drogas.map(d => AJUSTE_RENAL[d]).filter(Boolean);
}

/* Sinônimos de grafia entre o protocolo e o laboratório (já normalizados). */
const SINONIMOS_DROGA_ATB = {
  ceftriaxone: 'ceftriaxona', cefepime: 'cefepima', ciprofloxacina: 'ciprofloxacino',
  amoxicilinaclavulanato: 'amoxicilinaacidoclavulanico', piperacilinaetazobactam: 'piperacilinatazobactam',
  trimetoprimasulfametoxazol: 'sulfametoxazoltrimetoprima'
};
function drogaCanonicaATB(nome) {
  const n = normalizarTexto(nome);
  return SINONIMOS_DROGA_ATB[n] || n;
}

/* ---- Contexto local do paciente ----
   O que o banco já sabe e muda a decisão: multirresistentes isolados nos últimos 12
   meses, antibióticos nos últimos 90 dias e internação recente. É daqui que os fatores
   de risco saem pré-marcados na tela — o médico confirma ou corrige. */
function contextoLocalDoPaciente(bancos, prontuario, hoje) {
  const chave = normalizarProntuario(prontuario);
  if (!chave) return null;
  const corte90 = new Date(Date.parse(hoje + 'T00:00:00Z') - 90 * 86400000).toISOString().slice(0, 10);
  const corte365 = new Date(Date.parse(hoje + 'T00:00:00Z') - 365 * 86400000).toISOString().slice(0, 10);
  const sens = indiceSensibilidade(bancos);

  const doPaciente = ((bancos.culturas || {}).culturas || [])
    .filter(c => normalizarProntuario(c.Prontuario) === chave && String(c.DataColeta).slice(0, 10) >= corte365);
  const mdr = doPaciente
    .map(c => ({ data: String(c.DataColeta).slice(0, 10), germe: c.Microrganismo, material: c.Material,
      mecanismo: mecanismoDaCultura(c, sens) }))
    .filter(x => x.mecanismo)
    .sort((a, b) => b.data.localeCompare(a.data));

  const cursos = cursosDeAntibiotico(((bancos.antibioticos || {}).prescricoes || [])
    .filter(p => normalizarProntuario(p.Prontuario) === chave));
  const atb90 = [...new Set(cursos.filter(c => c.fim >= corte90).map(c => c.Antibiotico))];

  const internacao90 = ((bancos.pacientes || {}).internacoes || []).some(i =>
    normalizarProntuario(i.Prontuario) === chave
    && (!String(i.DataAlta || '').trim() || String(i.DataAlta).slice(0, 10) >= corte90));

  const alertas = [];
  for (const x of mdr.slice(0, 5)) {
    alertas.push(`Já isolou ${x.germe} (${x.mecanismo}) em ${x.data} (${x.material || 'material não informado'}) — `
      + 'o esquema empírico deve considerar essa cobertura; na dúvida, discutir com a CCIH.');
  }
  if (atb90.length) alertas.push(`Antibióticos nos últimos 90 dias: ${atb90.join(', ')}.`);
  if (internacao90) alertas.push('Internação nos últimos 90 dias.');

  return { mdr, atb90, internacao90, culturasRecentes: doPaciente.length, alertas,
    riscoPresumido: Boolean(mdr.length || atb90.length || internacao90) };
}

/* ---- Antibiograma acumulado local por germe ----
   Fatia do banco para os germes prováveis da síndrome: % de resistência por antibiótico,
   com n testado. É o que corrige o consenso com a realidade da casa. */
function antibiogramaLocalPorGermes(bancos, germes, hoje, meses) {
  const corte = new Date(Date.parse(hoje + 'T00:00:00Z') - (meses || 24) * 30 * 86400000).toISOString().slice(0, 10);
  const sens = indiceSensibilidade(bancos);
  const resultado = [];
  for (const germe of (germes || [])) {
    const partes = normalizarTexto(germe).replace(/spp?$/, '');
    const culturas = ((bancos.culturas || {}).culturas || []).filter(c =>
      String(c.DataColeta).slice(0, 10) >= corte
      && normalizarTexto(c.Microrganismo).includes(partes)
      && !['Água', 'Leite', 'Não é cultura'].includes(String(c.AvaliacaoCCIH || '').trim()));
    const porDroga = new Map();
    for (const c of culturas) {
      const vistos = new Set();
      for (const s of (sens.get(c.ID_Cultura) || [])) {
        if (!['R', 'S', 'I'].includes(s.Resultado)) continue;
        const droga = drogaCanonicaATB(s.Antibiotico);
        if (vistos.has(droga)) continue;
        vistos.add(droga);
        if (!porDroga.has(droga)) porDroga.set(droga, { rotulo: s.Antibiotico, testados: 0, resistentes: 0 });
        const conta = porDroga.get(droga);
        conta.testados++;
        if (s.Resultado === 'R') conta.resistentes++;
      }
    }
    const linhas = [...porDroga.entries()]
      .map(([droga, c]) => ({ droga, rotulo: c.rotulo, testados: c.testados,
        pctR: Math.round(c.resistentes / c.testados * 100) }))
      .sort((a, b) => b.testados - a.testados);
    resultado.push({ germe, culturas: culturas.length, linhas });
  }
  return resultado;
}

/* Cruza o esquema sugerido com o antibiograma local: droga com resistência alta nos
   germes prováveis vira aviso com número e n — o dado local corrigindo o consenso. */
function avisosDeResistenciaLocal(esquemas, antibiograma, periodoTexto) {
  const periodo = periodoTexto || 'nos últimos 24 meses';
  const avisos = [];
  for (const esquema of (esquemas || [])) {
    for (const droga of (esquema.drogas || [])) {
      for (const bloco of (antibiograma || [])) {
        const linha = (bloco.linhas || []).find(l => l.droga === droga);
        if (!linha || linha.testados < 20 || linha.pctR < 30) continue;
        avisos.push(`Atenção — dado LOCAL: ${bloco.germe} tem ${linha.pctR}% de resistência a `
          + `${linha.rotulo} (n=${linha.testados} testados ${periodo}). `
          + 'Considerar alternativa ou coleta de cultura antes da primeira dose.');
      }
    }
  }
  return [...new Set(avisos)];
}

/* ---- Antibiograma consolidado para o miniapp ----
   O celular não carrega o banco: leva um recorte FECHADO (ex.: jun/2024–jun/2026) do
   antibiograma dos germes do protocolo, calculado aqui no computador da CCIH e embutido
   no HTML pelo montador. Só agregados (n testados e %R) — nenhum dado de paciente sai. */
function antibiogramaConsolidado(bancos, germes, de, ate) {
  const culturas = ((bancos.culturas || {}).culturas || []).filter(c => {
    const d = String(c.DataColeta).slice(0, 10);
    return d >= de && d <= ate;
  });
  const recorte = { culturas: { culturas, sensibilidade: (bancos.culturas || {}).sensibilidade || [] } };
  /* O corte por meses de antibiogramaLocalPorGermes fica folgado: o recorte por data já foi feito. */
  const meses = Math.ceil((Date.parse(ate + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z')) / (30 * 86400000)) + 1;
  return { periodo: { de, ate }, germes: antibiogramaLocalPorGermes(recorte, germes, ate, meses) };
}

/* Identificador do caminho percorrido no protocolo (pedido de 03/10/2026): síndrome +
   respostas em ordem fixa — "pneumonia|grave=S|mrsa=N". É individual por FLUXO: duas
   combinações de respostas são dois fluxos, mesmo que caiam no mesmo esquema. Não é
   regra clínica — é rótulo do registro, para a CCIH analisar adesão por caminho. */
/* ---- Agrupamento das síndromes para a tela de 3 botões do app clínico (05/10/2026) ----
   Botão 1 "esquema por sítio": síndromes com secao 'sitio', agrupadas por sítio (o esquema
   considera o RISCO DE RESISTÊNCIA do paciente, não a classificação de IRAS). Botão 3
   "situações específicas": secao 'especificas' (IST, tuberculose, profilaxias, PEP). */
const SECAO_SINDROME = {
  pav_pah: ['sitio', 'Respiratório'], pac_grave_uti: ['sitio', 'Respiratório'], respiratorio: ['sitio', 'Respiratório'],
  urinario: ['sitio', 'Urinário'], itu_cateter_uti: ['sitio', 'Urinário'],
  pele: ['sitio', 'Pele e partes moles'], pe_diabetico: ['sitio', 'Pele e partes moles'], ferida_necrosante_uti: ['sitio', 'Pele e partes moles'],
  abdominal: ['sitio', 'Abdominal'], biliar: ['sitio', 'Abdominal'], intra_abdominal_uti: ['sitio', 'Abdominal'],
  osteoarticular: ['sitio', 'Osteoarticular'],
  snc: ['sitio', 'Sistema nervoso central'], encefalite: ['sitio', 'Sistema nervoso central'], ventriculite_uti: ['sitio', 'Sistema nervoso central'],
  corrente_sanguinea: ['sitio', 'Corrente sanguínea / cateter'], bacteremia_saureus: ['sitio', 'Corrente sanguínea / cateter'], endocardite: ['sitio', 'Corrente sanguínea / cateter'],
  sepse_fi: ['sitio', 'Sepse sem foco'], sepse_sem_foco_uti: ['sitio', 'Sepse sem foco'],
  neutropenia_febril_emerg: ['sitio', 'Neutropenia febril'], neutropenia_febril_uti: ['sitio', 'Neutropenia febril'],
  febre_exposicao: ['sitio', 'Febre aguda / endêmicas'],
  ist_sifilis: ['especificas', 'IST'], ist_corrimento_uretral: ['especificas', 'IST'], ist_corrimento_vaginal: ['especificas', 'IST'], ist_dip: ['especificas', 'IST'], ist_ulcera_genital: ['especificas', 'IST'],
  tb_tratamento: ['especificas', 'Tuberculose'], tb_iltb: ['especificas', 'Tuberculose'],
  mordedura: ['especificas', 'Profilaxias de urgência'], raiva: ['especificas', 'Profilaxias de urgência'], tetano: ['especificas', 'Profilaxias de urgência'],
  material_biologico: ['especificas', 'Pós-exposição (PEP)'], ist_profilaxia_violencia: ['especificas', 'Pós-exposição (PEP)']
};
const ORDEM_SITIOS = ['Respiratório', 'Urinário', 'Pele e partes moles', 'Osteoarticular', 'Abdominal', 'Corrente sanguínea / cateter', 'Sistema nervoso central', 'Sepse sem foco', 'Neutropenia febril', 'Febre aguda / endêmicas'];
const ORDEM_ESPECIFICAS = ['Profilaxias de urgência', 'Pós-exposição (PEP)', 'IST', 'Tuberculose'];
/* Carimba secao/sitio em toda síndrome de todos os protocolos. */
function marcarSecoes(protocolos) {
  for (const p of Object.values(protocolos || {})) {
    for (const s of (p.sindromes || [])) {
      const m = SECAO_SINDROME[s.id] || ['sitio', 'Outros'];
      s.secao = m[0]; s.sitio = m[1];
    }
  }
}
/* { sitios: [{grupo, sindromes:[{id,rotulo,homologacao}]}], especificas: [...] } de um protocolo. */
function agruparSindromes(protocolo) {
  const sitios = new Map(), especificas = new Map();
  for (const s of (protocolo.sindromes || [])) {
    const alvo = s.secao === 'especificas' ? especificas : sitios;
    const chave = s.sitio || 'Outros';
    if (!alvo.has(chave)) alvo.set(chave, []);
    alvo.get(chave).push({ id: s.id, rotulo: s.rotulo, homologacao: s.homologacao });
  }
  const ordenar = (mapa, ordem) => {
    const chaves = [...mapa.keys()].sort((a, b) => { const ia = ordem.indexOf(a), ib = ordem.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b); });
    return chaves.map(grupo => ({ grupo, sindromes: mapa.get(grupo) }));
  };
  return { sitios: ordenar(sitios, ORDEM_SITIOS), especificas: ordenar(especificas, ORDEM_ESPECIFICAS) };
}
marcarSecoes(PROTOCOLOS_ATB);   /* carimba secao/sitio em todas as síndromes para a tela de 3 botões */

function idDoFluxo(protocoloId, sindromeId, respostas) {
  const partes = Object.keys(respostas || {}).sort().map(k => {
    const v = respostas[k];
    return k + '=' + (v === true ? 'S' : v === false ? 'N' : String(v == null ? '' : v));
  });
  return [String(protocoloId || ''), String(sindromeId || '')].concat(partes).join('|');
}

/* Versão de um protocolo = data do último adendo validado pela CCIH ("original" se nenhum;
   "em construção" se ainda não tem fluxos). Vai em cada decisão registrada: os fluxos
   mudam, e a análise precisa saber com qual versão o médico decidiu. */
function versaoDoProtocolo(protocolo) {
  const p = protocolo || PROTOCOLO_ATB;
  if (!(p.sindromes || []).length) return 'em construção';
  const datas = (p.adendos || []).map(a => String(a.data || '')).filter(Boolean).sort();
  return datas.length ? datas[datas.length - 1] : 'original';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PROTOCOLO_ATB, PROTOCOLOS_ATB, REVISAO_PROTOCOLO_ATB, ORIENTACAO_RENAL, AJUSTE_RENAL, ajusteRenalDosEsquemas,
    contextoLocalDoPaciente, antibiogramaLocalPorGermes, antibiogramaConsolidado, avisosDeResistenciaLocal, drogaCanonicaATB,
    idDoFluxo, versaoDoProtocolo, comprimidosTB, SINDROMES_PCDT, SINDROMES_ESPECIFICAS, TROCA_IV_VO, agruparSindromes };
}
