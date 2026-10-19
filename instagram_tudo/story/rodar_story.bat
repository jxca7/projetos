@echo off
rem Chamado pelo rodar.bat principal (opcao Postar story). Prepara o Python na 1a vez e posta.
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"

if not exist .venv (
  echo Preparando o Python do story, so na primeira vez...
  rem 3.12/3.13/3.11 tem tudo pronto. O 3.14/3.15 e muito novo e quebra.
  py -3.12 -m venv .venv 2>nul
  if not exist .venv py -3.13 -m venv .venv 2>nul
  if not exist .venv py -3.11 -m venv .venv 2>nul
  if not exist .venv py -3.10 -m venv .venv 2>nul
  if not exist .venv py -3 -m venv .venv 2>nul
  if not exist .venv python -m venv .venv 2>nul
  if not exist .venv (
    echo.
    echo Nao achei o Python. Instale a versao 3.12 em:
    echo https://www.python.org/downloads/release/python-3127/
    echo Na primeira tela marque "Add python.exe to PATH".
    exit /b 1
  )
  .venv\Scripts\python -m pip install --upgrade pip -q
  .venv\Scripts\python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo.
    echo FALHOU ao instalar. Quase sempre e o Python ser muito novo. Instale o 3.12 e rode de novo.
    rmdir /s /q .venv 2>nul
    exit /b 1
  )
)

.venv\Scripts\python postar_story.py
