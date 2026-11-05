#!/bin/bash
# Problemas (hipertensão, diabetes, gestação), vínculos de equipe e atendimentos fictícios + gabarito (tabela sira_gabarito).
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /sira/banco_real/04_dados_teste_clinicos.sql
