# Imagem única que roda tanto o painel quanto o worker.
# O comando de cada um é escolhido no docker-compose.
FROM node:22-slim AS base
# ffprobe/ffmpeg validam a mídia no upload (e o yt-dlp usa para remuxar).
# openssl é usado pela geração de segredos e pelo Prisma.
# curl baixa o yt-dlp.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
# yt-dlp: baixa os Reels na importação da biblioteca. Binário único (PyInstaller),
# sem dependência de Python. Deixe YTDLP_VERSION vazio para pegar a última versão
# (recomendado: o Instagram muda e a versão nova acompanha); fixe uma tag
# (ex.: 2025.09.05) se quiser um build reproduzível.
ARG YTDLP_VERSION=
RUN set -eux; \
  if [ -n "$YTDLP_VERSION" ]; then \
    url="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux"; \
  else \
    url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"; \
  fi; \
  curl -fsSL "$url" -o /usr/local/bin/yt-dlp; \
  chmod +x /usr/local/bin/yt-dlp; \
  /usr/local/bin/yt-dlp --version
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
