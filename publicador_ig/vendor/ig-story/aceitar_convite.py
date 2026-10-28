#!/usr/bin/env python3
"""Aceita o convite do "Testador do Instagram" numa conta, via navegador headless.

Lê o combo (cookies/<user>.txt) para pegar o cookie (sessionid etc.) e o useragent,
e o proxy.txt. Entra logado pelo cookie (sem senha → sem 2FA), confirma o login,
vai em instagram.com/accounts/manage_access/ e clica em "Aceitar".
Em caso de falha, imprime um diagnóstico (URL, se logou, se achou os convites e
quais botões apareceram) para ajustar os seletores. Saída: ✔ / ⏭ / ✘ (1ª linha).
"""
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

PASTA = Path(__file__).resolve().parent
PASTA_COOKIES = PASTA / "cookies"

URL_HOME = "https://www.instagram.com/"
URL_MANAGE = "https://www.instagram.com/accounts/manage_access/"
URL_EDIT = "https://www.instagram.com/accounts/edit/"
TXT_PERMISSOES = ["Permissões do site do app", "Website permissions", "App and website permissions"]
TXT_APPS = ["Apps e sites", "Apps and websites"]
TXT_CONVITES = ["Convites do testador", "Convites de testador", "Tester invites"]
TXT_ACEITAR = ["Aceitar", "Accept"]
TXT_REMOVER = ["Remover", "Remove"]
TXT_SEM = ["não tem convites", "nenhum convite", "no tester invites", "don't have any", "não tem nenhum"]
TXT_ERRO = ["recarregar página", "recarregar pagina", "reload page", "algo deu errado", "something went wrong"]


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


def textos_clicaveis(page):
    """Lista curta de textos de botões/links visíveis — para o diagnóstico."""
    try:
        return page.evaluate(
            """() => {
                const norm = s => (s||'').replace(/\\s+/g,' ').trim();
                const els = [...document.querySelectorAll('[role=button],button,a,[role=radio],[role=tab]')];
                const vis = e => { const r = e.getBoundingClientRect(); return r.width>0 && r.height>0; };
                const txts = els.filter(vis).map(e => norm(e.innerText)).filter(t => t && t.length <= 40);
                return [...new Set(txts)].slice(0, 14);
            }"""
        )
    except Exception:
        return []


def esta_logado(page):
    """Logado se não caiu na tela de login e há marca de sessão (inbox/perfil)."""
    try:
        if "/accounts/login" in page.url:
            return False
        return page.evaluate(
            """() => {
                if (document.querySelector('input[name=\"password\"]')) return false;
                return !!document.querySelector('a[href*=\"/direct/\"], a[href=\"/\"][role=link], svg[aria-label=\"Página inicial\"], svg[aria-label=\"Home\"]')
                    || /\\/accounts\\/(manage_access|edit)/.test(location.pathname);
            }"""
        )
    except Exception:
        return False


def tela_de_erro(page):
    """A tela 'Algo deu errado — Recarregar página' do Instagram."""
    return pagina_contem(page, TXT_ERRO) and not pagina_contem(page, TXT_CONVITES)


def rolar(page):
    try:
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    except Exception:
        pass
    page.wait_for_timeout(800)


def clicar_texto(page, textos, timeout_ms=10000):
    fim = time.time() + timeout_ms / 1000
    while time.time() < fim:
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


def diagnostico(page, nome, motivo, logado):
    url = (page.url or "")[:80]
    convites = "sim" if pagina_contem(page, TXT_CONVITES) else "não"
    botoes = textos_clicaveis(page)
    return (
        f"✘ {nome}: {motivo} | url={url} | logado={'sim' if logado else 'não'} "
        f"| convites={convites} | botões: {botoes}"
    )


def aceitar(page, nome):
    # 1) Confirma o login primeiro, na home.
    page.goto(URL_HOME, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    logado = esta_logado(page)
    if not logado:
        return diagnostico(page, nome, "cookie não autenticou no navegador", False)

    # 2) Abre a tela dos apps/convites. O Instagram às vezes serve a tela de erro
    #    "Algo deu errado — Recarregar página"; nesse caso recarrega e tenta de novo.
    for tentativa in range(4):
        if tentativa == 0:
            page.goto(URL_MANAGE, wait_until="domcontentloaded", timeout=60000)
        else:
            try:
                page.reload(wait_until="domcontentloaded", timeout=60000)
            except Exception:
                page.goto(URL_MANAGE, wait_until="domcontentloaded", timeout=60000)
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
        page.wait_for_timeout(2500)
        rolar(page)
        if pagina_contem(page, TXT_CONVITES):
            break
        if not tela_de_erro(page):
            break  # carregou (sem erro), só não é a tela com "Convites" — tenta o Editar
        page.wait_for_timeout(2500)  # é a tela de erro: espera antes de recarregar

    # 3) Se não mostrar "Convites" direto, navega pelo Editar → Permissões → Apps e sites.
    if not pagina_contem(page, TXT_CONVITES):
        page.goto(URL_EDIT, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        if clicar_texto(page, TXT_PERMISSOES, 8000):
            page.wait_for_timeout(2000)
            clicar_texto(page, TXT_APPS, 8000)
            page.wait_for_timeout(2500)
        else:
            page.goto(URL_MANAGE, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2500)
        rolar(page)

    clicar_texto(page, TXT_CONVITES, 8000)
    page.wait_for_timeout(2500)
    rolar(page)

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
    return diagnostico(page, nome, "não achei o botão Aceitar", logado)


def iniciar_display():
    """Inicia uma tela virtual (Xvfb) para rodar o Chromium HEADFUL — que é o que
    o script do PC faz. Sem Xvfb (ou fora do servidor), devolve None e cai no
    headless. O Instagram serve a tela de erro para headless; headful passa."""
    try:
        from pyvirtualdisplay import Display

        d = Display(visible=False, size=(1280, 900))
        d.start()
        return d
    except Exception:
        return None


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
    display = iniciar_display()
    headful = display is not None
    resultado = None
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=not headful,  # headful na tela virtual quando há Xvfb
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
        print(f"✘ {nome}: erro no navegador ({type(e).__name__}: {str(e)[:200]}) | modo={'headful' if headful else 'headless'}")
        return 1
    finally:
        if display:
            try:
                display.stop()
            except Exception:
                pass

    # Anexa o modo ao diagnóstico de falha, para eu saber se rodou headful.
    if resultado and resultado[0] == "✘":
        resultado = f"{resultado} | modo={'headful' if headful else 'headless'}"
    print(resultado)
    return 0 if resultado and resultado[0] in "✔⏭" else 1


if __name__ == "__main__":
    sys.exit(main())
