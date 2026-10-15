@echo off
cd /d "%~dp0"
echo Baixando a versao mais nova do reels.py...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest 'https://raw.githubusercontent.com/jxca7/projetos/claude/instagram-reels-downloader-bkjo1e/instagram_reels_downloader/reels.py' -OutFile 'reels.py'"
if errorlevel 1 (echo ERRO ao atualizar.) else (echo Atualizado!)
pause
