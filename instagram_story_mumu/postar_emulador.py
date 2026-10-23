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


# Botões de pop-up que aparecem do nada (notificações, câmera, galeria, "guardar login"...).
# A gente toca em PERMITIR (libera câmera/galeria/notificação) ou fecha o aviso e segue.
BOTOES_POPUP = [
    {"textContains": "Permitir todos"}, {"textContains": "PERMITIR TODOS"}, {"textContains": "Allow all"},
    {"text": "PERMITIR"}, {"text": "Permitir"}, {"text": "ALLOW"}, {"text": "Allow"},
    {"textContains": "Durante a utiliza"}, {"textContains": "Ao utilizar"}, {"textContains": "While using"},
    {"text": "Agora não"}, {"text": "AGORA NÃO"}, {"text": "Not now"}, {"text": "NÃO PERMITIR"},
]


def fechar_popups(d, vezes=4):
    """Fecha pop-ups de permissão/aviso que aparecerem (pode ter mais de um empilhado)."""
    for _ in range(vezes):
        achou = False
        for sel in BOTOES_POPUP:
            try:
                el = d(**sel)
                if el.exists:
                    el.click()
                    achou = True
                    time.sleep(0.8)
                    break
            except Exception:
                pass
        if not achou:
            return


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
    "agora_nao": [{"text": "Agora não"}, {"text": "AGORA NÃO"}, {"text": "Not now"}],
    # perfil no canto inferior direito (barra de baixo)
    "perfil_tab": [
        {"description": "Perfil"}, {"description": "Separador de perfil"},
        {"descriptionContains": "Perfil"}, {"descriptionContains": "perfil"},
    ],
    # "+" na foto de perfil (abre a câmera de story)
    "mais_perfil": [
        {"descriptionContains": "Adicionar à história"}, {"descriptionContains": "Adicionar"},
        {"descriptionContains": "Criar"}, {"descriptionContains": "nota"}, {"descriptionContains": "história"},
    ],
    # a única foto da galeria
    "primeira_foto": [
        {"descriptionContains": "Foto de"}, {"descriptionStartsWith": "Foto"},
        {"descriptionContains": "Imagem"}, {"resourceIdMatches": ".*gallery.*"},
    ],
    "sticker_botao": [
        {"description": "Autocolante"}, {"description": "Autocolantes"}, {"description": "Sticker"},
        {"descriptionContains": "Autocolante"}, {"descriptionContains": "Sticker"},
    ],
    "sticker_link": [
        {"description": "Sticker de ligação"}, {"descriptionContains": "ligação"}, {"descriptionContains": "Link"},
    ],
    "personalizar": [
        {"textContains": "Personalizar"}, {"descriptionContains": "Personalizar"},
    ],
    "concluir": [
        {"text": "Concluído"}, {"text": "Concluir"}, {"text": "Done"}, {"descriptionContains": "Concluído"},
    ],
    "compartilhar": [
        {"text": "A tua história"}, {"descriptionContains": "A tua história"},
        {"text": "Partilhar"}, {"text": "Compartilhar"}, {"descriptionContains": "Partilhar"},
        {"descriptionContains": "Enviar"}, {"descriptionContains": "história"},
    ],
    # --- destaque (adicionar ao destaque) ---
    "meu_story": [
        {"descriptionContains": "A tua nota"}, {"descriptionContains": "tua história"},
        {"descriptionContains": "sua história"}, {"descriptionContains": "A tua história"},
    ],
    "destacar": [
        {"text": "Destacar"}, {"descriptionContains": "Destacar"},
        {"text": "Adicionar ao destaque"}, {"descriptionContains": "destaque"}, {"text": "Highlight"},
    ],
    "novo_destaque": [{"text": "Novo"}, {"textStartsWith": "Novo"}, {"descriptionContains": "Novo destaque"}],
    "confirmar_destaque": [
        {"text": "Adicionar"}, {"text": "Seguinte"}, {"text": "Concluído"}, {"text": "Done"}, {"text": "Guardar"},
    ],
}


def destacar_em(d, base, destaque):
    """Adiciona o story recém-postado a um destaque chamado 'destaque'."""
    print(f"[{base}] destacando em '{destaque}'...")
    time.sleep(4)
    # abre o seu próprio story (fica em cima, "A tua nota/história"); se não, tenta pelo perfil
    if not tocar_primeiro(d, SEL["meu_story"], timeout=8):
        tocar_primeiro(d, SEL["perfil_tab"], timeout=6)
        time.sleep(2)
        tocar_primeiro(d, SEL["meu_story"], timeout=6)
    time.sleep(3)
    _shot(d, f"{base}_08_meu_story")
    if not tocar_primeiro(d, SEL["destacar"], timeout=8):
        _shot(d, f"{base}_erro_destacar")
        raise RuntimeError('não achei o botão "Destacar" (veja o print)')
    time.sleep(2)
    _shot(d, f"{base}_09_destaques")
    # se já existe um destaque com esse nome, toca nele; senão cria "Novo"
    if d(text=destaque).exists:
        d(text=destaque).click()
    else:
        tocar_primeiro(d, SEL["novo_destaque"], timeout=5)
        time.sleep(2)
        campo = d(className="android.widget.EditText")
        if campo.exists:
            campo.set_text(destaque)
            time.sleep(1)
    tocar_primeiro(d, SEL["confirmar_destaque"], timeout=6)
    time.sleep(2)
    _shot(d, f"{base}_10_destacado")
    print(f"[{base}] destaque OK (confira o print 10)")


