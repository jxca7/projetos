# Publicador IG

Plataforma de agendamento e publicação em **múltiplas contas profissionais do Instagram**
pela **API oficial da Meta** (Instagram Content Publishing API).

Serve para quem administra várias contas legítimas — agências, redes de franquia, gestores
de tráfego, grupos com várias marcas — e precisa publicar Reels, feed, carrossel e Stories
em todas elas com agendamento, legenda por conta, métricas e controle de falha.

## O que isto é e o que não é

**Faz**, porque a API oficial permite:

- Publicar Reels, posts de feed, carrossel e Stories em contas Business/Creator que o
  usuário conecta via OAuth e nas quais tem permissão de Página.
- Agendar, distribuir no tempo entre contas, repetir o que falhou.
- Ler métricas (alcance, views, curtidas, comentários, salvos, compartilhamentos).
- Respeitar a cota de publicação de 24h de cada conta, lida da própria API.

**Não faz**, porque a API oficial não permite e porque fazer por fora queima a conta:

- Criar contas do Instagram.
- Seguir, curtir, comentar ou enviar direct de forma automatizada.
- Inserir link sticker, enquete ou menção em Stories. A Meta descarta esses elementos em
  Stories publicados por API. A plataforma publica o Story e cria uma **pendência** com o
  link pronto, para a pessoa adicionar no app enquanto o Story está no ar. É o mesmo
  caminho que Later, Agorapulse e Publer usam — não existe outro por via oficial.
- Publicar em contas de terceiros sem o dono autorizar pelo OAuth.

## Stack

| Camada | Escolha |
| --- | --- |
| App | Next.js 15 (App Router), React 19, TypeScript, Tailwind v4 |
| Banco | PostgreSQL + Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Fila | BullMQ + Redis |
| Auth | Auth.js v5 (credenciais; OAuth da Meta é separado, para conectar contas) |
| Mídia | Driver local (dev) ou S3/R2 (produção) |
| Validação | ffprobe + regras de especificação do Instagram |

## Rodando local

Pré-requisitos: Node 22+, PostgreSQL, Redis, ffmpeg/ffprobe.

```bash
pnpm install
cp .env.example .env          # preencha os valores (veja abaixo)
pnpm db:migrate               # cria o schema
pnpm fixtures                 # gera mídia de teste com ffmpeg
pnpm seed                     # usuário, workspace, contas simuladas e um post
pnpm worker                   # em um terminal: processa a fila
pnpm dev                      # em outro: sobe o painel em :3000
```

Login do seed: `dono@exemplo.com` / `senha-de-teste-123`.

Com `META_DRIVER=mock` nada vai para o Instagram: contas, publicação, cota e falhas são
simuladas, inclusive o processamento assíncrono do vídeo. Dá para percorrer o produto
inteiro antes de ter o app aprovado.

### Variáveis de ambiente

| Variável | Para que serve |
| --- | --- |
| `DATABASE_URL` | Postgres |
| `REDIS_URL` | Redis da fila |
| `APP_URL` | URL pública do painel; compõe o redirect do OAuth |
| `AUTH_SECRET` | Sessão do painel (`openssl rand -base64 32`) |
| `APP_ENCRYPTION_KEY` | 32 bytes em hex (`openssl rand -hex 32`). Cifra os tokens da Meta em repouso |
| `META_APP_ID` / `META_APP_SECRET` | App da Meta. Opcionais: só servem de fallback para quem usa um app único; com vários, as credenciais vêm da tela Apps Meta |
| `META_GRAPH_VERSION` | Versão da Graph API (ex.: `v23.0`). Suba junto com os deprecations da Meta |
| `META_DRIVER` | `mock` (simulado) ou `graph` (API real) |
| `STORAGE_DRIVER` | `local` ou `s3` |
| `PUBLIC_MEDIA_BASE_URL` | **A Meta baixa a mídia por HTTP público.** Em dev, aponte para um túnel |
| `MIN_SECONDS_BETWEEN_PUBLISHES` | Piso de intervalo entre publicações da mesma conta (padrão 300s) |

> **Atenção em desenvolvimento:** a Meta precisa alcançar `PUBLIC_MEDIA_BASE_URL` pela
> internet para baixar o arquivo. `localhost` não funciona com `META_DRIVER=graph`. Use
> cloudflared/ngrok e aponte a variável para o túnel.

