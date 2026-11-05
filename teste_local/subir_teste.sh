#!/usr/bin/env bash
# Sobe o SIRA completo para TESTE, sem tocar em nenhum e-SUS. Uso: ./subir_teste.sh   (PORTA=3300 ./subir_teste.sh para outra porta)
set -euo pipefail
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo "Instale o Docker primeiro."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Falta o plugin 'docker compose' (Ubuntu: sudo apt install docker-compose-v2)."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Sem acesso ao Docker. Tente com sudo, ou: sudo usermod -aG docker \$USER e abra um novo terminal."; exit 1; }
hex() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
[ -f .env ] || touch .env
grep -q '^SIRA_SEGREDO=.' .env || { sed -i '/^SIRA_SEGREDO=/d' .env; echo "SIRA_SEGREDO=$(hex)" >> .env; }
grep -q '^SIRA_TOKEN=.'   .env || { sed -i '/^SIRA_TOKEN=/d' .env;   echo "SIRA_TOKEN=$(hex)"   >> .env; }
chmod 600 .env; set -a; . ./.env; set +a
PORTA="${PORTA:-3210}"; export PORTA

echo "1/4 Subindo o banco de teste e o cérebro (a primeira vez demora: baixa e constrói as imagens)…"
docker compose up -d --build db cerebro
echo "2/4 Aguardando o banco ficar pronto (cria as tabelas, os dados fictícios e as views)…"
for i in $(seq 1 90); do [ "$(docker compose ps db --format '{{.Health}}' 2>/dev/null)" = "healthy" ] && break; sleep 2; done
echo "3/4 Cliente e usuários de teste no cérebro…"
for i in $(seq 1 30); do docker compose exec -T cerebro node -e "1" >/dev/null 2>&1 && break; sleep 1; done
docker compose exec -T cerebro node criar_cliente.js teste "Prefeitura de Teste" "$SIRA_TOKEN" >/dev/null 2>&1 || true
docker compose exec -T cerebro node criar_usuario.js teste gestor "Coordenadora Teste" "SIRA@2026" admin >/dev/null
docker compose exec -T cerebro node criar_usuario.js teste bemo "BeMo Sistemas (super)" "SIRA@2026" super >/dev/null
echo "4/4 Subindo o conector…"
docker compose --profile conector up -d --build conector
sleep 4

echo; echo "== Gabarito: o que foi criado de propósito no banco de teste =="
docker compose exec -T db psql -U postgres -d esus -c "SELECT pergunta, esperado FROM sira_gabarito ORDER BY 1" || true
echo "Pronto: http://localhost:$PORTA     usuário gestor / bemo     senha SIRA@2026"
echo "Teste no chat: 'quantas gestantes temos', 'gestantes sem pré-natal há mais de 60 dias', 'quantos hipertensos estão sem consulta há mais de 6 meses'"
echo "e compare com o gabarito acima (as linhas 'soma ao que já existia' = só o que foi criado; o banco de teste começa vazio)."
echo "Logs: docker compose logs -f conector   |   Parar: ./parar_teste.sh   |   Recomeçar do zero: ./parar_teste.sh --apagar"
