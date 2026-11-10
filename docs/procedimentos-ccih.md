# Procedimentos da CCIH que já têm função no aplicativo

Levantamento feito a partir do programa (abas, funções da equipe cadastráveis, medidores do
Painel, manual e scripts) para servir de base à revisão de "quem faz o que e quando" da CCIH
do HNSC (10/11/2026). Não é o procedimento operacional em si: é o mapa do que o aplicativo
já sustenta, onde cada rotina acontece dentro dele e o que ele mede.

**Como ler as tabelas**

- **Função cadastrada** é o perfil de Configurações → Equipe e funções (chave interna entre
  parênteses). É por ela que o cartão **Rotina da equipe**, no Painel, sabe de quem é a fila.
- **Medidor** é como o Painel julga se a rotina está em dia: *fila* (atrasada quando o item
  mais antigo passou do prazo "a cada N dias" da função), *cadência* (atrasada quando faz mais
  tempo que o prazo desde a última vez) ou *sem medidor*.
- A cadência indicada é a que o programa pressupõe hoje (manual + código). Onde a CCIH decidir
  outra, basta mudar o "a cada N dias" da função.

---

## 1. Diário

| Procedimento | Função cadastrada | Onde no app | Medidor | Observações |
|---|---|---|---|---|
| **Entrada dos relatórios do Tasy** na ordem: censo 50023 → movimentação 2536 → internados com leito 2396 → culturas do laboratório → evoluções 2394 → sinais vitais 2411 → isolamentos 1042 → bundles 1116/2166 → análise de ATB 2362 → prescrições diárias 2365 → IRAS 2485 | Entrada dos relatórios do Tasy (`importacao_tasy`) | Importar (perfis de importação memorizam o layout) | cadência, em dias úteis desde a última carga | A ordem importa: o censo cria a identidade atendimento ↔ prontuário; o que vem por atendimento (2362, 2365) só casa depois dele. O 2365 é o que diz quando um antibiótico **parou** — sem ele os cursos emendam e a aba Antibióticos avisa. Reimportar não duplica. |
| Reimportar a **foto dos internados (2396)** antes de cada visita a setor | idem | Importar | — | É o que atualiza setor/leito do "leito a leito" da UTI e publica a lista de internados para o miniapp de decisão de ATB. |
| **Evoluções todos os dias** | idem | Importar | — | O Tasy exporta só o recorte do dia; o histórico de 28 dias que alimenta o dossiê e os sinais de infecção depende da importação diária. |
| **Revisão de culturas** (detecção de IRAS): classificar cada positivo pendente como Presente na admissão / IRAS (topografia + dispositivo) / Colonização / Contaminação / Repetição / Não é cultura, com a **observação para quem vai validar** | Detecção de IRAS (`deteccao_iras`) | Culturas (fila), com antibiograma, contexto da coleta e ficha do paciente | fila: idade da cultura pendente mais antiga | A triagem automática já tira negativas, swabs/SGB, controles e a regra D1–D3 (presente na admissão até o 3º dia, exceto readmissão ≤30 d e cirurgia ≤90 d). Amostras repetidas (mesmo germe/material em 14 d) são uma linha só. Classificar como IRAS abre a suspeita e já define o agente. |
| **Validação de IRAS** (segunda assinatura): completar topografia, dispositivo, agente (cultura em ±14 d) e critério; ligar ISC à cirurgia; confirmar ou descartar | Validação de IRAS (`validacao_iras`) | Infecções › **A confirmar** (também duplicatas a fundir e casos indeterminados) | fila: suspeita em investigação mais antiga | Toda suspeita (cultura, pós-alta, miniapp da UTI, avaliação remota, evolução com sinais) nasce "em investigação". O app avisa se a mesma pessoa que abriu tentar confirmar. A cultura escolhida como agente é reclassificada como IRAS. |
| **Digitação das IRAS no Tasy** e conciliação: imprimir fichas (2 por página, guardadas em `fichas/`) → digitar no Tasy → importar o export "IRAS digitadas no Tasy" ou a lista do IMAS (2485) | *(sem função própria — hoje cabe a quem valida)* | Infecções › **A digitar no Tasy** → Importar | — | Desde 01/07/2026 só a IRAS **digitada** conta nos relatórios. Reimportar o export marca como digitado e tira da fila; linha duplicada no Tasy é barrada com aviso. |
| **Identificação de isolamentos**: para cada multirresistente novo sem precaução ativa, registrar a precaução iniciada ou "não indicado" com justificativa; encerrar precauções | Identificação de isolamentos (`isolamentos`) | Isolamentos (pendências do app + lista diária 1042) | fila: pendência mais antiga | Multirresistentes classificados pela regra D1–D3 continuam aparecendo aqui. A lista "Multirresistentes isolados rotineiramente" (Configurações → Rotina da instituição) define o que gera pendência. |
| **Validação de isolamentos duvidosos** pelo infectologista | Validação de isolamentos (`isolamento_validacao`) | Isolamentos | **sem medidor** | Perfil só de cadastro: ainda não existe o encaminhamento do caso duvidoso nem a fila correspondente. |
| **Doenças de notificação compulsória**: avaliar a lista "A avaliar" (cultura ou evolução), notificar no SINAN e marcar aqui, incluir observação ou descartar; imprimir a lista para o SINAN; importar o NINDINET | *(sem função cadastrada)* | Notificáveis → Importar (NINDINET .dbf) | — | O app só aponta e cruza com o que já foi notificado; nunca notifica sozinho. Agravos de notificação imediata vêm marcados; "Isolamento indicado" leva à aba Isolamentos. |
| **Vigilância de colonização** (swabs): UTI adulto semana a semana (rastreados, positivos, aquisições, cluster), internados há mais de 9 dias sem swab, retal/orofaringe fora da UTI, nasal pré-operatório (MRSA → descolonização), SGB em gestante | *(sem função cadastrada — hoje junto da identificação de isolamentos)* | Colonização ("Marcar visto", descolonização) | — | Positivo de vigilância = carbapenem-R, MRSA ou VRE; ESBL não entra. Alertas: MDR sem precaução de contato, SGB (profilaxia intraparto), UTI sem swab, cluster. |
| **Conferir os alertas do dia**: suspeitas de surto, MDR dos últimos 10 dias, alertas de antimicrobianos (germe resistente ao ATB em uso, dose acima do teto, curso ≥10 dias), suspeitas de IRAS e pendências | Gestor (`gestor`, informativo) | Painel | — | Clicar num alerta de antibiótico abre a avaliação daquele curso na fila. |