## O que a Meta exige antes de publicar de verdade

**Você não precisa de App Review para publicar nas suas próprias contas.** Em
**modo de desenvolvimento**, o app publica normalmente nas contas que tiverem um
papel nele. App Review e Verificação do Negócio só passam a ser obrigatórios
quando *outras pessoas* forem conectar as contas delas no seu produto
(Advanced Access).

### Dois fluxos de login, e eles não se misturam

| | Instagram Login | Facebook Login |
| --- | --- | --- |
| Credencial | **Instagram App ID / Secret** | App ID / Chave Secreta do Facebook |
| Exige Página do Facebook | Não | Sim |
| Host da API | `graph.instagram.com` | `graph.facebook.com` |
| Permissões | `instagram_business_*` | `instagram_basic`, `pages_*`, … |
| Uma autorização traz | uma conta | todas as contas das suas Páginas |
| Token | 60 dias, **precisa renovar** | de Página, não expira |

Os nomes antigos de permissão foram descontinuados no fluxo do Instagram em
janeiro de 2025 — app que ainda manda `instagram_basic` ali não chama os
endpoints. Por isso o fluxo fica gravado em cada app e decide host, permissões
e driver.

No Instagram Login a plataforma renova os tokens sozinha, todo dia às 4h, com
10 dias de folga. **Se o worker ficar parado mais de 60 dias, as contas precisam
autorizar de novo** — não há como recuperar um token vencido.

### URLs que precisam estar salvas no app

A Meta compara caractere a caractere; qualquer diferença vira
`Invalid redirect_uri`. A tela **Apps Meta** mostra as três com botão de copiar:

- `{APP_URL}/api/meta/callback` — OAuth redirect URI
- `{APP_URL}/api/meta/deauthorize` — chamada quando alguém remove o app
- `{APP_URL}/api/meta/data-deletion` — chamada no pedido de exclusão de dados

Os dois últimos validam o `signed_request` (HMAC-SHA256 com o App Secret) contra
cada app cadastrado: só o secret certo valida, e é assim que se descobre qual app
enviou sem confiar em nada do corpo da requisição.

### Por que a plataforma suporta vários apps

Um app do Meta aceita no máximo **50 testers**. Como em modo de desenvolvimento só
quem tem papel no app consegue autorizar, esse número é o teto de contas por app —
com 93 contas, não cabe em um só. Cada app também tem o próprio balde de rate
limit, o que distribui o risco de estourar o limite de chamadas.

Os apps são cadastrados na tela **Apps Meta**, com o secret cifrado em repouso, e
um deles fica marcado como ativo (é o que assina as próximas conexões). **Cada
conta guarda qual app a conectou**: o `appsecret_proof` é um HMAC do secret
daquele app, então assinar com o secret de outro faz a Meta recusar todas as
chamadas daquela conta. Por isso apagar um app marca as contas dele para
reconectar, em vez de deixá-las falhando com um erro de token sem causa aparente.

Quem roda com um app só pode continuar usando `META_APP_ID` e `META_APP_SECRET`
no `.env`: eles são o fallback quando não há nenhum app cadastrado, e assumem o
fluxo do Facebook.

## Arquitetura da publicação

Um **Post** é o conteúdo. Um **PostTarget** é a publicação daquele conteúdo numa conta.
Cada target vira um job na fila, com horário próprio.

```
agendar → QUEUED → CREATING_CONTAINER → WAITING_CONTAINER → PUBLISHING → PUBLISHED
                         ↘ erro permanente/tentativas esgotadas ↘ FAILED
```

Decisões que importam:

- **O estado vive no banco, não no payload do job.** Um worker que morre no meio retoma de
  onde parou e não republica o que já foi publicado.
- **A transição para `PUBLISHING` é atômica** (`updateMany` condicional). É isso que impede
  dois workers publicarem o mesmo container.
- **O retry é decidido pela classe do erro da Meta**, não pelo retry genérico da fila:
  token revogado para a conta inteira; cota cheia reagenda sem gastar tentativa; formato de
  vídeo inválido falha na primeira. Ver `src/lib/meta/errors.ts`.
- **A cota de 24h é lida da API** (`content_publishing_limit`), não fixada no código. A Meta
  já mudou esse teto mais de uma vez (25 → 50 → 100 conforme a conta).
