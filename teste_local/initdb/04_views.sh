#!/bin/bash
# Instala as MESMAS views e o MESMO usuário sira_ro que irão para a prefeitura.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v sal="${SIRA_SAL:-sal-de-teste}" -v senha="${SIRA_RO_SENHA:-teste_ro_senha}" -f /sira/banco_real/02_views_mcp_esus.sql
