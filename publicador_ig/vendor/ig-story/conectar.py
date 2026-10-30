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
import re
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
TXT_ENTRAR = ["Entrar", "Log in", "Log In"]
URL_LOGIN = "https://www.instagram.com/accounts/login/"
# Aprovar o login novo ("Foi você?") para a sessão virar confiável para o OAuth.
TXT_FOI_VOCE = ["Foi você", "Sim, fui eu", "Fui eu", "Sim", "It was me",
                "This was me", "Yes, it was me", "Was me", "Confirmar"]
TXT_NOTIF_LOGIN = ["Novo login", "nova tentativa de login", "Tentativa de login",
                   "New login", "login attempt", "entrou na sua conta", "Verifique"]
# Marcas da TELA DE LOGIN (não logado): se aparecem, o cookie não valeu na web.
TXT_LOGIN = ["Esqueceu a senha", "Forgot password", "Criar nova conta",
             "Create new account", "Telefone, nome de usuário", "Phone number, username"]
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


def esperar_decisao(page, timeout_ms=20000):
    """Espera a home decidir entre LOGIN e LOGADO (a página carrega devagar pelo
    proxy). Devolve 'login', 'logado' ou 'incerto'."""
    fim = time.time() + timeout_ms / 1000
    while time.time() < fim:
        # Campo de senha/usuário na tela = login (sinal mais forte que texto).
        if tem_form_login(page) or pagina_contem(page, TXT_LOGIN):
            return "login"
        if pagina_contem(page, TXT_2FA):
            return "2fa"
        # "logado" só se houver marca forte E nenhum form de login.
        if esta_logado(page) and not tem_form_login(page):
            return "logado"
        page.wait_for_timeout(800)
    if tem_form_login(page):
        return "login"
    return "logado" if esta_logado(page) else "incerto"


def tem_form_login(page):
    """Há um campo de usuário/senha visível? (sinal direto de tela de login)."""
    try:
        return bool(
            page.evaluate(
                """() => {
                    const sel = 'input[name="username"],input[name="email"],input[name="password"],input[type="password"]';
                    return [...document.querySelectorAll(sel)].some(e => {
                        const r = e.getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                    });
                }"""
            )
        )
    except Exception:
        return False


def _achar_campo_login(page, timeout_ms=30000):
    """Espera o campo de usuário aparecer; se for a landing só com 'Entrar',
    clica e espera de novo; recarrega uma vez se preciso."""
    seletor = 'input[name="username"], input[name="email"], input[autocomplete="username"]'
    fim = time.time() + timeout_ms / 1000
    recarregou = False
    while time.time() < fim:
        if tem_form_login(page):
            try:
                page.wait_for_selector(seletor, timeout=4000)
                return True
            except Exception:
                pass
        # Landing só com "Entrar": clica para abrir o formulário.
        clicar_texto(page, TXT_ENTRAR, timeout_ms=2500)
        page.wait_for_timeout(1500)
        if not recarregou and time.time() + 8 > fim:
            try:
                page.reload(wait_until="commit", timeout=60000)
            except Exception:
                pass
            recarregou = True
    return tem_form_login(page)


def clicar_real(page, textos, timeout_ms=5000):
    """Clique REAL (mouse de verdade) num botão/elemento com um dos textos — o
    React do IG não reage ao .click() sintético do DOM."""
    padrao = "|".join(re.escape(t) for t in textos)
    rx = re.compile(rf"^\s*({padrao})\s*$", re.I)
    tentativas = [
        lambda: page.get_by_role("button", name=rx).first.click(timeout=timeout_ms),
        lambda: page.get_by_role("radio", name=rx).first.click(timeout=timeout_ms),
        lambda: page.get_by_text(rx).first.click(timeout=timeout_ms),
    ]
    for t in tentativas:
        try:
            t()
            return True
        except Exception:
            continue
    return False


def clicar_entrar_real(page):
    return clicar_real(page, ["Entrar", "Log in", "Log In"])


