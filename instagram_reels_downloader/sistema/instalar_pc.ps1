# Instala o Downloader de Reels do zero em C:\reels.
# Uso: abra o PowerShell e cole:
#   irm https://raw.githubusercontent.com/jxca7/projetos/claude/instagram-reels-downloader-bkjo1e/instagram_reels_downloader/sistema/instalar_pc.ps1 | iex
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
$ProgressPreference = 'SilentlyContinue'
$destino = 'C:\reels'

Write-Host "Instalando o Downloader de Reels em $destino ..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force $destino, "$destino\sistema", "$destino\videos" | Out-Null
Set-Location $destino

try {
    $ref = (Invoke-RestMethod 'https://api.github.com/repos/jxca7/projetos/commits/claude/instagram-reels-downloader-bkjo1e').sha
} catch {
    $ref = 'claude/instagram-reels-downloader-bkjo1e'
}
$base = "https://raw.githubusercontent.com/jxca7/projetos/$ref/instagram_reels_downloader/"
foreach ($f in 'sistema/reels.py', 'sistema/requirements.txt', 'baixar.bat', 'instalar.bat', 'atualizar.bat') {
    Write-Host "   baixando $f"
    Invoke-WebRequest ($base + $f) -OutFile $f
}

Write-Host 'Instalando Python, ffmpeg e bibliotecas (pode levar alguns minutos)...' -ForegroundColor Cyan
cmd /c instalar.bat

Start-Process explorer.exe $destino
Write-Host ''
Write-Host "PRONTO! A pasta $destino foi aberta." -ForegroundColor Green
Write-Host 'Agora coloque o cookies.txt nela e de dois cliques em baixar.bat.' -ForegroundColor Green
