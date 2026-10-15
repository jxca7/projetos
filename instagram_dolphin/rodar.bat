@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias, so na primeira vez...
  call npm install --no-audit --no-fund
)
echo Verificando atualizacao...
node atualizar.js
echo.
node instagram-setup.js
pause
