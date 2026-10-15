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
from instagrapi.types import StoryLink
from PIL import Image

PASTA = Path(__file__).resolve().parent
PASTA_COOKIES = PASTA / "cookies"
PASTA_FEITOS = PASTA_COOKIES / "feitos"
PASTA_SESSOES = PASTA / "sessoes"
EXT_FOTO = (".jpg", ".jpeg", ".png", ".webp")

# Intervalo entre uma conta e outra, em segundos (aleatório para não parecer robô)
INTERVALO_MIN = 60
INTERVALO_MAX = 180

# Posição da figurinha de link na tela (0 a 1). y=0.8 deixa ela mais para baixo.
LINK_X = 0.5
LINK_Y = 0.8


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


def ler_link():
    link = ler_texto(PASTA / "link.txt")
    if not link or "seulink.com" in link:
        return None
    if not link.startswith(("http://", "https://")):
        link = "https://" + link
    return link


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


def preparar_imagem(imagem):
    """Converte para JPG (o Instagram só aceita JPG no story)."""
    destino = Path(tempfile.gettempdir()) / "story_para_postar.jpg"
    with Image.open(imagem) as img:
        img.convert("RGB").save(destino, "JPEG", quality=95)
    return destino


def postar(nome, arquivo_cookies, imagem, link, proxy):
    sessionid = ler_sessionid(arquivo_cookies)

    cl = Client()
    cl.delay_range = [2, 5]
    if proxy:
        cl.set_proxy(proxy)

    # Guarda o "aparelho" de cada conta, para o Instagram ver sempre o mesmo celular
    PASTA_SESSOES.mkdir(exist_ok=True)
    arquivo_sessao = PASTA_SESSOES / f"{nome}.json"
    if arquivo_sessao.exists():
        cl.load_settings(arquivo_sessao)

    log(nome, "Entrando na conta...")
    cl.login_by_sessionid(sessionid)
    cl.dump_settings(arquivo_sessao)
    log(nome, f"Logado como @{cl.username}" if cl.username else "Logado.")

    links = [StoryLink(webUri=link, x=LINK_X, y=LINK_Y)] if link else []
    log(nome, "Postando story..." + (f" (link: {link})" if link else ""))
    story = cl.photo_upload_to_story(imagem, links=links, resize_mode="fit")

    if link and not story.links:
        log(nome, "AVISO: o story foi postado, mas o Instagram não devolveu a figurinha de link. Confira no app.")
    log(nome, f"Story postado (id {story.pk}).")


def main():
    arquivos = sorted(f for f in PASTA_COOKIES.iterdir() if f.is_file() and f.suffix.lower() in (".json", ".txt"))
    if not arquivos:
        print("Nenhum arquivo de cookies na pasta cookies/. Nada a fazer.")
        return

    imagem = achar_imagem()
    if not imagem:
        print("Coloque a imagem do story (story.jpg) nesta pasta.")
        sys.exit(1)

    link = ler_link()
    if not link:
        print("AVISO: link.txt vazio, o story vai sem link.")

    proxy = ler_proxy()
    if proxy:
        print(f"Usando proxy {urlparse(proxy).hostname}:{urlparse(proxy).port}")

    imagem_jpg = preparar_imagem(imagem)
    PASTA_FEITOS.mkdir(exist_ok=True)

    resultado = []
    for i, arquivo in enumerate(arquivos):
        nome = arquivo.stem
        try:
            postar(nome, arquivo, imagem_jpg, link, proxy)
            shutil.move(str(arquivo), str(PASTA_FEITOS / arquivo.name))
            log(nome, "OK ✔")
            resultado.append(f"✔ {nome}")
        except Exception as err:
            msg = str(err) or type(err).__name__
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
