#!/usr/bin/env bash
# SIRA — ponto de entrada único. Uso: ./sira.sh COMANDO
set -euo pipefail
R="$(cd "$(dirname "$0")" && pwd)"
case "${1:-ajuda}" in
  teste)         exec "$R/teste_local/subir_teste.sh" ;;                 # laboratório com banco fictício (http://localhost:3210)
  teste-parar)   shift; exec "$R/teste_local/parar_teste.sh" "$@" ;;      # --apagar recomeça do zero
  copia-esus)    shift; exec "$R/teste_local/testar_no_esus_local.sh" "$@" ;;   # CONTAINER [BANCO] [USUARIO] [--recriar]
  instalar)      exec "$R/instalar.sh" ;;                                 # servidor da prefeitura (modo direto)
  views)         shift; exec "$R/banco_real/instalar_views_esus.sh" "$@" ;;     # --rede IP PORTA BANCO ADMIN | --docker CT BANCO
  permissoes)    shift; cd "$R" && docker compose exec -T sira node /app/conector/src/gerar_permissoes.js "$@" ;;   # --banco NOME [--usuario] [--ip] [--cns-cpf] > arquivo.sql
  desfazer-views) shift; exec "$R/banco_real/desinstalar_views_esus.sh" "$@" ;;
  parar)         cd "$R" && docker compose down ;;
  logs)          cd "$R" && docker compose logs -f --tail=100 ;;
  backup)        cd "$R" && d="$R/backups"; mkdir -p "$d"; a="$d/sira_dados_$(date +%Y%m%d_%H%M%S).tar.gz"; docker compose exec -T sira tar czf - -C /dados . > "$a"; chmod 600 "$a"; find "$d" -name 'sira_dados_*.tar.gz' -mtime +14 -delete; echo "Backup: $a" ;;
  *) cat <<'T'
SIRA — comandos
  ./sira.sh teste            sobe o laboratório com banco fictício (http://localhost:3210; gestor ou bemo / SIRA@2026)
  ./sira.sh teste-parar      para o laboratório (--apagar recomeça do zero)
  ./sira.sh copia-esus CONTAINER [BANCO] [USUARIO]   testa numa CÓPIA do seu e-SUS local
  ./sira.sh instalar         instala no servidor da prefeitura (modo direto)
  ./sira.sh permissoes --banco NOME > sira.sql      gera o script de permissões (usuário de leitura) para a TI rodar uma vez; ou use o botão na tela de Configurações
  ./sira.sh views --rede IP PORTA BANCO ADMIN        alternativa: instala as views (schema mcp) e o usuário sira_ro no banco
  ./sira.sh desfazer-views ...                       remove as views e o sira_ro
  ./sira.sh parar | logs | backup                    operação do servidor instalado
T
  ;;
esac
