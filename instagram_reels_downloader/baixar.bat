@echo off
cd /d "%~dp0"
if not exist "sistema\.venv\Scripts\python.exe" (
    echo Rode primeiro o instalar.bat
    pause
    exit /b 1
)
"sistema\.venv\Scripts\python.exe" "sistema\reels.py" %*
echo.
pause
