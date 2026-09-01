# Aplicativo CCIH — Estrutura do Sistema

> Aplicativo local de vigilância de IRAS (Infecções Relacionadas à Assistência à Saúde).
> 100% HTML/JavaScript rodando no navegador, sem servidor. Banco de dados em arquivos Excel.

---

## 1. Visão geral da arquitetura

```
┌─────────────────────┐     ┌──────────────────────┐
│ Sistemas do hospital │     │ Miniapps (celular)   │
│ (relatórios .xlsx/   │     │ visita UTI, higiene  │
│  .csv exportados)    │     │ mãos, bundles, etc.  │
└─────────┬───────────┘     └──────────┬───────────┘
          │                            │ planilha via
          │ exportação manual          │ e-mail institucional
          ▼                            ▼
┌─────────────────────────────────────────────────┐
│           ASSISTENTE DE IMPORTAÇÃO              │
│  mapeamento de colunas · validação · dedupe     │
└─────────────────────┬───────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────┐
│         BANCO EXCEL  (pasta /dados)             │
│  pacientes · culturas · antibióticos · UTI ...  │
└─────────────────────┬───────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────┐
│        MOTOR DE CRUZAMENTOS E ALERTAS           │
│  indicadores · triggers · surtos · stewardship  │
└─────────────────────┬───────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────┐
│    ABAS DO APLICATIVO + RELATÓRIOS (PDF/ANVISA) │
└─────────────────────────────────────────────────┘
```

### Tecnologias
| Componente | Tecnologia | Observação |
|---|---|---|
| Interface | HTML + CSS + JavaScript puro (ou framework leve) | roda com duplo clique no `index.html` |
| Leitura/gravação de planilhas | **SheetJS** embutido | lê xlsx, xls antigo (BIFF), csv e dbf com uma biblioteca só; offline |
| Leitura de PDF | **pdf.js** embutido | extrai texto com coordenadas; OCR opcional via Tesseract.js para PDF escaneado |
| Acesso à pasta de dados | **File System Access API** | Chrome/Edge; o usuário escolhe a pasta uma vez; pasta de rede funciona como pasta normal |
| Cache de trabalho | **IndexedDB** | autosave contínuo; grava no Excel ao clicar "Salvar" |
| Relatórios PDF | impressão do navegador (CSS print) ou jsPDF | |
| Miniapps | 1 arquivo HTML autônomo cada | roda offline no celular, exporta .xlsx |

---

## 2. Estrutura de arquivos no disco

```
/Aplicativo CCIH online
├── index.html                  ← aplicativo principal
├── css/
├── js/
│   ├── importacao.js           ← assistente de importação
│   ├── indicadores.js          ← cálculo de taxas e densidades
│   ├── alertas.js              ← motor de cruzamentos
│   ├── excel.js                ← camada de leitura/gravação (SheetJS)
│   └── (um módulo por aba)
├── lib/                        ← SheetJS e demais bibliotecas locais
├── miniapps/
│   ├── visita-uti.html
│   ├── higiene-maos.html
│   ├── bundle-dispositivos.html
│   └── busca-pos-alta.html
└── dados/                      ← pasta escolhida pelo usuário (o "banco")
    ├── pacientes.xlsx
    ├── culturas.xlsx
    ├── antibioticos.xlsx
    ├── evolucoes_2026.xlsx     ← arquivos volumosos são particionados por ano
    ├── uti.xlsx
    ├── higiene_maos.xlsx
    ├── iras.xlsx
    ├── isolamentos.xlsx
    ├── cirurgias.xlsx
    ├── denominadores.xlsx
    ├── config.xlsx
    ├── importados/             ← arquivos brutos arquivados após importar
    └── backups/                ← ZIP datado gerado pelo app
```

A pasta `dados/` fica numa **pasta de rede do hospital**: cada membro da equipe abre o app no seu próprio computador apontando para lá (decisão de agosto/2026 — uso multiusuário é rotineiro, mas quase sempre uma pessoa gravando por vez).

