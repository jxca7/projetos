# Baixa a versão mais nova do script do GitHub antes de rodar.
# Só atualiza os arquivos do programa; cookies, story.jpg, link.txt e proxy.txt nunca são tocados.

import py_compile
import subprocess
import sys
import urllib.request
from pathlib import Path

BASE = "https://raw.githubusercontent.com/jxca7/projetos/claude/great-fermat-rymemy/instagram_story/"
ARQUIVOS = ["postar_story.py", "atualizar.py", "requirements.txt", "LEIA-ME.md"]
PASTA = Path(__file__).resolve().parent


def main():
    mudou = []
    for nome in ARQUIVOS:
        try:
            with urllib.request.urlopen(BASE + nome, timeout=15) as resp:
                novo = resp.read()
        except Exception as err:
            print(f"Não consegui baixar {nome} ({err}).")
            continue

        local = PASTA / nome
        if local.exists() and local.read_bytes() == novo:
            continue

        # Não troca um .py por uma versão quebrada
        if nome.endswith(".py"):
            tmp = PASTA / (nome + ".novo")
            tmp.write_bytes(novo)
            try:
                py_compile.compile(str(tmp), doraise=True)
            except py_compile.PyCompileError:
                tmp.unlink()
                print(f"Atualização de {nome} ignorada (arquivo baixado com erro).")
                continue
            tmp.replace(local)
        else:
            local.write_bytes(novo)
        mudou.append(nome)

    if "requirements.txt" in mudou:
        print("Instalando dependências novas...")
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", str(PASTA / "requirements.txt")])

    print(f"Atualizado: {', '.join(mudou)}" if mudou else "Já está na versão mais nova.")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        # Sem internet ou GitHub fora do ar: segue com a versão que já tem
        print(f"Não consegui verificar atualização ({err}). Usando a versão atual.")
