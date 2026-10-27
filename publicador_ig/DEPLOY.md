# Deploy — colocar no ar

A plataforma são **dois processos** sobre o mesmo banco: o painel e o worker.
O worker precisa rodar **o tempo todo** — é ele que dispara os posts agendados e
renova os tokens do Instagram. Por isso não dá para hospedar só numa plataforma
serverless (como a Vercel pura): algo tem que ficar ligado 24/7.

## Opção A — VPS com Docker (não depende de nenhum PaaS)

É o caminho mais robusto: uma máquina sua (Hetzner, Contabo, DigitalOcean ~€4–8/mês),
tudo num `docker compose up`. Se um PaaS sair do ar, não te afeta.

Na VPS, com Docker instalado:

```bash
git clone https://github.com/jxca7/projetos.git
cd projetos/publicador_ig
git checkout claude/usar-100-dolares-no0meu

cp .env.docker.example .env.docker
# gere os segredos e cole no .env.docker:
openssl rand -base64 32    # -> AUTH_SECRET
openssl rand -hex 32       # -> APP_ENCRYPTION_KEY
# preencha também POSTGRES_PASSWORD (e repita na DATABASE_URL), APP_URL,
# e os dados do app da Meta quando for publicar de verdade.

docker compose up -d --build
```

Sobe banco, fila, painel (porta 3000) e worker. As migrações rodam sozinhas antes.
A imagem já traz `ffmpeg`, `python3` e as libs dos motores em `vendor/`
(`curl_cffi`/`requests` para baixar Reels; `instagrapi`/`Pillow` para postar
story com link e destaque).

> Ao **atualizar** o código, rode de novo `docker compose up -d --build`: ele
> reconstrói a imagem e aplica as migrações pendentes antes de o painel subir.

```bash
docker compose logs -f web worker   # acompanhar
docker compose ps                   # ver o que está de pé
docker compose down                 # parar (os dados do banco ficam no volume)
```

### HTTPS já está incluso (Caddy)

O `docker compose` sobe um Caddy na frente que **emite e renova o certificado
HTTPS sozinho**. Para funcionar:

1. Aponte o seu domínio para o IP da VPS (um registro **A** no seu provedor de
   DNS).
2. No `.env.docker`, preencha `APP_DOMAIN="seu-dominio.com"` e
   `APP_URL="https://seu-dominio.com"`.
3. Deixe as portas **80 e 443** abertas na VPS.

Na primeira subida o Caddy pede o certificado à Let's Encrypt (leva alguns
segundos). Depois disso, `https://seu-dominio.com` já responde.

> Para testar **sem domínio** (na sua máquina), não use o Caddy: acesse o painel
> direto em `http://localhost:3000`. O Caddy só faz sentido com um domínio real.

### Falta uma coisa para escala: mídia pública

O driver `local` serve a mídia pelo próprio painel (atrás do Caddy, já em
`https`), o que funciona num VPS único. Em escala, troque para **Cloudflare R2**
(10 GB grátis, compatível com S3): `STORAGE_DRIVER="s3"`, preencha as chaves S3 e
aponte `PUBLIC_MEDIA_BASE_URL` para o bucket.

## Opção B — PaaS gerenciado (deploy pelo GitHub)

Mesma imagem Docker. O serviço precisa suportar **um processo web + um worker
em background + Postgres + Redis**. Render, Fly.io e Koyeb servem.

- **Web**: build pelo Dockerfile, comando `pnpm start`, porta 3000.
- **Worker**: mesmo Dockerfile/imagem, comando `pnpm worker`.
- **Migração**: rode `pnpm db:deploy` uma vez a cada deploy (num release step,
  ou manualmente).
- **Postgres e Redis**: gerenciados pelo próprio provedor; use as URLs deles em
  `DATABASE_URL` e `REDIS_URL`.
- **Mídia**: Cloudflare R2 ou o S3 do provedor.

## Criar o seu usuário (o banco começa vazio)

O painel não tem tela de cadastro, e em produção o banco sobe sem nenhum
usuário. Crie o primeiro acesso rodando, na pasta do projeto na VPS:

```bash
docker compose run --rm --no-deps \
  -e EMAIL="voce@exemplo.com" \
  -e SENHA="uma-senha-forte" \
  -e WORKSPACE="Minha Agência" \
  web pnpm tsx scripts/criar-usuario.ts
```

Rodar de novo com o mesmo e-mail só troca a senha — não duplica nada. Depois é
só entrar em `https://seu-dominio` com esse e-mail e senha.

## Antes de ir para o ar — checklist

- [ ] `AUTH_SECRET` e `APP_ENCRYPTION_KEY` novos e **guardados**. Perder a chave
      de cifragem torna ilegíveis todos os tokens guardados: toda conta
      precisaria reconectar.
- [ ] `META_DRIVER="graph"`.
- [ ] `APP_URL` no domínio `https` real.
- [ ] Mídia acessível por URL pública (R2/S3, ou o painel atrás de HTTPS).
- [ ] No app da Meta, as três URLs da tela **Apps Meta** cadastradas com o
      domínio de produção (OAuth redirect, desautorização, exclusão de dados).
- [ ] O worker está rodando (`docker compose ps` ou o painel de Saúde: se os
      "atrasados" sobem, o worker caiu).
