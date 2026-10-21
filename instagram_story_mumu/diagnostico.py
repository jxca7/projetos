# Diagnóstico: conecta no MuMu pelo ADB, lista os apps (clones do Instagram) e, para um app,
# tira um print e salva o "mapa" da tela (os botões). Serve para a gente calibrar os toques.
#
# Uso:
#   python diagnostico.py                      -> conecta e lista os apps
#   python diagnostico.py <pacote>             -> abre esse app e salva print + mapa da tela
#
# A porta do ADB do MuMu aparece nas configurações do MuMu (varia por versão).
# Se precisar, conecte antes no terminal:  adb connect 127.0.0.1:PORTA

import sys
from pathlib import Path

try:
    import uiautomator2 as u2
except ImportError:
    print("Falta instalar: rode  pip install -r requirements.txt")
    sys.exit(1)

PASTA = Path(__file__).resolve().parent
# Endereço do ADB do MuMu. Se o seu for outro, troque aqui ou passe em ADDR_ENV.
import os
ADDR = os.environ.get("MUMU_ADB", "127.0.0.1:7555")


def conectar():
    print(f"Conectando no MuMu em {ADDR} ...")
    try:
        d = u2.connect(ADDR)
        _ = d.info  # força a conexão
        return d
    except Exception as e:
        print(f"Não conectei em {ADDR} ({e}).")
        print("Confira a porta do ADB nas configurações do MuMu e rode:  adb connect 127.0.0.1:PORTA")
        print("Depois rode de novo, ou defina a porta:  set MUMU_ADB=127.0.0.1:SUAPORTA")
        sys.exit(1)


def listar_apps(d):
    out = d.shell("pm list packages -3").output  # -3 = só apps instalados por você (não do sistema)
    pacotes = sorted(l.split(":", 1)[1].strip() for l in out.splitlines() if ":" in l)
    parecidos = [p for p in pacotes if "instagram" in p.lower() or "insta" in p.lower()]
    print(f"\nConectado. Apps instalados por você: {len(pacotes)}")
    print("\n== Apps parecidos com Instagram (clones) ==")
    for p in (parecidos or ["(nenhum com 'instagram' no nome — veja a lista completa abaixo)"]):
        print("  ", p)
    if not parecidos:
        print("\n== Todos os apps (procure os clones do Instagram) ==")
        for p in pacotes:
            print("  ", p)
    print("\nPara ver a tela de um app:  python diagnostico.py <pacote>")


def mapear(d, pacote):
    print(f"Abrindo {pacote} ...")
    d.app_start(pacote, wait=True)
    import time
    time.sleep(4)
    print("App atual:", d.app_current())
    png = PASTA / "tela.png"
    xml = PASTA / "tela.xml"
    d.screenshot(str(png))
    xml.write_text(d.dump_hierarchy(), encoding="utf-8")
    print(f"Print salvo em: {png}")
    print(f"Mapa da tela salvo em: {xml}")
    print("\nMe mande esses dois arquivos (tela.png e tela.xml) para eu calibrar os toques.")


def main():
    d = conectar()
    if len(sys.argv) > 1:
        mapear(d, sys.argv[1])
    else:
        listar_apps(d)


if __name__ == "__main__":
    main()
