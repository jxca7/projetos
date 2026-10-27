# Como rodar o Publicador IG

Dois estágios: primeiro em **modo mock** (roda tudo na sua máquina sem tocar na
Meta — serve para ver o produto funcionando), depois em **modo real** com os
apps do Meta.

## Pré-requisitos

- **Node 22+** e **pnpm** (`npm install -g pnpm`)
- **PostgreSQL** e **Redis** rodando
- **ffmpeg/ffprobe** (valida a mídia antes de enviar; sem ele a validação de
  vídeo é mais fraca, mas o resto funciona)

No macOS com Homebrew:
```bash
brew install node pnpm postgresql@16 redis ffmpeg
brew services start postgresql@16
brew services start redis
createdb publicador_ig
```

No Ubuntu/Debian:
```bash
sudo apt install -y postgresql redis-server ffmpeg
sudo -u postgres createdb publicador_ig
# use uma DATABASE_URL com o usuário/senha do seu Postgres
```

## Estágio 1 — rodar em modo mock (10 minutos)

```bash
git clone https://github.com/jxca7/projetos.git
cd projetos/publicador_ig
git checkout claude/usar-100-dolares-no0meu

pnpm install
pnpm setup:env          # cria o .env com os segredos gerados
# confira a DATABASE_URL no .env se seu Postgres tem senha

pnpm db:migrate         # cria as tabelas
pnpm fixtures           # gera um vídeo e uma imagem de teste
pnpm seed               # usuário, workspace e contas simuladas
```

Agora abra **dois terminais**, os dois dentro de `publicador_ig`:

```bash
# terminal 1 — o worker, que processa a fila. SEM ELE nada publica.
pnpm worker

# terminal 2 — o painel
pnpm dev
```

Abra http://localhost:3000 e entre com:

- **e-mail:** `dono@exemplo.com`
- **senha:** `senha-de-teste-123`

Tudo o que você publicar aqui é simulado — nada vai para o Instagram. É só para
ver a fila, o agendamento, as métricas e a saúde funcionando de ponta a ponta.

Para a escala do seu caso (dezenas de contas em pastas), rode também:
```bash
pnpm seed:escala        # ~93 contas em pastas, com algumas fora do ar
```

## Estágio 2 — publicar de verdade

Precisa de três coisas além do estágio 1:

### a) Apps do Meta cadastrados
No painel, vá em **Apps Meta** e cadastre seus apps (Instagram App ID + Secret).
A tela mostra as URLs que você precisa colar no app da Meta e o passo a passo de
cada fluxo. Lembre: **50 contas por app** — distribua as suas entre eles.

### b) Mídia acessível pela internet
A Meta **baixa** o vídeo/imagem de uma URL pública. `localhost` não serve.

- **Em produção:** use S3/R2 com leitura pública. No `.env`, `STORAGE_DRIVER="s3"`,
  preencha as chaves S3 e aponte `PUBLIC_MEDIA_BASE_URL` para o bucket/CDN.
- **Para testar na sua máquina:** suba um túnel e aponte a URL para ele:
  ```bash
  cloudflared tunnel --url http://localhost:3000
  # pegue a URL https://... que ele imprime e ponha em:
  #   APP_URL="https://...."
  #   PUBLIC_MEDIA_BASE_URL="https://..../media"
  ```
  Essa URL também precisa ser a do redirect cadastrado no app da Meta.

### c) Ligar o modo real
No `.env`, troque:
```
META_DRIVER="graph"
```
Reinicie o `pnpm dev` e o `pnpm worker`. A partir daí, **Conectar Instagram** na
tela de Contas abre o OAuth de verdade.

## Baixar do Instagram para a biblioteca

Na tela **Biblioteca** há o bloco **Baixar do Instagram**, com o mesmo motor do
downloader do projeto (`vendor/ig-downloader/reels.py`), em duas abas:

- **Perfil inteiro**: a conta (@ ou link), o que baixar (reels, destaques ou os
  dois), quantos, a ordem (**mais recentes / mais visualizados / mais curtidos**),
  *analisar entre os N mais recentes*, **quais destaques** (ex.: `1,3` ou `2-4`),
  pausa entre downloads e *não salvar legenda*.
