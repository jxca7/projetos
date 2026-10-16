@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias, so na primeira vez...
  call npm install --no-audit --no-fund
)
node testar-cookies.js %*
pause
