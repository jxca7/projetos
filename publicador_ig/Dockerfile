# Imagem única que roda tanto o painel quanto o worker.
# O comando de cada um é escolhido no docker-compose.
FROM node:22-slim AS base
# ffprobe/ffmpeg validam a mídia no upload e juntam as faixas dos Reels baixados.
# openssl é usado pela geração de segredos e pelo Prisma.
# python3 roda os motores em vendor/ (downloader de Reels e postador de story).
# fonts-dejavu-core: fonte que o postador de story usa para desenhar a figurinha.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ffmpeg openssl ca-certificates python3 python3-venv fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
# Dependências Python, num venv isolado (evita o PEP 668 do Debian).
# - curl_cffi conecta com a "cara" do Chrome (exigência do Instagram para a mídia).
# - instagrapi + Pillow postam o story com link e destaque pela API do app.
RUN python3 -m venv /opt/ig-dl \
  && /opt/ig-dl/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/ig-dl/bin/pip install --no-cache-dir \
       "curl_cffi>=0.7" "requests[socks]>=2.28" "instagrapi==3.0.25" "Pillow>=10"
# O worker encontra o interpretador e os scripts por estas variáveis.
ENV IG_DL_PYTHON=/opt/ig-dl/bin/python3 \
    IG_DL_SCRIPT=/app/vendor/ig-downloader/reels.py \
    IG_STORY_SCRIPT=/app/vendor/ig-story/postar_story.py
# Fixa a MESMA versão do pnpm que gerou o lockfile. Sem isto, o corepack baixa
# a versão que vier por padrão na imagem, que pode aplicar a trava de idade
# mínima de pacote (minimumReleaseAge) e recusar um lockfile legítimo.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# ---- Dependências (cacheadas enquanto o lockfile não muda) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
# Instala tudo (inclui tsx, que roda o worker e os scripts em produção).
RUN pnpm install --frozen-lockfile

# ---- Build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# O build do Next importa os módulos das rotas, e eles validam as variáveis de
# ambiente ao carregar (o cliente Prisma é criado no import). Como o .env não
# entra na imagem, estes valores de placeholder existem só para a validação
# passar durante o build. NÃO são segredos e NÃO vão para o container final:
# ficam nesta etapa de build, e em runtime o compose injeta os valores reais
# pelo env_file (.env.docker).
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
    AUTH_SECRET="placeholder-de-build-trocado-em-runtime" \
    APP_ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000"
# Gera o client do Prisma e compila o painel.
RUN pnpm exec prisma generate && pnpm build

# ---- Runtime ----
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
# Padrão: o painel. O worker sobrescreve o command no compose.
CMD ["pnpm", "start"]
