@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias, so na primeira vez...
  call npm install
)
node instagram-setup.js
pause
