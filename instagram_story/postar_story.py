# Para cada arquivo de cookies em cookies/, entra na conta pelo sessionid e posta
# a imagem story.jpg como story, com a figurinha de link do link.txt.
# Os arquivos que deram certo vão para cookies/feitos/.

import json
import random
import shutil
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse

import logging

from instagrapi import Client
from instagrapi.types import StoryLink
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# A biblioteca imprime tracebacks enormes a cada tentativa; deixa só o essencial
logging.getLogger("instagrapi").setLevel(logging.CRITICAL)
logging.getLogger("public_request").setLevel(logging.CRITICAL)
logging.getLogger("private_request").setLevel(logging.CRITICAL)


class FalhaAposLogin(Exception):
    """O login deu certo, mas a ação (postar/destacar) foi recusada. NÃO é cookie morto."""

PASTA = Path(__file__).resolve().parent
PASTA_COOKIES = PASTA / "cookies"
PASTA_FEITOS = PASTA_COOKIES / "feitos"
PASTA_MORTOS = PASTA_COOKIES / "mortos"  # cookies desconectados/expirados
PASTA_SESSOES = PASTA / "sessoes"
EXT_FOTO = (".jpg", ".jpeg", ".png", ".webp")

# Intervalo PADRÃO entre contas que postaram com sucesso, em segundos (pode mudar no intervalo.txt)
INTERVALO_MIN = 30
INTERVALO_MAX = 90
# Espera curta depois de uma conta que falhou (2FA, cookie morto, erro): não precisa "descansar"
FALHA_MIN = 3
FALHA_MAX = 8

# Posição do centro da figurinha de link na tela (0 a 1). y=0.8 deixa ela mais para baixo.
LINK_X = 0.5
LINK_Y = 0.8

# Tamanho do story
LARGURA, ALTURA = 1080, 1920


def log(conta, msg):
    print(f"[{datetime.now():%H:%M:%S}] [{conta}] {msg}", flush=True)


def ler_texto(arquivo):
    if not arquivo.exists():
        return None
    return arquivo.read_text(encoding="utf-8-sig").strip()


def achar_imagem():
    for ext in EXT_FOTO:
        if (PASTA / f"story{ext}").exists():
            return PASTA / f"story{ext}"
    # O Windows às vezes esconde a extensão e vira story.jpg.jpg: pega qualquer imagem solta na pasta
    for f in sorted(PASTA.iterdir()):
        if f.is_file() and f.suffix.lower() in EXT_FOTO:
            return f
    return None


def ler_destaque():
    """destaque.txt: nome do destaque onde o story vai entrar. Vazio = não destaca."""
    nome = ler_texto(PASTA / "destaque.txt")
    if not nome or nome.lower().startswith("nome do destaque"):
        return None
    return nome.splitlines()[0].strip()


def ler_intervalo():
    """intervalo.txt: segundos de espera entre contas que postaram. 'min-max' (ex.: 20-60) ou um número.

    Vazio = usa o padrão (INTERVALO_MIN a INTERVALO_MAX).
    """
    texto = (ler_texto(PASTA / "intervalo.txt") or "").strip()
    if not texto:
        return INTERVALO_MIN, INTERVALO_MAX
    try:
        if "-" in texto:
            a, b = texto.split("-", 1)
            mn, mx = int(a.strip()), int(b.strip())
        else:
            mn = mx = int(texto)
        mn, mx = max(0, mn), max(0, mx)
        return (mn, mx) if mn <= mx else (mx, mn)
    except ValueError:
        return INTERVALO_MIN, INTERVALO_MAX


def ler_link():
    """link.txt: 1ª linha = link; 2ª linha (opcional) = texto que aparece na figurinha."""
    texto = ler_texto(PASTA / "link.txt")
    if not texto:
        return None, None
    linhas = [l.strip() for l in texto.splitlines() if l.strip()]
    link = linhas[0]
    if "seulink.com" in link:
        return None, None
    if not link.startswith(("http://", "https://")):
        link = "https://" + link
    rotulo = linhas[1] if len(linhas) > 1 else urlparse(link).hostname.removeprefix("www.")
    return link, rotulo.upper()


