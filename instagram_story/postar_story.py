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

from instagrapi import Client
from instagrapi.exceptions import BadPassword, ChallengeRequired, TwoFactorRequired
from instagrapi.types import StoryLink
from PIL import Image, ImageDraw, ImageFilter, ImageFont

PASTA = Path(__file__).resolve().parent
PASTA_COOKIES = PASTA / "cookies"
PASTA_FEITOS = PASTA_COOKIES / "feitos"
PASTA_MORTOS = PASTA_COOKIES / "mortos"  # cookies desconectados/expirados
PASTA_SESSOES = PASTA / "sessoes"
EXT_FOTO = (".jpg", ".jpeg", ".png", ".webp")

# Intervalo entre uma conta e outra, em segundos (aleatório para não parecer robô)
INTERVALO_MIN = 60
INTERVALO_MAX = 180

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


def ler_senhas():
    """senhas.txt: uma linha por conta, no formato usuario:senha.

    Serve de reserva: se o cookie falhar, o script tenta entrar com usuario e senha.
    O usuario tem que ser igual ao NOME do arquivo de cookie (ex.: joao.json -> joao).
    """
    texto = ler_texto(PASTA / "senhas.txt")
    mapa = {}
    if not texto:
        return mapa
    for linha in texto.splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or ":" not in linha:
            continue
        i = linha.index(":")
        usuario = linha[:i].strip()
        senha = linha[i + 1:].strip()
        if usuario and senha and not usuario.lower().startswith("usuario"):
            mapa[usuario.lower()] = senha
    return mapa


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
        draw = ImageDraw.Draw(canvas)
        caixa = draw.textbbox((0, 0), rotulo, font=fonte)
        texto_w, texto_h = caixa[2] - caixa[0], caixa[3] - caixa[1]
        icone, alt, pad = 44, 104, 34
        larg = min(pad + icone + 16 + texto_w + pad, LARGURA - 80)
        cx, cy = LARGURA * LINK_X, ALTURA * LINK_Y
        x0, y0 = int(cx - larg / 2), int(cy - alt / 2)

        draw = ImageDraw.Draw(canvas)
        draw.rounded_rectangle([x0, y0, x0 + larg, y0 + alt], radius=24, fill="white")
        azul = (0, 149, 246)
        elo, pos = desenhar_icone_link(draw, x0 + pad + icone / 2, cy, icone, azul)
        canvas.paste(elo, pos, elo)
        draw.text((x0 + pad + icone + 16, cy), rotulo, font=fonte, fill=azul, anchor="lm")
        area = (LINK_X, LINK_Y, larg / LARGURA, alt / ALTURA)

    destino = Path(tempfile.gettempdir()) / "story_para_postar.jpg"
    canvas.save(destino, "JPEG", quality=95)
    return destino, area