**Por que vários arquivos e não um único?** Arquivos menores gravam mais rápido, um arquivo corrompido não derruba o banco inteiro, e as planilhas dos miniapps se fundem cada uma no seu arquivo de destino. Com várias pessoas, a divisão paga em dobro: as travas de edição são por arquivo, então uma pessoa na visita da UTI e outra nas culturas trabalham em paralelo sem conflito. Todo arquivo permanece legível/editável no Excel comum — princípio do projeto: *o banco nunca prende o usuário*.

---

## 3. Modelo de dados (esquema das planilhas)

Convenções: `Prontuario` é a chave que liga tudo; datas em `AAAA-MM-DD`; cada aba tem coluna `ID` própria (ex.: `CUL-000123`); colunas geradas pelo app são marcadas com ⚙.

### 3.1 `pacientes.xlsx`
**Aba `pacientes`** — dados fixos da pessoa
| Coluna | Tipo | Descrição |
|---|---|---|
| Prontuario | texto (chave) | número do prontuário |
| Nome | texto | |
| DataNascimento | data | |
| Sexo | M/F | |
| Telefone | texto | para a vigilância pós-alta; alimentado pelo relatório de cirurgias |

**Aba `internacoes`** — uma linha por internação (permite reinternações)
| Coluna | Tipo | Descrição |
|---|---|---|
| ID_Internacao | texto (chave) | ⚙ `INT-...` |
| Prontuario | texto | ref. pacientes |
| DataInternacao / DataAlta | data | alta vazia = internado |
| SetorAtual / Leito | texto | |
| Desfecho | lista | alta, óbito, transferência |

### 3.2 `culturas.xlsx`
**Aba `culturas`**
| Coluna | Tipo | Descrição |
|---|---|---|
| ID_Cultura | texto (chave) | ⚙ |
| Prontuario | texto | |
| DataColeta / DataResultado | data | |
| Setor | texto | setor no momento da coleta |
| Material | lista | sangue, urina, secreção traqueal, swab de vigilância, etc. |
| Resultado | lista | positiva, negativa, contaminação |
| Microrganismo | lista | vocabulário do `config.xlsx` |
| MecanismoResistencia | lista | MRSA, ESBL, KPC/carbapenemase, VRE, etc. |
| StatusRevisao ⚙ | lista | pendente, avaliada |
| AvaliacaoCCIH | texto | conclusão do revisor (colonização, infecção comunitária, IRAS → gera caso na aba IRAS) |

**Aba `sensibilidade`** — formato longo (1 linha por antibiótico testado)
| Coluna | Tipo |
|---|---|
| ID_Cultura | ref |
| Antibiotico | lista |
| Resultado | S / I / R |

> O formato longo permite calcular o **antibiograma acumulado** com um filtro simples. O assistente de importação converte o formato "largo" (uma coluna por antibiótico) dos relatórios do laboratório para este formato.

### 3.3 `antibioticos.xlsx` — aba `prescricoes`
| Coluna | Tipo | Descrição |
|---|---|---|
| ID_Prescricao | texto (chave) | ⚙ |
| Prontuario | texto | |
| Antibiotico | lista | vocabulário padronizado com DDD no config |
| Dose / Via / Frequencia | texto | |
| DataInicio / DataFim | data | fim vazio = em uso |
| Setor | texto | |
| Indicacao | texto | se disponível no relatório |
| Restrito | S/N | ⚙ conforme lista do config |
| ParecerInfecto | texto | auditoria/parecer, se houver |

### 3.4 `evolucoes_AAAA.xlsx` — aba `evolucoes` (particionado por ano)
| Coluna | Tipo | Descrição |
|---|---|---|
| ID_Evolucao | chave ⚙ | |
| Prontuario | texto | |
| DataEvolucao | data | |
| CategoriaProfissional | lista | médico, enfermeiro, fisio... |
| TextoEvolucao | texto | conteúdo importado |
| TriggersDetectados ⚙ | lista | palavras-gatilho encontradas (febre, secreção purulenta, novo ATB, piora respiratória...) |
| StatusRevisao ⚙ | lista | pendente, revisada, descartada, virou caso |

> A lista de palavras-gatilho fica no `config.xlsx`, editável pelo usuário sem mexer em código.

