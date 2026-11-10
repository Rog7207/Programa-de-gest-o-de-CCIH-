# CCIH do HNSC — Manual de procedimentos operacionais

Este manual reúne os procedimentos operacionais padrão (POP) da CCIH que passam pelo
Aplicativo CCIH: **quem faz, o que faz, quando e como confere**. Ele complementa o
`MANUAL-DO-USUARIO.md`, que explica as telas; aqui o foco é a rotina. Cada POP tem um número
estável; quando a CCIH mudar uma regra, muda-se o POP e anota-se a data na linha "Revisão".

Numeração prevista (os POP ainda não escritos entram conforme a revisão de procedimentos
avançar, na ordem de prioridade de `docs/procedimentos-ccih.md`):

| POP | Procedimento | Situação |
|---|---|---|
| 01 | Carregamento diário dos relatórios | escrito em 10/11/2026 |
| 02 | Carregamento semanal e mensal dos relatórios | escrito em 10/11/2026 |
| 03 | Revisão de culturas (detecção de IRAS) | a escrever |
| 04 | Validação e digitação das IRAS | a escrever |
| 05 | Vigilância pós-alta e notificação à Anvisa | a escrever |
| 06 | Isolamentos e vigilância de colonização | a escrever |
| 07 | Controle de antibióticos | a escrever |
| 08 | Visita à UTI e dispositivos invasivos | a escrever |
| 09 | Surtos e higiene das mãos | a escrever |
| 10 | Doenças de notificação compulsória | a escrever |

---

## POP-01 — Carregamento diário dos relatórios

**Revisão:** 10/11/2026 (primeira versão).
**Responsável:** técnica Mayara — função "Entrada dos relatórios do Tasy" em Configurações →
Equipe e funções, com periodicidade **1 dia**. **Substituto:** a definir pela CCIH; qualquer
pessoa cadastrada pode executar o POP, assinando com o próprio nome.
**Quando:** todo dia útil, **no início do expediente**, antes de a equipe começar a revisão de
culturas e a validação de IRAS (que usam os dados do dia). Segunda-feira cobre também o fim de
semana (os relatórios do Tasy são puxados pelo período de sábado a segunda).
**Duração estimada:** 20 a 30 minutos.

### Objetivo

Colocar no banco do aplicativo, uma vez por dia e na ordem certa, tudo que o Tasy e o
laboratório produziram, de modo que paciente, setor, culturas, antibióticos e isolamentos
estejam ligados entre si e as filas da equipe reflitam o hospital de hoje.

### Pré-requisitos

- Acesso ao Tasy com os relatórios abaixo liberados (números entre parênteses).
- Aplicativo aberto na pasta de dados da CCIH, com o **nome do usuário** escolhido na tela de
  entrada (é ele que assina cada carga).
- Os arquivos do dia salvos numa pasta de trabalho local (ex.: `Cargas/AAAA-MM-DD/`). Depois
  da importação o aplicativo guarda uma cópia em `importados/AAAA-MM/`; a pasta de trabalho
  pode ser apagada.

### Regra de ouro

**O censo entra sempre primeiro.** Vários relatórios só trazem o número do atendimento; é o
censo (50023) e a movimentação (2536) que dizem de que paciente, prontuário e setor se trata.
Relatório importado antes do censo fica "sem paciente" (o aplicativo avisa quantos ficaram de
fora na aba Antibióticos). Se isso acontecer, basta reimportar depois do censo: a reimportação
nunca duplica.

### Passo a passo

Abra a aba **Importar**. O cartão **Conferência das cargas** mostra, na ordem abaixo, a data da
última carga de cada relatório e a situação (✓ feita · ○ falta hoje · ⚠ atrasada). Arraste
cada arquivo para a zona de importação; relatórios com perfil salvo entram sozinhos, os demais
abrem o assistente de 5 passos (mapear as colunas uma vez e salvar o perfil).

