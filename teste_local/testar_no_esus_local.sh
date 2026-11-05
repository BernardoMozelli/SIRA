#!/usr/bin/env bash
# Testa o SIRA contra uma CÓPIA do seu e-SUS local (o banco original não é alterado: só é lido pelo pg_dump).
# Cria o banco "esus_sira_teste" dentro do mesmo Postgres, injeta dados clínicos FICTÍCIOS nessa cópia, instala as views e mostra o gabarito.
# Uso: ./testar_no_esus_local.sh NOME_DO_CONTAINER [BANCO_DE_ORIGEM=esus] [USUARIO_ADMIN=postgres]   (--recriar apaga e refaz a cópia)
set -euo pipefail
CT="${1:?informe o nome do container do Postgres do e-SUS local (docker ps)}"; ORIG="${2:-esus}"; U="${3:-postgres}"; COPIA="esus_sira_teste"
AQUI="$(cd "$(dirname "$0")/.." && pwd)"
[ "$ORIG" != "$COPIA" ] || { echo "Origem e cópia não podem ser o mesmo banco."; exit 1; }
psqlc() { docker exec -i "$CT" psql -U "$U" -v ON_ERROR_STOP=1 "$@"; }
if psqlc -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$COPIA'" | grep -q 1; then
  [ "${4:-}" = "--recriar" ] || [ "${2:-}" = "--recriar" ] || [ "${3:-}" = "--recriar" ] || { echo "O banco $COPIA já existe. Para refazer do zero: $0 $CT $ORIG $U --recriar"; exit 1; }
  psqlc -d postgres -c "DROP DATABASE $COPIA WITH (FORCE)"
fi
echo "1/4 Copiando $ORIG para $COPIA (somente leitura no original)…"
psqlc -d postgres -c "CREATE DATABASE $COPIA"
docker exec "$CT" pg_dump -U "$U" -d "$ORIG" --no-owner --no-privileges | psqlc -d "$COPIA" -q >/dev/null
echo "2/4 Injetando dados clínicos fictícios na CÓPIA (nunca no original)…"
psqlc -d "$COPIA" -q < "$AQUI/banco_real/04_dados_teste_clinicos.sql"
echo "3/4 Instalando as views do SIRA na cópia…"
"$AQUI/banco_real/instalar_views_esus.sh" --docker "$CT" "$COPIA" "$U"
echo "4/4 Conferência (tempos e totais):"
docker exec -i "$CT" psql -U "$U" -d "$COPIA" < "$AQUI/banco_real/03_conferir_esus.sql" | tail -60
echo; echo "Para o conector usar a cópia: SIRA_DB_URL=postgres://sira_ro:SENHA_MOSTRADA_ACIMA@HOST:5432/$COPIA"
