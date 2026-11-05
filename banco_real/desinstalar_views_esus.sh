#!/usr/bin/env bash
# Desfaz a instalação do SIRA no banco do e-SUS: remove o schema "mcp" (views) e o usuário "sira_ro". Nenhuma tabela do PEC é alterada em nenhum momento.
# Uso (Docker):  ./desinstalar_views_esus.sh --docker NOME_DO_CONTAINER BANCO [USUARIO_ADMIN]     (direto: PGHOST=... ./desinstalar_views_esus.sh BANCO)
set -euo pipefail
SQL="DROP SCHEMA IF EXISTS mcp CASCADE; DO \$\$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sira_ro') THEN EXECUTE 'DROP OWNED BY sira_ro'; BEGIN EXECUTE 'DROP ROLE sira_ro'; EXCEPTION WHEN dependent_objects_still_exist THEN RAISE NOTICE 'O usuário sira_ro tem permissões em OUTRO banco deste servidor e foi mantido; aqui ele ficou sem acesso a nada.'; END; END IF; END \$\$;"
if [ "${1:-}" = "--docker" ]; then
  CT="${2:?container}"; DB="${3:?banco}"; ADM="${4:-postgres}"; docker exec -i "$CT" psql -U "$ADM" -d "$DB" -v ON_ERROR_STOP=1 -c "$SQL"
else DB="${1:?banco}"; psql -d "$DB" -v ON_ERROR_STOP=1 -c "$SQL"; fi
echo "OK. O SIRA foi removido do banco (schema mcp e usuário sira_ro)."
