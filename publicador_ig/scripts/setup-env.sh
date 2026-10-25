#!/usr/bin/env bash
# Gera um .env de desenvolvimento com os segredos já preenchidos.
# Não sobrescreve um .env existente.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo "Já existe um .env aqui. Apague ou renomeie antes de gerar outro."
  exit 1
fi

# AUTH_SECRET e a chave de cifragem (32 bytes em hex) geradas na hora.
AUTH_SECRET="$(openssl rand -base64 32)"
ENC_KEY="$(openssl rand -hex 32)"

cat > .env <<ENV
# ---- Banco / fila -------------------------------------------------------
DATABASE_URL="postgresql://postgres@127.0.0.1:5432/publicador_ig?schema=public"
REDIS_URL="redis://127.0.0.1:6379"

# ---- App ---------------------------------------------------------------
APP_URL="http://localhost:3000"
AUTH_SECRET="${AUTH_SECRET}"
# Cifra os tokens da Meta em repouso. GUARDE isto: se perder, toda conta
# conectada precisa reconectar.
APP_ENCRYPTION_KEY="${ENC_KEY}"

# ---- Meta / Instagram --------------------------------------------------
# "mock" roda tudo sem tocar na Meta. Troque para "graph" quando for publicar
# de verdade, depois de cadastrar os apps na tela Apps Meta.
META_DRIVER="mock"
META_GRAPH_VERSION="v23.0"
# Opcionais: fallback para quem usa UM app só. Com vários apps, as credenciais
# vêm da tela Apps Meta e estes ficam vazios.
META_APP_ID=""
META_APP_SECRET=""

# ---- Storage de mídia --------------------------------------------------
STORAGE_DRIVER="local"
STORAGE_LOCAL_DIR="./storage"
# A Meta baixa a mídia por HTTP público. Em dev com META_DRIVER=graph, aponte
# para um túnel (cloudflared/ngrok). Em mock, pode deixar como está.
PUBLIC_MEDIA_BASE_URL="http://localhost:3000/media"
S3_ENDPOINT=""
S3_REGION="auto"
S3_BUCKET=""
S3_ACCESS_KEY_ID=""
S3_SECRET_ACCESS_KEY=""
ENV

echo ".env criado com AUTH_SECRET e APP_ENCRYPTION_KEY gerados."
echo "Modo atual: META_DRIVER=mock (nada vai para a Meta ainda)."
