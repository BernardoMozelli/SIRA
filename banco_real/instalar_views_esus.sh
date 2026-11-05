#!/usr/bin/env bash
# SIRA — instala as views mascaradas (schema "mcp") e o usuário somente leitura "sira_ro" no banco do e-SUS PEC.
# Uso (Postgres em Docker):   ./instalar_views_esus.sh --docker NOME_DO_CONTAINER BANCO [USUARIO_ADMIN]
# Uso (Postgres direto):      PGHOST=... PGPORT=5432 PGUSER=postgres PGPASSWORD=... ./instalar_views_esus.sh BANCO
# Uso (só IP/porta/banco/usuário, sem psql instalado):  ./instalar_views_esus.sh --rede HOST PORTA BANCO USUARIO_ADMIN   (pede a senha; usa um container postgres:16-alpine só para rodar o psql)
# Variáveis opcionais: SIRA_SAL (sal do hash) e SIRA_RO_SENHA (senha do sira_ro). Se faltarem, são geradas e mostradas no fim (guarde!).
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"; SQL="$AQUI/02_views_mcp_esus.sql"
[ -f "$SQL" ] || { echo "Não achei $SQL"; exit 1; }
gerar() { head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24; }
SAL="${SIRA_SAL:-$(gerar)}"; SENHA="${SIRA_RO_SENHA:-$(gerar)}"
if [ "${1:-}" = "--docker" ]; then
  CT="${2:?informe o nome do container}"; DB="${3:?informe o banco}"; ADM="${4:-postgres}"
  docker exec -i "$CT" psql -U "$ADM" -d "$DB" -v ON_ERROR_STOP=1 -v sal="$SAL" -v senha="$SENHA" -f - < "$SQL"
elif [ "${1:-}" = "--rede" ]; then
  H="${2:?informe o servidor}"; P="${3:?informe a porta}"; DB="${4:?informe o banco}"; ADM="${5:?informe o usuário administrador}"
  read -rsp "Senha do usuário $ADM: " PW; echo
  docker run --rm -i --network host -e PGPASSWORD="$PW" postgres:16-alpine psql -h "$H" -p "$P" -U "$ADM" -d "$DB" -v ON_ERROR_STOP=1 -v sal="$SAL" -v senha="$SENHA" -f - < "$SQL"
  unset PW
else
  DB="${1:?informe o banco}"
  psql -d "$DB" -v ON_ERROR_STOP=1 -v sal="$SAL" -v senha="$SENHA" -f "$SQL"
fi
echo
echo "OK. Views criadas e usuário sira_ro configurado."
echo "  Usuário do conector: sira_ro      Senha: $SENHA"
echo "  Sal do hash (mantenha SEMPRE o mesmo, senão os ids mudam): $SAL"
echo "  SIRA_DB_URL=postgres://sira_ro:$SENHA@HOST_DO_BANCO:5432/$DB"
echo "Próximo passo: rode 03_conferir_esus.sql e compare os totais com o PEC."
