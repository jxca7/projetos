#!/usr/bin/env python3
"""
Downloader de Reels do Instagram na melhor qualidade disponivel.

Usa o yt-dlp para pegar a melhor faixa de video + a melhor faixa de audio
(o Instagram serve em DASH, separadas) e o ffmpeg para juntar num .mp4,
sem recodificar (zero perda de qualidade).

Uso:
    python3 baixar_reels.py URL [URL ...]
    python3 baixar_reels.py -a links.txt
    python3 baixar_reels.py URL --cookies-from-browser chrome
    python3 baixar_reels.py URL --cookies cookies.txt -o ~/Videos/reels
"""
import argparse
import shutil
import sys
from pathlib import Path

try:
    import yt_dlp
except ImportError:
    sys.exit("Falta o yt-dlp. Instale com:  pip install -U yt-dlp")


# Ordem de preferencia: maior resolucao, maior bitrate, depois codec.
# Se nao houver DASH separado, cai para o melhor arquivo unico.
FORMATO = "bestvideo*+bestaudio/best"
ORDENACAO = ["res", "fps", "tbr", "vbr", "abr", "vcodec:avc1", "acodec:aac"]


def opcoes_ytdlp(saida):
    """Opcoes do yt-dlp para baixar na melhor qualidade, sem recodificar."""
    return {
        "format": FORMATO,
        "format_sort": ORDENACAO,
        "merge_output_format": "mp4",
        # remux (copia os streams) — nao recodifica, nao perde qualidade
        "postprocessors": [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}],
        "outtmpl": str(Path(saida) / "%(uploader_id,uploader)s_%(id)s.%(ext)s"),
        "restrictfilenames": True,
        "windowsfilenames": True,
        "retries": 10,
        "fragment_retries": 10,
        "concurrent_fragment_downloads": 4,
        "ignoreerrors": True,
        "noplaylist": False,
    }


def ler_links(caminho):
    linhas = Path(caminho).read_text(encoding="utf-8").splitlines()
    return [l.strip() for l in linhas if l.strip() and not l.strip().startswith("#")]


def main():
    p = argparse.ArgumentParser(description="Baixa Reels do Instagram na melhor qualidade.")
    p.add_argument("urls", nargs="*", help="links dos reels (instagram.com/reel/...)")
    p.add_argument("-a", "--arquivo", help="arquivo .txt com um link por linha")
    p.add_argument("-o", "--saida", default="reels", help="pasta de destino (padrao: ./reels)")
    p.add_argument("--cookies", help="arquivo cookies.txt (formato Netscape) de uma conta logada")
    p.add_argument("--cookies-from-browser", metavar="NAVEGADOR",
                   help="ler cookies do navegador: chrome, firefox, edge, brave, safari...")
    p.add_argument("--legenda", action="store_true", help="salvar tambem a legenda/descricao em .txt")
    p.add_argument("--capa", action="store_true", help="salvar tambem a capa (thumbnail)")
    p.add_argument("--listar", action="store_true", help="so listar os formatos disponiveis, sem baixar")
    args = p.parse_args()

    urls = list(args.urls)
    if args.arquivo:
        urls += ler_links(args.arquivo)
    if not urls:
        p.error("informe pelo menos um link ou use -a links.txt")

    if not shutil.which("ffmpeg"):
        print("AVISO: ffmpeg nao encontrado. Sem ele nao da para juntar video+audio "
              "na melhor qualidade. Instale o ffmpeg.", file=sys.stderr)

    saida = Path(args.saida).expanduser()
    saida.mkdir(parents=True, exist_ok=True)

    opcoes = opcoes_ytdlp(saida)
    if args.cookies:
        opcoes["cookiefile"] = args.cookies
    if args.cookies_from_browser:
        opcoes["cookiesfrombrowser"] = (args.cookies_from_browser,)
    if args.legenda:
        opcoes["writedescription"] = True
    if args.capa:
        opcoes["writethumbnail"] = True
    if args.listar:
        opcoes["listformats"] = True

    with yt_dlp.YoutubeDL(opcoes) as ydl:
        erros = ydl.download(urls)

    if not args.listar:
        print(f"\nPronto. Arquivos em: {saida.resolve()}")
    if erros:
        print("Alguns links falharam. Se o reel for privado ou o Instagram pedir login, "
              "use --cookies-from-browser chrome (estando logado no navegador).",
              file=sys.stderr)
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(main())