### 3.5 `uti.xlsx`
**Aba `visitas`** — visita padronizada da CCIH (1 linha por leito por dia)
| Coluna | Tipo | Descrição |
|---|---|---|
| ID_Visita | chave ⚙ | |
| Data / Setor / Leito | | |
| Prontuario | texto | |
| CVC | S/N | + `CVC_DataInsercao`, `CVC_Sitio` |
| VM | S/N | + `VM_DataInicio` (ventilação mecânica) |
| SVD | S/N | + `SVD_DataInsercao` (sonda vesical) |
| AntibioticosEmUso | texto | conferência cruzada com prescrições |
| SuspeitaIRAS | S/N | impressão da visita |
| Observacoes / Pendencias | texto | |

> **Os dispositivos-dia da UTI saem daqui automaticamente**: cada linha com CVC=S soma 1 CVC-dia, e assim por diante.

### 3.6 `higiene_maos.xlsx`
**Aba `observacoes`** — auditoria pelos 5 momentos da OMS (1 linha por oportunidade)
| Coluna | Tipo |
|---|---|
| Data / Setor / Observador | |
| CategoriaProfissional | lista |
| Momento | 1–5 (OMS) |
| Acao | álcool / água e sabão / não higienizou |

**Aba `consumo_alcool`** — indicador indireto
| Coluna | Tipo |
|---|---|
| Mes / Setor | |
| Volume_ml | número |

### 3.7 `iras.xlsx` — aba `casos` (o coração da vigilância)
| Coluna | Tipo | Descrição |
|---|---|---|
| ID_IRAS | chave ⚙ | |
| Prontuario / ID_Internacao | ref | |
| Topografia | lista | IPCSL, PAV, ITU-AC, ISC, pele/partes moles, etc. |
| CriterioDiagnostico | lista | critério ANVISA/CDC utilizado |
| DataInfeccao / Setor | | |
| DispositivoAssociado | lista | CVC, VM, SVD, nenhum |
| Culturas | refs | IDs das culturas relacionadas |
| Microrganismos | lista | |
| Desfecho | lista | cura, óbito relacionado, óbito não relacionado |
| NotificadoANVISA | S/N + mês | controle da notificação |
| StatusInvestigacao | lista | em investigação, confirmado, descartado |

### 3.8 `isolamentos.xlsx` — aba `precaucoes`
| Coluna | Tipo |
|---|---|
| Prontuario / Setor / Leito | |
| TipoPrecaucao | contato / gotícula / aerossol |
| Motivo | microrganismo ou síndrome |
| DataInicio / DataFim | |
| CriterioSuspensao | texto (ex.: 2 swabs negativos) |

### 3.9 `cirurgias.xlsx` — aba `cirurgias` (vigilância de sítio cirúrgico)
| Coluna | Tipo |
|---|---|
| ID_Cirurgia ⚙ / Prontuario | |
| Procedimento / Data / Cirurgiao | |
| PotencialContaminacao | limpa / potencialmente contaminada / contaminada / infectada |
| ASA | 1–5 |
| DuracaoMin | número |
| IndiceNNIS ⚙ | 0–3 calculado |
| Obito | S/N — óbito na internação; se S, a vigilância pós-alta não se aplica |
| VigilanciaPosAlta | datas de contato + resultado |
| ISC | S/N + tipo (superficial / profunda / órgão-espaço) → gera caso em `iras.xlsx` |

### 3.10 `denominadores.xlsx` — aba `censo_mensal`
| Coluna | Tipo | Descrição |
|---|---|---|
| Mes / Setor | | |
| PacientesDia | número | do censo hospitalar (importado ou manual) |
| CVCdia / VMdia / SVDdia | número | ⚙ da UTI vêm das visitas; demais setores, manual |
| Saidas | número | altas + óbitos (para taxa por 100 saídas) |

### 3.11 `config.xlsx` — tudo que é ajustável sem tocar no código
Abas: `setores` · `antibioticos` (nome, classe, DDD, restrito S/N) · `microrganismos` · `materiais` · `triggers_evolucao` · `criterios_iras` · `metas_indicadores` · `perfis_importacao` (assinatura do layout + mapeamento de colunas + templates de extração PDF) · `aliases` (sinônimo → termo canônico, alimentada pelo importador) · `usuarios` (nome + PIN simples, para registrar quem fez o quê).