def ler_sessionid(arquivo):
    """Aceita JSON (Cookie-Editor / EditThisCookie), cookies.txt (Netscape) ou texto sessionid=...;"""
    texto = arquivo.read_text(encoding="utf-8-sig").strip()
    if not texto:
        raise ValueError("O arquivo de cookies está vazio")

    sessionid = None
    if texto.startswith(("[", "{")):
        try:
            dados = json.loads(texto)
        except json.JSONDecodeError:
            raise ValueError("O JSON de cookies está incompleto ou quebrado (copie de novo o conteúdo inteiro)")
        lista = dados if isinstance(dados, list) else dados.get("cookies", [])
        for c in lista:
            if c.get("name") == "sessionid":
                sessionid = c.get("value")
    else:
        for linha in texto.splitlines():
            partes = linha.split("\t")
            if len(partes) >= 7 and partes[5] == "sessionid":
                sessionid = partes[6]
        if not sessionid:
            for par in texto.replace("\n", ";").split(";"):
                nome, _, valor = par.strip().partition("=")
                if nome.strip() == "sessionid":
                    sessionid = valor.strip()

    if not sessionid:
        raise ValueError('O arquivo não tem o cookie "sessionid"')
    return unquote(sessionid)


def ler_proxy():
    """proxy.txt (opcional): host:porta, host:porta:usuario:senha ou http://usuario:senha@host:porta"""
    linha = ler_texto(PASTA / "proxy.txt")
    if not linha:
        return None
    if "://" in linha:
        return linha
    partes = linha.split(":")
    if len(partes) >= 4:
        host, porta, usuario, senha = partes[0], partes[1], partes[2], ":".join(partes[3:])
        return f"http://{usuario}:{senha}@{host}:{porta}"
    return f"http://{linha}"


