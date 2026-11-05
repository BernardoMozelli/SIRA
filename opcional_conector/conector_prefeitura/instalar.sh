#!/usr/bin/env bash
# SIRA — instala o conector na prefeitura. Pergunta 5 coisas, grava o .env e sobe o container.
# Uso: ./instalar.sh            (interativo)       ./instalar.sh --reconfigurar   (refaz as respostas)
set -euo pipefail
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo "ERRO: o Docker não está instalado neste servidor."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERRO: falta o plugin 'docker compose'."; exit 1; }

if [ ! -f .env ] || [ "${1:-}" = "--reconfigurar" ]; then
  echo "== SIRA: configuração do conector =="
  echo "O banco é o do e-SUS PEC (o usuário sira_ro precisa já existir: veja banco_real/instalar_views_esus.sh)."
  read -rp "1) Servidor do banco do e-SUS [host.docker.internal = este mesmo servidor]: " H; H="${H:-host.docker.internal}"
  read -rp "2) Porta [5432]: " PT; PT="${PT:-5432}"
  read -rp "3) Nome do banco [esus]: " DB; DB="${DB:-esus}"
  read -rp "4) Senha do usuário sira_ro: " -s SN; echo
  read -rp "5) Endereço do cérebro (ex.: wss://sira.bemosistemas.com.br/conector): " CE
  read -rp "6) Token do conector (gerado em Administração > Configurações): " -s TK; echo
  [ -n "$SN" ] && [ -n "$CE" ] && [ -n "$TK" ] || { echo "ERRO: senha, endereço do cérebro e token são obrigatórios."; exit 1; }
  SN_ENC="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$SN" 2>/dev/null || printf '%s' "$SN")"
  umask 077
  { echo "SIRA_DB_URL=postgres://sira_ro:${SN_ENC}@${H}:${PT}/${DB}"; echo "SIRA_CEREBRO_URL=${CE}"; echo "SIRA_TOKEN=${TK}"; } > .env
  echo "Configuração gravada em .env (somente você lê)."
fi

mkdir -p logs && chmod 777 logs
docker compose up -d --build
echo; echo "Aguardando conexão..."; sleep 6
docker compose logs --tail 8 conector
echo
if docker compose logs --tail 30 conector | grep -q "conectado ao cérebro"; then echo "OK: conector CONECTADO ao cérebro."; else
  echo "Ainda não conectou. Veja o motivo acima (ou rode: docker compose logs -f conector)."; fi
echo "Registro do que foi executado no banco: ./logs/conector-execucoes.log"