---

## 4. Abas do aplicativo (navegação)

| # | Aba | Conteúdo principal |
|---|---|---|
| 1 | **Painel** | indicadores do mês, alertas ativos, pendências (culturas não revisadas, triggers não avaliados, casos em investigação) |
| 2 | **Pacientes** | busca por nome/prontuário → **linha do tempo** da internação: culturas + antibióticos + dispositivos + evoluções + cirurgias numa régua temporal única |
| 3 | **Culturas** | fila de revisão (pendentes primeiro), filtros, botão "classificar como IRAS" |
| 4 | **Antibióticos** | prescrições ativas, DOT/1.000 pac-dia, alertas de duração e de descalonamento, restritos sem parecer |
| 5 | **Evoluções** | fila de triggers detectados para revisão |
| 6 | **UTI** | grade de leitos do dia, entrada rápida da visita, resumo de dispositivos-dia do mês |
| 7 | **Higiene de mãos** | % adesão por setor/categoria/momento, consumo de álcool |
| 8 | **Casos IRAS** | investigação, classificação por critério, lista para notificação ANVISA |
| 9 | **Isolamentos** | mapa de leitos com precauções ativas e pendências de suspensão |
| 10 | **Cirurgias** | vigilância de ISC, busca pós-alta pendente |
| 11 | **Relatórios** | relatório mensal automático (PDF), exportação formato ANVISA, antibiograma acumulado |
| 12 | **Importar** | assistente de importação (relatórios do hospital + planilhas dos miniapps) |
| 13 | **Configurações** | edição do config, backup/restauração, perfis de importação |

---

## 5. Assistente de importação (funcionalidade de primeira classe)

Atende **apenas relatórios externos** (sistemas do hospital e do laboratório). As planilhas dos miniapps não passam por aqui: nascem no layout nativo do app e entram por **ingestão direta** (validar + fundir, sem assistente).

### Formatos aceitos
| Formato | Leitura | Observações |
|---|---|---|
| .xlsx / .xls | SheetJS | inclusive Excel antigo (BIFF) |
| .csv / .txt | SheetJS | detecção de separador e de codificação (UTF-8 × Windows-1252, pelos acentos) |
| .dbf (dBASE) | SheetJS | comum em sistemas legados; atenção à codificação (CP850/CP1252) |
| .pdf digital | pdf.js | texto com coordenadas; tabela reconstruída por template de extração |
| .pdf escaneado | Tesseract.js (OCR) | última opção; revisão humana obrigatória |

**Política de formatos**: sempre que o sistema oferecer exportação em planilha/CSV/DBF, preferir ao PDF. PDF digital funciona bem com template; PDF escaneado é o último recurso.

**Tipos de relatório suportados**: culturas (laboratório, com antibiograma largo→longo) · antibióticos prescritos · **cirurgias realizadas** (procedimentos normalizados para as categorias NHSN traduzidas via sinônimos, telefone do paciente levado ao cadastro para a vigilância pós-alta, ASA/contaminação/duração normalizados e índice NNIS calculado quando os dados permitem — pontos de corte de duração editáveis na aba `procedimentos_nhsn` do config) · **casos de IRAS** exportados de outros sistemas (migração, com topografias normalizadas por vocabulário).

### Pipeline em 5 camadas