def login_senha(page, usuario, senha):
    """Preenche a tela de login do Instagram com usuário e senha."""
    sel_user = 'input[name="username"], input[name="email"], input[autocomplete="username"]'
    sel_pass = 'input[name="password"], input[type="password"]'
    diag = []
    try:
        ir(page, URL_LOGIN)
        if not _achar_campo_login(page):
            return "sem-campo"
        # DIGITA caractere a caractere (o React do IG ignora valor setado via fill):
        page.click(sel_user)
        page.type(sel_user, usuario, delay=60)
        page.click(sel_pass)
        page.type(sel_pass, senha, delay=60)
        page.wait_for_timeout(300)
        # Reforço: força o React a registrar o valor (setter nativo + evento input).
        # Sem isso, o valor aparece no campo mas o IG trata como vazio e não loga.
        page.evaluate(
            """(s) => {
                const set = (el, v) => {
                    if (!el) return;
                    const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                    d.set.call(el, v);
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                };
                set(document.querySelector(s.u), s.uv);
                set(document.querySelector(s.p), s.pv);
            }""",
            {"u": sel_user, "p": sel_pass, "uv": usuario, "pv": senha},
        )
        page.wait_for_timeout(600)
        # Lê de volta o que ficou nos campos (confirma que a digitação pegou).
        vals = page.evaluate(
            """(s) => {
                const u = document.querySelector(s.u);
                const p = document.querySelector(s.p);
                const btn = document.querySelector('button[type=submit]');
                return { uLen: u ? (u.value||'').length : -1, pLen: p ? (p.value||'').length : -1,
                         btnDisabled: btn ? !!btn.disabled : null };
            }""",
            {"u": sel_user, "p": sel_pass},
        )
        diag.append(f"user={vals['uLen']}ch pass={vals['pLen']}ch btnOff={vals['btnDisabled']}")
    except Exception as e:
        return f"erro-preencher({type(e).__name__})"
    # Envia com CLIQUE REAL do Playwright no botão "Entrar" (o .click() sintético
    # do DOM não dispara o React do IG). Fallback: Enter no campo de senha.
    clicar_entrar_real(page)
    page.wait_for_timeout(3000)
    if tem_form_login(page):
        try:
            page.focus(sel_pass)
            page.keyboard.press("Enter")
        except Exception:
            pass
    # Espera o form SUMIR (entrou) ou dar erro/2FA.
    fim = time.time() + 25
    while time.time() < fim:
        if not tem_form_login(page):
            break
        if pagina_contem(page, TXT_2FA):
            break
        page.wait_for_timeout(1000)
    return "ok[" + ";".join(diag) + "]"


def erro_de_login(page):
    """Mensagem de erro do IG na tela de login (senha errada etc.), se houver."""
    marcas = ["senha estava incorreta", "password was incorrect", "incorrect password",
              "não foi possível encontrar", "couldn't find an account", "tente novamente mais tarde",
              "try again later", "suspeita", "suspicious", "ação bloqueada", "action blocked"]
    try:
        body = (page.inner_text("body") or "").lower()
    except Exception:
        return None
    for m in marcas:
        if m in body:
            return m
    return None


def aprovar_login(page):
    """Aprova o login novo ('Foi você?') para a sessão virar confiável no OAuth.
    Tenta o prompt inline, e depois pelas notificações (o coração)."""
    # 1) Prompt inline, que às vezes aparece direto após logar.
    for _ in range(2):
        if clicar_real(page, TXT_FOI_VOCE, timeout_ms=3500):
            page.wait_for_timeout(2000)
            return "inline"
        page.wait_for_timeout(1500)
    # 2) Notificações (coração): abre e procura a notificação de login.
    try:
        clicar_real(page, ["Notificações", "Notifications", "Atividade", "Activity"], timeout_ms=3000)
        page.wait_for_timeout(2000)
        clicar_real(page, TXT_NOTIF_LOGIN, timeout_ms=3500)
        page.wait_for_timeout(1500)
        if clicar_real(page, TXT_FOI_VOCE, timeout_ms=3500):
            page.wait_for_timeout(2000)
            return "notif"
    except Exception:
        pass
    return "nada"


def esperar_liberar(page, timeout_ms=60000):
    """Na sessão A: espera a verificação liberar depois que B aprovou. Clica
    'Continuar'/'OK' se aparecer. Devolve True se ficou logado."""
    fim = time.time() + timeout_ms / 1000
    while time.time() < fim:
        clicar_real(page, ["Continuar", "Continue", "OK", "Entendi", "Dispensar"], timeout_ms=1500)
        if not tem_form_login(page) and esta_logado(page):
            return True
        page.wait_for_timeout(2500)
    return not tem_form_login(page) and esta_logado(page)


