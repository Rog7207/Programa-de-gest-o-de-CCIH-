# Aplicativo CCIH — Manual do usuário

*Versão de setembro/2026. Este manual acompanha o aplicativo e cresce com ele.*

---

## 1. Começando

1. Abra o **`index.html`** no Google Chrome ou Microsoft Edge (outros navegadores não têm
   acesso a pastas). Não há instalação.
2. **Identifique-se pelo nome** — ele assina tudo que você importar ou alterar na sessão.
3. **Aponte a pasta de dados** da CCIH (na rede do hospital). O app lembra as últimas
   pastas usadas. Na primeira vez numa pasta vazia, ele pergunta antes de criar o banco —
   se você esperava dados e a pasta veio vazia, escolheu a pasta errada: cancele.

Os dados são planilhas Excel dentro dessa pasta — dá para abrir qualquer uma no Excel para
conferir (só não edite com o app aberto ao mesmo tempo). O aplicativo em si não guarda
nada: atualizar o app **nunca toca nos dados**.

### Como atualizar o aplicativo

O app é composto por **4 itens**: `index.html` + as pastas `js/`, `css/` e `lib/`.
Para atualizar:

1. Baixe a versão atual em <https://github.com/Rog7207/Programa-de-gest-o-de-CCIH->
   (botão **Code → Download ZIP**) — o ZIP traz exatamente esses itens, na versão publicada.
2. Na pasta do aplicativo, **apague as pastas `js/` e `css/` antigas** e cole as novas por
   cima, junto com o `index.html` e a `lib/` (apagar antes garante espelho exato; copiar
   por cima poderia deixar arquivo velho órfão).
3. Abra o app e tecle **Ctrl+Shift+R** na primeira vez (limpa o cache do navegador).

Na primeira conexão, a versão nova **atualiza a estrutura do banco sozinha** — acrescenta
colunas e abas que ainda não existiam, preservando todos os dados.

**Regra de ouro: só para frente.** Nunca use uma versão antiga do app numa pasta de dados
que já foi aberta por versão mais nova — a antiga não conhece as colunas novas.

---

## 2. Cadastros e configurações

Tudo isto fica na aba **Configurações** — é o que você define uma vez (ou revisa de tempos
em tempos) e o resto do app passa a respeitar.

### Usuário

Seu nome **assina** tudo que você importa ou altera. Salve-o uma vez; fica guardado no
navegador daquele computador.

### Equipe e funções

Cadastre cada profissional da CCIH e marque **quais funções** ele exerce. Cada função pode
receber um **"a cada N dias"** — a periodicidade com que a fila daquela função deve ser
zerada.

- **Para que servem os nomes:** viram os **botões da tela de entrada**, padronizando a
  assinatura (acaba o "Rogerio" × "Rogério" contando como duas pessoas).
- **Para que servem os dias:** definem o **prazo de cada fila**. O prazo é *por função*, então
  a mesma pessoa pode ter "Detecção de IRAS a cada 1 dia" e "Visita à UTI a cada 2 dias".
  Deixe em branco quando a função não tem periodicidade fixa.

As funções são: Gestor, Entrada dos relatórios do Tasy, Detecção de IRAS (revisão de
culturas), Validação de IRAS (segunda assinatura), Vigilância pós-alta, Controle de
antibióticos, Visita à UTI, Controle de procedimentos invasivos, Investigação de surtos,
Identificação de isolamentos, Validação de isolamentos (infectologista, casos duvidosos) e
Auditoria de higiene das mãos.

Alguns perfis já entram no cartão com medidor automático; outros (validação de isolamentos —
que o infectologista faz **só nos casos duvidosos** — e controle de procedimentos invasivos)
por ora são **só cadastro** e ganham o medidor quando chegarmos à tela correspondente.

### Rotina da equipe (no Painel)

Esse cadastro alimenta o cartão **Rotina da equipe**, no Painel. Para cada função ele mostra
a fila, quem responde por ela e se está **em dia** ou **atrasada** para o prazo:

- **fila** (culturas a revisar, suspeitas a validar, isolamentos pendentes, cirurgias a
  contatar, surtos a investigar): atrasada quando o **item mais antigo** já passou do prazo;
- **cadência** (visita à UTI, auditoria de higiene, avaliação semanal de antibióticos):
  atrasada quando faz **mais tempo que o prazo desde a última vez**.

