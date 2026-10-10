# Downloader de Reels do Instagram (melhor qualidade)

Baixa Reels pegando a **melhor faixa de vídeo + melhor faixa de áudio** que o
Instagram oferece e junta num `.mp4` **sem recodificar** (sem perda nenhuma).

## Instalação

1. Python 3.9+
2. `pip install -U -r requirements.txt`
3. ffmpeg instalado e no PATH
   - Windows: `winget install ffmpeg`
   - macOS: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg`

## Uso

```bash
# um ou vários reels
python3 baixar_reels.py https://www.instagram.com/reel/XXXXXXXXX/

# vários de um arquivo (um link por linha)
python3 baixar_reels.py -a links.txt

# escolher pasta, salvar legenda e capa
python3 baixar_reels.py URL -o ~/Videos/reels --legenda --capa

# reel privado / Instagram pedindo login: usa os cookies do navegador logado
python3 baixar_reels.py URL --cookies-from-browser chrome

# ver todas as qualidades disponíveis sem baixar
python3 baixar_reels.py URL --listar
```

Os arquivos saem como `usuario_IDDOREEL.mp4` na pasta `reels/`.

## Baixar todos os Reels de uma conta

```bash
python3 baixar_conta.py nome_da_conta --cookies cookies.txt
python3 baixar_conta.py nome_da_conta --cookies cookies.txt --limite 20   # só os 20 mais recentes
```

O Instagram só mostra a lista de reels de um perfil para quem está logado, por
isso precisa do `cookies.txt` (exporte com a extensão "Get cookies.txt LOCALLY"
estando logado no instagram.com). Os vídeos vão para `reels_<conta>/` com o nome
`DATA_ID.mp4`. Rodando de novo, só baixa os reels novos.

## Pelo navegador (sem instalar nada)

Se o Instagram bloquear o Colab/servidor (erro 429), use `baixar_reels_navegador.js`:
abra o instagram.com logado no Chrome, F12 → Console, cole o código e aperte Enter.
Ele pede o nome da conta e baixa os reels para a pasta Downloads, escolhendo a
versão de maior resolução com vídeo+áudio.

## Dicas

- Se começar a falhar, atualize o yt-dlp: `pip install -U yt-dlp`
  (o Instagram muda com frequência).
- A qualidade máxima é a que o Instagram guarda (normalmente 1080x1920).
  Nada acima disso existe para baixar.
- Baixe apenas conteúdo seu ou que você tem permissão para usar.
