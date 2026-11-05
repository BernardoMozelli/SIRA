#!/usr/bin/env bash
# Para o ambiente de teste. Com --apagar remove também os dados (banco e cérebro de teste) para recomeçar do zero.
set -euo pipefail
cd "$(dirname "$0")"
if [ "${1:-}" = "--apagar" ]; then docker compose --profile conector down -v; rm -f .env; echo "Ambiente de teste apagado."; else docker compose --profile conector down; echo "Parado (dados mantidos)."; fi
