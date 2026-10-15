@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"

if not exist .venv (
  echo Preparando o Python, so na primeira vez...
  py -3 -m venv .venv 2>nul || python -m venv .venv
  if not exist .venv (
    echo Nao achei o Python. Instale em https://www.python.org/downloads/ marcando "Add python.exe to PATH".
    pause
    exit /b 1
  )
  .venv\Scripts\python -m pip install --upgrade pip -q
  .venv\Scripts\python -m pip install -r requirements.txt
)

echo Verificando atualizacao...
.venv\Scripts\python atualizar.py
echo.
.venv\Scripts\python postar_story.py
pause
