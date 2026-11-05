#!/usr/bin/env bash
# Gera o pacote que vai para o servidor da prefeitura: conector + instalador + scripts do banco. Uso: ./empacotar_para_prefeitura.sh [destino.zip]
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"; SAIDA="${1:-$RAIZ/sira-conector-prefeitura.zip}"
T="$(mktemp -d)"; P="$T/sira-conector"; mkdir -p "$P/conector" "$P/banco_real"
cp -r "$RAIZ/conector/Dockerfile" "$RAIZ/conector/package.json" "$RAIZ/conector/package-lock.json" "$RAIZ/conector/src" "$P/conector/"
rm -f "$P/conector/src/teste_catalogo.js"
cp "$RAIZ/banco_real/"{02_views_mcp_esus.sql,03_conferir_esus.sql,instalar_views_esus.sh,desinstalar_views_esus.sh} "$P/banco_real/"
cp "$RAIZ/opcional_conector/conector_prefeitura/"{docker-compose.yml,instalar.sh,LEIA-ME.txt} "$P/"
chmod +x "$P/instalar.sh" "$P/banco_real/"*.sh
( cd "$T" && rm -f "$SAIDA" && zip -qr "$SAIDA" sira-conector ); rm -rf "$T"; echo "Pacote: $SAIDA"
