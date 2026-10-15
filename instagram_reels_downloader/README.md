# Downloader de Reels e Destaques do Instagram (melhor qualidade)

Baixa reels de uma conta (os mais recentes ou os mais visualizados) e os **destaques**
(cada destaque na sua pasta, com o nome dele), na **melhor
qualidade que o Instagram tem**: a faixa de vídeo de maior resolução + a melhor
faixa de áudio, juntadas com o ffmpeg **sem recodificar**. Salva a legenda em `.txt`.

## Organização da pasta

```
reels\
  baixar.bat          dois cliques para baixar
  atualizar.bat       baixa a versão mais nova
  instalar.bat        instala Python, ffmpeg e bibliotecas (só na primeira vez)
  cookies.txt         login do Instagram (você coloca)
  proxy.txt           opcional
  videos\<conta>\     os reels baixados
  videos\<conta>\destaques\<nome do destaque>\   fotos e videos de cada destaque
  sistema\            programa, Python, ffmpeg e histórico (não precisa mexer)
```

## Windows (PC ou VPS)

1. Baixe: https://github.com/jxca7/projetos/archive/refs/heads/claude/instagram-reels-downloader-bkjo1e.zip
2. Extraia e copie a pasta `instagram_reels_downloader` para um caminho curto, ex: `C:\reels`.
3. Dois cliques em **`instalar.bat`**.
4. Coloque o `cookies.txt` na pasta (junto do `baixar.bat`).
5. Dois cliques em **`baixar.bat`**: ele pergunta a conta e o que baixar (reels,
   destaques ou os dois). Nos reels: quantos e se quer os mais recentes ou os mais
   visualizados. Nos destaques: mostra a lista e você escolhe (Enter = todos, ou `1,3`).

## Linux (Ubuntu/Debian)

```bash
git clone --depth 1 -b claude/instagram-reels-downloader-bkjo1e https://github.com/jxca7/projetos.git
cd projetos/instagram_reels_downloader
bash sistema/instalar.sh
sistema/.venv/bin/python sistema/reels.py nome_da_conta -n 10
sistema/.venv/bin/python sistema/reels.py nome_da_conta -n 10 --mais-vistos
sistema/.venv/bin/python sistema/reels.py nome_da_conta --destaques
```

## Opções

`-n N` (0 = todos), `--mais-vistos`, `--destaques`, `--reels-e-destaques`,
`--quais-destaques 1,3`, `--analisar N` (com --mais-vistos: só entre os N
mais recentes), `--atualizar-lista`, `-o PASTA`, `--cookies ARQUIVO`,
`--proxy http://user:senha@host:porta` (ou arquivo `proxy.txt`), `--pausa SEGUNDOS`,
`--sem-legenda`. Links avulsos de reels também funcionam no lugar do nome da conta.

Rodar de novo só baixa o que falta. Se o Instagram bloquear (429), espere 1 hora.
