# Decisões e contexto do projeto (para qualquer sessão, em qualquer máquina)

Resumo do que foi decidido com a CCIH e do que está pendente. **Não traz dado de paciente.**
A pasta de dados real nunca está disponível fora da máquina da CCIH e da cópia local do autor:
em sessões na nuvem ou em outro computador, valide com testes (`node scripts/testes.js`,
fixtures sintéticas) e deixe a conferência com o banco real para a sessão local.

## Como trabalhar de outro computador
- Mesmo repositório (`Rog7207/Programa-de-gest-o-de-CCIH-`, espelho em `hnsc-aplicativo-ccih`).
- Trabalhe num ramo (`claude/...` ou com seu nome); o `main` recebe pelo merge na sessão local,
  que roda os testes e monta o pacote (`node scripts/montar-pacote-hnsc.js`).
- Nunca aponte a sessão para a pasta de dados nem a coloque dentro do repositório
  (o `.gitignore` bloqueia `Dados CCIH*/`, `dossies/` e `.xlsx` na raiz por precaução).
- Commits em português, terminados com a linha de coautoria do Claude.

## Fontes de dados (Tasy) e rotina diária
Ordem: censo 50023 → movimentação/passagens 2536 (seg–sex; segunda cobre sáb–seg) → internados
hoje 2396 → culturas → **evoluções 2394** → sinais vitais 2411 → isolamentos 1042 → bundles
1116/2166 → análise de antibióticos **2362** → IRAS/IMAS 2485. Mensal: cirurgias 2550,
profilaxia 1714, óbitos 836, NISS 3066.
- O **2362 é análise de antibióticos, não evoluções** (de 08 a 17/10/2026 ele foi importado como
  "evoluções" e nenhuma evolução entrou). O 2394 é o único que traz `Ds evolucao`.
- O Tasy exporta um **recorte diário** de evoluções: o app acumula em
  `evolucoes_historico.xlsx` (retenção: internado ou 28 dias). O histórico começou em 17/10/2026.
- A dose dos antibióticos só vem do **relatório de prescrições** (desde ago/2026); o 2362 não traz.
- Passagens por setor: o 2536 (com hora) vence a foto 2396 no período que cobre
  (`reconciliarPassagens`, roda a cada importação).

## Regras clínicas decididas pela CCIH
- **Cultura colhida até D3 = presente na admissão** (D1 = dia da admissão), exceto readmissão
  ≤30 d ou cirurgia ≤90 d (ficam pendentes com o motivo). Multirresistente classificado assim
  **continua na tela de isolamentos**. Retroativo: `scripts/aplicar-regra-admissao.js` (simula;
  `--aplicar` grava com backup) — ainda não aplicado no banco da CCIH.
- **Mesmo paciente + mesmo sítio + ≤14 dias = mesmo episódio de IRAS**, mesmo com nomes
  diferentes (ISC superficial/profunda/órgão; traqueobronquite/pneumonia/PAV; IPCS clínica/
  laboratorial; ITU com/sem cateter). Fica a topografia **mais profunda/grave**; digitado no
  Tasy > confirmado > descartado > em investigação. Bacteremia secundária é grupo à parte.
- **ISC**: liga-se à cirurgia de origem (candidatas até 180 d antes da detecção; "na janela" =
  ≤30 d ou ≤90 d com prótese). **A data da infecção passa a ser a data da cirurgia**; a data em
  que foi vista fica em `DataDeteccao`.
- **A cultura escolhida como agente de uma IRAS confirmada é reclassificada como "IRAS — topografia"**
  (a anterior fica em `TriagemRegra`).
- **Casos indeterminados**: os 658 casos sem topografia criados da classificação retroativa
  (set/2021–jun/2026; sistema antigo sem verificação) devem ser marcados "indeterminado" pelo
  botão da aba Infecções e **não contam** como IRAS nem como admissão. Ainda não marcados.
- IRAS confirmada → ficha impressa → digitação no Tasy → conciliação marca "digitado"; a partir
  de 01/07/2026 só o digitado conta nos relatórios.