## 2. Semanal

| Procedimento | Função cadastrada | Onde no app | Medidor | Observações |
|---|---|---|---|---|
| **Avaliação dos cursos de antibiótico** (stewardship): fila do mais recente para o mais antigo, com culturas recentes, antibiograma e última evolução; registrar Avaliação + Recomendação (Manter / Ajustar dose / Descalonar / Modificar / Suspender) e parecer | Controle de antibióticos (`controle_antibioticos`) | Antibióticos (fila, alertas, indicadores DOT/DDD) | cadência da última avaliação registrada | Curso avaliado que continua correndo volta à fila em 7 dias. A lista "Antibióticos avaliados rotineiramente" (Rotina da instituição) define o que entra. |
| **Página remota para os prescritores**: gerar o HTML cifrado com os pendentes; o retorno dos médicos entra pela aba Importar | idem | Antibióticos → Importar | — | Também é um caminho de entrada de suspeita de IRAS. |
| **Visita à UTI**: preparar (📋 resumo do mês do setor; 🛏 leito a leito com dispositivos, ATB em curso, culturas, isolamento, última evolução, vitais alterados 48 h), gerar o **miniapp cifrado** da visita, visitar, importar o arquivo do celular | Visita à UTI (`visita_uti`) | UTI → Importar | cadência da última visita importada | A importação vira dispositivo-dia, retiradas sugeridas (o app confere depois se foram retiradas) e suspeitas de IRAS. O slide 6 da Reunião sai daqui. |
| **Controle de dispositivos invasivos** (CVC/VM/SVD; infectologista + enfermeiro) | Controle de procedimentos invasivos (`controle_procedimentos_invasivos`) | UTI (indicadores; bundles 1116/2166 importados) | **sem medidor** | Perfil só de cadastro: não há ainda a tela de dispositivos a revisar. Os dados existem (bundles, visitas, NISS). |
| **Auditoria de higiene das mãos**: observar os 5 momentos no miniapp; **☁ Sincronizar** com a planilha do Google (ou importar o CSV) | Auditoria de higiene das mãos (`higiene_maos`) | Higiene de mãos (adesão por momento, setor, categoria) | cadência da última observação | Alimenta o slide 7 da Reunião e o benchmark OMS. |
| **Investigação de surtos**: avaliar cada suspeita automática (mesmo germe + mesmo perfil de resistência em 14 d, mesmo setor ou mesmo procedimento; endêmicos acima da linha de base), investigar com o cruzamento de coincidências e anexos, ou descartar | Investigação de surtos (`investigacao_surtos`) | Surtos (+ alerta no Painel) | fila: suspeita ativa mais antiga | Suspeita com mais de 6 meses sem avaliação vira "antigo não avaliado" e pode ser descartada em lote. |
| **Vigilância pós-alta de ISC**: (1) triagem das cirurgias de 30–150 d (limpas, cesarianas, próteses — Anvisa não pode ser dispensada), (2) WhatsApp com mensagem-modelo, (3) registrar resposta (sem infecção / investigação), (4) validação por segundo profissional, (5) **contato de 90 dias** nas próteses/implantes, (6) encerrar "sem contato" após 150 d | Vigilância pós-alta (`vigilancia_pos_alta`) | Pós-alta (abas Triagem, Aguardando envio, Enviados, Em investigação, Contato de 90 dias, Encerradas) | fila, contada a partir da abertura da janela (cirurgia + 30 d) | Investigação abre suspeita de IRAS com a observação da enfermeira em destaque para quem valida. Efetividade por procedimento no relatório "ISC — Anvisa". |
| **Decisão de ATB empírica** (médicos, no celular): sincronizar a planilha; acompanhar adesão por protocolo › síndrome; manter cadastro de médicos (CRM/senha) na aba privada da planilha | Gestor / Controle de antibióticos | Decisão ATB → Configurações (☁ Planilha do Google) | — | Protocolos por público (emergência, UTI, gestante, pediatria); fluxos do PCDT entram "a homologar" — homologação vira adendo. |

