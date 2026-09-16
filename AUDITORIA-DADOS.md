# Auditoria dos dados (HNSC) — consistência e apresentação

Feita em 16/09/2026 a pedido do usuário: varredura de TODOS os bancos, preenchimento
coluna a coluna, o que é consistente e útil, e onde cada dado aparece (ou deveria
aparecer) no aplicativo. Só números agregados — nenhum dado de paciente aqui.

## Dados consistentes e BEM apresentados

| Dado | Preenchimento | Onde aparece |
|---|---|---|
| Internações (61.163, 2023–2026) | 100% em TODAS as colunas | Panorama, denominadores, ficha |
| Culturas (38.724) + sensibilidade (7.712) | núcleo 100%; germe 22% (o resto é negativa — correto) | Culturas, perfil, ficha |
| Análises de ATB do Tasy (21.463) | curso 100%, suspensão 70%, análise CCIH ~2% (começou jul/26) | Relatório de antibióticos (DOT + bloco de análises) |
| Dias de dispositivo NISS (4.532, CTI ago/23–set/26) | 100% | Taxas /1.000 dias no rel. de IRAS e na Reunião |
| Sepse (599) | tempos parciais (ATB≤1h 99%, minutos 27–78%) | Relatório de sepse |
| Higiene de mãos (5.695 observações) | momento/ação 100% | Relatório de higiene |
| Evoluções (foto, 250) | 100% | Ficha + card da cultura |

## Dados consistentes e SUBapresentados → providências desta rodada

- **Óbitos e permanência** (Desfecho/DataAlta 100% nas internações): letalidade hospitalar
  mensal (~5–6%) e permanência média (~4–5 dias) não apareciam em lugar nenhum →
  **slide próprio na tela Reunião CCIH** (série de 12 meses).
- **Taxas por dispositivo**: o numerador usava `DispositivoAssociado`, preenchido em só
  2% das IRAS → taxa quase zero, enganosa. **Corrigido**: fallback pela topografia
  (PAV→VM, IPCS→cateter central, ITU→SVD). CTI no trimestre: PAV ~12/1.000 d-VM,
  IPCS ~6/1.000 d-CVC, ITU ~0,6/1.000 d-SVD.
- **Profilaxia cirúrgica** (agora 67% das cirurgias): não aparecia em tela nenhuma →
  entrou no evento de cirurgia da **ficha do paciente**. Falta: bloco de auditoria de
  profilaxia (droga × procedimento, prolongadas) no relatório — próxima rodada.
- **MDR por setor, DOT, isolamentos ativos**: existiam nos relatórios, mas espalhados →
  consolidados nos slides da Reunião.

## Dados FRACOS ou vazios (não usar em indicador sem melhorar)

| Dado | Situação | Caminho |
|---|---|---|
| `iras.casos`: CriterioDiagnostico 2%, DispositivoAssociado 2%, Desfecho 1%, NotificadoANVISA 0% | quase vazios | preencher na notificação (formulário já tem os campos) ou derivar (desfecho via internação) |
| `pacientes`: DataNascimento 0%, Telefone 11% | fonte não traz | relatório 2405 do Tasy (chave a decifrar) |
| `antibioticos.prescricoes`: Setor 13%, Via/Dose/Frequência ~0% | relatório do Tasy não traz | DOT por setor precisa da passagem de setor |
| `cirurgias`: PotencialContaminacao 0%, IndiceNNIS 0%, ISC 0% | não preenchidos | ISC virá da vigilância pós-alta; NNIS precisa de contaminação |
| `isolamentos.precaucoes` (72) | só o operacional atual | histórico de 8.230 no `isolamentos vs.xls` — leitor pendente |
| `higiene_maos.consumo_alcool`, `denominadores.censo_setor`, `passagem_setor`, `pacientes.obitos`, `surtos.documentos/pacientes_surto`, `decisoes_empiricas` | 0 linhas | fontes listadas em PENDENCIAS |
| `surtos.investigacoes`: FonteProvavel 0%, MedidasAdotadas 0%, Hipotese 6% | anotações não preenchidas | campo existe na tela — questão de uso |
| `uti.visitas/avaliacoes_atb`: Setor 0% | miniapp não grava o setor | corrigir no miniapp na próxima rodada de montagem |

## Consistências conferidas (sem defeito)

- Nenhum prontuário duplicado no cadastro; unificações aplicadas (47.804 pacientes).
- Internações: datas 100% válidas; 1 atendimento repetido (inofensivo).
- 1 prescrição com início em dez/2026 (erro de digitação na origem, registrado).
- `dispositivos.dispositivos`: DataRetirada 40% vazia = dispositivos em uso (correto).

## Funcionalidades-âncora verificadas (não regredir)

- Notificar infecção e abrir a ficha do paciente continuam acessíveis das telas de
  culturas, painel, vigilância e surtos (nenhuma mudança nesses caminhos).
- Vigilância pós-alta, análise de antibióticos e revisão de culturas: fluxos intactos;
  botões em tabelas ganharam CSS compacto (defeito visual da pós-alta).