- Suspeita da IA no mesmo sítio de IRAS já notificada (±14 d) é desconsiderada; se a CCIH tinha
  descartado, volta com aviso.

## IA de detecção de IRAS (em andamento)
- Dossiê por internação (`js/dossie.js`): eventos por dia (D1 = admissão), bloco "infecção
  presente na admissão", contaminante em amostra única, fatias ≤1.800 caracteres para um
  classificador de 512 tokens (`gerar-dossies --treino` → `_treino.jsonl`).
- 1ª fase do classificador (do autor, em outro projeto, treinado localmente): **fragmento
  suspeito**, não IRAS confirmada. Pré-anotação com Qwen local (`pre-anotar-fragmentos.js`) +
  página de anotação (`montar-pagina-anotacao.js`); a correção humana é o rótulo. Tudo fica
  dentro da pasta de dados; modelo só local (LGPD).
- Pausado em 21/10/2026 para correções do app; retomar quando o histórico de evoluções tiver
  ~3 semanas.

## Reunião da CCIH
- Feito: slide "Consumo de antibióticos — 12 meses" (DOT e DDD por 1.000 pacientes-dia, UTI
  adulto = só o CTI Dr. Joaquim, e hospital). Tabela de DDD/apresentações em `config.xlsx`,
  aba `ddd_antibioticos` (OMS; confirmados: meropenem 1 g, vancomicina 500 mg, metronidazol
  comprimido 400 mg, sulfa comprimido 800/160).
- Redesenho de 21/10/2026 (ordem e conteúdo dos slides, decisão dele): IRAS do mês (taxa/1.000
  pd, n, barras por sítio) → IRAS por mês em colunas → dispositivos do CTI (utilização e
  densidade, mês × 6 meses anteriores) → MDR do trimestre → consumo ATB desde janeiro →
  avaliações de ATB da UTI adulto (visita/miniapp; o relatório de avaliações do Tasy não
  funciona) → higiene do trimestre por momento e setor → pós-alta das cirurgias do MÊS
  ANTERIOR (contato aos 30 dias) → isolamentos → óbitos/permanência. Slide de sepse retirado.
  A reunião só conta IRAS confirmadas/digitadas.
- 23/10/2026: slide "Comparação com benchmarks externos" (`compararComBenchmarks`,
  `BENCHMARKS_EXTERNOS` em relatorios.js): trimestre fechado × Anvisa 2024 (Boletim 32,
  percentis nacionais de UTI adulto e ISC por categoria, transcritos do boletim de Porto Alegre
  2024 que reproduz as tabelas), NHSN 2012 (UTI médico-cirúrgica major teaching) e INICC
  2015–20; higiene 70% como patamar usual (OMS não fixa meta); DDD UTI vs programa de SP.
  Os números das referências estão em código e devem ser conferidos pela CCIH; a Anvisa
  publica o Boletim 32 só em Power BI.
- Pendente: painel por público (direção / UTI / clínica / cirúrgica) com metas e semáforo —
  depende de a CCIH definir metas e os grupos de setores de cada área.

## Antibióticos: cursos e dias de terapia
- 23/10/2026: o fim PREVISTO do 2362 (sem suspensão) emendava esquema antigo com esquema novo
  (cefepima parada há 15 dias contada junto com a nova). Regra: o previsto termina na véspera do
  primeiro dia em que o relatório diário de prescrições mostra o paciente sem aquele
  antibiótico (`prescricoesComFimEfetivo`); "Nr dia util" = 1 (coluna DiaTerapia, a mapear na
  importação do diário) abre curso novo. Sem diário no dia, nada muda. Vale para cursos, fila,
  alertas e DOT/DDD.

## Pendências conhecidas
- Idade não existe no cadastro de pacientes (vem no 2536 e nos óbitos; guardar na internação).
- Dispositivo-dia só do CTI (NISS); enfermarias sem denominador de dispositivo.
- Contagens antigas (panorama gerencial, cruzamento IRAS × culturas) incluem
  descartados e em investigação como IRAS — não alterado para não mudar números já apresentados.
- Arquivo cifrado da pasta de dados para transporte: decisão de formato pendente.
