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

## 2. Importando dados

### O que pode ser importado (aba Importar)

| Tipo | O que traz | De onde vem |
|---|---|---|
| Culturas (laboratório) | exames, germes, antibiograma | planilha/PDF do laboratório |
| Internações (censo) | entradas, altas, setores, nomes, telefones | Tasy |
| Altas | fecha internações abertas | Tasy |
| Cirurgias realizadas | procedimentos, profilaxia | relatório do centro cirúrgico |
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

## 3. Culturas — triagem e revisão

Ao importar, o app **pré-classifica sozinho** o que não pede julgamento clínico:
cultura sem crescimento → **Negativa**; swab de vigilância e pesquisa de SGB →
**Colonização**; leite e água → controles. Essas ficam com status `triagem` e **fora do
painel** (há um seletor no relatório para vê-las quando quiser).

O que sobra na **fila de revisão** (aba Culturas) é o que pode ser infecção. Clique na
linha: o detalhe abre embaixo dela, com antibiograma e o botão "Ver ficha do paciente".
Classifique: Presente na admissão / IRAS (pede topografia e dispositivo) / Colonização /
Contaminação / Repetição / Não é cultura.

- Classificar como **IRAS abre uma suspeita de notificação** — que só vira notificação
  oficial depois que *outro profissional* confirmar (ver seção 7).
- Culturas colhidas em torno de um protocolo de sepse levam o selo **🩸 sepse** e nunca
  somem do relatório, mesmo negativas — a ausência de germe é o resultado do protocolo.

O **Relatório microbiológico** (aba Relatórios) filtra por período, setor, material,
germe, resistência e classificação, mostra o antibiograma acumulado (%S só de painéis
completos) e exporta para Excel.

---

## 4. Antibióticos

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

## 5. Miniapps (celular)

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

## 6. Isolamentos

Duas fontes se encontram na aba Isolamentos:

- A **lista diária de isolados** importada do hospital (foto do momento — encerra sozinha
  quem saiu).
- As **pendências geradas pelo app**: multirresistente novo sem precaução ativa nem
  decisão registrada. Para cada pendência, registre a precaução iniciada ou "não indicado"
  com justificativa.

Encerrar uma precaução manualmente também é feito ali. O painel inicial mostra o total de
pendências abertas.

---

## 7. Notificação de IRAS — dupla assinatura

Toda suspeita de infecção hospitalar — venha da revisão de culturas, da avaliação remota,
do miniapp da UTI ou da vigilância pós-alta — entra como **"em investigação"**. A
notificação oficial só nasce na **aba Infecções**, onde um segundo profissional:

1. abre a suspeita (a lista fica no topo da aba, e o painel inicial avisa);
2. completa topografia, dispositivo, germe e critério;
3. **confirma** (fica registrado quem notificou e quem confirmou) ou **descarta**.

Se você tentar confirmar uma suspeita que você mesmo abriu, o app avisa — não impede,
mas o ideal é que sejam duas pessoas. Os indicadores contam apenas as confirmadas.

---

## 8. Vigilância pós-alta (cirurgias)

A aba Pós-alta acompanha infecção de sítio cirúrgico depois da alta:

1. **Triagem**: cirurgias de 30 a 120 dias aparecem com checkbox — próteses/implantes e
   cesarianas já marcadas. Confirme para colocar **sob vigilância**.
2. **WhatsApp**: mensagem-modelo editável (com {nome}, {procedimento}, {data}); o clique
   abre a conversa e marca "mensagem enviada" (reversível com ↩).
3. **Desfecho**: "✓ Sem infecção" encerra; "⚠ Investigação" abre a ficha (tipo de ISC,
   observações) e cria a suspeita de IRAS.
4. **Validação**: um segundo profissional valida — só então a infecção é confirmada.
5. Quem passa de 120 dias sem resposta é encerrado "sem contato".

---

## 9. As outras abas, em uma linha cada

- **Painel** — alertas do dia (surtos, MDR 10 dias, antimicrobianos, suspeitas de IRAS,
  pendências) e gráficos rápidos.
- **Pacientes** — cadastro, busca e unificação de registros provisórios do laboratório.
- **Ficha do paciente** — tudo sobre uma pessoa numa linha do tempo (internações, culturas,
  antibióticos por curso, cirurgias, dispositivos, sepse, isolamentos, óbito); abre
  clicando no nome em qualquer tela.
- **Sepse** — indicadores do protocolo (tempos, bundle, desfechos) e perfil
  microbiológico IRAS × admissão.
- **Surtos** — investigação das suspeitas do painel, com cruzamento automático do que os
  pacientes têm em comum e anexos.
- **Higiene de mãos** — adesão por momento da OMS, setor e categoria profissional.
- **Eventos** — séries temporais de qualquer fonte do banco.
- **Configurações** — vocabulários (com unificação de termos), distribuição dos miniapps.

---

## 10. Segurança e boas práticas

- **Backup** = copiar a pasta de dados inteira. Os scripts de manutenção também deixam
  cópias em `backups/` antes de qualquer mudança em massa.
- **Multiusuário**: cada arquivo tem trava; se outra pessoa estiver gravando, o app pede
  para aguardar. Evite editar as planilhas no Excel com o app aberto.
- **LGPD**: arquivos que saem do app (miniapps, resumos por WhatsApp) carregam o mínimo —
  registro ou iniciais, nunca a ficha completa. A pasta de dados nunca deve ser publicada
  ou sincronizada em nuvem pública.
