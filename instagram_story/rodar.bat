@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"

if not exist .venv (
  echo Preparando o Python, so na primeira vez...
  rem Tenta criar o ambiente com 3.12/3.13/3.11 (tem tudo pronto). O 3.15 e muito novo e quebra.
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
    pause
    exit /b 1
  )

  .venv\Scripts\python -m pip install --upgrade pip -q
  .venv\Scripts\python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo.
    echo ========================================================================
    echo  FALHOU ao instalar. Quase sempre e o Python ser muito novo ^(3.14/3.15^).
    echo  1^) Instale o Python 3.12: https://www.python.org/downloads/release/python-3127/
    echo  2^) Apague a pasta .venv
    echo  3^) Rode o rodar.bat de novo
    echo ========================================================================
    rmdir /s /q .venv 2>nul
    pause
    exit /b 1
  )
)

echo Verificando atualizacao...
.venv\Scripts\python atualizar.py
echo.
.venv\Scripts\python postar_story.py
pause
