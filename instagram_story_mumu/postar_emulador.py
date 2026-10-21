# Posta um story COM LINK em cada clone do Instagram no MuMu.
# Abre cada ícone de clone (#N1, #N2, ...), entra na câmera de story, escolhe a imagem,
# coloca a figurinha de "Sticker de ligação" com o link, e compartilha.
#
# ESTA É A v1 (calibração): ele tira um print de cada passo na pasta "passos/".
# Rode em UM clone primeiro, veja/mande a pasta passos/ e a gente acerta os cliques que faltam.
#
# Config nesta pasta:
#   imagem.jpg        -> a imagem do story
#   link.txt          -> 1a linha: o link ; 2a linha (opcional): texto da figurinha
#   clones.txt        -> (opcional) quais clones: "1-10" ou "1,3,5". Vazio = todos os #N.
#   intervalo.txt     -> (opcional) segundos de espera entre contas (ex.: 60-120). Padrão 40-90.

import os
import random
import re
import sys
import time
from pathlib import Path

from diagnostico import conectar  # reaproveita a conexão (acha a porta sozinho)

PASTA = Path(__file__).resolve().parent
PASSOS = PASTA / "passos"
IMG_REMOTA = "/sdcard/Pictures/story_mumu.jpg"


def ler_texto(p):
    return p.read_text(encoding="utf-8-sig").strip() if p.exists() else ""


def ler_link():
    linhas = [l.strip() for l in ler_texto(PASTA / "link.txt").splitlines() if l.strip()]
    link = linhas[0] if linhas else ""
    rotulo = linhas[1] if len(linhas) > 1 else ""
    return link, rotulo


def achar_imagem():
    for nome in ("imagem.jpg", "imagem.png", "story.jpg", "story.png"):
        if (PASTA / nome).exists():
            return PASTA / nome
    return None


def ler_intervalo():
    txt = ler_texto(PASTA / "intervalo.txt")
    m = re.findall(r"\d+", txt)
    if len(m) >= 2:
        return int(m[0]), int(m[1])
    if len(m) == 1:
        return int(m[0]), int(m[0])
    return 40, 90


def clones_desejados():
    txt = ler_texto(PASTA / "clones.txt")
    if not txt:
        return None
    nums = set()
    for parte in re.split(r"[,\s]+", txt):
        if "-" in parte:
            a, b = parte.split("-")
            nums.update(range(int(a), int(b) + 1))
        elif parte.isdigit():
            nums.add(int(parte))
    return nums


def icones_clones(d):
    """Lê os ícones #N<num> da tela inicial do MuMu."""
    d.press("home")
    time.sleep(2)
    xml = d.dump_hierarchy()
    achados = {}
    for m in re.finditer(r'text="(#N(\d+)[^"]*)"', xml):
        achados.setdefault(int(m.group(2)), m.group(1))
    return [(n, achados[n]) for n in sorted(achados)]


def _shot(d, nome):
    try:
        PASSOS.mkdir(exist_ok=True)
        d.screenshot(str(PASSOS / f"{nome}.png"))
        (PASSOS / f"{nome}.xml").write_text(d.dump_hierarchy(), encoding="utf-8")
    except Exception:
        pass


def tocar_primeiro(d, seletores, timeout=8):
    """Toca no primeiro seletor que existir. seletores = lista de dicts (kwargs do uiautomator2)."""
    fim = time.time() + timeout
    while time.time() < fim:
        for sel in seletores:
            try:
                el = d(**sel)
                if el.exists:
                    el.click()
                    return True
            except Exception:
                pass
        time.sleep(0.5)
    return False


# ---- Os CLIQUES do Instagram (em português). O que eu não vi ainda está com palpite + fallback. ----
# Se algum passo falhar, o print em passos/ mostra a tela e a gente corrige o seletor aqui.
SEL = {
    "abrir_story": [
        {"description": "Câmara"}, {"descriptionContains": "Câmara"},
        {"descriptionContains": "story"}, {"descriptionContains": "história"},
        {"text": "A tua nota"}, {"descriptionContains": "Camera"},
    ],
    "galeria": [
        {"descriptionContains": "Galeria"}, {"descriptionContains": "galeria"},
        {"resourceIdMatches": ".*gallery.*"}, {"descriptionContains": "rolo"},
    ],
    "sticker_botao": [
        {"description": "Autocolante"}, {"description": "Autocolantes"},
        {"description": "Sticker"}, {"descriptionContains": "Autocolante"},
        {"descriptionContains": "Sticker"},
    ],
    "sticker_link": [
        {"description": "Sticker de ligação"}, {"descriptionContains": "ligação"},
        {"descriptionContains": "Link"},
    ],
    "concluir": [
        {"text": "Concluído"}, {"text": "Concluir"}, {"text": "Done"},
        {"descriptionContains": "Concluído"},
    ],
    "compartilhar": [
        {"text": "A tua história"}, {"descriptionContains": "A tua história"},
        {"text": "Sua história"}, {"descriptionContains": "Sua história"},
        {"text": "Partilhar"}, {"text": "Compartilhar"}, {"descriptionContains": "história"},
    ],
}


