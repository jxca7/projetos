@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist node_modules (
  echo Instalando dependencias, so na primeira vez...
  call npm install --no-audit --no-fund
)

echo Verificando atualizacao...
node atualizar.js
rem (o menu fica no menu.bat, que se atualiza sozinho; NAO mude as linhas acima deste comentario)
call menu.bat
