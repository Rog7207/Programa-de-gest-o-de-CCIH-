# Pendências conhecidas

Lista curta do que está consciente e deliberadamente por fazer. Não é backlog de ideias:
só entra aqui o que já foi analisado e teve a decisão adiada, com o motivo.

## Relatórios — pacientes-dia POR SETOR (passagem de setor)

O leitor de transferências (banco `denominadores`, aba `passagem_setor`) já importa as
estadas por setor com entrada/saída datadas — a fonte correta de pacientes-dia por setor
(o censo agregado só sabe o setor de ENTRADA). Falta a integração nos relatórios:

- Somar os intervalos (saída − entrada) ∩ período, por setor, como denominador POR SETOR de
  IRAS e dispositivos — substituindo/complementando `pacientesDiaDoCenso`, que hoje é o único
  caminho por setor e depende do censo mensal agregado. Isso destrava densidade por setor de
  verdade, com o denominador vindo de onde o paciente REALMENTE ficou.
- Os horários de origem têm ~10% de inconsistências (setor N+1 entra antes de o setor N sair)
  — dado da Unimed, não da leitura. Ao somar intervalos, decidir se sobreposições são
  aparadas ou somadas como estão (provável: aparar ao período e não deixar intervalo
  negativo).

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
- **Cirurgias: não ingerir o PDF sem telefone ainda.** O leitor de PDF está pronto e
  validado, mas o PDF não traz prontuário, e a dedup de cirurgia é por
  `Prontuario+DataCirurgia+Procedimento` (js/esquemas.js). Ingerir o PDF agora (prontuário
  vazio) e depois o relatório novo — mesmas cirurgias, com telefone e talvez prontuário —
  daria chaves diferentes e DUPLICARIA as 4.193. Decisão (09/09/2026): esperar os dois
  relatórios novos da Unimed (transferências + cirurgias com telefone) e ingerir só eles.
- **Rever a chave de dedup de cirurgia depois de ver o relatório novo.** O identificador
  estável entre formatos (PDF sem prontuário × Excel com) é o **Atendimento**. Provável
  troca: Atendimento quando existir, caindo para a chave composta só quando faltar — mas
  só decidir com o arquivo novo em mãos (saber se ele traz prontuário muda o desenho).

## Formatos de agosto/2026 recebidos, aguardando versão com texto (11/09/2026)

Só de agosto em diante — não haverá retrospectiva.

- **Busca fonada = "Relação das Cirurgias" COM telefone + endereço.** É o mesmo relatório
  de cirurgias que o leitor já entende, mais uma linha de continuação com `Celular:`/`Fone:`
  e endereço sob cada paciente. É a "cirurgias com telefone" que faltava para a pós-alta.
  Veio separada por especialidade (CIRURGIAS LIMPAS, GINECOLOGIA, OFTALMOLÓGICAS) + ÓBITOS
  à parte (formato "Atendimentos", são as altas por óbito, para EXCLUIR da ligação).
  - **Bloqueio**: os arquivos vieram como IMAGEM escaneada (0 fontes, 0 texto) — OCR num
    relatório girado é inseguro. O usuário vai pedir a versão **impressa para PDF** (com
    texto) e, se possível, **uma lista única** do mês em vez de três por especialidade.
  - **Quando chegar com texto**: estender `analisarPDFCirurgias` para capturar a linha de
    telefone/endereço (hoje ignorada). Isso liga a vigilância pós-alta na Unimed.
- **"atendimentos MMAAAA" = transferências ("Passagem de Setor"), formato NOVO.** NÃO é o
  "todos atendimentos" que o leitor de censo já lê. Estrutura: por paciente (prontuário +
  nome), uma linha por setor com ENTRADA e SAÍDA datadas e duração. É o que dá pacientes-dia
  e densidade POR SETOR de verdade (o censo agregado só tem o setor de entrada). Precisa de
  leitor próprio; construir quando o usuário confirmar que é o formato padrão.

## Miniapps

- **Decisão ATB no iPhone**: só funciona hospedado por `https` (arquivo baixado não roda no
  iOS, em navegador nenhum — todos usam o motor do Safari). O build `--publico` está pronto
  e testado, sem segredo embutido. Falta a CCIH decidir se o protocolo pode ficar numa
  página pública, e preencher o e-mail no momento de publicar.
- **Offline da versão hospedada** exigiria um *service worker*. Não feito, e não prometido.
