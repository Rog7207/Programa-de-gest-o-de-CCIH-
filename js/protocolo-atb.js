/* Decisão de antibioticoterapia empírica — núcleo puro (roda em Node, testável).
   As regras vêm do "Protocolo de Tratamento Empírico de Infecções na Emergência" do HNSC
   (validado pela CCIH); o motor cruza a resposta do protocolo com os dados LOCAIS do
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
  fonte: 'Protocolo de Tratamento Empírico de Infecções na Emergência — HNSC/SCIH',
  /* Alterações de conduta validadas pela CCIH depois do documento original. Cada uma é
     uma decisão registrada aqui até ser incorporada ao texto do protocolo. */
  adendos: [
    { data: '2026-09-05', texto: 'Pneumonia aspirativa: ceftriaxona quando não há abscesso pulmonar; ampicilina-sulbactam '
      + 'reservada à aspirativa com abscesso (4 doses/dia — praticidade pesa na adesão).' },
    { data: '2026-09-05', texto: 'Pielonefrite/ITU em homem com TFG < 30: amicacina deixa de ser empírico de escolha '
      + '(nefrotoxicidade). Risco ESBL → ertapenem 1 g IV 1x/dia; alergia a beta-lactâmicos → levofloxacino com dose '
      + 'ajustada; ciprofloxacino VO ajustado para 24/24h.' },
    { data: '2026-09-06', texto: 'Função renal: a primeira dose é sempre plena; o ajuste começa na segunda dose, '
      + 'pela tabela de correção exibida junto do esquema.' },
    { data: '2026-09-06', texto: 'Risco de MRSA definido (MRSA prévio em 12 meses; internação/cirurgia/ATB IV em 90 dias; '
      + 'hemodiálise, ILPI ou droga injetável; falha de beta-lactâmico) com reforços por sítio — sem mudança de conduta.' },
    { data: '2026-09-06', texto: 'Pé diabético infectado acrescentado como síndrome (classificação IWGDF/IDSA 2023): leve VO, '
      + 'moderada ceftriaxona + metronidazol, grave piperacilina-tazobactam + vancomicina; vancomicina associada se risco de MRSA.' }
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

/* ---- Ajuste à função renal ----
   Regra do protocolo (CCIH, 06/09/2026): a PRIMEIRA dose é sempre plena — dose de ataque —
   qualquer que seja a função renal; o ajuste começa na segunda dose. Faixas em TFG/ClCr
   (mL/min), adulto. Só constam as drogas dos esquemas que precisam de ajuste; as demais
   (ceftriaxona, metronidazol, azitromicina, clindamicina, doxiciclina, oxacilina,
   moxifloxacino, fosfomicina) não ajustam. Referência: bula/Sanford — conferir com a
   farmácia em diálise. */
const ORIENTACAO_RENAL = 'Primeira dose sempre plena (dose de ataque), qualquer que seja a função renal. '
  + 'O ajuste começa na SEGUNDA dose, pela TFG/ClCr — e, para vancomicina e amicacina, pelo nível sérico.';

const AJUSTE_RENAL = {
  vancomicina: { rotulo: 'Vancomicina', nota: 'Ataque 20–25 mg/kg. Manutenção guiada por vale (15–20 mg/L).', faixas: [
    ['≥ 50', '15–20 mg/kg 8/8h a 12/12h'], ['20–49', '15–20 mg/kg 24/24h'], ['10–19', '15–20 mg/kg 24–48h'],
    ['< 10 / diálise', 'redosar pelo nível sérico (após a diálise)']] },
  amicacina: { rotulo: 'Amicacina', nota: '1ª dose 15 mg/kg plena; depois só pelo intervalo e nível (vale < 5 mg/L antes de redosar).', faixas: [
    ['≥ 60', '15 mg/kg 24/24h'], ['40–59', '15 mg/kg 36/36h'], ['20–39', '15 mg/kg 48/48h'],
    ['< 20 / diálise', 'redosar só com nível sérico; em diálise, após a sessão']] },
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
  nitrofurantoina: { rotulo: 'Nitrofurantoína', faixas: [['≥ 30', '100 mg 12/12h'], ['< 30', 'contraindicada']] }
};

/* Tabela de ajuste só das drogas presentes nos esquemas sugeridos. */
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PROTOCOLO_ATB, REVISAO_PROTOCOLO_ATB, ORIENTACAO_RENAL, AJUSTE_RENAL, ajusteRenalDosEsquemas,
    contextoLocalDoPaciente, antibiogramaLocalPorGermes, antibiogramaConsolidado, avisosDeResistenciaLocal, drogaCanonicaATB };
}
