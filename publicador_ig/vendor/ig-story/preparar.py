#!/usr/bin/env python3
"""Prepara UMA conta: troca a foto e/ou a bio pelo instagrapi.

Reaproveita o login/sessão/combo do postar_story.py (mesma pasta). O worker monta
uma pasta temporária com: o arquivo da conta (cookies/<user>.txt com o combo, OU
contas.txt com usuario:senha), foto.jpg (opcional), bio.txt (opcional),
proxy.txt (opcional) e sessoes/ (a sessão salva, para reusar e evitar 2FA).

Saída: uma linha começando com ✔ (ok), ⏭ (2FA/verificação) ou ✘ (erro).
"""
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))

# Reaproveita exatamente o login, a sessão e a leitura de combo/proxy do Story.
from postar_story import (  # noqa: E402
    PASTA,
    PASTA_COOKIES,
    PASTA_SESSOES,
    log,
    ler_texto,
    ler_proxy,
    login_por_cookie,
    login_por_senha,
)


def achar_foto():
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        p = PASTA / f"foto{ext}"
        if p.exists():
            return p
    return None


def primeira_conta():
    """Devolve (modo, nome, ref). modo 'cookie' -> ref é o arquivo; 'senha' -> (usuario, senha)."""
    arquivos = (
        sorted(f for f in PASTA_COOKIES.iterdir() if f.is_file())
        if PASTA_COOKIES.exists()
        else []
    )
    if arquivos:
        f = arquivos[0]
        return ("cookie", f.stem, f)
    for linha in (ler_texto(PASTA / "contas.txt") or "").splitlines():
        l = linha.strip()
        if l and not l.startswith("#") and ":" in l:
            i = l.index(":")
            usuario = l[:i].strip().lstrip("@")
            return ("senha", usuario, (usuario, l[i + 1 :].strip()))
    return (None, None, None)


def trocar_bio(cl, bio, nome):
    """Troca só a bio. Usa o método dedicado quando existe; senão, edita o perfil
    preservando os demais campos (lê os valores atuais antes de enviar)."""
    fn = getattr(cl, "account_set_biography", None)
    if fn:
        fn(bio)
        return
    info = cl.account_info()
    data = {
        "biography": bio,
        "external_url": getattr(info, "external_url", "") or "",
        "username": cl.username or nome,
        "full_name": getattr(info, "full_name", "") or "",
        "phone_number": getattr(info, "phone_number", "") or "",
        "email": getattr(info, "email", "") or "",
    }
    for metodo in ("account_edit_profile", "account_edit"):
        editar = getattr(cl, metodo, None)
        if editar:
            try:
                editar(data)
            except TypeError:
                editar(**data)
            return
    raise RuntimeError("esta versão do instagrapi não tem como editar a bio")


def main():
    foto = achar_foto()
    bio = ler_texto(PASTA / "bio.txt")
    bio = bio.strip() if bio else None
    if not foto and not bio:
        print("✘ nada para fazer: nem foto nem bio informadas")
        return 1

    proxy = ler_proxy()
    modo, nome, ref = primeira_conta()
    if not nome:
        print("✘ nenhuma conta informada")
        return 1

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
        # "Esquenta" e salva a sessão (o login por cookie não salva sozinho).
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

    # ---- aplica foto e/ou bio ----
    feitos = []
    erros = []
    if foto:
        try:
            cl.account_change_picture(foto)
            feitos.append("foto")
            log(nome, "Foto trocada.")
        except Exception as e:
            erros.append(f"foto: {e}")
            log(nome, f"Foto falhou: {e}")
    if bio:
        try:
            trocar_bio(cl, bio, nome)
            feitos.append("bio")
            log(nome, "Bio trocada.")
        except Exception as e:
            erros.append(f"bio: {e}")
            log(nome, f"Bio falhou: {e}")

    if feitos and not erros:
        print(f"✔ {nome}: {', '.join(feitos)} ok")
        return 0
    if feitos and erros:
        print(f"✔ {nome}: {', '.join(feitos)} ok; problema em {' | '.join(erros)}")
        return 0
    print(f"✘ {nome}: {' | '.join(erros) or 'nada aplicado'}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
