#!/usr/bin/env bash
# Gera midia de teste que respeita as especificacoes do Instagram:
# reel 1080x1920 (9:16), 6s, H.264 + AAC; imagem 1080x1350 (4:5).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/fixtures"
mkdir -p "$DIR"

ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=0x1b1b2f:s=1080x1920:d=6,format=yuv420p" \
  -f lavfi -i "sine=frequency=440:duration=6" \
  -vf "drawtext=text='REEL DE TESTE':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=(h-text_h)/2" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 128k -shortest \
  "$DIR/reel.mp4"

ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=0x2f1b2f:s=1080x1350:d=1" \
  -vf "drawtext=text='POST DE TESTE':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2" \
  -frames:v 1 -q:v 2 \
  "$DIR/post.jpg"

echo "fixtures em $DIR:"
ls -la "$DIR"