1. **Leitura** — qualquer formato vira uma tabela bruta (linhas × colunas). Para PDF: pdf.js entrega cada palavra com coordenada x/y; linhas agrupadas pelo y, colunas pelas faixas de x definidas no template do relatório. Relatórios de texto corrido (evoluções em PDF) são fatiados em blocos por âncoras (regex do cabeçalho de cada evolução: data + hora + profissional). O cabeçalho da tabela pode não estar na linha 1 (logotipos, títulos) — o app o localiza pela assinatura.
2. **Reconhecimento** — o app calcula a *impressão digital* do relatório (assinatura do cabeçalho ou do layout PDF). Se existe um **perfil de importação** com essa assinatura, tudo é automático e cai direto na validação. Se não, abre o assistente: sugestão de mapeamento coluna→campo por similaridade de nomes e farejamento de tipos de dados; o usuário confirma e o perfil fica salvo. Se o hospital atualizar o sistema e o layout mudar, a assinatura não bate e o assistente reabre — **nunca importa errado em silêncio**.
3. **Normalização** — datas em qualquer formato, prontuário como texto, antibiograma largo→longo, e a **tabela de sinônimos**: "KLEB PNEUMONIAE", "K. pneumoniae" e "Klebsiella pneumoniae" viram o mesmo termo canônico. Valor desconhecido → o usuário mapeia uma vez, fica salvo no config, o app nunca mais pergunta. É isso que torna o antibiograma acumulado confiável.
4. **Validação e deduplicação** — erros bloqueantes (prontuário vazio, data impossível) × avisos (valor fora do vocabulário), com grade de correção na tela. Dedupe por chave natural (ex.: cultura = prontuário + data da coleta + material). Pacientes novos são criados automaticamente em `pacientes.xlsx`.
5. **Prévia e gravação** — resumo antes de confirmar: *N novas, N atualizadas, N duplicadas ignoradas, N com erro*. Gravação atômica, arquivo bruto arquivado em `/dados/importados/AAAA-MM/`, e o **motor de alertas roda automaticamente**.

---

## 6. Motor de cruzamentos e alertas

Roda após cada importação e ao abrir o app. Regras iniciais:

| Alerta | Cruzamento |
|---|---|
| Germe resistente ao ATB em uso | cultura (R) × prescrição ativa do mesmo paciente |
| Descalonamento possível | cultura sensível a espectro menor × ATB de amplo espectro em uso |
| ATB prolongado | prescrição ativa > X dias (X por classe, no config) |
| Restrito sem parecer | prescrição de ATB restrito sem `ParecerInfecto` |
| MDR reinternado | nova internação de prontuário com histórico de multirresistente → sugerir precaução de contato |
| Suspeita de surto | ≥ N isolados do mesmo germe/perfil no mesmo setor em Y dias (limiar no config) |
| Trigger em evolução | palavras-gatilho → fila de revisão |
| Cultura positiva sem avaliação | positiva há > 48 h com `StatusRevisao = pendente` |
| Dispositivo de longa permanência | CVC/SVD com inserção > X dias nas visitas da UTI |

---

## 7. Indicadores calculados (aba Painel / Relatórios)

- **Densidade de incidência**: IPCSL / 1.000 CVC-dia · PAV / 1.000 VM-dia · ITU-AC / 1.000 SVD-dia (numerador: `iras.xlsx`; denominador: visitas UTI + censo).
- **Taxa de utilização de dispositivos**: dispositivo-dia ÷ paciente-dia.
- **Taxa de ISC** por procedimento e por índice NNIS.
- **Adesão à higiene de mãos** por setor, categoria e momento; consumo de álcool ml/paciente-dia.
- **DOT/1.000 pacientes-dia** por antibiótico/classe/setor.
- **Antibiograma acumulado** (% sensibilidade germe × ATB, por setor e período; só 1º isolado por paciente/período, conforme boas práticas).
- **% IRAS por topografia**, letalidade associada, distribuição por microrganismo.
- Tudo com **série histórica mensal** e comparação com metas do config.

---

## 8. Miniapps (celular)

Cada miniapp é **um único arquivo HTML** enviado ao celular (WhatsApp/e-mail/QR code), aberto no navegador, funcionando offline:

| Miniapp | Coleta | Arquivo gerado |
|---|---|---|
| `visita-uti.html` | grade de leitos, dispositivos, ATB, suspeitas | `UTI_AAAA-MM-DD.xlsx` |
| `higiene-maos.html` | contador rápido de oportunidades (5 momentos) | `HM_SETOR_AAAA-MM-DD.xlsx` |
| `bundle-dispositivos.html` | checklists de inserção/manutenção CVC, PAV, SVD | `BUNDLE_SETOR_AAAA-MM-DD.xlsx` |
| `busca-pos-alta.html` | contato telefônico pós-cirurgia | `POSALTA_AAAA-MM-DD.xlsx` |

Regras dos miniapps:
- Salvam cada registro em `localStorage` (não perde dado se fechar).
- Botão **Exportar** gera o .xlsx (SheetJS embutido) já no layout nativo do app — entra por **ingestão direta**, sem passar pelo assistente de importação.
- **LGPD**: gravam apenas o número do prontuário — nunca o nome do paciente. O nome só existe no app principal, no computador da CCIH.