Duas regras importantes, decididas para a rotina do HNSC:

- **O relógio é a carga semanal, não o calendário.** Os dados entram uma vez por semana
  (segunda) e o trabalho de processo é feito nesse dia. Entre uma carga e a próxima o painel
  **congela** e mostra a semana vigente — só vira atraso o que **sobrou de semanas
  anteriores**. A data de referência ("Dados de: DD/MM") aparece no topo do cartão e é
  detectada sozinha, pela última importação.
- **Conta-se em dias úteis.** Sábado e domingo são sobreaviso e **não envelhecem** a fila:
  uma pendência de sexta para segunda conta como ~1 dia útil, não 3.

Se ninguém estiver cadastrado com função, o cartão não aparece. O **Gestor** entra só como
informativo — não é uma tarefa com fila.

### Grupos de setores

Junte setores em grupos ("UTIs", "Clínicas cirúrgicas") para os relatórios saírem por grupo,
além de por setor individual ou hospital inteiro.

### Rotina da instituição

Três listas que ligam/desligam o que é da sua CCIH (desligado = comportamento completo, de
fábrica):

- **Antibióticos avaliados** rotineiramente — quais entram na fila de avaliação e na página
  remota dos médicos;
- **Multirresistentes isolados** rotineiramente — quais mecanismos geram alerta de MDR no
  painel e pendência de isolamento;
- **Cirurgias com vigilância pós-alta** — quais categorias entram pré-marcadas na triagem da
  aba Pós-alta.

Ainda aqui ficam os **perfis de importação** (memorizam o layout de cada relatório, para não
remapear a cada vez) e a **auditoria de vocabulário** (junta termos quase iguais, como
"E. coli" e "Escherichia coli").

---

## 3. Importando dados

### O que pode ser importado (aba Importar)

| Tipo | O que traz | De onde vem |
|---|---|---|
| Culturas (laboratório) | exames, germes, antibiograma | planilha/PDF do laboratório |
| Internações (censo) | entradas, altas, setores, nomes, telefones | Tasy |
| Altas | fecha internações abertas | Tasy |
| Cirurgias realizadas | procedimentos, profilaxia | relatório do centro cirúrgico |
| Internados hoje (Tasy 2396) | setor e leito **atuais** de cada internação; passagem por setores | foto diária do Tasy — importada todo dia vira pacientes-dia por setor |
| Dispositivos invasivos | CVC/VM/SVD, instalação e retirada | Tasy |
| Pacientes em isolamento | foto de quem está isolado agora | Tasy |
| Óbitos | desfecho das internações | Tasy |
| Antibióticos prescritos | prescrições em janelas renovadas | Tasy |
| Higiene das mãos | observações dos 5 momentos | miniapp |
| Protocolo de sepse | ficha dos enfermeiros | planilha própria |
| Casos de IRAS | migração de outro sistema | eventual |
| Catálogo de antimicrobianos | padronização da farmácia | farmácia |

### Como importar

**Arraste o arquivo** (ou clique para escolher) na aba Importar. O assistente tem 5 passos:
arquivo → tipo e cabeçalho → mapeamento de colunas → prévia e validação → gravação.

- **O app memoriza o layout**: na segunda vez que o mesmo relatório chegar, ele reconhece
  pelas colunas e sugere tudo sozinho. Mudou o layout no hospital? Ele pede o mapeamento
  uma vez e memoriza de novo.
- **Termos novos** (setor, germe, material que o app não conhece) aparecem para você
  decidir: termo novo, sinônimo de um existente, ou descarte. A decisão fica memorizada.
- **Importar pasta**: o botão "Importar pasta" varre uma pasta inteira e importa tudo que
  já tem layout memorizado — ideal para o lote diário de anexos.
- **Arquivos de miniapp entram sozinhos**, sem assistente (o cabeçalho já diz o que são).

### Atualizações e reimportação — pode repetir sem medo

A regra geral do app é: **reimportar não duplica**. Cada tipo tem sua identidade
(nº do exame do laboratório, atendimento+data, etc.) e o que já existe é ignorado ou
atualizado. Na prática:

