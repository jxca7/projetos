@echo off
cd /d "%~dp0"
echo Baixando a versao mais nova...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; $sha=(Invoke-RestMethod 'https://api.github.com/repos/jxca7/projetos/commits/claude/instagram-reels-downloader-bkjo1e').sha; $b='https://raw.githubusercontent.com/jxca7/projetos/' + $sha + '/instagram_reels_downloader/'; New-Item -ItemType Directory -Force sistema | Out-Null; foreach($f in 'sistema/reels.py','sistema/requirements.txt','sistema/baixar_reels_navegador.js','baixar.bat','instalar.bat','atualizar.bat'){ Invoke-WebRequest ($b + $f) -OutFile ($f + '.novo') }; foreach($f in 'sistema/reels.py','sistema/requirements.txt','sistema/baixar_reels_navegador.js','baixar.bat','instalar.bat'){ Move-Item -Force ($f + '.novo') $f }"
if errorlevel 1 (
    echo ERRO ao baixar.
    pause
    exit /b 1
)
echo Atualizando bibliotecas...
"sistema\.venv\Scripts\python.exe" -m pip install -q -r sistema\requirements.txt
findstr /c:"VERSAO = " sistema\reels.py
echo Atualizado!
pause
move /y atualizar.bat.novo atualizar.bat >nul