| # | Relatório (Tasy) | Período a pedir | Como entra | Para que serve |
|---|---|---|---|---|
| 1 | **Internações — censo (50023)** | internados hoje (todos) | tipo "Internações (censo)" | cria a identidade atendimento ↔ prontuário ↔ nome ↔ setor |
| 2 | **Movimentação de pacientes (2536)** | ontem até hoje; na segunda, sábado a segunda | reconhecido sozinho | passagem por setor com entrada e saída; completa nomes |
| 3 | **Internados hoje, com leito (2396)** | hoje | reconhecido sozinho (a data sai do nome do arquivo) | setor e leito atuais; prepara a visita à UTI e a lista do miniapp de decisão de ATB |
| 4 | **Culturas do laboratório** | laudos liberados desde a última carga | PDF ou planilha; perfil salvo | fila de revisão, isolamentos, surtos, colonização |
| 5 | **Evoluções (2394)** | hoje | reconhecido sozinho | sinais de infecção, visita à UTI, histórico do dossiê (precisa ser todo dia: o Tasy só exporta o recorte do dia) |
| 6 | **Sinais vitais (2411)** | últimos 2 dias | reconhecido sozinho | vitais alterados na preparação da visita |
| 7 | **Pacientes em isolamento (1042)** | hoje (foto) | tipo "Pacientes em isolamento" | encerra sozinho quem saiu; pendências de MDR |
| 8 | **Bundles CVC/SVD (1116) e PAV (2166)** | hoje | tipo "Dispositivos invasivos" | dispositivo-dia, utilização, PAV/IPCS/ITU associadas |
| 9 | **Análise de antibióticos (2362)** | hoje | tipo "Análise de antibióticos" | abre os cursos com o fim **previsto** |
| 10 | **Prescrições diárias de antimicrobianos (2365)** | hoje | tipo "Antibióticos prescritos", perfil "Antibióticos (1)"; mapear também **"Nr dia util" → "Dia de terapia (Tasy)"** | diz quando um esquema **parou**; sem ele os cursos emendam e a aba Antibióticos avisa "diário parado" |

Depois do passo 10, volte à aba Importar e confira que **as dez linhas da carga diária estão
✓ feita**. Se algum relatório não pôde ser puxado (Tasy fora do ar, relatório vazio), deixe
como está e avise a equipe: a linha fica "○ falta hoje" e, no dia seguinte, "⚠ atrasada".

### Conferências rápidas (2 minutos)

1. **Painel → Rotina da equipe**: "Referência: dados de" deve mostrar a data de hoje.
2. **Aba Antibióticos**: não deve haver o aviso de relatório diário de prescrições parado.
3. **Aba UTI → Leito a leito**: os leitos 1–30 devem estar preenchidos com a foto de hoje.
4. **Aba Importar → Conferência**: nenhuma linha diária em "atrasada".

### O que fazer quando dá errado

| Situação | O que fazer |
|---|---|
| "sem perfil — importe manualmente uma vez" | abra o arquivo pelo assistente, mapeie as colunas, salve o perfil com o nome do relatório; da próxima vez entra sozinho |
| arquivo em edição por outra pessoa (trava) | aguarde um minuto e confirme de novo; se persistir, peça à pessoa que feche a tela que está gravando |
| relatório importado antes do censo | importe o censo e **reimporte** o relatório; nada duplica |
| número de linhas muito diferente do habitual (ex.: 2365 com 20 linhas) | o período do relatório provavelmente saiu errado; puxe de novo antes de importar |
| o aplicativo não reconheceu o 2396/2536/2394/2411 | o Tasy mudou o cabeçalho; **não** use "ler como planilha comum" — avise o gestor para ajustar o leitor |
| perfil com duas colunas de mesmo nome (ex.: dois "Telefone") | o aplicativo usa a coluna preenchida; se os telefones vierem em branco, avise o gestor |

### Registro

Cada carga fica registrada em `cargas.xlsx` (data, hora, relatório, arquivo, linhas, quem) e o
arquivo original em `importados/AAAA-MM/`. Não é preciso anotar em outro lugar.

---

## POP-02 — Carregamento semanal e mensal dos relatórios

