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

## Dicas

- Se começar a falhar, atualize o yt-dlp: `pip install -U yt-dlp`
  (o Instagram muda com frequência).
- A qualidade máxima é a que o Instagram guarda (normalmente 1080x1920).
  Nada acima disso existe para baixar.
- Baixe apenas conteúdo seu ou que você tem permissão para usar.
