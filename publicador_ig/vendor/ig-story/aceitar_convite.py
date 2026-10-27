#!/usr/bin/env python3
"""Aceita o convite do "Testador do Instagram" numa conta, via navegador headless.

Lê o combo (cookies/<user>.txt) para pegar o cookie (sessionid etc.) e o useragent,
e o proxy.txt. Entra logado pelo cookie (sem senha → sem 2FA), vai em
instagram.com/accounts/manage_access/ e clica em "Aceitar". Reproduz o fluxo do
perfil.js do projeto. Saída: ✔ / ⏭ / ✘ (uma linha).
"""
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

PASTA = Path(__file__).resolve().parent
PASTA_COOKIES = PASTA / "cookies"

URL_MANAGE = "https://www.instagram.com/accounts/manage_access/"
URL_EDIT = "https://www.instagram.com/accounts/edit/"
TXT_PERMISSOES = ["Permissões do site do app", "Website permissions", "App and website permissions"]
TXT_APPS = ["Apps e sites", "Apps and websites"]
TXT_CONVITES = ["Convites do testador", "Convites de testador", "Tester invites"]
TXT_ACEITAR = ["Aceitar", "Accept"]
TXT_REMOVER = ["Remover", "Remove"]
TXT_SEM = ["não tem convites", "nenhum convite", "no tester invites", "don't have any", "não tem nenhum"]
TXT_LOGIN = ["entrar", "log in", "página não está disponível", "isn't available", "faça login"]


def arquivo_da_conta():
    arqs = (
        sorted(f for f in PASTA_COOKIES.iterdir() if f.is_file())
        if PASTA_COOKIES.exists()
        else []
    )
    return arqs[0] if arqs else None


def parse_combo(texto):
    """Devolve (cookie_str, user_agent) do combo usuario:senha|UA|TechData|Cookie."""
    cookie = None
    ua = None
    if "|" in texto:
        campos = [c.strip() for c in texto.split("|")]
        for c in campos:
            if "sessionid=" in c.lower():
                cookie = c
                break
        if len(campos) >= 2 and "sessionid=" not in campos[1].lower():
            ua = campos[1]
    elif "sessionid=" in texto.lower():
        cookie = texto
    return (cookie, ua)


def cookies_para_browser(cookie_str):
    out = []
    for par in cookie_str.replace("\n", ";").split(";"):
        nome, _, valor = par.strip().partition("=")
        nome = nome.strip()
        valor = valor.strip()
        if nome and valor:
            out.append({"name": nome, "value": valor, "domain": ".instagram.com", "path": "/"})
    return out


def ler_proxy():
    p = PASTA / "proxy.txt"
    if not p.exists():
        return None
    linha = (p.read_text(encoding="utf-8-sig") or "").strip()
    if not linha:
        return None
    if "://" in linha:
        u = urlsplit(linha)
        proxy = {"server": f"{u.scheme}://{u.hostname}:{u.port}"}
        if u.username:
            proxy["username"] = u.username
            proxy["password"] = u.password or ""
        return proxy
    partes = linha.split(":")
    if len(partes) >= 4:
        return {
            "server": f"http://{partes[0]}:{partes[1]}",
            "username": partes[2],
            "password": ":".join(partes[3:]),
        }
    if len(partes) == 2:
        return {"server": f"http://{linha}"}
    return None


def pagina_contem(page, textos):
    try:
        body = (page.inner_text("body") or "").lower()
    except Exception:
        return False
    return any(t.lower() in body for t in textos)


def clicar_texto(page, textos, timeout_ms=10000):
    fim = time.time() + timeout_ms / 1000
    while time.time() < fim:
        clicou = False
        try:
            clicou = page.evaluate(
                """(textos) => {
                    const norm = s => (s||'').toLowerCase().replace(/\\s+/g,' ').trim();
                    const alvos = textos.map(norm);
                    const els = [...document.querySelectorAll('[role=button],button,a,div,span,label')];
                    const cand = els.filter(e => alvos.includes(norm(e.innerText))
                        && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0);
                    const inner = cand.filter(e => !cand.some(o => o !== e && e.contains(o)));
                    const el = inner[inner.length - 1];
                    if (el) { (el.closest('[role=button],button,a,label,[tabindex]') || el).click(); return true; }
                    return false;
                }""",
                textos,
            )
        except Exception:
            clicou = False
        if clicou:
            return True
        page.wait_for_timeout(300)
    return False


def aceitar(page, nome):
    page.goto(URL_MANAGE, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)

    if pagina_contem(page, TXT_LOGIN) and not pagina_contem(page, TXT_CONVITES + TXT_APPS):
        return f"✘ {nome}: não logou (cookie morto ou IP bloqueado)"

    # Alguns idiomas/layouts não mostram "Convites" direto: navega pelo Editar.
    if not pagina_contem(page, TXT_CONVITES):
        page.goto(URL_EDIT, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2000)
        if clicar_texto(page, TXT_PERMISSOES, 8000):
            page.wait_for_timeout(2000)
            clicar_texto(page, TXT_APPS, 8000)
            page.wait_for_timeout(2500)
        else:
            page.goto(URL_MANAGE, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2000)

    clicar_texto(page, TXT_CONVITES, 8000)
    page.wait_for_timeout(2500)

    tem_aceitar = pagina_contem(page, TXT_ACEITAR)
    tem_remover = pagina_contem(page, TXT_REMOVER)
    if tem_remover and not tem_aceitar:
        return f"⏭ {nome}: convite já estava aceito"

    aceitos = 0
    while aceitos < 20 and clicar_texto(page, TXT_ACEITAR, 2500 if aceitos == 0 else 1500):
        aceitos += 1
        page.wait_for_timeout(1500)

    if aceitos:
        return f"✔ {nome}: {aceitos} convite(s) do testador aceito(s)"
    if pagina_contem(page, TXT_SEM):
        return f"⏭ {nome}: nenhum convite do testador pendente"
    return f"✘ {nome}: não achei o botão Aceitar (convite não encontrado ou a tela mudou)"


def main():
    arq = arquivo_da_conta()
    if not arq:
        print("✘ nenhuma conta informada")
        return 1
    texto = arq.read_text(encoding="utf-8-sig").strip()
    cookie, ua = parse_combo(texto)
    if not cookie or "sessionid=" not in cookie.lower():
        print("✘ o combo não tem cookie (sessionid) — aceitar convite exige o combo completo")
        return 1

    nome = arq.stem
    proxy = ler_proxy()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
                proxy=proxy,
            )
            ctx = browser.new_context(user_agent=ua or None, locale="pt-BR")
            ctx.add_cookies(cookies_para_browser(cookie))
            page = ctx.new_page()
            try:
                resultado = aceitar(page, nome)
            finally:
                ctx.close()
                browser.close()
    except Exception as e:
        print(f"✘ {nome}: erro no navegador ({type(e).__name__}: {str(e)[:200]})")
        return 1

    print(resultado)
    return 0 if resultado[0] in "✔⏭" else 1


if __name__ == "__main__":
    sys.exit(main())
