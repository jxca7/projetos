# Downloader de Reels do Instagram (melhor qualidade)

`reels.py` baixa os **N reels mais recentes** de uma conta (ou links avulsos) na
**melhor qualidade que o Instagram tem**: pega a faixa de vídeo de maior
resolução/bitrate e a melhor faixa de áudio e junta com o ffmpeg **sem
recodificar** (zero perda). Também salva a legenda de cada reel em `.txt`.

## Instalar no Windows (PC ou VPS Windows)

1. Baixe o código: https://github.com/jxca7/projetos/archive/refs/heads/claude/instagram-reels-downloader-bkjo1e.zip
2. Extraia o zip e abra a pasta `instagram_reels_downloader`.
3. Dois cliques em **`instalar.bat`** (baixa Python e ffmpeg sozinho).
4. Coloque o `cookies.txt` nessa pasta (ou deixe em Downloads).
5. Dois cliques em **`baixar.bat`**: ele pergunta a conta e quantos reels.

## Instalar na VPS (Ubuntu/Debian)

```bash
git clone --depth 1 -b claude/instagram-reels-downloader-bkjo1e https://github.com/jxca7/projetos.git
cd projetos/instagram_reels_downloader
bash instalar.sh
```

Depois envie o `cookies.txt` (de uma conta logada) para essa pasta. Do seu PC:

```bash
scp cookies.txt root@IP_DA_VPS:~/projetos/instagram_reels_downloader/
```

## Usar

```bash
cd ~/projetos/instagram_reels_downloader
.venv/bin/python reels.py                         # pergunta a conta e a quantidade
.venv/bin/python reels.py nome_da_conta -n 10     # 10 mais recentes
.venv/bin/python reels.py nome_da_conta -n 0      # todos
.venv/bin/python reels.py nome_da_conta -n 10 --mais-vistos   # 10 mais visualizados
.venv/bin/python reels.py https://www.instagram.com/reel/XXXX/   # links avulsos
```

Opções: `-o PASTA`, `--cookies ARQUIVO`, `--proxy http://user:senha@host:porta`,
`--pausa SEGUNDOS` (padrão 4), `--sem-legenda`.

Os vídeos vão para `reels_<conta>/` como `conta_DATA_CODIGO.mp4`. Rodar de novo
só baixa o que falta (`baixados.txt`).

## Se o Instagram bloquear a VPS

IPs de datacenter costumam receber erro 429 / "login não aceito". Nesse caso use
um **proxy residencial** com `--proxy`, ou rode no seu PC, ou use
`baixar_reels_navegador.js` no console do Chrome (abra `instagram.com/CONTA/reels/`,
F12 → Console, cole e Enter).