def _set_edit(d, texto):
    """Escreve num campo de texto visível (o que estiver focado, ou o último)."""
    try:
        campo = d(className="android.widget.EditText", focused=True)
        if not campo.exists:
            campos = d(className="android.widget.EditText")
            campo = campos[campos.count - 1] if campos.count else campos
        campo.set_text(texto)
        return True
    except Exception:
        return False


def postar_em(d, label, link, rotulo):
    base = label.split()[0]  # "#N1"

    # 1) abrir o clone
    print(f"[{base}] abrindo o clone...")
    d.press("home")
    time.sleep(1.5)
    if not tocar_primeiro(d, [{"text": label}, {"textStartsWith": base + " "}], timeout=8):
        raise RuntimeError("não achei o ícone do clone na tela inicial")
    time.sleep(8)  # o app abrir / logar
    fechar_popups(d)  # notificação
    # 3) "Agora não"
    tocar_primeiro(d, SEL["agora_nao"], timeout=5)
    fechar_popups(d)
    _shot(d, f"{base}_01_abriu")

    # 4) perfil (canto inferior direito)
    print(f"[{base}] indo no perfil...")
    if not tocar_primeiro(d, SEL["perfil_tab"], timeout=10):
        _shot(d, f"{base}_erro_perfil")
        raise RuntimeError("não achei o botão do perfil (veja o print)")
    time.sleep(3)
    _shot(d, f"{base}_02_perfil")

    # 5) "+" na foto de perfil -> abre a câmera de story
    print(f"[{base}] abrindo a câmera de story (+ na foto)...")
    if not tocar_primeiro(d, SEL["mais_perfil"], timeout=8):
        _shot(d, f"{base}_erro_mais")
        raise RuntimeError('não achei o "+" na foto de perfil (veja o print)')
    time.sleep(3)
    fechar_popups(d)  # 6) "Permitir todos"
    _shot(d, f"{base}_03_galeria")

    # 7) a única foto
    print(f"[{base}] escolhendo a foto...")
    if not tocar_primeiro(d, SEL["primeira_foto"], timeout=8):
        _shot(d, f"{base}_erro_foto")
        raise RuntimeError("não achei a foto para escolher (veja o print)")
    time.sleep(3)
    _shot(d, f"{base}_04_editor")

    # 8) figurinha  9) ligação
    print(f"[{base}] figurinha -> ligação...")
    if not tocar_primeiro(d, SEL["sticker_botao"], timeout=8):
        _shot(d, f"{base}_erro_sticker")
        raise RuntimeError("não achei o botão de figurinhas (veja o print)")
    time.sleep(2)
    if not tocar_primeiro(d, SEL["sticker_link"], timeout=8):
        _shot(d, f"{base}_erro_link")
        raise RuntimeError('não achei o "Sticker de ligação" (veja o print)')
    time.sleep(2)
    _shot(d, f"{base}_05_link")

    # 10) colocar o link
    if not _set_edit(d, link):
        _shot(d, f"{base}_erro_url")
        raise RuntimeError("não achei o campo do link (veja o print)")
    time.sleep(1)

    # 11) personalizar texto  12) colocar o texto
    if rotulo:
        if tocar_primeiro(d, SEL["personalizar"], timeout=5):
            time.sleep(1)
            _set_edit(d, rotulo)
            time.sleep(1)
            _shot(d, f"{base}_06_texto")

    # 13) concluído
    tocar_primeiro(d, SEL["concluir"], timeout=6)
    time.sleep(2)
    _shot(d, f"{base}_06b_depois_link")

    # 14) postar
    print(f"[{base}] postando...")
    if not tocar_primeiro(d, SEL["compartilhar"], timeout=10):
        _shot(d, f"{base}_erro_compartilhar")
        raise RuntimeError("não achei o botão de postar (veja o print)")
    time.sleep(6)
    _shot(d, f"{base}_07_fim")
    print(f"[{base}] story postado (confira o print 07)")

    destaque = ler_texto(PASTA / "destaque.txt")
    if destaque:
        try:
            destacar_em(d, base, destaque)
        except Exception as e:
            print(f"[{base}] AVISO: não consegui destacar ({e}). O story foi postado mesmo assim.")
    print(f"[{base}] OK ✔")


def main():
    imagem = achar_imagem()  # opcional: se não tiver, usa a foto que já está no dispositivo
    link, rotulo = ler_link()
    if not link:
        print("AVISO: link.txt vazio — o story vai sem link.")

    d = conectar()

    if imagem:
        print("Enviando a imagem para a galeria do MuMu...")
        d.push(str(imagem), IMG_REMOTA)
        d.shell(f"am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://{IMG_REMOTA}")
    else:
        print("Sem imagem.jpg no PC — vou usar a foto que já está no dispositivo (a única).")

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