## 3. Mensal

| Procedimento | Função cadastrada | Onde no app | Medidor | Observações |
|---|---|---|---|---|
| **Importar no 1º dia do mês**: cirurgias + telefones (2550), profilaxia cirúrgica (1714), óbitos (836), invasividade NISS (3066, um para a CTI e um para a UTI neonatal) | Entrada dos relatórios do Tasy | Importar | — | O 3066 é o único que não depende de ninguém (denominador por setor). A reimportação das cirurgias completa telefone/caráter/cirurgião que faltavam. |
| **Notificação mensal à Anvisa** (até o dia 15): conferir antes o relatório "ISC — procedimentos de notificação à Anvisa" (problemas a resolver: dispensadas, pendentes há >7 d, janela vencida sem contato, nome ambíguo) e então gerar o **Relatório ANVISA** (só números: cesariana e 5 procedimentos com implante, UTI adulto e neonatal com densidades, utilização e agentes/resistência) | *(sem função cadastrada — Gestor)* | Relatórios | — | Ainda não saem do app: gramas dos 26 antimicrobianos prioritários, álcool/sabonete por paciente-dia, UTI neonatal por faixa de peso. |
| **Reunião da CCIH**: apresentar os slides (IRAS do mês, série de 12 meses, dispositivos no CTI, benchmarks, MDR, consumo de ATB, avaliações na UTI, higiene, pós-alta do mês anterior, isolamentos, óbitos) | Gestor | Reunião CCIH | — | Só IRAS confirmadas/digitadas contam. Benchmarks externos (Anvisa 2024, NHSN, INICC) por trimestre fechado. |
| **Relatórios padrão e perfil microbiológico** (por setor, grupo de setores ou hospital), eventos e séries | Gestor | Relatórios, Perfil micro, Eventos | — | — |
| **Higiene da fila de IRAS**: fundir duplicatas apontadas no topo da aba, checar casos indeterminados (É IRAS / Não é IRAS) | Validação de IRAS | Infecções › A confirmar | — | Dedup automática reconhece mesmo paciente + mesmo sítio em 14 d, por identidade do cadastro. |

