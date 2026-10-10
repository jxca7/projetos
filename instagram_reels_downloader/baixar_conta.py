#!/usr/bin/env python3
"""
Baixa TODOS os Reels de uma conta do Instagram na melhor qualidade.

- O Instaloader lista os reels da conta (o yt-dlp nao lista perfis mais).
- O yt-dlp baixa cada reel com o melhor video + melhor audio, sem recodificar.

O Instagram exige login para listar os reels de um perfil, entao e preciso
um cookies.txt (formato Netscape) de uma conta logada.

Uso:
    python3 baixar_conta.py nome_da_conta --cookies cookies.txt
    python3 baixar_conta.py nome_da_conta --cookies cookies.txt --limite 20 -o pasta

Rodar de novo com a mesma pasta so baixa os reels novos (arquivo baixados.txt).
"""
import argparse
import sys
import time
from http.cookiejar import MozillaCookieJar
from pathlib import Path

try:
    import instaloader
    from instaloader.nodeiterator import NodeIterator
except ImportError:
    sys.exit("Falta o instaloader. Instale com:  pip install -U instaloader")
try:
    import yt_dlp
except ImportError:
    sys.exit("Falta o yt-dlp. Instale com:  pip install -U yt-dlp")

from baixar_reels import opcoes_ytdlp


def carregar_cookies(caminho):
    jar = MozillaCookieJar(caminho)
    jar.load(ignore_discard=True, ignore_expires=True)
    cookies = {c.name: c.value for c in jar if "instagram.com" in c.domain}
    if "sessionid" not in cookies:
        sys.exit("O cookies.txt nao tem 'sessionid' do instagram.com. "
                 "Exporte de novo estando logado no Instagram.")
    return cookies


def listar_reels(perfil):
    """Gera os shortcodes de todos os reels do perfil (do mais novo ao mais antigo).

    Mesma consulta do Profile.get_reels() do Instaloader, mas so pega o codigo
    de cada reel, sem uma requisicao extra por reel (menos chance de bloqueio).
    """
    perfil._obtain_metadata()
    return NodeIterator(
        context=perfil._context,
        edge_extractor=lambda d: d["data"]["xdt_api__v1__clips__user__connection_v2"],
        node_wrapper=lambda n: n["media"]["code"],
        query_variables={"data": {"page_size": 12, "include_feed_video": True,
                                  "target_user_id": str(perfil.userid)}},
        query_referer=f"https://www.instagram.com/{perfil.username}/",
        doc_id="7845543455542541",
        query_hash=None,
    )


def main():
    p = argparse.ArgumentParser(description="Baixa todos os Reels de uma conta do Instagram.")
    p.add_argument("conta", help="nome de usuario (com ou sem @) ou link do perfil")
    p.add_argument("--cookies", required=True, help="cookies.txt de uma conta logada no Instagram")
    p.add_argument("-o", "--saida", help="pasta de destino (padrao: ./reels_<conta>)")
    p.add_argument("--limite", type=int, help="baixar no maximo N reels (os mais recentes)")
    p.add_argument("--pausa", type=float, default=3,
                   help="segundos de pausa entre downloads, para evitar bloqueio (padrao: 3)")
    args = p.parse_args()

    conta = args.conta.strip().rstrip("/").split("/")[-1].lstrip("@")
    saida = Path(args.saida or f"reels_{conta}").expanduser()
    saida.mkdir(parents=True, exist_ok=True)

    L = instaloader.Instaloader(quiet=True)
    L.load_session("sessao", carregar_cookies(args.cookies))

    print(f"Listando reels de @{conta}...")
    codigos = []
    try:
        perfil = instaloader.Profile.from_username(L.context, conta)
        for codigo in listar_reels(perfil):
            codigos.append(codigo)
            if args.limite and len(codigos) >= args.limite:
                break
    except instaloader.exceptions.ProfileNotExistsException:
        sys.exit(f"A conta @{conta} nao existe.")
    except (instaloader.exceptions.LoginRequiredException,
            instaloader.exceptions.QueryReturnedForbiddenException):
        sys.exit("O Instagram recusou o acesso. Os cookies podem ter expirado "
                 "ou a conta e privada e voce nao a segue. Exporte o cookies.txt de novo.")
    except instaloader.exceptions.InstaloaderException as e:
        if not codigos:
            sys.exit(f"Erro ao listar os reels: {e}")
        print(f"Aviso: a listagem parou no meio ({e}). Baixando os {len(codigos)} encontrados.",
              file=sys.stderr)
    print(f"{len(codigos)} reels encontrados.")
    if not codigos:
        return 0

    opcoes = opcoes_ytdlp(saida)
    opcoes.update({
        "cookiefile": args.cookies,
        # lembra o que ja foi baixado: rodar de novo so pega os novos
        "download_archive": str(saida / "baixados.txt"),
        "outtmpl": str(saida / "%(upload_date)s_%(id)s.%(ext)s"),
    })

    falhas = 0
    with yt_dlp.YoutubeDL(opcoes) as ydl:
        for i, codigo in enumerate(codigos, 1):
            print(f"\n[{i}/{len(codigos)}] {codigo}")
            falhas += ydl.download([f"https://www.instagram.com/reel/{codigo}/"])
            if i < len(codigos):
                time.sleep(args.pausa)

    print(f"\nPronto. Arquivos em: {saida.resolve()}")
    if falhas:
        print(f"{falhas} reels falharam. Rode de novo para tentar so os que faltaram.",
              file=sys.stderr)
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
