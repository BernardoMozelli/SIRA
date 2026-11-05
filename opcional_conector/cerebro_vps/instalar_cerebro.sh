#!/usr/bin/env bash
# SIRA — instala o CÉREBRO na VPS (Docker + HTTPS automático).
# Uso: ./instalar_cerebro.sh                      (primeira vez: pergunta o domínio e cria o cliente e o administrador BeMo)
#      ./instalar_cerebro.sh --novo-cliente       (cadastra outra prefeitura e mostra o token do conector dela)
set -euo pipefail
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo "ERRO: instale o Docker nesta VPS primeiro."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERRO: falta o plugin 'docker compose'."; exit 1; }
hex() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
senha() { head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16; }
slugfy() { echo "$1" | iconv -f utf8 -t ascii//TRANSLIT 2>/dev/null | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/^-*//; s/-*$//' | cut -c1-30; }

if [ ! -f .env ]; then
  read -rp "Domínio do SIRA (ex.: sira.bemosistemas.com.br — já apontando para o IP desta VPS): " DOM
  [ -n "$DOM" ] || { echo "ERRO: informe o domínio."; exit 1; }
  umask 077; { echo "SIRA_DOMINIO=$DOM"; echo "SIRA_SEGREDO=$(hex)"; } > .env
  echo ">> .env criado. FAÇA UMA CÓPIA do SIRA_SEGREDO em lugar seguro: sem ele as chaves de IA cadastradas não podem ser lidas de novo."
fi
set -a; . ./.env; set +a
docker compose up -d --build
for i in $(seq 1 40); do docker compose exec -T cerebro node -e "1" >/dev/null 2>&1 && break; sleep 1; done

if [ "${1:-}" = "--novo-cliente" ] || ! docker compose exec -T cerebro sh -c 'test -s /dados/clientes.json' 2>/dev/null; then
  read -rp "Nome da prefeitura (ex.: Prefeitura de Santa Luzia): " NOME
  SLUG="$(slugfy "$NOME")"; [ -n "$SLUG" ] || SLUG="cliente-$(date +%s)"
  TOKEN="$(hex)"
  docker compose exec -T cerebro node criar_cliente.js "$SLUG" "$NOME" "$TOKEN" >/dev/null
  echo; echo "== Cliente criado: $NOME ($SLUG) =="
  echo "TOKEN DO CONECTOR (guarde; é usado na instalação do conector na prefeitura): $TOKEN"
  read -rp "Criar o administrador BeMo (super) para este cliente? [S/n] " R
  if [ "${R:-S}" != "n" ] && [ "${R:-S}" != "N" ]; then
    SN="$(senha)"
    docker compose exec -T cerebro node criar_usuario.js "$SLUG" bemo "BeMo Sistemas" "$SN" super trocar >/dev/null
    echo "Administrador BeMo: usuário bemo   senha provisória: $SN   (o SIRA pede para trocar no primeiro acesso)"
  fi
fi
echo; echo "Pronto: https://$SIRA_DOMINIO   (o certificado HTTPS é emitido na primeira visita; pode levar alguns segundos)"
echo "Endereço do cérebro para o conector: wss://$SIRA_DOMINIO/conector"
echo "Logs: docker compose logs -f   |   Backup: ./backup_cerebro.sh"
