@echo off
setlocal
cd /d "%~dp0"
if not exist "sistema\" mkdir sistema
if not exist "videos\" mkdir videos
cd /d "%~dp0sistema"
echo ==========================================
echo   Instalando o downloader de Reels
echo ==========================================
echo.

rem ---------- Python ----------
set "PY=%LocalAppData%\Programs\Python\Python312\python.exe"
if exist "%PY%" goto temPython
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>nul
if not errorlevel 1 (
    set "PY=python"
    goto temPython
)
echo [1/3] Baixando o Python (pode levar 1-2 minutos)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe' -OutFile (Join-Path $env:TEMP 'python-instalador.exe')"
echo       Instalando o Python...
"%TEMP%\python-instalador.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0
set "PY=%LocalAppData%\Programs\Python\Python312\python.exe"
:temPython
"%PY%" --version >nul 2>nul
if errorlevel 1 (
    echo ERRO: nao consegui instalar o Python. Instale manualmente pelo site python.org
    echo marcando a opcao "Add python.exe to PATH", e rode este arquivo de novo.
    pause
    exit /b 1
)
echo [1/3] Python OK

rem ---------- ffmpeg ----------
where ffmpeg >nul 2>nul
if not errorlevel 1 goto temFfmpeg
if exist "ffmpeg\" goto temFfmpeg
echo [2/3] Baixando o ffmpeg (uns 100 MB)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile 'ffmpeg.zip'; Expand-Archive 'ffmpeg.zip' -DestinationPath 'ffmpeg' -Force; Remove-Item 'ffmpeg.zip'"
if not exist "ffmpeg\" (
    echo ERRO: nao consegui baixar o ffmpeg. Confira a internet e rode de novo.
    pause
    exit /b 1
)
:temFfmpeg
echo [2/3] ffmpeg OK

rem ---------- bibliotecas ----------
echo [3/3] Instalando bibliotecas...
if not exist ".venv\Scripts\python.exe" "%PY%" -m venv .venv
".venv\Scripts\python.exe" -m pip install -q --upgrade pip
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
if errorlevel 1 (
    echo ERRO ao instalar as bibliotecas.
    pause
    exit /b 1
)
echo.
echo ==========================================
echo   PRONTO! Agora:
echo   1. Coloque o cookies.txt na pasta de fora (junto do baixar.bat)
echo   2. De dois cliques em baixar.bat
echo ==========================================
pause