- **Intervalo mínimo entre publicações da mesma conta**, com reserva no Redis. Publicar em
  várias contas no mesmo segundo é exatamente o padrão que o Instagram trata como automação
  coordenada — o espaçamento é um piso técnico do produto, não uma preferência.
- **A mídia é validada localmente com ffprobe** antes de qualquer chamada: duração,
  proporção, codec, tamanho, limite de legenda e de hashtags. Erro aparece no upload, em
  português, em vez de um código `2207057` vinte minutos depois — e não gasta cota da conta.
- **O container da Meta expira em 24h** e é recriado quando necessário.

## Escala: pastas, saúde e contas off

Com dezenas de contas o gargalo deixa de ser a API e passa a ser a tela.

- **Pastas de contas.** Cada conta fica em no máximo uma pasta. No compositor,
  um clique na pasta marca ou desmarca o grupo inteiro, e a busca por `@` filtra
  a lista. A lista de Contas renderiza em blocos de 30 — jogar 100 contas de uma
  vez deixa a página com dezenas de milhares de pixels e trava a rolagem no celular.
- **Saúde das contas** (`/saude`): fila ao vivo com em execução, publicados na
  última hora, pendentes, atrasados e com erro, recarregando sozinha a cada 90s.
  Os erros das últimas 24h vêm agrupados por código, porque código repetido é
  problema sistêmico, não azar. A lista mostra só exceção — conta fora do ar ou
  com cota alta — e não o inventário inteiro.
- **Atrasados** tem significado preciso: destino cujo horário passou e que **não**
  tem retry marcado. Reagendamento por cota ou rate limit é a fila esperando de
  propósito, não atraso. Se esse número sobe, quase sempre o worker não está rodando.
- **Contas off** (`/contas-off`): separa token vencido, acesso revogado e desligada
  aqui no painel, porque a ação é diferente em cada caso. Só o último volta por
  botão; os outros exigem passar pelo OAuth, e uma autorização só reconecta todas
  as contas que você marcar na tela da Meta.

## Scripts

```bash
pnpm dev          # painel em modo desenvolvimento
pnpm worker       # processador da fila (precisa rodar junto)
pnpm build        # build de produção
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm test         # testes unitários
pnpm test:falhas  # cenários de falha contra o banco
pnpm seed         # dados de exemplo
pnpm seed:escala  # ~93 contas em pastas, para testar a tela em escala real
pnpm status       # estado da fila e das cotas no terminal
```

### Testes

`tests/unit.test.ts` cobre a classificação de erro da Meta, o backoff, a cifragem dos
tokens e as regras de mídia e legenda. `tests/failure-paths.ts` roda contra o banco com
`MOCK_FORCE_ERROR` para exercitar cada caminho de falha:

```bash
MOCK_FORCE_ERROR=auth      pnpm tsx tests/failure-paths.ts   # token revogado
MOCK_FORCE_ERROR=quota     pnpm tsx tests/failure-paths.ts   # cota de 24h cheia
MOCK_FORCE_ERROR=permanent pnpm tsx tests/failure-paths.ts   # mídia recusada
MOCK_FORCE_ERROR=rate_limit pnpm tsx tests/failure-paths.ts  # limite de chamadas
```

## Deploy

O painel e o worker são dois processos sobre o mesmo código e o mesmo banco.

- Painel: qualquer host de Node (Vercel, Railway, Fly, VPS).
- Worker: `pnpm worker` como processo contínuo. **Sem ele a fila não anda.**
- Postgres e Redis gerenciados.
- Mídia em S3/R2 com leitura pública: a Meta precisa baixar o arquivo.

Antes de subir: troque `AUTH_SECRET` e `APP_ENCRYPTION_KEY`. Perder a chave de cifragem
significa que todos os tokens guardados viram ilegíveis e cada conta precisa reconectar.

## Limites reais que o produto respeita

| Item | Limite |
| --- | --- |
| Publicações por conta | Janela deslizante de 24h, valor lido da API |
| Legenda | 2.200 caracteres |
| Hashtags | 30 por post |
| Carrossel | 2 a 10 itens |
| Reel | MP4/MOV, H.264 + AAC, 3s a 15min, até 1 GB |
| Imagem de feed | JPEG/PNG, até 8 MB, de 4:5 a 1.91:1 |
| Story | Até 60s; **sem link sticker por API** |