def carregar_fonte(tamanho):
    for nome in ("segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(nome, tamanho)
        except OSError:
            pass
    return ImageFont.load_default(tamanho)


def carregar_fonte_emoji(tamanho):
    """Fonte de emoji colorido (Segoe UI Emoji no Windows). None se não achar."""
    for nome in ("seguiemj.ttf", "C:/Windows/Fonts/seguiemj.ttf", "NotoColorEmoji.ttf"):
        try:
            return ImageFont.truetype(nome, tamanho)
        except OSError:
            pass
    return None


def _eh_emoji(ch):
    c = ord(ch)
    return (
        0x1F000 <= c <= 0x1FAFF
        or 0x2600 <= c <= 0x27BF
        or 0x1F1E6 <= c <= 0x1F1FF
        or c in (0x2122, 0x2139, 0x2B50, 0x2B55, 0x2B1B, 0x2B1C, 0x3030, 0x303D, 0x2049, 0x203C)
        or 0x2190 <= c <= 0x21AA
    )


def _runs(texto):
    """Divide o texto em pedaços (é_emoji, texto). Mantém seletor de variação e ZWJ junto do emoji."""
    runs = []
    for ch in texto:
        emo = _eh_emoji(ch)
        # seletores (FE0F/FE0E), ZWJ e tons de pele colam no emoji anterior
        if ch in ("\uFE0F", "\uFE0E", "\u200D") or 0x1F3FB <= ord(ch) <= 0x1F3FF:
            if runs:
                runs[-1][1] += ch
                continue
            emo = True
        if runs and runs[-1][0] == emo:
            runs[-1][1] += ch
        else:
            runs.append([emo, ch])
    return runs


def medir_texto(draw, texto, fonte, fonte_emoji):
    larg = 0
    for emo, sub in _runs(texto):
        f = fonte_emoji if (emo and fonte_emoji) else fonte
        larg += draw.textlength(sub, font=f)
    return larg


def desenhar_texto(draw, x, y, texto, fonte, fonte_emoji, fill):
    """Desenha texto com emoji colorido, alinhado à esquerda no meio (anchor lm)."""
    for emo, sub in _runs(texto):
        if emo and fonte_emoji:
            draw.text((x, y), sub, font=fonte_emoji, anchor="lm", embedded_color=True)
            x += draw.textlength(sub, font=fonte_emoji)
        else:
            draw.text((x, y), sub, font=fonte, fill=fill, anchor="lm")
            x += draw.textlength(sub, font=fonte)


def desenhar_icone_link(draw, cx, cy, tam, cor):
    """Dois elos de corrente inclinados, parecido com o ícone do Instagram."""
    elo = Image.new("RGBA", (tam * 2, tam * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(elo)
    esp = max(3, tam // 7)
    w, h = int(tam * 0.95), int(tam * 0.5)
    for dx in (-tam * 0.28, tam * 0.28):
        x0 = tam + dx - w / 2
        d.rounded_rectangle([x0, tam - h / 2, x0 + w, tam + h / 2], radius=h / 2, outline=cor, width=esp)
    elo = elo.rotate(45, resample=Image.BICUBIC)
    return elo, (int(cx - tam), int(cy - tam))


def montar_story(imagem, rotulo):
    """Monta a imagem 1080x1920 do story e, se tiver link, desenha a figurinha.

    Devolve o caminho do JPG e a área da figurinha (x, y, largura, altura em 0..1).
    """
    with Image.open(imagem) as img:
        img = img.convert("RGB")

    # Fundo: a própria imagem ampliada e desfocada (igual o Instagram faz); por cima, a imagem inteira
    escala_fundo = max(LARGURA / img.width, ALTURA / img.height)
    fundo = img.resize((int(img.width * escala_fundo) + 1, int(img.height * escala_fundo) + 1))
    fundo = fundo.crop(((fundo.width - LARGURA) // 2, (fundo.height - ALTURA) // 2,
                        (fundo.width - LARGURA) // 2 + LARGURA, (fundo.height - ALTURA) // 2 + ALTURA))
    canvas = fundo.filter(ImageFilter.GaussianBlur(40))
    escala = min(LARGURA / img.width, ALTURA / img.height)
    frente = img.resize((int(img.width * escala), int(img.height * escala)), Image.LANCZOS)
    canvas.paste(frente, ((LARGURA - frente.width) // 2, (ALTURA - frente.height) // 2))

    area = None
    if rotulo:
        fonte = carregar_fonte(44)
        fonte_emoji = carregar_fonte_emoji(44)
        draw = ImageDraw.Draw(canvas)
        texto_w = medir_texto(draw, rotulo, fonte, fonte_emoji)
        icone, alt, pad = 44, 104, 34
        larg = int(min(pad + icone + 16 + texto_w + pad, LARGURA - 80))
        cx, cy = LARGURA * LINK_X, ALTURA * LINK_Y
        x0, y0 = int(cx - larg / 2), int(cy - alt / 2)

        draw.rounded_rectangle([x0, y0, x0 + larg, y0 + alt], radius=24, fill="white")
        azul = (0, 149, 246)
        elo, pos = desenhar_icone_link(draw, x0 + pad + icone / 2, cy, icone, azul)
        canvas.paste(elo, pos, elo)
        desenhar_texto(draw, x0 + pad + icone + 16, cy, rotulo, fonte, fonte_emoji, azul)
        area = (LINK_X, LINK_Y, larg / LARGURA, alt / ALTURA)

    destino = Path(tempfile.gettempdir()) / "story_para_postar.jpg"
    canvas.save(destino, "JPEG", quality=95)
    return destino, area


def novo_cliente(proxy):
    cl = Client()
    cl.delay_range = [2, 5]
    if proxy:
        cl.set_proxy(proxy)
    # NÃO pergunta o código na tela: se pedir verificação, falha na hora e o script pula a conta
    cl.challenge_code_handler = lambda username, choice: ""
    cl.change_password_handler = lambda username: ""
    return cl


def ler_todos_cookies(arquivo):
    """Lê todos os cookies (nome -> valor). Usado para dar à API tudo que o navegador tinha."""
    texto = arquivo.read_text(encoding="utf-8-sig").strip()
    mapa = {}
    if texto.startswith(("[", "{")):
        try:
            dados = json.loads(texto)
        except json.JSONDecodeError:
            return mapa
        lista = dados if isinstance(dados, list) else dados.get("cookies", [])
        for c in lista:
            if c.get("name") and c.get("value") is not None:
                mapa[c["name"]] = str(c["value"])
    else:
        for linha in texto.splitlines():
            partes = linha.split("\t")
            if len(partes) >= 7:
                mapa[partes[5]] = partes[6]
        if not mapa:
            for par in texto.replace("\n", ";").split(";"):
                n, _, v = par.strip().partition("=")
                if n.strip():
                    mapa[n.strip()] = v.strip()
    return mapa


def login_por_cookie(nome, arquivo_cookies, proxy, arquivo_sessao):
    cl = novo_cliente(proxy)
    if arquivo_sessao.exists():
        cl.load_settings(arquivo_sessao)
    cl.login_by_sessionid(ler_sessionid(arquivo_cookies))

    # Injeta TODOS os cookies do arquivo na sessão (mid, ig_did, csrftoken, ds_user_id, rur...).
    # Ajuda o upload a não dar login_required quando só o sessionid não basta.
    try:
        todos = ler_todos_cookies(arquivo_cookies)
        for jar in (cl.private.cookies, cl.public.cookies):
            for nome_c, valor in todos.items():
                try:
                    jar.set(nome_c, unquote(valor), domain=".instagram.com")
                except Exception:
                    pass
        if todos.get("csrftoken"):
            cl.private.headers.update({"X-CSRFToken": unquote(todos["csrftoken"])})
    except Exception:
        pass

    return cl


def enviar_story(cl, nome, imagem, link, area, destaque, arquivo_sessao):
    # "Esquenta" a sessão: pega o feed para a biblioteca guardar os tokens das ações privadas
    try:
        cl.get_timeline_feed()
    except Exception:
        pass
    cl.dump_settings(arquivo_sessao)

    # Login JÁ deu certo. Se der erro aqui, é o Instagram recusando a AÇÃO (geralmente IP).
    try:
        links = []
        if link:
            x, y, largura, altura = area
            links = [StoryLink(webUri=link, x=x, y=y, width=largura, height=altura)]
        log(nome, "Postando story..." + (f" (link: {link})" if link else ""))
        story = cl.photo_upload_to_story(imagem, links=links, resize_mode="fill")
    except Exception as e:
        raise FalhaAposLogin(f"logou, mas o Instagram recusou postar o story ({type(e).__name__}: {e})")

    if link and not story.links:
        log(nome, "AVISO: o story foi postado, mas o Instagram não devolveu a figurinha de link. Confira no app.")
    log(nome, f"Story postado (id {story.pk}).")

    if destaque:
        sid = str(story.pk)
        ok = False
        ultimo_erro = None
        for tentativa in range(3):
            time.sleep(8 if tentativa == 0 else 15)  # o story precisa aparecer antes de poder destacar
            try:
                existente = next((h for h in cl.user_highlights(cl.user_id) if h.title.strip().lower() == destaque.lower()), None)
                if existente:
                    cl.highlight_add_stories(existente.pk, [cl.media_id(sid)])
                    log(nome, f'Story adicionado ao destaque "{destaque}".')
                else:
                    cl.highlight_create(destaque, [sid])
                    log(nome, f'Destaque "{destaque}" criado com o story.')
                ok = True
                break
            except Exception as e:
                ultimo_erro = e
                log(nome, f"Destaque falhou (tentativa {tentativa + 1}/3): {e}")
        if not ok:
            log(nome, f"AVISO: não consegui destacar ({ultimo_erro}). O story foi postado mesmo assim.")


def postar(nome, arquivo_cookies, imagem, link, area, proxy, destaque):
    PASTA_SESSOES.mkdir(exist_ok=True)
    arquivo_sessao = PASTA_SESSOES / f"{nome}.json"

    log(nome, "Entrando pelo cookie...")
    cl = login_por_cookie(nome, arquivo_cookies, proxy, arquivo_sessao)
    log(nome, f"Logado como @{cl.username}" if cl.username else "Logado.")

    enviar_story(cl, nome, imagem, link, area, destaque, arquivo_sessao)


def main():
    imagem = achar_imagem()
    if not imagem:
        print("Coloque a imagem do story (story.jpg) nesta pasta.")
        sys.exit(1)

    link, rotulo = ler_link()
    if not link:
        print("AVISO: link.txt vazio, o story vai sem link.")

    destaque = ler_destaque()
    if destaque:
        print(f'Vai destacar em: "{destaque}"')

    global INTERVALO_MIN, INTERVALO_MAX
    INTERVALO_MIN, INTERVALO_MAX = ler_intervalo()
    print(f"Espera entre contas que postarem: {INTERVALO_MIN} a {INTERVALO_MAX}s.")
    proxy = ler_proxy()
    if proxy:
        print(f"Usando proxy {urlparse(proxy).hostname}:{urlparse(proxy).port}")

    # Lista as contas: cada arquivo de cookie da pasta cookies/.
    arquivos = sorted(f for f in PASTA_COOKIES.iterdir() if f.is_file() and f.suffix.lower() in (".json", ".txt"))
    if not arquivos:
        print("Nenhum cookie na pasta cookies/. Coloque os cookies e rode de novo.")
        return
    print(f"{len(arquivos)} cookie(s) para postar.")

    imagem_jpg, area = montar_story(imagem, rotulo if link else None)
    PASTA_FEITOS.mkdir(exist_ok=True)

    resultado = []
    itens = [(f.stem, f) for f in arquivos]
    for i, (nome, arquivo) in enumerate(itens):
        sucesso = False
        try:
            postar(nome, arquivo, imagem_jpg, link, area, proxy, destaque)
            shutil.move(str(arquivo), str(PASTA_FEITOS / arquivo.name))
            log(nome, "OK ✔")
            resultado.append(f"✔ {nome}")
            sucesso = True
        except FalhaAposLogin as err:
            # Logou, mas o Instagram recusou a ação. NÃO é cookie morto: separa em cookies/recusado/
            msg = str(err)
            log(nome, f"ERRO: {msg}")
            pasta = PASTA_COOKIES / "recusado"
            pasta.mkdir(exist_ok=True)
            try:
                shutil.move(str(arquivo), str(pasta / arquivo.name))
            except Exception:
                pass
            resultado.append(f"✘ {nome}: {msg} (cookies/recusado/)")
            with open(PASTA / "erros.txt", "a", encoding="utf-8") as f:
                f.write(f"{datetime.now():%d/%m %H:%M} {nome}: FalhaAposLogin: {msg}\n")
        except Exception as err:
            msg = str(err) or type(err).__name__
            ml = msg.lower()
            if any(x in ml for x in ["2fa", "duas etapas", "verificação", "verificacao", "checkpoint", "challenge"]):
                # conta em verificação: separa em cookies/precisa_2fa/
                log(nome, "Conta em verificação (checkpoint) — pulei.")
                pasta = PASTA_COOKIES / "precisa_2fa"
                pasta.mkdir(exist_ok=True)
                try:
                    shutil.move(str(arquivo), str(pasta / arquivo.name))
                except Exception:
                    pass
                resultado.append(f"⏭ {nome}: conta em verificação (cookies/precisa_2fa/)")
            else:
                # cookie desconectado/expirado ou outro erro de login: separa em cookies/mortos/
                PASTA_MORTOS.mkdir(exist_ok=True)
                try:
                    shutil.move(str(arquivo), str(PASTA_MORTOS / arquivo.name))
                except Exception:
                    pass
                log(nome, "ERRO: cookie não logou — movido para cookies/mortos/")
                resultado.append(f"✘ {nome}: cookie não logou (cookies/mortos/)")
            with open(PASTA / "erros.txt", "a", encoding="utf-8") as f:
                f.write(f"{datetime.now():%d/%m %H:%M} {nome}: {type(err).__name__}: {msg}\n")

        # Espera longa só depois de postar com sucesso (anti-bloqueio). Falhou? espera pouco e segue.
        if i < len(itens) - 1:
            if sucesso:
                espera = random.randint(INTERVALO_MIN, INTERVALO_MAX)
            else:
                espera = random.randint(FALHA_MIN, FALHA_MAX)
            print(f"Esperando {espera}s antes da próxima conta...")
            time.sleep(espera)

    print("\n===== RESUMO =====")
    for r in resultado:
        print(r)


if __name__ == "__main__":
    main()
