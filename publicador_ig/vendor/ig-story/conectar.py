#!/usr/bin/env python3
"""Conecta UMA conta no app, via navegador no servidor (OAuth do Instagram).

Reaproveita o login por cookie e o navegador do aceitar_convite.py. O app passa,
na pasta temporária:
  - cookies/<user>.txt : o combo (Login:Pass|UserAgent|TechData|Cookie)
  - oauth_url.txt      : a URL de autorização do OAuth (gerada pelo app, com state)
  - redirect_prefix.txt: o começo do redirect_uri (para capturar o ?code=)
  - proxy.txt          : o IP da conta (opcional, recomendado)

Abre a URL do OAuth logado pelo cookie, clica a sequência de telas até "Permitir"
e captura o `code` que a Meta devolve no redirect. Imprime:
  ✔ <nome>: CODE=<code>     (sucesso — o app troca o code pelo token)
  ⏭ <nome>: ...             (2FA/verificação)
  ✘ <nome>: <motivo>
"""
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))

from playwright.sync_api import sync_playwright  # noqa: E402

# Reaproveita exatamente os helpers do aceitar_convite.py.
from aceitar_convite import (  # noqa: E402
    PASTA,
    URL_HOME,
    parse_combo,
    cookies_para_browser,
    ler_proxy,
    clicar_texto,
    esta_logado,
    pagina_contem,
    textos_clicaveis,
    iniciar_display,
    arquivo_da_conta,
)

TXT_AGORA_NAO = ["Agora não", "Not now", "Not Now"]
TXT_2FA = ["código de segurança", "security code", "autenticação de dois fatores",
           "two-factor", "insira o código", "enter the code", "confirme que é você",
           "confirm it's you", "verificação"]

# Telas após abrir o OAuth logado, na ordem. "opcional" pode não aparecer.
PASSOS = [
    {"nome": "Mudar", "textos": ["Mudar", "Mudar para conta profissional", "Switch",
        "Change", "Update", "Switch now", "Switch to professional account",
        "Switch to professional", "Change account type"], "opcional": True},
    {"nome": "Criador de conteúdo", "textos": ["Criador de conteúdo", "Criador", "Creator",
        "Content creator"], "opcional": True},
    {"nome": "Avançar", "textos": ["Avançar", "Próximo", "Next"], "opcional": True},
    {"nome": "Avançar (2)", "textos": ["Avançar", "Próximo", "Next"], "opcional": True},
    {"nome": "Blog pessoal", "textos": ["Blog pessoal", "Personal blog"], "opcional": True},
    {"nome": "Concluir", "textos": ["Concluir", "Concluído", "Done", "Finish", "Complete"],
        "opcional": True},
    {"nome": "Continuar", "textos": ["Continuar", "Continue"], "opcional": True},
    {"nome": "Concluir (2)", "textos": ["Concluir", "Concluído", "Done", "Finish"],
        "opcional": True},
    # A tela final: "... está solicitando acesso a: ... Permitir".
    {"nome": "Permitir", "textos": ["Permitir", "Allow", "Allow access", "Authorize",
        "Autorizar"], "obrigatorio": True},
]


def ler(nome_arquivo):
    p = PASTA / nome_arquivo
    return (p.read_text(encoding="utf-8-sig").strip() if p.exists() else "")


def capturar_code(page, redirect_prefix, timeout_ms=20000):
    """Espera o redirect para o redirect_uri e tira o ?code= dele. Não deixa o
    navegador seguir até o callback (o browser não está logado no app)."""
    achado = {"code": None}

    def ver(url):
        if redirect_prefix and url.startswith(redirect_prefix):
            qs = parse_qs(urlsplit(url).query)
            if qs.get("code"):
                achado["code"] = qs["code"][0]

    # Intercepta a navegação para o redirect_uri e captura o code.
    def on_request(req):
        ver(req.url)

    page.on("request", on_request)
    fim = time.time() + timeout_ms / 1000
    while time.time() < fim and not achado["code"]:
        ver(page.url)
        page.wait_for_timeout(300)
    return achado["code"]


