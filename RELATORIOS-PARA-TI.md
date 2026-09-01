# Relatórios do Tasy para a CCIH — lista para a TI

A CCIH registra as infecções no seu próprio sistema; o que precisamos do Tasy são os
relatórios brutos abaixo, em planilha. A importação deduplica sozinha, então **períodos
sobrepostos não são problema** — pode sempre exportar "últimos 30 dias", por exemplo.

## Regras que valem para todos

1. **Formato: Excel (xlsx/xls) ou CSV — nunca PDF.** PDF nos custa reconstrução manual e perde dados.
2. **Toda linha precisa do nº de ATENDIMENTO** (e do prontuário, quando houver). É a chave que liga tudo.
3. **Nomes de colunas estáveis**: o sistema memoriza o layout de cada relatório; mudar cabeçalho quebra o reconhecimento automático.
4. **Uma linha por evento** (uma cultura, uma prescrição, uma internação) — sem células mescladas, sem totais no meio.

## Os relatórios

| # | Relatório | Frequência | Colunas essenciais | Observações |
|---|-----------|-----------|--------------------|-------------|
| 1 | **Culturas do laboratório** | Diário (dias úteis) | ID do exame, atendimento, nome, data coleta, data resultado, setor, material, resultado, microrganismo, antibiograma | Substituir os PDFs diários por planilha. A partir de set/2026 já vem com atendimento — confirmar que ficou de pé |
| 2 | **Pacientes em isolamento** (foto do momento) | Diário | atendimento, nome, setor, leito, data internação, data início isolamento, precaução, motivo | É a "foto de agora": cada importação encerra sozinha as precauções de quem saiu da lista |
| 3 | **Censo de internações** | Diário (mínimo 3×/semana) | prontuário, atendimento, nome, **data de nascimento**, **telefone**, data internação, data alta, desfecho, setor atual, leito, clínica | **Pedido novo: incluir as PASSAGENS DE SETOR** (data/hora de cada transferência). Sem isso não conseguimos calcular taxa de infecção por unidade |
| 4 | **Antibióticos prescritos** *(ainda não recebemos — é o que falta)* | Diário (dias úteis) | atendimento, antibiótico, dose, via, frequência, data início, data fim/suspensão, setor, indicação se houver, última evolução | Alimenta a avaliação diária de prescrições e o consumo de antimicrobianos |
| 5 | **Cirurgias realizadas** | Semanal | atendimento, data, procedimento, cirurgião, **potencial de contaminação**, ASA, duração, caráter, profilaxia (antibiótico + horário) | **Pedido novo: o potencial de contaminação vem em branco hoje.** Com ele, a vigilância pós-alta pré-seleciona as cirurgias limpas sozinha |
| 6 | **Dispositivos invasivos** (CVC, VM, SVD…) | Semanal | atendimento, nome, dispositivo, data instalação, data retirada | Confere as retiradas combinadas na visita da UTI e os dias de dispositivo |
| 7 | **Óbitos** | Mensal | atendimento, nome, data entrada, data óbito, idade, sexo, médico, setor | **Uma vez só: exportação retroativa desde 2021**, para fechar o desfecho do histórico |
| 8 | **Catálogo de antimicrobianos da farmácia** | Semestral (ou quando mudar a padronização) | código do material, descrição, subgrupo, classe | Já recebemos um — só manter atualizado |

## O que NÃO precisamos mais

- **Vigispec** — descontinuado. A higiene das mãos passa a ser registrada pelo aplicativo
  próprio da CCIH (miniapp no celular do observador).
- **Relatório de infecções/IRAS de outro sistema** — as infecções são classificadas e
  registradas dentro do sistema da CCIH, a partir das culturas e da vigilância.

## Como entregar (sugestão à TI)

O Tasy roda sobre Oracle. A forma mais simples e robusta de atender esta lista é **uma
consulta SQL agendada por relatório** (DBMS_SCHEDULER ou script no servidor), gravando o
CSV direto numa pasta de rede da CCIH — sem tela, sem relatório formatado, sem ninguém
clicando. `SELECT` com as colunas da lista, uma linha por registro, nome de arquivo com a
data. O sistema da CCIH importa a pasta inteira em lote.

Alternativa sem DBA: o agendamento de relatórios do próprio Tasy (geração + envio por
e-mail em horário programado) também funciona, desde que o layout não seja alterado depois.

## Prioridade, se for para escalonar

1. **Antibióticos prescritos** (item 4) — é a única fonte que ainda não existe.
2. **Passagens de setor no censo** (item 3) — destrava as taxas por unidade.
3. **Potencial de contaminação nas cirurgias** (item 5).
4. Migrar culturas de PDF para planilha diária (item 1).

*CCIH — atualizado em 01/09/2026.*