- **Períodos sobrepostos são bem-vindos** — exporte sempre "últimos 30 dias".
- **Internações**: reimportar atualiza alta, desfecho e setor das que mudaram.
- **Isolamentos**: cada lista importada é uma *foto de agora* — quem estava na foto
  anterior e sumiu tem a precaução encerrada automaticamente na data da foto.
- **Miniapp da UTI**: reexportar o mesmo dia substitui a visita (correções valem).
- O relatório original é sempre **arquivado** em `importados/AAAA-MM/` dentro da pasta de
  dados — nada se perde.

---

## 4. Culturas — triagem e revisão

Ao importar, o app **pré-classifica sozinho** o que não pede julgamento clínico:
cultura sem crescimento → **Negativa**; swab de vigilância e pesquisa de SGB →
**Colonização**; leite e água → controles. Essas ficam com status `triagem` e **fora do
painel** (há um seletor no relatório para vê-las quando quiser).

O que sobra na **fila de revisão** (aba Culturas) é o que pode ser infecção. Clique na
linha: o detalhe abre embaixo dela, com antibiograma e o botão "Ver ficha do paciente".
Classifique: Presente na admissão / IRAS (pede topografia e dispositivo) / Colonização /
Contaminação / Repetição / Não é cultura.

- **Amostras repetidas viram uma linha só**: o mesmo paciente com o mesmo germe no mesmo
  material em até 14 dias aparece como "Hemocultura (2 amostras)". O detalhe lista todas
  as amostras e **uma classificação vale para todas** — é a mesma infecção, não duas.
  Se as amostras já tinham classificações diferentes, a linha avisa "⚠ divergente" para
  a CCIH escolher uma. O mesmo agrupamento vale para as pendências de isolamento.

- Classificar como **IRAS abre uma suspeita de notificação** — que só vira notificação
  oficial depois que *outro profissional* confirmar (ver seção 7).
- Culturas colhidas em torno de um protocolo de sepse levam o selo **🩸 sepse** e nunca
  somem do relatório, mesmo negativas — a ausência de germe é o resultado do protocolo.

O **Relatório microbiológico** (aba Relatórios) filtra por período, setor, material,
germe, resistência e classificação, mostra o antibiograma acumulado (%S só de painéis
completos) e exporta para Excel.

---

## 5. Antibióticos

O extrato do hospital traz *janelas de prescrição* renovadas a cada 1–3 dias. O app funde
as janelas contíguas do mesmo paciente + droga num **curso de tratamento** — é o curso que
aparece na ficha do paciente, na fila e nos indicadores.

A aba Antibióticos traz:

- **Alertas**: 🦠 germe do paciente resistente ao antibiótico em uso (culturas de até 30
  dias) · 💊 dose diária acima do teto usual de adulto (setores pediátricos ficam fora) ·
  ⏱ curso com 10+ dias sem interrupção. Os alertas também aparecem no painel inicial.
- **Fila de avaliação**: como a de culturas — clique no curso, o cartão mostra as culturas
  recentes com o resultado daquele antibiótico, e você registra Avaliação + Recomendação
  (Manter / Ajustar dose / Descalonar / Modificar / Suspender) com parecer. A avaliação
  vale pelo curso; se ele continuar correndo, volta à fila em 7 dias.
- **Indicadores**: DOT (dias de terapia) por semana, por setor, por droga e por classe
  (quando o catálogo da farmácia estiver importado), duração média dos cursos.
- **Página remota dos médicos**: gera um HTML cifrado com os pacientes pendentes para os
  prescritores avaliarem de fora; o retorno entra pela aba Importar.

---

## 6. Miniapps (celular)

Três miniaplicativos rodam **offline no celular**, distribuídos por QR code (aba
Configurações → distribuição):

- **Visita à UTI**: dispositivos por paciente (com indicação e "sugerir retirada"),
  avaliação de antibióticos à beira do leito e **suspeita de IRAS** com foco.
- **Higiene das mãos**: observação dos 5 momentos com cronômetro de fricção.
- **Decisão de ATB empírica** (para o médico da emergência): o protocolo institucional
  responde o esquema e os exames a coletar. Cada decisão fica registrada no aparelho e é
  enviada à CCIH quando houver rede (só prontuário, nunca nome) — é assim que o uso do
  protocolo começa a gerar dados. Versão inicial é **protocolo puro** (consenso). Quando o
  banco tiver painel S/I/R suficiente, o **antibiograma consolidado do hospital** pode ser
  embutido (`node scripts/consolidar-antibiograma.js --de … --ate …` e montar com
  `--com-antibiograma`): aí a droga sugerida com resistência local alta (≥30%, n ≥ 20)
  ganha aviso. O histórico individual do paciente só existe na aba Decisão ATB do computador.

