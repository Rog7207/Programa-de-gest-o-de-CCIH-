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

const PROTOCOLO_ATB = {
  fonte: 'Protocolo de Tratamento Empírico de Infecções na Emergência — HNSC/SCIH',
  /* Alterações de conduta validadas pela CCIH depois do documento original. Cada uma é
     uma decisão registrada aqui até ser incorporada ao texto do protocolo. */
  adendos: [
    { data: '2026-09-05', texto: 'Pneumonia aspirativa: ceftriaxona quando não há abscesso pulmonar; ampicilina-sulbactam '
      + 'reservada à aspirativa com abscesso (4 doses/dia — praticidade pesa na adesão).' }
  ],
  publico: 'Adultos e adolescentes (>14 anos) com infecção presente na admissão (<48h de internação). '
    + 'Sepse com foco conhecido segue o protocolo institucional de sepse.',
  sindromes: [

    {
      id: 'urinario', rotulo: 'Foco urinário',
      germes: ['Escherichia coli', 'Klebsiella pneumoniae', 'Proteus mirabilis', 'Enterococcus spp'],
      perguntas: [
        { id: 'apresentacao', rotulo: 'Apresentação', tipo: 'escolha', opcoes: [
          ['cistite', 'Cistite simples (mulher)'], ['pielonefrite', 'Pielonefrite ou ITU em homem']] },
        { id: 'internacao', rotulo: 'Necessita internação ou via oral inviável', tipo: 'sim_nao' },
        { id: 'riscoEsbl', rotulo: 'Risco ESBL: internação, antimicrobiano ou procedimento urológico nos últimos 90 dias', tipo: 'sim_nao' },
        { id: 'alergiaBL', rotulo: 'Alergia a beta-lactâmicos', tipo: 'sim_nao' },
        { id: 'tfgBaixa', rotulo: 'TFG < 30 mL/min', tipo: 'sim_nao' }
      ],
      decidir(r) {
        const exames = r.apresentacao === 'cistite'
          ? ['Cistite simples em mulher: diagnóstico clínico — não coletar exames de rotina.']
          : ['Urina tipo 1 (EAS) e urocultura com antibiograma ANTES da primeira dose.',
             '2 pares de hemoculturas se instabilidade hemodinâmica ou febre alta com calafrios.'];
        if (r.apresentacao === 'cistite') {
          const esquemas = [];
          if (!r.tfgBaixa) esquemas.push({ rotulo: '1ª escolha', posologia: 'Nitrofurantoína 100 mg VO 12/12h por 5 dias', drogas: ['nitrofurantoina'] });
          esquemas.push({ rotulo: r.tfgBaixa ? '1ª escolha (TFG < 30: nitrofurantoína contraindicada)' : 'Alternativa',
            posologia: 'Fosfomicina trometamol 3 g VO, dose única', drogas: ['fosfomicina'] });
          esquemas.push({ rotulo: 'Segunda linha oral', posologia: 'Amoxicilina + Clavulanato 875/125 mg VO 12/12h por 5–7 dias', drogas: ['amoxicilinaacidoclavulanico'] });
          return { esquemas, exames, avisos: [] };
        }
        if (r.riscoEsbl) {
          return { esquemas: [{ rotulo: 'Risco ESBL', posologia: 'Amicacina 15 mg/kg IV 1x/dia', drogas: ['amicacina'] }],
            exames, avisos: ['Risco ESBL assumido (internação/ATB/procedimento urológico em 90 dias).'] };
        }
        if (r.alergiaBL) {
          return { esquemas: [
            { rotulo: 'Alergia a beta-lactâmicos', posologia: 'Levofloxacino 750 mg IV 1x/dia', drogas: ['levofloxacino'] },
            { rotulo: 'Alternativa', posologia: 'Amicacina 15 mg/kg IV 1x/dia', drogas: ['amicacina'] }], exames, avisos: [] };
        }
        if (r.internacao) {
          return { esquemas: [{ rotulo: 'Pielonefrite internada', posologia: 'Ceftriaxona 2 g IV 1x/dia', drogas: ['ceftriaxona'] }], exames, avisos: [] };
        }
        return { esquemas: [
          { rotulo: 'Pielonefrite estável (VO)', posologia: 'Ciprofloxacino 500 mg VO 12/12h por 7 dias', drogas: ['ciprofloxacino'] },
          { rotulo: 'Alternativa', posologia: 'Levofloxacino 750 mg VO 1x/dia por 5 dias', drogas: ['levofloxacino'] }], exames, avisos: [] };
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
        { id: 'riscoMRSA', rotulo: 'Risco para MRSA hospitalar', tipo: 'sim_nao' }
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
        { id: 'riscoMRSAHosp', rotulo: 'Risco de MRSA hospitalar, falha prévia ou IRAS', tipo: 'sim_nao' },
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
        { id: 'posTrauma', rotulo: 'Pós-trauma ou procedimento cirúrgico prévio (IRAS)', tipo: 'sim_nao' },
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
  module.exports = { PROTOCOLO_ATB, REVISAO_PROTOCOLO_ATB, contextoLocalDoPaciente,
    antibiogramaLocalPorGermes, antibiogramaConsolidado, avisosDeResistenciaLocal, drogaCanonicaATB };
}