def ir(page, url, tentativas=2):
    """Navega tolerando lentidão (proxy residencial + Chromium em servidor fraco).
    Não trava no domcontentloaded: assim que a navegação 'commita', segue. Em
    timeout, tenta de novo. Devolve True se pelo menos carregou algo da URL."""
    erro = None
    for _ in range(tentativas):
        try:
            page.goto(url, wait_until="commit", timeout=90000)
            page.wait_for_timeout(4000)  # deixa o JS da página renderizar um pouco
            return True
        except Exception as e:
            erro = e
            page.wait_for_timeout(2000)
    # Mesmo em timeout, pode ter carregado parte: vale seguir se saiu da about:blank.
    try:
        if page.url and page.url != "about:blank":
            return True
    except Exception:
        pass
    raise erro if erro else RuntimeError("navegação falhou")


def conectar(page, nome, oauth_url, redirect_prefix):
    # 1) Aquece: abre o instagram.com com o cookie e confirma o login AQUI (onde
    #    dá para ver os ícones de home/perfil). A tela do OAuth não tem esses
    #    ícones, então checar login nela dava falso "não logado".
    ir(page, URL_HOME)
    clicar_texto(page, TXT_AGORA_NAO, timeout_ms=2500)  # fecha pop-ups "Agora não"
    if not esta_logado(page):
        if pagina_contem(page, TXT_2FA):
            return ("2fa", "pediu 2FA/verificação ao abrir o Instagram")
        return (
            "erro",
            f"o cookie não logou na web (url={page.url[:80]}). "
            "O combo precisa de sessionid + csrftoken + ds_user_id no cookie.",
        )

    # 2) Já logado: abre a URL do OAuth.
    ir(page, oauth_url)

    # Às vezes o code volta na hora (app já autorizado antes): tenta capturar já.
    code = capturar_code(page, redirect_prefix, timeout_ms=2500)
    if code:
        return ("ok", code)

    # Percorre a sequência de telas até o Permitir.
    for passo in PASSOS:
        if pagina_contem(page, TXT_2FA):
            return ("2fa", "pediu 2FA/verificação no meio do fluxo")
        clicou = clicar_texto(page, passo["textos"], timeout_ms=6000 if passo.get("obrigatorio") else 3500)
        if clicou:
            page.wait_for_timeout(1500)
            code = capturar_code(page, redirect_prefix, timeout_ms=2500)
            if code:
                return ("ok", code)
        elif passo.get("obrigatorio"):
            botoes = " | ".join(textos_clicaveis(page))
            return ("erro", f"não achei o botão '{passo['nome']}'. Botões na tela: {botoes}")

    # Depois do Permitir, dá um tempo para o redirect sair.
    code = capturar_code(page, redirect_prefix, timeout_ms=15000)
    if code:
        return ("ok", code)
    return ("erro", f"cliquei tudo mas não veio o code (url={page.url[:80]})")


def main():
    arq = arquivo_da_conta()
    if not arq:
        print("✘ nenhuma conta informada")
        return 1
    cookie, ua = parse_combo(arq.read_text(encoding="utf-8-sig").strip())
    if not cookie or "sessionid=" not in cookie.lower():
        print("✘ o combo não tem cookie (sessionid) — conectar exige o combo completo")
        return 1

    oauth_url = ler("oauth_url.txt")
    redirect_prefix = ler("redirect_prefix.txt")
    if not oauth_url:
        print("✘ falta a oauth_url.txt (URL de autorização)")
        return 1

    nome = arq.stem
    proxy = ler_proxy()
    display = iniciar_display()
    headful = display is not None
    estado, info = ("erro", "falha desconhecida")
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=not headful,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
                proxy=proxy,
            )
            ctx = browser.new_context(user_agent=ua or None, locale="pt-BR")
            ctx.add_cookies(cookies_para_browser(cookie))
            page = ctx.new_page()
            try:
                estado, info = conectar(page, nome, oauth_url, redirect_prefix)
            finally:
                try:
                    ctx.close()
                    browser.close()
                except Exception:
                    pass
    except Exception as e:
        msg = f"{type(e).__name__}: {str(e)[:160]}"
        if "Timeout" in type(e).__name__ or "timeout" in str(e).lower():
            dica = " — página não carregou (proxy lento/fora do ar?). Teste o proxy ou tente sem ele." if proxy else " — página não carregou."
            msg += dica
        estado, info = ("erro", f"navegador falhou ({msg})")
    finally:
        if display:
            try:
                display.stop()
            except Exception:
                pass

    if estado == "ok":
        print(f"✔ {nome}: CODE={info}")
        return 0
    if estado == "2fa":
        print(f"⏭ {nome}: {info}")
        return 0
    print(f"✘ {nome}: {info} | modo={'headful' if headful else 'headless'}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
