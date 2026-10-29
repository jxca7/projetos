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
    # Envia: Enter com o foco no campo de senha é o mais confiável (o IG não usa
    # button[type=submit]). Reforça com o clique no "Entrar" se ainda estiver lá.
    try:
        page.focus(sel_pass)
        page.keyboard.press("Enter")
    except Exception:
        pass
    page.wait_for_timeout(2500)
    if tem_form_login(page):
        clicar_texto(page, TXT_ENTRAR, timeout_ms=5000)
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


def conectar(page, nome, oauth_url, redirect_prefix, usuario, senha):
    tr = []  # trilha dos passos, para aparecer no erro
    # 1) Aquece: abre o instagram.com (o cookie pode já logar). Espera decidir.
    ir(page, URL_HOME)
    clicar_texto(page, TXT_AGORA_NAO, timeout_ms=2500)  # fecha pop-ups "Agora não"
    estado = esperar_decisao(page)
    tr.append(f"home={estado}")

    # 2) SEMPRE faz login por usuário e senha — o cookie não vale no navegador aqui,
    #    e o "logado" do aquecimento dá falso positivo com a página meio carregada.
    if usuario and senha:
        diag = login_senha(page, usuario, senha)
        clicar_texto(page, TXT_AGORA_NAO, timeout_ms=3000)  # "Salvar informações? Agora não"
        estado = esperar_decisao(page)
        tr.append(f"login={diag}->{estado}")

    if estado == "2fa":
        return ("2fa", f"pediu 2FA/verificação no login [{' '.join(tr)}]")
    if estado != "logado":
        if not usuario or not senha:
            return ("erro", f"não logou e sem usuário:senha [{' '.join(tr)}]")
        motivo = erro_de_login(page)
        extra = f" — Instagram: '{motivo}'" if motivo else ""
        return ("erro", f"não logou com usuário e senha{extra} [{' '.join(tr)}]")

    # 3) Já logado: abre a URL do OAuth.
    ir(page, oauth_url)
    page.wait_for_timeout(2000)
    # Se o OAuth AINDA mostra login, a sessão não ficou de pé.
    if pagina_contem(page, TXT_LOGIN):
        return ("erro", f"abri o OAuth mas voltou pro login (sessão não ficou logada) [{' '.join(tr)}]")

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
            return ("erro", f"não achei o botão '{passo['nome']}'. Botões: {botoes} [{' '.join(tr)}]")

    # Depois do Permitir, dá um tempo para o redirect sair.
    code = capturar_code(page, redirect_prefix, timeout_ms=15000)
    if code:
        return ("ok", code)
    return ("erro", f"cliquei tudo mas não veio o code (url={page.url[:80]})")


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
    _, ua = parse_combo(texto)  # cookie não usado aqui (login é por senha)
    usuario, senha = parse_user_pass(texto)
    # Conectar usa login por usuário e senha (o cookie não loga no navegador aqui).
    if not usuario or not senha:
        print("✘ o combo não tem usuário:senha (necessário para o login no navegador)")
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
            # NÃO injeta o cookie: ele cria um estado "meio-logado" que esconde o
            # formulário de login e trava a senha, mas é inválido pro OAuth.
            # Navegador limpo -> login por senha limpo -> sessão válida pro OAuth.
            ctx = browser.new_context(user_agent=ua or None, locale="pt-BR")
            page = ctx.new_page()
            try:
                estado, info = conectar(page, nome, oauth_url, redirect_prefix, usuario, senha)
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
