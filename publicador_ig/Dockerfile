# Imagem única que roda tanto o painel quanto o worker.
# O comando de cada um é escolhido no docker-compose.
FROM node:22-slim AS base
# ffprobe/ffmpeg validam a mídia no upload antes de enviar à Meta.
# openssl é usado pela geração de segredos e pelo Prisma.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
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
# Gera o client do Prisma e compila o painel.
RUN pnpm exec prisma generate && pnpm build

# ---- Runtime ----
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
# Padrão: o painel. O worker sobrescreve o command no compose.
CMD ["pnpm", "start"]