**Revisão:** 10/11/2026 (primeira versão).
**Responsável:** técnica Mayara (mesma função do POP-01). **Substituto:** a definir.
**Quando:** **toda segunda-feira**, logo depois da carga diária (POP-01). Na **primeira
segunda-feira do mês**, acrescenta-se a carga mensal. Feriado na segunda: no primeiro dia útil
seguinte.
**Duração estimada:** 15 minutos (semanal) + 10 minutos (mensal).

### Objetivo

Trazer os relatórios que não mudam de um dia para o outro mas alimentam a vigilância pós-alta,
os desfechos e os denominadores, de modo que a triagem da pós-alta e os relatórios da Anvisa
tenham a semana e o mês completos.

### Passo a passo — semanal (toda segunda-feira)

| # | Relatório (Tasy) | Período a pedir | Como entra | Para que serve |
|---|---|---|---|---|
| 1 | **Cirurgias realizadas + telefones (2550)** | segunda anterior até domingo | tipo "Cirurgias realizadas" | triagem da pós-alta (as cirurgias aparecem para triagem 30 dias depois); a reimportação completa telefone, caráter e cirurgião que faltavam |
| 2 | **Profilaxia cirúrgica (1714)** | mesma semana | tipo "Cirurgias realizadas" com as colunas de profilaxia mapeadas | adequação da profilaxia (antibiótico, início, intervalo) |
| 3 | **Óbitos (836)** | mesma semana | tipo "Óbitos" | fecha as internações como óbito; mortalidade na Reunião |
| 4 | **IRAS do IMAS (2485)** | mês corrente até hoje | reconhecido sozinho ("Ficha de ocorrência por classificação") | concilia o que a CCIH já digitou no Tasy: casos confirmados aqui que constam lá saem da fila de digitação |

Ordem obrigatória: **2550 antes do 1714** (a profilaxia completa cirurgias que já existem).
O 2485 depende de censo e casos já carregados, por isso vem por último.

Se a planilha do Google estiver configurada (Configurações → ☁ Planilha do Google), aproveite
para clicar **Sincronizar agora**: traz as observações de higiene das mãos e as decisões de
ATB registradas nos celulares durante a semana.

### Passo a passo — mensal (primeira segunda-feira do mês)

| # | Relatório (Tasy) | Período a pedir | Como entra | Para que serve |
|---|---|---|---|---|
| 5 | **Invasividade — censo NISS (3066)** | **mês anterior inteiro**; **um relatório para a CTI e outro para a UTI neonatal** | reconhecido sozinho | pacientes-dia e dispositivo-dia da UTI: densidades da Reunião, do Relatório ANVISA e dos benchmarks |

O 3066 é independente (denominador por setor, não liga a paciente) e pode entrar a qualquer
hora; a primeira segunda-feira é só para o mês anterior estar completo antes da Reunião e da
notificação à Anvisa (dia 15).

### Conferências

1. **Aba Importar → Conferência das cargas**: as quatro linhas semanais em ✓ feita; na
   primeira segunda do mês, também a linha mensal.
2. **Aba Pós-alta → Triagem**: as cirurgias da semana de 30 dias atrás devem estar listadas
   com telefone; cirurgia sem telefone indica relatório puxado sem a coluna.
3. **Aba Infecções → A digitar no Tasy**: depois do 2485 a fila deve ter diminuído se houve
   digitação na semana.

### O que fazer quando dá errado

| Situação | O que fazer |
|---|---|
| 2550 sem a coluna de telefone | puxe o relatório com a coluna; reimporte — a linha existente ganha o telefone |
| 1714 com cirurgias que não estão no banco | o 2550 da mesma semana não entrou; importe-o e reimporte o 1714 |
| 3066 reconhecido só para um setor | o relatório do Tasy sai por setor; puxe o segundo (UTI neonatal) e importe também |
| 2485 avisa "duas linhas para o mesmo episódio" | é duplicidade no Tasy; a segunda não entra — corrigir lá, não aqui |

### Registro

O mesmo do POP-01: `cargas.xlsx` e `importados/AAAA-MM/`.
