#!/usr/bin/env python3
"""Aceita o convite de testador pelo instagrapi (sem navegador). TESTE.

Faz login como o preparar.py (mesma pasta: cookies/<user>.txt com o combo OU
contas.txt, proxy.txt e sessoes/) e chama o mesmo endpoint que o site chama ao
clicar em "Aceitar":

    POST https://www.instagram.com/api/v1/web/oauth/accept_platform_tester_invite/

O ID do app vem de app_id.txt (na pasta) ou do 1º argumento da linha de comando.

Tentativa 1: só com app_id + jazoest + csrftoken.
Tentativa 2 (se a 1 for recusada): abre a página manage_access pela mesma sessão,
pega o fb_dtsg do HTML e envia de novo.

Saída: uma linha começando com ✔ (aceito), ⏭ (2FA/verificação) ou ✘ (erro).
Não imprime cookies nem tokens.
"""
import re
import sys
from pathlib import Path

import requests

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))

from postar_story import (  # noqa: E402
    PASTA,
    PASTA_SESSOES,
    log,
    ler_texto,
    ler_proxy,
    login_por_cookie,
    login_por_senha,
)
from preparar import primeira_conta  # noqa: E402

URL_ACEITAR = "https://www.instagram.com/api/v1/web/oauth/accept_platform_tester_invite/"
URL_PAGINA = "https://www.instagram.com/accounts/manage_access/"
WEB_APP_ID = "936619743392459"  # x-ig-app-id fixo do site do Instagram
UA_WEB = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"
)


def ler_app_id():
    cli = sys.argv[1] if len(sys.argv) > 1 else ""
    if cli.strip().isdigit():
        return cli.strip()
    texto = (ler_texto(PASTA / "app_id.txt") or "").strip()
    return texto if texto.isdigit() else None


def sessao_web(cl):
    """Monta uma sessão HTTP 'de navegador' com os cookies da sessão do instagrapi."""
    s = requests.Session()
    s.headers.update({"user-agent": UA_WEB, "accept-language": "pt-BR,pt;q=0.9,en;q=0.8"})
    if cl.private.proxies:
        s.proxies.update(cl.private.proxies)

    for jar in (cl.private.cookies, cl.public.cookies):
        for c in jar:
            s.cookies.set(c.name, c.value, domain=".instagram.com")
    # Login por senha: o instagrapi guarda o sessionid no header Authorization, não no cookie.
    sessionid = getattr(cl, "sessionid", None)
    if sessionid:
        s.cookies.set("sessionid", sessionid, domain=".instagram.com")
    if cl.user_id:
        s.cookies.set("ds_user_id", str(cl.user_id), domain=".instagram.com")
    return s


def garantir_csrf(s):
    token = s.cookies.get("csrftoken", domain=".instagram.com") or s.cookies.get("csrftoken")
    if token:
        return token
    s.get("https://www.instagram.com/", timeout=30)
    return s.cookies.get("csrftoken")


def achar_fb_dtsg(html):
    for padrao in (
        r'"DTSGInitialData",\[\],\{"token":"([^"]+)"',
        r'"dtsg":\{"token":"([^"]+)"',
        r'name="fb_dtsg" value="([^"]+)"',
    ):
        m = re.search(padrao, html)
        if m:
            return m.group(1)
    return None


def jazoest(csrf):
    # Conferido na captura: jazoest = "2" + soma dos códigos dos caracteres do csrftoken.
    return "2" + str(sum(ord(c) for c in csrf))


def enviar(s, csrf, dados):
    r = s.post(
        URL_ACEITAR,
        data=dados,
        headers={
            "accept": "*/*",
            "content-type": "application/x-www-form-urlencoded",
            "origin": "https://www.instagram.com",
            "referer": URL_PAGINA,
            "x-csrftoken": csrf,
            "x-ig-app-id": WEB_APP_ID,
            "x-requested-with": "XMLHttpRequest",
            "x-asbd-id": "359341",
        },
        timeout=30,
        allow_redirects=False,
    )
    corpo = (r.text or "")[:300]
    try:
        ok = r.json().get("status") == "ok"
    except ValueError:
        ok = False
    return ok, r.status_code, corpo


def main():
    app_id = ler_app_id()
    if not app_id:
        print("✘ falta o ID do app (app_id.txt ou argumento)")
        return 1

    modo, nome, ref = primeira_conta()
    if not nome:
        print("✘ nenhuma conta informada")
        return 1
    proxy = ler_proxy()
    PASTA_SESSOES.mkdir(exist_ok=True)

    # ---- login (reusa a sessão salva; combo entra por cookie, sem 2FA) ----
    try:
        if modo == "cookie":
            arquivo_sessao = PASTA_SESSOES / f"{nome}.json"
            log(nome, "Entrando pelo cookie...")
            cl = login_por_cookie(nome, ref, proxy, arquivo_sessao)
        else:
            usuario, senha = ref
            arquivo_sessao = PASTA_SESSOES / f"senha_{usuario}.json"
            log(nome, "Entrando com usuário e senha...")
            cl = login_por_senha(nome, usuario, senha, proxy, arquivo_sessao)
        try:
            cl.get_timeline_feed()
        except Exception:
            pass
        cl.dump_settings(arquivo_sessao)
        log(nome, f"Logado como @{cl.username}" if cl.username else "Logado.")
    except Exception as e:
        msg = str(e) or type(e).__name__
        ml = msg.lower()
        if any(x in ml for x in ["2fa", "verifica", "checkpoint", "challenge", "two"]):
            print(f"⏭ {nome}: pediu 2FA/verificação")
            return 0
        print(f"✘ {nome}: não logou ({msg})")
        return 1

    # ---- aceita o convite ----
    try:
        s = sessao_web(cl)
        csrf = garantir_csrf(s)
        if not csrf:
            print(f"✘ {nome}: não consegui um csrftoken")
            return 1

        log(nome, "Aceitando o convite (tentativa 1: só app_id)...")
        ok, status, corpo = enviar(s, csrf, {"app_id": app_id, "jazoest": jazoest(csrf)})
        if ok:
            print(f"✔ {nome}: convite aceito (tentativa 1, sem fb_dtsg)")
            return 0
        log(nome, f"Tentativa 1 recusada (HTTP {status}): {corpo}")

        log(nome, "Tentativa 2: com fb_dtsg da página...")
        r = s.get(URL_PAGINA, timeout=30)
        token = achar_fb_dtsg(r.text)
        if not token:
            print(f"✘ {nome}: recusado e sem fb_dtsg na página (HTTP {status}: {corpo})")
            return 1
        csrf = s.cookies.get("csrftoken") or csrf
        ok, status2, corpo2 = enviar(
            s, csrf, {"app_id": app_id, "jazoest": jazoest(csrf), "fb_dtsg": token}
        )
        if ok:
            print(f"✔ {nome}: convite aceito (tentativa 2, com fb_dtsg)")
            return 0
        print(f"✘ {nome}: recusado (HTTP {status2}: {corpo2})")
        return 1
    except Exception as e:
        print(f"✘ {nome}: erro ao aceitar ({type(e).__name__}: {e})")
        return 1


if __name__ == "__main__":
    sys.exit(main())
