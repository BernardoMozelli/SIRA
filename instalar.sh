#!/usr/bin/env bash
# SIRA — instala o MODO DIRETO num servidor da rede interna da prefeitura (Docker).
# Depois de instalar, abra http://IP-DESTE-SERVIDOR:3200, entre e cadastre o banco em Configurações > Conexão com o banco de dados.
# Uso: ./instalar.sh
set -euo pipefail
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo "ERRO: instale o Docker neste servidor primeiro."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERRO: falta o plugin 'docker compose'."; exit 1; }
hex() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
senha() { head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16; }
slugfy() { echo "$1" | iconv -f utf8 -t ascii//TRANSLIT 2>/dev/null | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/^-*//; s/-*$//' | cut -c1-30; }
if [ ! -f .env ]; then
  read -rp "Porta para acessar o SIRA nesta rede [3200]: " P; P="${P:-3200}"
  umask 077; { echo "SIRA_PORTA=$P"; echo "SIRA_SEGREDO=$(hex)"; echo "SIRA_HTTP_INTERNO=1"; } > .env
  echo ">> .env criado. FAÇA UMA CÓPIA do SIRA_SEGREDO em lugar seguro: sem ele a senha do banco cadastrada não pode ser lida de novo."
fi
set -a; . ./.env; set +a
docker compose up -d --build
for i in $(seq 1 40); do docker compose exec -T sira node -e "1" >/dev/null 2>&1 && break; sleep 1; done
if ! docker compose exec -T sira sh -c 'test -s /dados/clientes.json' 2>/dev/null; then
  read -rp "Nome da prefeitura (ex.: Prefeitura de Santa Luzia): " NOME
  SLUG="$(slugfy "$NOME")"; [ -n "$SLUG" ] || SLUG="cliente-$(date +%s)"
  docker compose exec -T sira node criar_cliente.js "$SLUG" "$NOME" "$(hex)" >/dev/null
  echo; echo "== Cliente criado: $NOME =="
  for U in "admin|Administrador da Prefeitura|admin" "bemo|BeMo Sistemas|super"; do
    L="${U%%|*}"; R="${U#*|}"; N="${R%%|*}"; PAPEL="${R##*|}"; SN="$(senha)"
    docker compose exec -T sira node criar_usuario.js "$SLUG" "$L" "$N" "$SN" "$PAPEL" trocar >/dev/null
    echo "Usuário $L ($PAPEL)   senha provisória: $SN   (o SIRA pede para trocar no primeiro acesso)"
  done
fi
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo; echo "Pronto: http://${IP:-IP-DO-SERVIDOR}:${SIRA_PORTA}"
echo "Próximo passo: entre como 'admin' > Início > Configurações > Conexão com o banco de dados (servidor, porta, banco, usuário e senha) > Testar conexão > Salvar e conectar."
echo "Ainda não existe usuário de leitura no banco? Na mesma tela, o botão 'Gerar script para a TI' baixa o arquivo .sql que a TI executa uma única vez (nada é instalado no banco)."
echo "Logs: docker compose logs -f"