Ao final, o miniapp **exporta um arquivo** (compartilhe pelo próprio celular — e-mail ou
WhatsApp para você mesmo). No computador, arraste esse arquivo na aba Importar: entra
sozinho. O que acontece na importação:

- visitas viram os indicadores da aba UTI (dispositivo-dia, retiradas sugeridas — e o app
  confere depois se **foram retiradas de fato**);
- suspeitas de IRAS viram casos aguardando confirmação;
- os pacientes são identificados pelo número anotado (prontuário *ou* atendimento).

A aba UTI também gera o **📋 resumo para levar à visita** (último mês do setor: MDR,
isolamentos, adesão à higiene, pendências) — enviado por WhatsApp para o celular de quem
vai fazer a visita, com pacientes em iniciais.

---

## 7. Isolamentos

Duas fontes se encontram na aba Isolamentos:

- A **lista diária de isolados** importada do hospital (foto do momento — encerra sozinha
  quem saiu).
- As **pendências geradas pelo app**: multirresistente novo sem precaução ativa nem
  decisão registrada. Para cada pendência, registre a precaução iniciada ou "não indicado"
  com justificativa.

Encerrar uma precaução manualmente também é feito ali. O painel inicial mostra o total de
pendências abertas.

---

## 8. Notificação de IRAS — dupla assinatura

Toda suspeita de infecção hospitalar — venha da revisão de culturas, da avaliação remota,
do miniapp da UTI ou da vigilância pós-alta — entra como **"em investigação"**. A
notificação oficial só nasce na **aba Infecções**, onde um segundo profissional:

1. abre a suspeita (a lista fica no topo da aba, e o painel inicial avisa);
2. completa topografia, dispositivo, germe e critério;
3. **confirma** (fica registrado quem notificou e quem confirmou) ou **descarta**.

Se você tentar confirmar uma suspeita que você mesmo abriu, o app avisa — não impede,
mas o ideal é que sejam duas pessoas.

**Agente da infecção**: na confirmação, o germe é escolhido entre as **culturas positivas
válidas do paciente em ±14 dias** (a cultura escolhida fica vinculada ao caso), ou
"Sem cultura positiva válida", ou outro nome digitado.

**Digitação no Tasy e conciliação** (o passo final do processo):

1. A aba Infecções lista as confirmadas **aguardando digitação**; marque-as e clique
   **Imprimir fichas** — saem 2 fichas por página (identificação, internação e passagem
   por setores, dispositivos invasivos, cirurgias, a infecção, o agente com as resistências)
   e o arquivo fica guardado em `fichas/` na pasta de dados, como registro.
2. Digite as infecções no prontuário (Tasy).
3. Importe o export de IRAS do Tasy (aba Importar, tipo **"IRAS digitadas no Tasy"**). A
   conciliação casa cada linha com o caso daqui (mesmo paciente, data em até 7 dias, mesma
   topografia) e o marca como **digitado**; o que existe só no Tasy entra aqui já como
   digitado, para revisão; e se o Tasy tiver **duas linhas para o mesmo episódio**, o app
   avisa e não deixa entrar a segunda — corrija no Tasy. Reimportar o mesmo export não
   duplica nada.
4. A partir da **data de início da conciliação** (Configurações → Rotina; 01/07/2026 no
   HNSC), **só a infecção digitada conta nos relatórios** — antes dela, a confirmada vale.
   É o que impede os dois sistemas de divergirem.

**Sem duplicatas**: o mesmo episódio costuma ser detectado por mais de um caminho (uma
cultura revisada, o contato da pós-alta, uma planilha importada). O app reconhece o
episódio — mesmo paciente, mesma topografia (contando siglas como ITU, PAV, IPCS e ISC)
e datas até 14 dias entre si — e, em vez de abrir um caso novo, completa os campos
vazios do existente. Duplicatas antigas aparecem no topo da aba Infecções com o botão
**Fundir duplicatas**: fica o caso mais forte (decisão da segunda assinatura vale mais),
e a fusão fica registrada nas observações.

