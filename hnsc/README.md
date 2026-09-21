# Subprojeto HNSC

Espelho do desenho do subprojeto Unimed, para a **instalação do HNSC**: esta pasta guarda
o que é específico da instalação no hospital; o código continua sendo um só, na raiz.

## O pacote de instalação/atualização

Montado por script — atualizar a instalação do hospital vira um comando:

```
node scripts/montar-pacote-hnsc.js              # só o aplicativo (atualização)
node scripts/montar-pacote-hnsc.js --com-dados  # aplicativo + cópia do banco (instalação do zero)
```

Sai em `hnsc/Aplicativo CCIH HNSC/` com um LEIA-ME de instruções — é zipar e levar.
Atualização de instalação existente = substituir `js/`, `css/`, `lib/` e `index.html`;
a pasta de dados não é tocada (esquemas migram sozinhos na primeira abertura).

## O que é do HNSC e onde vive

- **Pasta de dados canônica (local)**: `~/Documentos/Dados CCIH HNSC` — fora do repositório.
- **Relatórios crus do Tasy** trazidos para análise: `hhnsc/` (gitignorada — dado real).
- **Protocolo empírico de ATB**: `js/protocolo-atb.js` é o do HNSC (documento validado
  pela CCIH) — é a Unimed que precisa de versão própria, não o contrário.
- **Miniapps/Drive**: catálogo em `js/miniapps-catalogo.js` (pasta do Drive da CCIH HNSC);
  segredos em `miniapps/fonte/config-local.json` (gitignorado, por instalação).
- Vocabulários, rotina (MDR monitorados, ATB avaliados), equipe e aliases: tudo no
  `config.xlsx` da pasta de dados, como em qualquer instituição.

## Regra inviolável

**Dados de pacientes nunca entram no repositório.** Esta pasta é gitignorada por padrão,
exceto este README — o pacote montado (que pode conter cópia do banco com `--com-dados`)
jamais é commitado.
