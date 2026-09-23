#!/usr/bin/env bash
# Aplica numa pasta de dados TODO o saneamento decidido com a CCIH do HNSC (21–22/09/2026),
# na ordem certa, com backup por arquivo (cada script guarda backups/*.backup-antes-*.xlsx).
# É idempotente: rodar de novo numa pasta já saneada não muda nada.
#
# Uso:  bash scripts/atualizar-pasta-hnsc.sh "/caminho/da/Dados CCIH HNSC" [--simular]
#   --simular  só mostra o que cada passo faria (nada é gravado).
#
# Cenário para o qual foi escrito: a cópia do hospital tem dados mais novos; traz-se a pasta
# inteira de lá, roda-se isto nela e a pasta fica igual à daqui em vocabulários, setores,
# identidades, cirurgias, antibióticos e casos de IRAS — mas com os dados atuais.
set -euo pipefail
PASTA="${1:-}"
[ -n "$PASTA" ] && [ -f "$PASTA/config.xlsx" ] || { echo "Uso: $0 \"/caminho/da/Dados CCIH HNSC\" [--simular]"; exit 1; }
FLAG="--aplicar"; [ "${2:-}" = "--simular" ] && FLAG=""
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
export PASTA_CCIH="$PASTA"
export USUARIO_CCIH="${USUARIO_CCIH:-Rogerio}"

passo() { echo; echo "=================================================================="; echo ">> $1"; echo "=================================================================="; }
rodar() { node "$RAIZ/scripts/$1" "${@:2}" $FLAG 2>&1 | grep -vE "^\s+at " || true; }

passo "1/9 Setores: unificar grafias e tirar lixo"
rodar limpar-setores.js
passo "2/9 Setores: sanear aliases venenosos"
rodar corrigir-aliases-setores.js
passo "3/9 Setores: tipo de cada setor (setores_tipo)"
rodar classificar-setores.js
passo "4/9 Microrganismos: unificar spp"
rodar limpar-microrganismos.js
passo "5/9 Culturas: coliformes -> Controle ambiental/alimentar"
rodar reclassificar-controle-ambiental.js
passo "6/9 Cirurgias: categoria pelo classificador + vocabulário procedimentos_nhsn"
rodar reclassificar-cirurgias.js
passo "7/9 Identidades: unificar pacientes com prova de internação (2 passadas)"
rodar unificar-identidades.js
rodar unificar-identidades.js
passo "8/9 Antibióticos: vocabulário, unificações, exclusões"
rodar limpar-antibioticos.js
passo "9/9 IRAS: casos para culturas já classificadas (confirmado até mai/2026; em investigação desde jun/2026)"
rodar criar-casos-de-culturas-iras.js --status=confirmado --ate=2026-06-01
rodar criar-casos-de-culturas-iras.js --desde=2026-06-01

echo
echo "Concluído em: $PASTA"
[ -z "$FLAG" ] && echo "(simulação — nada foi gravado)"
echo "No aplicativo: Ctrl+Shift+R e reabrir a pasta."