def postar_em(d, label, link, rotulo):
    base = label.split()[0]  # "#N1"
    print(f"[{base}] abrindo o clone...")
    d.press("home")
    time.sleep(1.5)
    if not tocar_primeiro(d, [{"text": label}, {"textStartsWith": base + " "}], timeout=8):
        raise RuntimeError("não achei o ícone do clone na tela inicial")
    time.sleep(7)  # o app abrir
    _shot(d, f"{base}_01_abriu")

    print(f"[{base}] abrindo a câmera de story...")
    if not tocar_primeiro(d, SEL["abrir_story"], timeout=10):
        _shot(d, f"{base}_erro_abrir_story")
        raise RuntimeError("não achei como abrir a câmera de story (veja o print)")
    time.sleep(3)
    _shot(d, f"{base}_02_camera")

    print(f"[{base}] escolhendo a foto...")
    tocar_primeiro(d, SEL["galeria"], timeout=6)
    time.sleep(2)
    _shot(d, f"{base}_03_galeria")
    # toca na primeira foto da galeria (a imagem que empurramos fica entre as mais recentes)
    tocar_primeiro(d, [{"descriptionContains": "Foto de"}, {"resourceIdMatches": ".*gallery_grid.*"}], timeout=6)
    time.sleep(3)
    _shot(d, f"{base}_04_editor")

    print(f"[{base}] abrindo figurinhas e o link...")
    if not tocar_primeiro(d, SEL["sticker_botao"], timeout=8):
        _shot(d, f"{base}_erro_sticker")
        raise RuntimeError("não achei o botão de figurinhas (veja o print)")
    time.sleep(2)
    if not tocar_primeiro(d, SEL["sticker_link"], timeout=8):
        _shot(d, f"{base}_erro_link")
        raise RuntimeError('não achei o "Sticker de ligação" (veja o print)')
    time.sleep(2)
    _shot(d, f"{base}_05_link")

    # campo do URL
    campo = d(className="android.widget.EditText")
    if campo.exists:
        campo.set_text(link)
    else:
        _shot(d, f"{base}_erro_url")
        raise RuntimeError("não achei o campo do link (veja o print)")
    time.sleep(1)
    # (rótulo personalizado fica para a próxima versão)
    tocar_primeiro(d, SEL["concluir"], timeout=6)
    time.sleep(2)
    _shot(d, f"{base}_06_depois_link")

    print(f"[{base}] compartilhando...")
    if not tocar_primeiro(d, SEL["compartilhar"], timeout=10):
        _shot(d, f"{base}_erro_compartilhar")
        raise RuntimeError("não achei o botão de compartilhar (veja o print)")
    time.sleep(6)
    _shot(d, f"{base}_07_fim")
    print(f"[{base}] OK ✔ (confira o print 07 para ter certeza)")


def main():
    imagem = achar_imagem()
    if not imagem:
        print("Coloque a imagem como imagem.jpg nesta pasta.")
        return
    link, rotulo = ler_link()
    if not link:
        print("AVISO: link.txt vazio — o story vai sem link.")

    d = conectar()

    print("Enviando a imagem para a galeria do MuMu...")
    d.push(str(imagem), IMG_REMOTA)
    d.shell(f"am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://{IMG_REMOTA}")

    todos = icones_clones(d)
    if not todos:
        print("Não achei ícones de clone (#N1, #N2, ...) na tela inicial.")
        return
    querer = clones_desejados()
    lista = [(n, t) for (n, t) in todos if (querer is None or n in querer)]
    print(f"Vou postar em {len(lista)} clone(s): {', '.join('#N'+str(n) for n, _ in lista)}")

    imin, imax = ler_intervalo()
    resultado = []
    for i, (n, label) in enumerate(lista):
        try:
            postar_em(d, label, link, rotulo)
            resultado.append(f"✔ #N{n}")
        except Exception as e:
            print(f"[#N{n}] ERRO: {e}")
            resultado.append(f"✘ #N{n}: {e}")
        d.press("home")
        if i < len(lista) - 1:
            espera = random.randint(imin, imax)
            print(f"Esperando {espera}s...")
            time.sleep(espera)

    print("\n===== RESUMO =====")
    for r in resultado:
        print(r)
    print(f"\nOs prints de cada passo estão na pasta: {PASSOS}")


if __name__ == "__main__":
    main()
