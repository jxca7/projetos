@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"

if not exist .venv (
  echo Preparando o Python, so na primeira vez...
  rem Prefere 3.12/3.13/3.11 (tem tudo pronto). O 3.15 e muito novo e quebra na instalacao.
  set PYEXE=
  for %%V in (3.12 3.13 3.11 3.10) do (
    if not defined PYEXE ( py -%%V -c "import sys" >nul 2>&1 && set PYEXE=py -%%V )
  )
  if not defined PYEXE ( py -3 -c "import sys" >nul 2>&1 && set PYEXE=py -3 )
  if not defined PYEXE ( python -c "import sys" >nul 2>&1 && set PYEXE=python )
  if not defined PYEXE (
    echo Nao achei o Python. Instale a versao 3.12 em https://www.python.org/downloads/release/python-3127/
    echo Na primeira tela marque "Add python.exe to PATH".
    pause
    exit /b 1
  )
  echo Usando: %PYEXE%
  %PYEXE% -m venv .venv
  if not exist .venv (
    echo Nao consegui criar o ambiente. Instale o Python 3.12 e tente de novo.
    pause
    exit /b 1
  )
  .venv\Scripts\python -m pip install --upgrade pip -q
  .venv\Scripts\python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo.
    echo ========================================================================
    echo  FALHOU ao instalar. Isso quase sempre e o Python ser muito novo ^(3.15^).
    echo  Instale o Python 3.12 em:
    echo  https://www.python.org/downloads/release/python-3127/
    echo  Depois apague a pasta .venv e rode de novo.
    echo ========================================================================
    pause
    exit /b 1
  )
)

echo Verificando atualizacao...
.venv\Scripts\python atualizar.py
echo.
.venv\Scripts\python postar_story.py
pause
