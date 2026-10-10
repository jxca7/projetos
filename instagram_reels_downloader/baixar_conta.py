#!/usr/bin/env python3
"""
Baixa TODOS os Reels de uma conta do Instagram na melhor qualidade.

- Lista os reels da conta pela API web do Instagram (a mesma que o site usa),
  com os cookies de uma conta logada.
- O yt-dlp baixa cada reel com o melhor video + melhor audio, sem recodificar.

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
    import requests
    import yt_dlp
except ImportError:
    sys.exit("Faltam dependencias. Instale com:  pip install -U yt-dlp requests")

from baixar_reels import opcoes_ytdlp

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")


class ErroInstagram(Exception):
    pass


def criar_sessao(caminho_cookies):
    jar = MozillaCookieJar(caminho_cookies)
    jar.load(ignore_discard=True, ignore_expires=True)
    s = requests.Session()
    for c in jar:
        if "instagram.com" in c.domain:
            s.cookies.set(c.name, c.value, domain=".instagram.com", path="/")
    nomes = s.cookies.keys()
    if "sessionid" not in nomes:
        raise ErroInstagram(
            "O cookies.txt nao tem o cookie 'sessionid' do Instagram "
            f"(cookies encontrados: {', '.join(nomes) or 'nenhum'}). Exporte o arquivo "
            "estando NA ABA do instagram.com e logado.")
    s.headers.update({
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "X-IG-App-ID": "936619743392459",
        "X-ASBD-ID": "129477",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRFToken": s.cookies.get("csrftoken", ""),
        "Origin": "https://www.instagram.com",
        "Referer": "https://www.instagram.com/",
    })
    return s


def pedir_json(s, metodo, url, **kw):
    r = s.request(metodo, url, allow_redirects=False, timeout=30, **kw)
    if r.status_code in (301, 302):
        destino = r.headers.get("Location", "")
        if "challenge" in destino:
            raise ErroInstagram("O Instagram pediu verificacao de seguranca. Abra o "
                                "instagram.com no navegador, confirme que foi voce, "
                                "exporte os cookies de novo e tente outra vez.")
        raise ErroInstagram("O Instagram nao aceitou o login dos cookies (redirecionou "
                            "para o login). Exporte o cookies.txt de novo logado.")
    if r.status_code == 429:
        raise ErroInstagram("Muitas requisicoes (429). Espere uns minutos e tente de novo.")
    try:
        dados = r.json()
    except ValueError:
        raise ErroInstagram(f"Resposta inesperada do Instagram (HTTP {r.status_code}). "
                            "Provavelmente os cookies expiraram: exporte de novo.")
    if dados.get("require_login") or dados.get("message") == "login_required":
        raise ErroInstagram("O Instagram nao aceitou o login dos cookies. Exporte de novo.")
    if r.status_code >= 400:
        raise ErroInstagram(f"Erro HTTP {r.status_code}: {dados.get('message', dados)}")
    return dados


def id_da_conta(s, conta):
    d = pedir_json(s, "GET", "https://www.instagram.com/api/v1/users/web_profile_info/",
                   params={"username": conta})
    user = (d.get("data") or {}).get("user")
    if not user:
        raise ErroInstagram(f"A conta @{conta} nao foi encontrada.")
    if user.get("is_private") and not user.get("followed_by_viewer"):
        raise ErroInstagram(f"A conta @{conta} e privada e voce nao a segue.")
    return user["id"]


def listar_reels(s, user_id, conta):
    """Gera os codigos de todos os reels da conta, do mais novo ao mais antigo."""
    max_id = ""
    while True:
        dados = {"target_user_id": user_id, "page_size": "12", "include_feed_video": "true"}
        if max_id:
            dados["max_id"] = max_id
        d = pedir_json(s, "POST", "https://www.instagram.com/api/v1/clips/user/", data=dados,
                       headers={"Referer": f"https://www.instagram.com/{conta}/reels/"})
        for item in d.get("items", []):
            codigo = (item.get("media") or {}).get("code")
            if codigo:
                yield codigo
        pag = d.get("paging_info") or {}
        max_id = pag.get("max_id")
        if not pag.get("more_available") or not max_id:
            return
        time.sleep(1.5)


def main():
    p = argparse.ArgumentParser(description="Baixa todos os Reels de uma conta do Instagram.")
    p.add_argument("conta", help="nome de usuario (com ou sem @) ou link do perfil")
    p.add_argument("--cookies", required=True, help="cookies.txt de uma conta logada no Instagram")
    p.add_argument("-o", "--saida", help="pasta de destino (padrao: ./reels_<conta>)")
    p.add_argument("--limite", type=int, help="baixar no maximo N reels (os mais recentes)")
    p.add_argument("--pausa", type=float, default=3,
                   help="segundos de pausa entre downloads, para evitar bloqueio (padrao: 3)")
    args = p.parse_args()

    conta = args.conta.strip().rstrip("/").split("/")[-1].lstrip("@").lower()
    saida = Path(args.saida or f"reels_{conta}").expanduser()
    saida.mkdir(parents=True, exist_ok=True)

    print(f"Listando reels de @{conta}...")
    codigos = []
    try:
        s = criar_sessao(args.cookies)
        for codigo in listar_reels(s, id_da_conta(s, conta), conta):
            codigos.append(codigo)
            if args.limite and len(codigos) >= args.limite:
                break
    except (ErroInstagram, requests.RequestException) as e:
        if not codigos:
            sys.exit(f"ERRO: {e}")
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
