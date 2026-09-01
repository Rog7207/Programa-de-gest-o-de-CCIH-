# Relatórios do sistema hospitalar para a CCIH — lista para a TI

O Aplicativo CCIH funciona com **exportações periódicas** do sistema de prontuário
eletrônico do hospital (Tasy, MV, Soul MV, AGHU ou qualquer outro) — nenhuma integração é
necessária. Esta lista descreve o que pedir à TI: os relatórios, as colunas mínimas e a
frequência recomendada. A importação deduplica sozinha, então **períodos sobrepostos não
são problema** — pode sempre exportar "últimos 30 dias", por exemplo.

## Regras que valem para todos

1. **Formato: Excel (xlsx/xls) ou CSV — evite PDF.** PDF exige reconstrução e perde dados.
2. **Toda linha precisa do nº de ATENDIMENTO/internação** (e do prontuário, quando houver).
   É a chave que liga os relatórios entre si.
3. **Nomes de colunas estáveis**: o aplicativo memoriza o layout de cada relatório; mudar o
   cabeçalho quebra o reconhecimento automático.
4. **Uma linha por evento** (uma cultura, uma prescrição, uma internação) — sem células
   mescladas, sem totais no meio.

## Os relatórios

| # | Relatório | Frequência | Colunas essenciais |
|---|-----------|-----------|--------------------|
| 1 | **Culturas do laboratório** | Diário (dias úteis) | ID do exame, atendimento, nome, data coleta, data resultado, setor, material, resultado, microrganismo, antibiograma |
| 2 | **Pacientes em isolamento** (foto do momento) | Diário | atendimento, nome, setor, leito, data internação, data início do isolamento, precaução, motivo |
| 3 | **Censo de internações** | Diário (mínimo 3×/semana) | prontuário, atendimento, nome, data de nascimento, telefone, data internação, data alta, desfecho, setor atual, leito, clínica — e, se possível, as **passagens de setor** (sem elas não há taxa de infecção por unidade) |
| 4 | **Antibióticos prescritos** | Diário (dias úteis) | atendimento, antibiótico, dose, via, frequência, data início, data fim/suspensão, setor, indicação |
| 5 | **Cirurgias realizadas** | Semanal | atendimento, data, procedimento, cirurgião, **potencial de contaminação**, ASA, duração, caráter, profilaxia (antibiótico + horário) |
| 6 | **Dispositivos invasivos** (CVC, VM, SVD…) | Semanal | atendimento, nome, dispositivo, data instalação, data retirada |
| 7 | **Óbitos** | Mensal | atendimento, nome, data entrada, data óbito, idade, sexo, médico, setor — vale pedir uma exportação retroativa única para fechar o histórico |
| 8 | **Catálogo de antimicrobianos da farmácia** | Semestral | código do material, descrição, subgrupo, classe |

Confira com a TI se os campos destacados **vêm preenchidos** — é comum o relatório ter a
coluna e ela vir vazia (potencial de contaminação e profilaxia são os casos clássicos).

## Como entregar (sugestão à TI)

A maioria dos sistemas hospitalares roda sobre um banco relacional (Oracle, SQL Server,
PostgreSQL). A forma mais simples e robusta de atender esta lista é **uma consulta SQL
agendada por relatório**, gravando o CSV direto numa pasta de rede da CCIH — sem tela, sem
relatório formatado, sem ninguém clicando. `SELECT` com as colunas da lista, uma linha por
registro, nome de arquivo com a data. O aplicativo importa a pasta inteira em lote.

Alternativa sem acesso ao banco: o agendamento de relatórios do próprio sistema (geração e
envio por e-mail em horário programado) também atende, desde que o layout não mude depois.

## Prioridade, se for preciso escalonar

1. **Antibióticos prescritos** — costuma ser a fonte que falta.
2. **Passagens de setor no censo** — destrava as taxas de infecção por unidade.
3. **Potencial de contaminação nas cirurgias** — pré-seleciona a vigilância pós-alta.
4. **Culturas em planilha diária** no lugar de PDFs.