- **Links avulsos**: cole um ou vários links de Reel/post (um por linha).

Tudo é baixado na melhor qualidade, validado e salvo como asset (a legenda vem
junto, quando existe). Rodar de novo a mesma coisa não duplica: a biblioteca
reconhece o arquivo pelo checksum.

**Cookie (obrigatório).** O Instagram exige login para listar perfil e entregar a
mídia. Clique em **Configurar cookie**, exporte o `cookies.txt` da sua conta com a
extensão *Get cookies.txt LOCALLY* e cole ali — fica cifrado no banco
(AES-256-GCM), como os tokens. Use uma **conta secundária**: baixar rápido demais
pode gerar limite **na conta do cookie** (não afeta as contas que publicam, que
usam outro caminho). Baixe só conteúdo que você tem direito de usar.

Em desenvolvimento, tenha `python3`, `ffmpeg` e as libs do downloader
(`pip install curl_cffi "requests[socks]"`) no PATH. No Docker já vêm na imagem.

## Story com link e destaque (pelo app)

A API oficial da Meta **não** coloca figurinha de link no story nem adiciona ao
destaque. A tela **Story + link** faz isso pela API do app (motor
`vendor/ig-story/postar_story.py`, com instagrapi), logando com **usuário e senha
de cada conta**:

1. Escolha a imagem (JPG/PNG).
2. (Opcional) o **link** da figurinha e o texto dela.
3. (Opcional) o nome do **destaque** (cria se não existir).
4. (Opcional, recomendado) o **proxy** (`host:porta`, `host:porta:user:senha` ou
   `http://user:senha@host:porta`) — de preferência do mesmo país das contas.
5. Cole as contas em `usuario:senha`, uma por linha.
6. **Postar story**.

As senhas ficam **cifradas** no banco (AES-256-GCM). O worker posta **uma conta
por vez, espaçada**. Contas com 2FA/verificação são puladas (resolva no app e use
*Tentar de novo*). Em dev, precisa de `python3` + `pip install instagrapi Pillow`.

> Aviso honesto: isso roda sobre contas logadas por senha, fora da API oficial —
> use só nas suas contas e sem exagerar no volume, senão o Instagram limita a
> conta. Não misture essa automação com volume alto nas contas que publicam pela
> API oficial.

## Preparar conta (trocar foto e bio, pelo app)

A tela **Preparar conta** troca a **foto de perfil** e a **bio** pelo app
(instagrapi), no servidor — sem abrir navegador no seu PC. Você envia a foto
e/ou a bio, cola as contas (combo `usuario:senha | useragent | techdata | cookie`
ou só `usuario:senha`) e um proxy. Cada conta vai **uma de cada vez**, reusando a
mesma sessão salva do Story (combo com cookie entra sem 2FA). Status ao vivo por
conta, com "tentar de novo". A bio só muda a bio (preserva nome/link/contato).

Marcando **"aceitar o convite do testador também"**, o servidor abre um **navegador
headless** (Playwright/Chromium, na imagem Docker), entra pelo **cookie do combo**
(sem 2FA), vai em `instagram.com/accounts/manage_access/` e clica "Aceitar". Essa
ação **exige o combo** (precisa do cookie) e **proxy é recomendado** — é a parte
que sai do IP do servidor, mais sensível a bloqueio.

## Comandos úteis

```bash
pnpm status        # estado da fila e das cotas no terminal
pnpm test          # testes
pnpm db:studio     # abre o Prisma Studio para olhar o banco
```

## Deploy (quando for para o ar)

São **dois processos** sobre o mesmo código e banco:
- o painel (`pnpm build` depois `pnpm start`) — Vercel, Railway, Fly ou VPS
- o worker (`pnpm worker`) como processo contínuo — **sem ele a fila não anda**

Postgres e Redis gerenciados, mídia em S3/R2 público. Antes de subir, gere um
`AUTH_SECRET` e um `APP_ENCRYPTION_KEY` novos e **guarde a chave de cifragem** —
perdê-la torna ilegíveis todos os tokens guardados.