def conectar(browser, nome, oauth_url, redirect_prefix, usuario, senha, cookie, ua, make_ctx):
    """Duas sessões: A (login+senha) dispara a verificação; B (cookie) aprova
    "Foi você"; A destrava e faz o OAuth. make_ctx() cria um contexto novo."""
    tr = []
    if not usuario or not senha:
        return ("erro", "sem usuário:senha para o login", None)

    # --- Sessão A: login por usuário e senha (dispara o pedido de verificação) ---
    ctxA = make_ctx()
    pageA = ctxA.new_page()
    diagA = login_senha(pageA, usuario, senha)
    clicar_real(pageA, TXT_AGORA_NAO, timeout_ms=2500)
    estadoA = esperar_decisao(pageA)
    tr.append(f"A:login={diagA}->{estadoA}")

    # Se A já logou direto (sem pedir verificação), nem precisa aprovar.
    if estadoA != "logado":
        # --- Sessão B: cookie aprova a notificação "Foi você" ---
        if cookie:
            ctxB = make_ctx()
            ctxB.add_cookies(cookies_para_browser(cookie))
            pageB = ctxB.new_page()
            ir(pageB, URL_HOME)
            clicar_real(pageB, TXT_AGORA_NAO, timeout_ms=2500)
            aprov = aprovar_login(pageB)
            tr.append(f"B:aprovar={aprov}")
            try:
                pageB.screenshot(path=str(PASTA / "aprovar.png"))
            except Exception:
                pass
            try:
                ctxB.close()
            except Exception:
                pass
        else:
            tr.append("B:sem-cookie")

        # --- Volta à A: espera a verificação liberar após a aprovação ---
        liberou = esperar_liberar(pageA)
        tr.append(f"A:pos={'logado' if liberou else 'preso'}")
        if not liberou:
            return ("erro", f"a verificação não liberou após aprovar [{' '.join(tr)}]", pageA)

    page = pageA  # daqui pra frente o fluxo do OAuth é na sessão A, já logada.

    # Abre a URL do OAuth.
    ir(page, oauth_url)
    page.wait_for_timeout(2000)
    if pagina_contem(page, TXT_LOGIN) or tem_form_login(page):
        return ("erro", f"OAuth voltou pro login [{' '.join(tr)}]", page)

    # Às vezes o code volta na hora (app já autorizado antes): tenta capturar já.
    code = capturar_code(page, redirect_prefix, timeout_ms=2500)
    if code:
        return ("ok", code, page)

    # Percorre a sequência de telas até o Permitir (clique REAL, por causa do React).
    for passo in PASSOS:
        if pagina_contem(page, TXT_2FA):
            return ("2fa", "pediu 2FA/verificação no meio do fluxo", page)
        clicou = clicar_real(page, passo["textos"], timeout_ms=6000 if passo.get("obrigatorio") else 3500)
        if clicou:
            page.wait_for_timeout(1500)
            code = capturar_code(page, redirect_prefix, timeout_ms=2500)
            if code:
                return ("ok", code, page)
        elif passo.get("obrigatorio"):
            botoes = " | ".join(textos_clicaveis(page))
            return ("erro", f"não achei o botão '{passo['nome']}'. Botões: {botoes} [{' '.join(tr)}]", page)

    # Depois do Permitir, dá um tempo para o redirect sair.
    code = capturar_code(page, redirect_prefix, timeout_ms=15000)
    if code:
        return ("ok", code, page)
    return ("erro", f"cliquei tudo mas não veio o code (url={page.url[:80]}) [{' '.join(tr)}]", page)


def parse_user_pass(texto):
    """Pega (usuario, senha) do 1º campo do combo (Login:Pass|UA|TechData|Cookie)."""
    campo0 = texto.split("|", 1)[0].strip()
    if ":" in campo0:
        u, _, p = campo0.partition(":")
        return (u.strip().lstrip("@"), p.strip())
    return (None, None)


def main():
    arq = arquivo_da_conta()
    if not arq:
        print("✘ nenhuma conta informada")
        return 1
    texto = arq.read_text(encoding="utf-8-sig").strip()
    cookie, ua = parse_combo(texto)
    usuario, senha = parse_user_pass(texto)
    # Fluxo: loga pelo COOKIE (sem 2FA) e aprova a notificação de login; cai para
    # usuário:senha só se não houver cookie.
    if (not cookie or "sessionid=" not in cookie.lower()) and (not usuario or not senha):
        print("✘ o combo precisa do cookie (sessionid) ou de usuário:senha")
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
    cookie_ok = cookie if (cookie and "sessionid=" in cookie.lower()) else None
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=not headful,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
                proxy=proxy,
            )

            def make_ctx():
                return browser.new_context(user_agent=ua or None, locale="pt-BR")

            page = None
            try:
                estado, info, page = conectar(
                    browser, nome, oauth_url, redirect_prefix, usuario, senha, cookie_ok, ua, make_ctx
                )
            finally:
                # Na falha, salva um print da sessão A para a gente VER a tela.
                if estado != "ok" and page is not None:
                    try:
                        page.screenshot(path=str(PASTA / "erro.png"), full_page=False)
                    except Exception:
                        pass
                try:
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
