@echo off
rem Menu do programa. Chamado pelo rodar.bat depois da atualizacao (por isso pode ser atualizado sozinho).
chcp 65001 >nul
cd /d "%~dp0"

rem Cria as pastas e arquivos-modelo (cookies\, bios\, fotos\, testar\, bio.txt, site.txt...)
node preparar.js

:menu
echo.
echo  ================= Instagram =================
echo    1 - Foto/bio + Conectar (tudo de uma vez)
echo    2 - So foto, bio e convite de testador
echo    3 - So conectar a conta no site
echo    4 - Testar cookies (janela escondida)
echo    5 - Testar cookies (mostrando as janelas)
echo    6 - Postar story (com link e destaque)
echo    0 - Sair
echo  ============================================
set "op="
set /p op=Digite o numero e tecle Enter:

if "%op%"=="1" ( node menu.js tudo & goto fim )
if "%op%"=="2" ( node menu.js perfil & goto fim )
if "%op%"=="3" ( node menu.js conectar & goto fim )
if "%op%"=="4" ( node menu.js testar & goto fim )
if "%op%"=="5" ( node menu.js testar --ver & goto fim )
if "%op%"=="6" ( call story\rodar_story.bat & cd /d "%~dp0" & goto fim )
if "%op%"=="0" exit /b 0
echo Opcao invalida.
goto menu

:fim
echo.
pause
goto menu