def postar(nome, arquivo_cookies, imagem, link, area, proxy, destaque, senhas):
    cl = Client()
    cl.delay_range = [2, 5]
    if proxy:
        cl.set_proxy(proxy)

    # Guarda o "aparelho" de cada conta, para o Instagram ver sempre o mesmo celular
    PASTA_SESSOES.mkdir(exist_ok=True)
    arquivo_sessao = PASTA_SESSOES / f"{nome}.json"
    if arquivo_sessao.exists():
        cl.load_settings(arquivo_sessao)

    # 1º tenta pelo cookie; se falhar, tenta pelo usuario e senha do senhas.txt
    senha = senhas.get(nome.lower())
    logou = False
    try:
        log(nome, "Entrando pelo cookie...")
        cl.login_by_sessionid(ler_sessionid(arquivo_cookies))
        logou = True
    except Exception as e:
        if not senha:
            raise
        log(nome, f"Cookie não logou ({type(e).__name__}). Tentando com usuário e senha...")

    if not logou:
        # login limpo com usuario e senha
        cl2 = Client()
        cl2.delay_range = [2, 5]
        if proxy:
            cl2.set_proxy(proxy)
        if arquivo_sessao.exists():
            cl2.load_settings(arquivo_sessao)
        try:
            cl2.login(nome, senha)
        except TwoFactorRequired:
            raise RuntimeError("pediu verificação em duas etapas (2FA) no login por senha")
        except ChallengeRequired:
            raise RuntimeError("caiu em verificação (checkpoint) no login por senha")
        except BadPassword:
            raise RuntimeError("usuário ou senha incorretos no senhas.txt")
        cl = cl2

    cl.dump_settings(arquivo_sessao)
    log(nome, f"Logado como @{cl.username}" if cl.username else "Logado.")

    links = []
    if link:
        x, y, largura, altura = area
        links = [StoryLink(webUri=link, x=x, y=y, width=largura, height=altura)]
    log(nome, "Postando story..." + (f" (link: {link})" if link else ""))
    story = cl.photo_upload_to_story(imagem, links=links, resize_mode="fill")

    if link and not story.links:
        log(nome, "AVISO: o story foi postado, mas o Instagram não devolveu a figurinha de link. Confira no app.")
    log(nome, f"Story postado (id {story.pk}).")

    # Destacar: coloca o story num Destaque do perfil
    if destaque:
        try:
            time.sleep(3)  # dá um tempo para o story ficar disponível
            sid = str(story.pk)
            existente = next((h for h in cl.user_highlights(cl.user_id) if h.title.strip().lower() == destaque.lower()), None)
            if existente:
                cl.highlight_add_stories(existente.pk, [cl.media_id(sid)])
                log(nome, f'Story adicionado ao destaque "{destaque}".')
            else:
                cl.highlight_create(destaque, [sid])
                log(nome, f'Destaque "{destaque}" criado com o story.')
        except Exception as e:
            log(nome, f"AVISO: não consegui destacar ({e}). O story foi postado mesmo assim.")


def main():
    arquivos = sorted(f for f in PASTA_COOKIES.iterdir() if f.is_file() and f.suffix.lower() in (".json", ".txt"))
    if not arquivos:
        print("Nenhum arquivo de cookies na pasta cookies/. Nada a fazer.")
        return

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

    senhas = ler_senhas()
    if senhas:
        print(f"senhas.txt: {len(senhas)} conta(s) com usuário e senha de reserva.")

    proxy = ler_proxy()
    if proxy:
        print(f"Usando proxy {urlparse(proxy).hostname}:{urlparse(proxy).port}")

    imagem_jpg, area = montar_story(imagem, rotulo if link else None)
    PASTA_FEITOS.mkdir(exist_ok=True)

    resultado = []
    for i, arquivo in enumerate(arquivos):
        nome = arquivo.stem
        try:
            postar(nome, arquivo, imagem_jpg, link, area, proxy, destaque, senhas)
            shutil.move(str(arquivo), str(PASTA_FEITOS / arquivo.name))
            log(nome, "OK ✔")
            resultado.append(f"✔ {nome}")
        except Exception as err:
            msg = str(err) or type(err).__name__
            # cookie desconectado/expirado: separa em cookies/mortos/ para não tentar de novo
            morto = any(x in msg.lower() for x in ["logged_out", "login_required", "checkpoint", "não está logado", "csrf", "sessionid"])
            if morto:
                PASTA_MORTOS.mkdir(exist_ok=True)
                try:
                    shutil.move(str(arquivo), str(PASTA_MORTOS / arquivo.name))
                except Exception:
                    pass
                log(nome, "ERRO: cookie desconectado/expirado — movido para cookies/mortos/")
                resultado.append(f"✘ {nome}: cookie desconectado/expirado (cookies/mortos/)")
            else:
                log(nome, f"ERRO: {msg}")
                resultado.append(f"✘ {nome}: {msg}")
            with open(PASTA / "erros.txt", "a", encoding="utf-8") as f:
                f.write(f"{datetime.now():%d/%m %H:%M} {nome}: {type(err).__name__}: {msg}\n")

        if i < len(arquivos) - 1:
            espera = random.randint(INTERVALO_MIN, INTERVALO_MAX)
            print(f"Esperando {espera}s antes da próxima conta...")
            time.sleep(espera)

    print("\n===== RESUMO =====")
    for r in resultado:
        print(r)


if __name__ == "__main__":
    main()
