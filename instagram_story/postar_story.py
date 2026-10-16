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


def novo_cliente(proxy):
    cl = Client()
    cl.delay_range = [2, 5]
    if proxy:
        cl.set_proxy(proxy)
    return cl


def login_por_senha(nome, senha, proxy, arquivo_sessao):
    cl = novo_cliente(proxy)
    if arquivo_sessao.exists():
        cl.load_settings(arquivo_sessao)
    try:
        cl.login(nome, senha)
    except TwoFactorRequired:
        raise RuntimeError("pediu verificação em duas etapas (2FA) no login por senha")
    except ChallengeRequired:
        raise RuntimeError("caiu em verificação (checkpoint) no login por senha")
    except BadPassword:
        raise RuntimeError("usuário ou senha incorretos no senhas.txt")
    return cl


def postar(nome, arquivo_cookies, imagem, link, area, proxy, destaque, senha):
    # Guarda o "aparelho" de cada conta, para o Instagram ver sempre o mesmo celular
    PASTA_SESSOES.mkdir(exist_ok=True)
    arquivo_sessao = PASTA_SESSOES / f"{nome}.json"

    cl = None
    # 1º tenta pelo cookie (se houver). Se falhar, tenta usuario e senha (se houver).
    if arquivo_cookies:
        cl_cookie = novo_cliente(proxy)
        if arquivo_sessao.exists():
            cl_cookie.load_settings(arquivo_sessao)
        try:
            log(nome, "Entrando pelo cookie...")
            cl_cookie.login_by_sessionid(ler_sessionid(arquivo_cookies))
            cl = cl_cookie
        except Exception as e:
            if not senha:
                raise
            log(nome, f"Cookie não logou ({type(e).__name__}). Tentando com usuário e senha...")

    if cl is None:
        if not senha:
            raise RuntimeError("sem cookie e sem senha para essa conta")
        if not arquivo_cookies:
            log(nome, "Entrando com usuário e senha...")
        cl = login_por_senha(nome, senha, proxy, arquivo_sessao)

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

    # Destacar: coloca o story num Destaque do perfil (tenta algumas vezes, o story demora a ficar pronto)
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

    senhas = ler_senhas()
    proxy = ler_proxy()
    if proxy:
        print(f"Usando proxy {urlparse(proxy).hostname}:{urlparse(proxy).port}")

    # Monta a lista de contas: cada cookie da pasta + cada usuário do senhas.txt.
    # A chave é o nome (cookie = nome do arquivo; senha = usuário). Nomes iguais se juntam.
    contas = {}  # nome -> arquivo de cookie (ou None)
    for f in sorted(PASTA_COOKIES.iterdir()):
        if f.is_file() and f.suffix.lower() in (".json", ".txt"):
            contas[f.stem] = f
    for usuario in senhas:
        contas.setdefault(usuario, None)

    if not contas:
        print("Nenhuma conta. Coloque cookies em cookies/ ou contas no senhas.txt.")
        return

    com_cookie = sum(1 for a in contas.values() if a is not None)
    com_senha = sum(1 for n in contas if senhas.get(n.lower()))
    print(f"{len(contas)} conta(s): {com_cookie} com cookie, {com_senha} com senha de reserva.")
    # Avisa quando o cookie não tem senha com o mesmo nome (a reserva não vai funcionar nessa)
    sem_reserva = [n for n, a in contas.items() if a is not None and not senhas.get(n.lower())]
    if senhas and sem_reserva:
        print("AVISO: estes cookies NÃO têm senha de reserva com o mesmo nome no senhas.txt:")
        print("       " + ", ".join(sem_reserva))
        print("       (para a reserva funcionar, o nome do cookie tem que ser igual ao usuário)")

    imagem_jpg, area = montar_story(imagem, rotulo if link else None)
    PASTA_FEITOS.mkdir(exist_ok=True)

    resultado = []
    itens = list(contas.items())
    for i, (nome, arquivo) in enumerate(itens):
        senha = senhas.get(nome.lower())
        try:
            postar(nome, arquivo, imagem_jpg, link, area, proxy, destaque, senha)
            if arquivo is not None:
                shutil.move(str(arquivo), str(PASTA_FEITOS / arquivo.name))
            log(nome, "OK ✔")
            resultado.append(f"✔ {nome}")
        except Exception as err:
            msg = str(err) or type(err).__name__
            # cookie desconectado/expirado E sem senha de reserva: separa em cookies/mortos/
            morto = any(x in msg.lower() for x in ["logged_out", "login_required", "checkpoint", "não está logado", "csrf", "sessionid", "sem cookie e sem senha"])
            if morto and arquivo is not None:
                PASTA_MORTOS.mkdir(exist_ok=True)
                try:
                    shutil.move(str(arquivo), str(PASTA_MORTOS / arquivo.name))
                except Exception:
                    pass
                log(nome, "ERRO: cookie não logou — movido para cookies/mortos/")
                resultado.append(f"✘ {nome}: cookie não logou (cookies/mortos/)")
            else:
                log(nome, f"ERRO: {msg}")
                resultado.append(f"✘ {nome}: {msg}")
            with open(PASTA / "erros.txt", "a", encoding="utf-8") as f:
                f.write(f"{datetime.now():%d/%m %H:%M} {nome}: {type(err).__name__}: {msg}\n")

        if i < len(itens) - 1:
            espera = random.randint(INTERVALO_MIN, INTERVALO_MAX)
            print(f"Esperando {espera}s antes da próxima conta...")
            time.sleep(espera)

    print("\n===== RESUMO =====")
    for r in resultado:
        print(r)


if __name__ == "__main__":
    main()
