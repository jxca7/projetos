@echo off
cd /d "%~dp0"
echo Baixando a versao mais nova...
set "BASE=https://raw.githubusercontent.com/jxca7/projetos/claude/instagram-reels-downloader-bkjo1e/instagram_reels_downloader"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; $t=[DateTime]::Now.Ticks; foreach($f in 'reels.py','requirements.txt','baixar.bat','instalar.bat'){ Invoke-WebRequest \"$env:BASE/$f`?t=$t\" -OutFile $f -Headers @{'Cache-Control'='no-cache'} }"
if errorlevel 1 (
    echo ERRO ao baixar.
    pause
    exit /b 1
)
echo Atualizando bibliotecas...
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
echo Atualizado!
pause