## 4. Contínuo / sob demanda

| Procedimento | Função cadastrada | Onde no app | Observações |
|---|---|---|---|
| **Correção de registro errado** (cultura, caso de IRAS, avaliação de ATB, cirurgia, isolamento, internação, sepse): botão ✎ na linha do tempo; nada é apagado, tudo fica com quem/quando/de → para e motivo | quem detectar | Ficha do paciente | Cultura que deixa de ser IRAS oferece descartar o caso; caso descartado oferece reclassificar as culturas. |
| **Ficha do paciente**: consulta da linha do tempo completa; unificação de registros provisórios do laboratório | todos | Pacientes / clique no nome | Endereço próprio `#paciente=prontuário`; várias abas do navegador com o mesmo usuário. |
| **Cadastros do gestor**: equipe e funções (com "a cada N dias"), grupos de setores, rotina da instituição (ATB avaliados, MDR isolados, cirurgias vigiadas, germes só com resistência), perfis de importação, auditoria/unificação de vocabulário, data de início da conciliação | Gestor | Configurações | É este cadastro que define os prazos do cartão Rotina da equipe. |
| **Distribuição dos miniapps** (higiene, decisão ATB, visita à UTI): gravar na pasta espelhada / publicar pelo Apps Script; QR codes nas abas; tablet da CCIH | Gestor | Configurações, abas UTI / Higiene / Decisão ATB / Antibióticos | Nada sensível sai sem cifra; a senha da lista cifrada vai por outro canal. |
| **Protocolo de sepse**: importar a ficha dos enfermeiros; indicadores de tempos, bundle e desfechos | *(sem função cadastrada)* | Sepse → Importar | Cultura colhida em torno da abertura do protocolo aparece no relatório mesmo triada. |
| **Dossiê de internação para IA** (rotina diária opcional): `gerar-dossies.js --todos` e `avaliar-dossies-ollama.js` na máquina da CCIH; anotação de fragmentos para o classificador | Gestor | scripts (fora do app) | Fica dentro da pasta de dados; só modelo local. |
| **Backup** da pasta de dados inteira | Gestor | — | Os scripts de manutenção fazem cópia datada em `backups/` antes de gravar. |
| **Scripts de manutenção** (rodar com simulação e depois `--aplicar`): dedup de culturas, telefones das cirurgias, reclassificar cirurgias, triagem, regra D1–D3, sítio dos swabs, reabrir cirurgias Anvisa, fundir IRAS duplicadas, unificar identidades | Gestor / suporte | `scripts/` | Já aplicados na cópia de 05/11/2026; valem para repetir quando um lote antigo entrar. |

---

## 5. O que a revisão de procedimentos vai encontrar sem correspondente (ou pela metade)

1. **Relógio do Painel × rotina real.** O cartão Rotina da equipe foi desenhado para carga
   **semanal** (segunda) e congela entre cargas; a importação hoje é **diária** (seção 3 do
   manual). Decidir qual é a regra e ajustar o cartão.
2. **Funções sem cadastro próprio**, que hoje caem no gestor ou em quem valida: digitação das
   IRAS no Tasy, notificação compulsória (SINAN), vigilância de colonização (swabs), notificação
   mensal à Anvisa, protocolo de sepse, reunião mensal. Se a revisão atribuir donos, vale criar
   as funções para o Painel medir.
3. **Perfis cadastrados sem medidor nem tela**: validação de isolamentos duvidosos
   (encaminhamento ao infectologista) e controle de procedimentos invasivos (dispositivos a
   revisar).
