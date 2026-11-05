#!/usr/bin/env bash
# Backup dos dados do cérebro (usuários, configurações, auditoria, chaves de IA cifradas). Guarda 14 dias.
# Agende no cron da VPS, por exemplo:   0 3 * * *  /opt/sira/opcional_conector/cerebro_vps/backup_cerebro.sh
set -euo pipefail
cd "$(dirname "$0")"; DEST="${1:-$HOME/backup_sira}"; mkdir -p "$DEST"
ARQ="$DEST/sira_dados_$(date +%Y%m%d_%H%M%S).tar.gz"
docker compose exec -T cerebro tar czf - -C /dados . > "$ARQ"
chmod 600 "$ARQ"; find "$DEST" -name 'sira_dados_*.tar.gz' -mtime +14 -delete
echo "Backup: $ARQ"; echo "Guarde também uma cópia do SIRA_SEGREDO (arquivo .env) — o backup sozinho não decifra as chaves de IA."
