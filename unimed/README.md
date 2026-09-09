# Subprojeto Unimed

Aplicação do mesmo sistema a um **segundo hospital** (Unimed Tubarão), sem duplicar o
aplicativo. Esta pasta guarda apenas o que é **específico da Unimed**; o código continua
sendo o mesmo, um só, na raiz do projeto.

## O que já é por instituição (não precisa de nada aqui)

O aplicativo nasceu multi-hospital na maior parte: tudo isto vive no `config.xlsx` da
**pasta de dados**, que é escolhida ao abrir o programa — basta uma pasta de dados
separada para a Unimed.

- setores, materiais, microrganismos, antibióticos, topografias, focos de sepse
- procedimentos NHSN, categorias profissionais, momentos de higiene, motivos de precaução
- rotina da instituição (antibióticos avaliados, MDR monitorados, cirurgias vigiadas)
- equipe e funções, grupos de setores, perfis de importação, sinônimos (aliases)
- e-mail da CCIH (aba `meta`)

## O que hoje está preso ao HNSC e precisa de versão Unimed

| Item | Onde está | Como resolver |
|---|---|---|
| Protocolo empírico de ATB | `js/protocolo-atb.js` | fonte: MAN.SCIH.01 (manual de antibióticos da Unimed). Vira `unimed/protocolo-atb.js`, carregado conforme a instituição |
| Links dos miniapps (Drive) | `js/miniapps-catalogo.js` | catálogo próprio da Unimed (outra pasta do Drive) |
| E-mail e segredo dos miniapps | `miniapps/fonte/config-local.json` | já é por instalação (gitignorado) — a Unimed monta os seus |

## Regra inviolável

**Dados de pacientes da Unimed nunca entram no repositório** — a pasta de dados dela vive
fora do projeto, como a do HNSC. Esta pasta é gitignorada por padrão, exceto este README:
o que for código genérico deve ser promovido para a raiz, não ficar aqui.

## Estado

Iniciado em 09/09/2026. Próximo passo: definir de onde vem cada relatório da Unimed
(o sistema não é o Tasy) e montar o `config.xlsx` inicial com os vocabulários da casa.
