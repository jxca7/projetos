@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Rode primeiro o instalar.bat
    pause
    exit /b 1
)
".venv\Scripts\python.exe" reels.py %*
echo.
pause
