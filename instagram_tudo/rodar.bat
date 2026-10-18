@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist node_modules (
  echo Instalando dependencias, so na primeira vez...
  call npm install --no-audit --no-fund
)

echo Verificando atualizacao...
node atualizar.js

:menu
echo.
echo  ============== Instagram ==============
echo    1 - Foto, bio e convite de testador
echo    2 - Conectar a conta no site
echo    3 - Testar cookies (janela escondida)
echo    4 - Testar cookies (mostrando as janelas)
echo    0 - Sair
echo  ======================================
set "op="
set /p op=Digite o numero e tecle Enter:

if "%op%"=="1" ( node menu.js perfil & goto fim )
if "%op%"=="2" ( node menu.js conectar & goto fim )
if "%op%"=="3" ( node menu.js testar & goto fim )
if "%op%"=="4" ( node menu.js testar --ver & goto fim )
if "%op%"=="0" exit /b 0
echo Opcao invalida.
goto menu

:fim
echo.
pause
goto menu