4. **Contato de 90 dias** das próteses: organizado em aba própria em 05/11/2026; a rotina de
   quem liga e quando ainda não estava escrita.
5. **Anvisa**: gramas dos antimicrobianos prioritários, álcool/sabonete por paciente-dia e UTI
   neonatal por peso ainda são apurados fora do app.
6. **Dupla assinatura**: o app avisa mas não impede a mesma pessoa de abrir e confirmar uma
   IRAS; a revisão pode decidir se vira bloqueio.

---

## 6. Ordem de prioridade proposta para a revisão (10/11/2026)

Critérios, nesta ordem: o que sustenta todo o resto (dados), obrigação legal, segurança do
paciente, o que já funciona e só precisa de dono e cadência, e por fim o que exige construir
tela nova.

| # | Bloco | Por que agora | Decisão da CCIH | O que o app ganha |
|---|---|---|---|---|
| 1 | **Entrada de dados** (os 11 relatórios diários + os 4 mensais) | Tudo abaixo depende disso; o 2365 parado em 10/10 já distorceu os cursos de ATB | Dono e horário fixos; confirmar que é diária | Relógio do Painel passa de semanal para o combinado; aviso quando um relatório essencial atrasa |
| 2 | **IRAS de ponta a ponta**: revisão de culturas → validação → digitação no Tasy → conciliação | É o indicador-mãe (taxa, Reunião, Anvisa); hoje a digitação não tem dono | Quem revisa, quem valida, quem digita e em quantos dias; bloquear ou só avisar a mesma pessoa nas duas assinaturas | Função "Digitação no Tasy" com fila e medidor; bloqueio da dupla assinatura se decidido |
| 3 | **Anvisa mensal + pós-alta de ISC** | Obrigação até o dia 15; a efetividade da pós-alta está baixa (quadril/joelho sem contato, 50 Anvisa dispensadas) e é ela que alimenta a notificação | Dono da notificação; quem faz o contato de 30 d e o de 90 d, em que dia da semana; o que fazer com o atraso de jun–ago | Função "Notificação Anvisa" com lembrete até o dia 15; medidor do contato de 90 d; script para encerrar o atraso sem contato, se decidido |
| 4 | **Isolamentos e colonização** | Segurança do paciente e transmissão cruzada; a colonização ganhou aba mas não tem dono | Dono dos swabs (o mesmo da identificação?); como o duvidoso chega ao infectologista | Função "Vigilância de colonização" com medidor (UTI sem swab, aquisição sem precaução); encaminhamento do duvidoso e fila da validação |
| 5 | **Antibióticos** (avaliação semanal, página remota, decisão de ATB) | Já funciona; só falta cadência oficial e o uso da página remota pelos prescritores | Dia da semana da avaliação; se a página remota vai mesmo aos médicos; dono da planilha de decisão de ATB | Nada a construir; ajustar "a cada N dias" |
| 6 | **Visita à UTI e dispositivos invasivos** | Rotina existe e é medida; o perfil "procedimentos invasivos" está vazio | Quem visita e quantas vezes por semana; o que o infectologista + enfermeiro revisam nos dispositivos | Tela de dispositivos a revisar com medidor (construção maior) |
| 7 | **Surtos e higiene das mãos** | Funcionam e são medidos; só confirmar cadência e dono | Prazo para avaliar uma suspeita; meta de observações/mês por setor | Nada a construir |
| 8 | **Notificáveis (SINAN)** | Complementar; o app só aponta | Dono; frequência de importação do NINDINET | Função "Notificação compulsória" com fila |
| 9 | **Sepse, Reunião, relatórios, dossiê para IA, backup** | Baixo risco; são rotinas do gestor | Donos e datas (reunião mensal, backup) | Nada a construir |

Regra prática: fechar os blocos 1 a 3 antes de mexer nos demais — são os que mudam número de
indicador e obrigação externa. Os blocos 4 a 9 podem ser revisados em paralelo pela equipe,
porque não dependem um do outro.