---

## 9. Multiusuário e integridade dos dados

Cenário de uso definido: equipe da CCIH acessando pela **pasta de rede**, com gravação simultânea sendo exceção. O modelo é *travas simples + verificação na gravação* — sem servidor.

### Travas por arquivo
- Ao entrar em modo de edição de um domínio, o app cria `<arquivo>.trava.json` na pasta de dados, com usuário, máquina e hora.
- Outra pessoa que tentar editar o mesmo domínio vê: *"em edição por Fulana desde 14:32"* — pode consultar, não pode gravar. Domínios diferentes editam em paralelo.
- **Leitura é sempre livre** (painel, consultas, relatórios não precisam de trava).
- Trava sem atividade expira em 30 min (renovada automaticamente enquanto o app está aberto) e pode ser assumida com confirmação explícita.
- A trava é liberada ao salvar ou sair da edição.

### Verificação na gravação (segunda camada)
Antes de salvar, o app confere a data de modificação do arquivo:
- Se mudou desde o carregamento, recarrega e **funde por ID**: como o uso é majoritariamente acréscimo de linhas, linhas novas dos dois lados são mantidas automaticamente.
- Conflito real (mesma linha editada por duas pessoas) → tela de escolha, nunca sobrescrita silenciosa.

### Disciplinas de integridade
1. **O app é o único escritor.** Excel serve para consultar; ao abrir cada arquivo o app valida o esquema (colunas e tipos) e avisa se alguém alterou pelo Excel.
2. **Gravação atômica**: escreve `arquivo.tmp.xlsx` e só então renomeia por cima do original — queda no meio da gravação nunca corrompe o banco.
3. **Validação de referências ao carregar**: prontuários citados que não existem em `pacientes.xlsx` geram relatório de órfãos (protege contra restauração parcial de backup).
4. **Prontuário sempre gravado como texto** — o Excel converte `0001234` em `1234` e quebraria todos os vínculos.
5. **Particionamento anual** dos arquivos volumosos (`evolucoes_2026.xlsx`, ...); o app abre o ano corrente por padrão. Nenhum arquivo cresce para sempre.
6. **Backup sempre da pasta inteira**, nunca de arquivo avulso — evita dessincronizar os domínios.
7. **Arquivo travado pelo Excel aberto**: o app detecta a falha de gravação e orienta ("feche culturas.xlsx e tente novamente") em vez de falhar em silêncio.

> Sinal para migrar para banco central com servidor no futuro: várias pessoas editando **a mesma área** ao mesmo tempo rotineiramente. Como a camada de dados é isolada em `excel.js` e o esquema é normalizado, a migração não exigiria reescrever o aplicativo.

---

## 10. Segurança e LGPD

- Dados nunca saem do computador da CCIH, exceto as planilhas pseudonimizadas dos miniapps.
- Tela de entrada com PIN por usuário (controle simples de acesso) + coluna ⚙ de auditoria (`CriadoPor`, `CriadoEm`) nas planilhas.
- **Backup em 1 clique**: ZIP datado da pasta `/dados` em `/dados/backups`, com lembrete automático semanal.
- Opção de exportar relatórios agregados **sem dados nominais** para envio à direção.

---

## 11. Fases de desenvolvimento

| Fase | Entregas | Resultado |
|---|---|---|
| **1 — MVP** | esqueleto do app + camada Excel (gravação atômica, validação, travas por arquivo) + `config` · pacientes/internações · importação de culturas e antibióticos · aba UTI com visita e dispositivos-dia · casos IRAS · painel com densidades de incidência | vigilância básica multiusuário funcionando ponta a ponta |
| **2** | evoluções + triggers · higiene de mãos + miniapp · alertas de stewardship · antibiograma acumulado · relatório mensal PDF | rotina completa da CCIH no app |
| **3** | cirurgias/ISC + busca pós-alta · mapa de isolamentos · surtos (carta de controle) · bundles · exportação ANVISA | módulos avançados |

---

*Documento de arquitetura — versão 1.0, agosto/2026.*
