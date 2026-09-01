# Aplicativo CCIH

Sistema de vigilância de infecções relacionadas à assistência à saúde (IRAS) para uso de
Comissões de Controle de Infecção Hospitalar. Roda 100% local no navegador (Chrome/Edge),
sem servidor, com os dados em planilhas Excel numa pasta escolhida pelo usuário.

Módulos: importação de relatórios hospitalares (culturas, internações, cirurgias,
dispositivos, isolamentos, óbitos, antibióticos, higiene das mãos), triagem automática de
culturas, alertas de surto e de multirresistentes, alertas de antimicrobianos (resistência
ao antibiótico em uso, dose, duração), fila de avaliação de antimicrobianos, notificação de
IRAS com dupla assinatura, vigilância pós-alta de cirurgias com contato por WhatsApp,
protocolo de sepse, ficha do paciente com linha do tempo, indicadores e relatórios, e
miniaplicativos móveis para coleta à beira do leito.

## Uso

Abra o `index.html` no Chrome ou Edge e aponte para a pasta de dados. Na primeira vez, os
arquivos do banco são criados automaticamente. Não há instalação nem dependência externa.

## Licença

© 2026 Rogério Sobroza de Mello.

Este programa é software livre, licenciado sob a **GNU General Public License v3.0**
(arquivo `LICENSE`): você pode usá-lo, estudá-lo, modificá-lo e redistribuí-lo livremente,
desde que qualquer versão derivada distribuída permaneça sob a mesma licença — o que
garante que ele continue livre para todas as CCIHs, sem que ninguém possa fechá-lo ou
registrá-lo como próprio.

Este repositório contém apenas o código. **Nunca publique a pasta de dados** (planilhas de
pacientes) — ela é separada do aplicativo justamente para isso.
