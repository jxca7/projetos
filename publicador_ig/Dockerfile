# Imagem única que roda tanto o painel quanto o worker.
# O comando de cada um é escolhido no docker-compose.
FROM node:22-slim AS base
# ffprobe/ffmpeg validam a mídia no upload antes de enviar à Meta.
# openssl é usado pela geração de segredos e pelo Prisma.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
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
# Gera o client do Prisma e compila o painel.
RUN pnpm exec prisma generate && pnpm build

# ---- Runtime ----
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
# Padrão: o painel. O worker sobrescreve o command no compose.
CMD ["pnpm", "start"]
