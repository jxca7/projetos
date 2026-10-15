#!/usr/bin/env bash
# Instala o downloader de Reels numa VPS Ubuntu/Debian.
# Uso:  bash instalar.sh
set -e
cd "$(dirname "$0")"
echo ">> Instalando Python, ffmpeg e tmux..."
sudo apt-get update -y
sudo apt-get install -y python3 python3-venv ffmpeg tmux
echo ">> Criando ambiente Python..."
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
chmod +x reels.py
echo
echo "Pronto! Agora envie o cookies.txt para esta pasta:  $(pwd)"
echo "e rode:  .venv/bin/python reels.py"
