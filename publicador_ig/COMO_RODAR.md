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

## Baixar Reels para a biblioteca

Na tela **Biblioteca** há o bloco **Importar Reels do Instagram**: cole um ou
vários links (um por linha) e o servidor baixa com `yt-dlp`, valida e salva como
asset, pronto para reaproveitar em qualquer post.

- **Conteúdo que exige login** (a maioria dos Reels): clique em **Configurar
  cookie**, exporte o `cookies.txt` da sua conta com a extensão *Get cookies.txt
  LOCALLY* e cole ali. Fica cifrado no banco (AES-256-GCM), como os tokens.
- Use uma **conta secundária** no cookie e não baixe centenas de uma vez: baixar
  rápido demais pode gerar limite temporário **na conta do cookie** (não afeta as
  contas conectadas, que publicam por outro caminho).
- Baixe apenas conteúdo que você tem direito de usar. A ferramenta não remove
  marca d'água nem contorna bloqueio: é download direto do arquivo.

Em desenvolvimento, instale o `yt-dlp` na máquina (`pipx install yt-dlp` ou o
binário do projeto) e tenha o `ffmpeg` no PATH. No Docker já vem na imagem.

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
