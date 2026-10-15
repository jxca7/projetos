# Reorganiza uma pasta do formato antigo (tudo solto) para o novo:
#   reels\  baixar.bat, atualizar.bat, instalar.bat, cookies.txt, proxy*.txt
#   reels\videos\<conta>\   os reels
#   reels\sistema\          programa, Python, ffmpeg, historico
# Uso (PowerShell aberto DENTRO da pasta do programa):
#   irm <url deste arquivo> | iex
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'

if (-not (Test-Path 'baixar.bat')) {
    Write-Host 'ERRO: abra o PowerShell dentro da pasta do programa (onde esta o baixar.bat).' -ForegroundColor Red
    return
}
Write-Host '1/4 Baixando a versao nova...'
New-Item -ItemType Directory -Force 'sistema', 'videos', 'sistema\dados' | Out-Null
$sha = (Invoke-RestMethod 'https://api.github.com/repos/jxca7/projetos/commits/claude/instagram-reels-downloader-bkjo1e').sha
$base = "https://raw.githubusercontent.com/jxca7/projetos/$sha/instagram_reels_downloader/"
foreach ($f in 'sistema/reels.py', 'sistema/requirements.txt', 'sistema/baixar_reels_navegador.js',
               'sistema/instalar.sh', 'baixar.bat', 'instalar.bat', 'atualizar.bat') {
    Invoke-WebRequest ($base + $f) -OutFile $f
}

Write-Host '2/4 Movendo os arquivos do sistema...'
if ((Test-Path 'ffmpeg') -and -not (Test-Path 'sistema\ffmpeg')) { Move-Item 'ffmpeg' 'sistema\ffmpeg' }
if (Test-Path 'ids_das_contas.txt') { Move-Item -Force 'ids_das_contas.txt' 'sistema\dados\' }
if (Test-Path '.venv') { Remove-Item -Recurse -Force '.venv' }
foreach ($f in 'reels.py', 'requirements.txt', 'instalar.sh', 'baixar_reels_navegador.js',
               'README.md', '.gitignore', 'proxy.txt.exemplo') {
    if (Test-Path $f) { Remove-Item -Force $f }
}

Write-Host '3/4 Movendo os videos para a pasta videos...'
foreach ($pasta in @(Get-ChildItem -Directory -Filter 'reels_*')) {
    $conta = $pasta.Name.Substring(6)
    $dados = "sistema\dados\$conta"
    New-Item -ItemType Directory -Force $dados, "videos\$conta" | Out-Null
    foreach ($h in 'baixados.txt', 'lista_reels.json') {
        $arq = Join-Path $pasta.FullName $h
        if (Test-Path $arq) {
            if ($h -eq 'baixados.txt' -and (Test-Path "$dados\$h")) {
                Get-Content $arq | Add-Content "$dados\$h"; Remove-Item $arq
            } else { Move-Item -Force $arq "$dados\$h" }
        }
    }
    foreach ($item in @(Get-ChildItem -Force $pasta.FullName)) {
        if (-not (Test-Path "videos\$conta\$($item.Name)")) { Move-Item $item.FullName "videos\$conta\" }
    }
    if (-not (Get-ChildItem -Force $pasta.FullName)) { Remove-Item $pasta.FullName }
    Write-Host "   $($pasta.Name) -> videos\$conta"
}

Write-Host '4/4 Instalando (alguns segundos)...'
cmd /c instalar.bat
Write-Host ''
Write-Host 'Pronto! Pasta organizada.' -ForegroundColor Green
