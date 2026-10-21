# Diagnóstico: conecta no MuMu pelo ADB, lista os apps (clones do Instagram) e, para um app,
# tira um print e salva o "mapa" da tela (os botões). Serve para a gente calibrar os toques.
#
# Uso:
#   python diagnostico.py                      -> conecta e lista os apps
#   python diagnostico.py <pacote>             -> abre esse app e salva print + mapa da tela
#
# Você NÃO precisa saber a porta do MuMu: o script testa as portas comuns e conecta sozinho.
# Se quiser forçar uma:  set MUMU_ADB=127.0.0.1:SUAPORTA   (antes de rodar)

import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

try:
    import uiautomator2 as u2
except ImportError:
    print("Falta instalar: rode  pip install -r requirements.txt")
    sys.exit(1)

PASTA = Path(__file__).resolve().parent

# Portas de ADB mais usadas pelo MuMu (12 e 6) e por emuladores em geral.
PORTAS_MUMU = ["16384", "16416", "16448", "16480", "7555", "5555", "5557", "21503"]

# Lugares onde o adb do MuMu costuma ficar (caso você não tenha o adb no PATH).
ADB_MUMU = [
    r"C:\Program Files\Netease\MuMuPlayer-12.0\shell\adb.exe",
    r"C:\Program Files\Netease\MuMu Player 12\shell\adb.exe",
    r"C:\Program Files\Netease\MuMuPlayerGlobal-12.0\shell\adb.exe",
    r"C:\Program Files (x86)\MuMu\emulator\nemu\vmonitor\bin\adb_server.exe",
]


def achar_adb():
    # 1) caminho forçado por você:  set ADB=C:\...\adb.exe
    env = os.environ.get("ADB")
    if env and Path(env).exists():
        return env
    # 2) adb no PATH
    if shutil.which("adb"):
        return "adb"
    # 3) adb copiado para a MESMA pasta deste script (jeito mais fácil: cole o adb.exe aqui)
    if (PASTA / "adb.exe").exists():
        return str(PASTA / "adb.exe")
    # 4) lugares comuns onde o platform-tools é baixado, e o adb do próprio MuMu
    user = Path(os.path.expanduser("~"))
    comuns = []
    for base in (user / "Documents", user / "Downloads", user / "Desktop", user / "OneDrive" / "Documents"):
        comuns += [base / "platform-tools" / "platform-tools" / "adb.exe", base / "platform-tools" / "adb.exe"]
    comuns += [Path(p) for p in ADB_MUMU]
    for p in comuns:
        if p.exists():
            return str(p)
    return "adb"  # última tentativa; se não existir, o erro aparece adiante


def rodar_adb(adb, *args, timeout=20):
    try:
        return subprocess.run([adb, *args], capture_output=True, text=True, timeout=timeout).stdout or ""
    except Exception:
        return ""


def achar_dispositivo():
    """Conecta nas portas comuns do MuMu e devolve o endereço de um aparelho pronto."""
    forcado = os.environ.get("MUMU_ADB")
    adb = achar_adb()
    candidatos = [forcado] if forcado else [f"127.0.0.1:{p}" for p in PORTAS_MUMU]

    for addr in candidatos:
        rodar_adb(adb, "connect", addr, timeout=8)

    saida = rodar_adb(adb, "devices")
    prontos = [l.split("\t")[0] for l in saida.splitlines()[1:] if "\tdevice" in l]
    if prontos:
        return prontos[0]
    if forcado:
        return forcado
    return None


def conectar():
    print("Procurando o MuMu pelo ADB...")
    addr = achar_dispositivo()
    if not addr:
        print("\nNão achei o MuMu. Confira:")
        print("  1) O MuMu está ABERTO.")
        print("  2) Em Opções do desenvolvedor, 'Depuração ADB' = Habilitar conexão local (e reinicie o MuMu).")
        print("  3) O 'adb.exe' precisa ser encontrado. O jeito mais fácil: copie o adb.exe")
        print("     (da pasta platform-tools) para a MESMA pasta deste script.")
        print("     Ou aponte o caminho:  set ADB=C:\\caminho\\para\\adb.exe")
        print("  Se souber a porta do MuMu, rode:  set MUMU_ADB=127.0.0.1:PORTA  e tente de novo.")
        sys.exit(1)
    print(f"Achei o aparelho: {addr}. Conectando...")
    try:
        d = u2.connect(addr)
        _ = d.info
        print("Conectado!")
        return d
    except Exception as e:
        print(f"Conectei no adb ({addr}) mas o uiautomator2 falhou ({e}).")
        print("Tente de novo; na primeira vez ele instala um app de apoio no MuMu e pode demorar.")
        sys.exit(1)


def listar_apps(d):
    out = d.shell("pm list packages -3").output  # -3 = só apps instalados por você (não do sistema)
    pacotes = sorted(l.split(":", 1)[1].strip() for l in out.splitlines() if ":" in l)
    parecidos = [p for p in pacotes if "instagram" in p.lower() or "insta" in p.lower()]
    print(f"\nApps instalados por você: {len(pacotes)}")
    print("\n== Apps parecidos com Instagram (clones) ==")
    for p in (parecidos or ["(nenhum com 'instagram' no nome — veja a lista completa abaixo)"]):
        print("  ", p)
    if not parecidos:
        print("\n== Todos os apps (procure os clones do Instagram) ==")
        for p in pacotes:
            print("  ", p)
    print("\nPara ver a tela de um app:  python diagnostico.py <pacote>")


def _salvar(d, base):
    png = PASTA / f"{base}.png"
    xml = PASTA / f"{base}.xml"
    d.screenshot(str(png))
    xml.write_text(d.dump_hierarchy(), encoding="utf-8")
    print(f"\nSalvei: {png.name} e {xml.name} — me mande esses dois arquivos.")
    return xml.read_text(encoding="utf-8")


def _icones(xml_text):
    textos = re.findall(r'text="([^"]+)"', xml_text) + re.findall(r'content-desc="([^"]+)"', xml_text)
    alvos = [t.strip() for t in textos if t.strip() and re.search(r"insta|#\s*n?\d", t, re.I)]
    return sorted(set(alvos))


def mapear_home(d):
    print("Indo para a tela inicial do MuMu...")
    d.press("home")
    time.sleep(2)
    xml = _salvar(d, "home")
    icones = _icones(xml)
    print("\nÍcones parecidos com os clones encontrados na tela:")
    for t in (icones or ["(não achei textos de ícone — me mande o home.png que eu vejo pelo print)"]):
        print("  ", t)


def capturar_atual(d):
    print("Capturando a tela que está aberta agora...")
    time.sleep(1)
    print("App atual:", d.app_current())
    _salvar(d, "tela")


def mapear(d, pacote):
    print(f"Abrindo {pacote} ...")
    d.app_start(pacote, wait=True)
    time.sleep(4)
    print("App atual:", d.app_current())
    _salvar(d, "tela")


def main():
    d = conectar()
    arg = (sys.argv[1] if len(sys.argv) > 1 else "").strip().lower()
    if not arg:
        listar_apps(d)
    elif arg in ("home", "inicio", "início", "tela-inicial"):
        mapear_home(d)
    elif arg in ("agora", "tela", "atual"):
        capturar_atual(d)
    else:
        mapear(d, sys.argv[1])


if __name__ == "__main__":
    main()
