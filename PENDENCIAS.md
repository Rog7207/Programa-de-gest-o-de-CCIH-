# Pendências conhecidas

Lista curta do que está consciente e deliberadamente por fazer. Não é backlog de ideias:
só entra aqui o que já foi analisado e teve a decisão adiada, com o motivo.

## Relatórios — dispositivos invasivos

O denominador de dias de dispositivo (banco `denominadores`, aba `dispositivos_dia`) já é
importado e já alimenta as taxas por 1.000 dias no **relatório de IRAS**. Falta:

- **DOT / stewardship**: o relatório de antibióticos usa pacientes-dia. Para as UTIs, DOT
  por 1.000 pacientes-dia do setor já sai do censo agregado; o que não existe é o cruzamento
  com dias de dispositivo (ex.: uso de antimicrobiano em pacientes ventilados).
- **Resumo executivo**: não traz nenhuma taxa por dispositivo. Como ele reaproveita o
  `resumo` de cada relatório, basta o relatório de IRAS publicar as taxas nesse bloco —
  ainda não publica.
- **Perfil microbiológico**: as ICS poderiam ser expressas por 1.000 dias de cateter
  central, hoje aparecem só como contagem.
- **Sem tipo em `TIPOS_RELATORIO`**: `dispositivos_dia` entra pelo caminho especial
  (detecção por estrutura + confirmação), e por isso **não aparece na lista de tipos** da
  tela de importação. É correto — a planilha não tem colunas mapeáveis —, mas quem procurar
  o nome na lista não acha. Decidir se vale um item só para explicar isso.

## Relatórios — denominadores em geral

- **Cobertura da contagem não é persistida.** O leitor calcula quantos dias de cada mês
  foram efetivamente contados, mas só as contagens vão para o banco. O relatório reconstrói
  a cobertura a partir das linhas gravadas, o que subestima mês em que houve contagem e
  nenhum paciente. Persistir a cobertura resolveria; ainda não vale a coluna nova.
- **Mês pela metade não é rateado** no censo agregado: a competência entra inteira ou não
  entra. É deliberado (o relatório de origem não diz quanto de cada dia foi de quem), mas
  distorce período que começa ou termina no meio do mês.

## Dados da Unimed

- **Janeiro/2022 da neonatal**: corrigido em 09/09/2026 (as datas eram de dezembro/2018).
  Backup em `…ANTES-DA-CORRECAO.xlsx`.
- **Abas de ago–nov/2026 da neonatal** nascem com datas do mês errado: quem preencher
  agosto vai preencher na aba errada.
- **Agosto/2026 vazio nas duas UTIs**, com o mês já fechado.
- **2017–2021 dos dispositivos** ficam de fora: quatro estruturas diferentes, e 2020 tem
  doze estruturas em doze abas (UTIs criadas e fundidas na pandemia). Se for necessário,
  merece script próprio, aba por aba — não importador genérico.
- **22 nomes crus de procedimento do Tasy** aguardam o de-para para as categorias NHSN.

## Miniapps

- **Decisão ATB no iPhone**: só funciona hospedado por `https` (arquivo baixado não roda no
  iOS, em navegador nenhum — todos usam o motor do Safari). O build `--publico` está pronto
  e testado, sem segredo embutido. Falta a CCIH decidir se o protocolo pode ficar numa
  página pública, e preencher o e-mail no momento de publicar.
- **Offline da versão hospedada** exigiria um *service worker*. Não feito, e não prometido.
