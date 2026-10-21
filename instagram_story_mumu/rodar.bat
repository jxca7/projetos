@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem Acha o Python (py ou python)
set PY=py
where py >nul 2>nul || set PY=python

echo Instalando o necessario (so na primeira vez, pode demorar um pouco)...
%PY% -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo Nao consegui instalar. Instale o Python 3.12 em:
  echo https://www.python.org/downloads/release/python-3127/
  echo Na primeira tela marque "Add python.exe to PATH". Depois rode de novo.
  pause
  exit /b 1
)

echo.
echo Deixe o MuMu ABERTO e com a Depuracao ADB ligada (Habilitar conexao local).
echo.
echo O que fazer? Digite a opcao e tecle Enter:
echo    home   = fotografar a TELA INICIAL do MuMu (os icones dos clones)
echo    agora  = fotografar a TELA ABERTA agora (ex.: dentro de um clone)
echo    (vazio)= so listar os apps
echo.
set "pkg="
set /p pkg=Opcao:

%PY% diagnostico.py %pkg%

echo.
pause