---

## 9. Vigilância pós-alta (cirurgias)

A aba Pós-alta acompanha infecção de sítio cirúrgico depois da alta:

1. **Triagem**: cirurgias de 30 a 150 dias aparecem com checkbox — próteses/implantes e
   cesarianas já marcadas. Confirme para colocar **sob vigilância**.
   - Quem entra na triagem: **cirurgias limpas, cesarianas e próteses/implantes** (regra da
     CCIH). Como o anestesista raramente preenche o potencial de contaminação, o app
     **presume** limpa/não-limpa pelo tipo de cirurgia; o valor do anestesista, quando
     existe, sempre vence.
   - O tipo de cirurgia é definido sozinho pelo app a partir do nome que veio do Tasy:
     **categoria NHSN** (Colecistectomia, Artroplastia de quadril…), categoria própria para
     as frequentes fora do NHSN (Desbridamento, Cateter duplo J…) ou a especialidade
     "(outras)". Bloqueio anestésico, biópsia, drenagem e cateteres não são cirurgia e não
     entram. Só o que o app não reconhece aparece na importação para alguém decidir.
2. **WhatsApp**: mensagem-modelo editável (com {nome}, {procedimento}, {data}); o clique
   abre a conversa e marca "mensagem enviada" (reversível com ↩).
3. **Desfecho**: "✓ Sem infecção" encerra; "⚠ Investigação" abre a ficha (tipo de ISC,
   observações) e cria a suspeita de IRAS.
4. **Validação**: um segundo profissional valida — só então a infecção é confirmada.
5. Quem passa de 150 dias sem resposta é encerrado "sem contato".

---

## 10. As outras abas, em uma linha cada

- **Painel** — alertas do dia (surtos, MDR 10 dias, antimicrobianos, suspeitas de IRAS,
  pendências), o cartão **Rotina da equipe** (ver seção 2) e gráficos rápidos.
- **Pacientes** — cadastro, busca e unificação de registros provisórios do laboratório.
- **Ficha do paciente** — tudo sobre uma pessoa numa linha do tempo (internações, culturas,
  antibióticos por curso, cirurgias, dispositivos, sepse, isolamentos, óbito); abre
  clicando no nome em qualquer tela.
- **Sepse** — indicadores do protocolo (tempos, bundle, desfechos) e perfil
  microbiológico IRAS × admissão.
- **Surtos** — investigação das suspeitas do painel, com cruzamento automático do que os
  pacientes têm em comum e anexos. A suspeita exige pacientes com o mesmo germe **e
  antibiograma semelhante** em 14 dias, no mesmo setor ou após o mesmo procedimento
  cirúrgico: **3** para germe esporádico ou **clone resistente** (MRSA, VRE,
  carbapenem-resistente — sempre grupo à parte); germe **endêmico** no setor só alerta
  acima da própria linha de base dos 24 meses anteriores (o limiar aparece no alerta).
  Ocorrência contínua (caso novo em até 14 dias do anterior) é **um surto só**, que se
  estende; um descarte da CCIH corta a sequência. Estafilococo coagulase-negativo e
  identificações preliminares só entram depois de classificados como infecção. Suspeita
  com mais de 6 meses sem avaliação vira **"antigo não avaliado"** — sai do painel e
  pode ser descartada em lote na aba. Pronto atendimento, emergência e ambulatórios
  ficam fora da detecção.
- **Higiene de mãos** — adesão por momento da OMS, setor e categoria profissional.
- **Eventos** — séries temporais de qualquer fonte do banco.
- **Configurações** — usuário, equipe e funções, grupos de setores, rotina da instituição,
  vocabulários e distribuição dos miniapps (detalhado na seção 2).

---

## 11. Segurança e boas práticas

- **Backup** = copiar a pasta de dados inteira. Os scripts de manutenção também deixam
  cópias em `backups/` antes de qualquer mudança em massa.
- **Multiusuário**: cada arquivo tem trava; se outra pessoa estiver gravando, o app pede
  para aguardar. Evite editar as planilhas no Excel com o app aberto.
- **LGPD**: arquivos que saem do app (miniapps, resumos por WhatsApp) carregam o mínimo —
  registro ou iniciais, nunca a ficha completa. A pasta de dados nunca deve ser publicada
  ou sincronizada em nuvem pública.
