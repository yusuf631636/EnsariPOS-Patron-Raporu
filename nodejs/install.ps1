$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host 'SambaPOS Patron Raporu kurulumu' -ForegroundColor Cyan
& (Join-Path $root 'install-requirements.ps1')
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js bulunamadi. Node.js LTS kurup tekrar deneyin.' }
if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) { Write-Warning 'sqlcmd bulunamadi. SQL Server komut satiri araclarini kurun.' }
$configPath = Join-Path $root 'config.json'
if (-not (Test-Path $configPath)) { Copy-Item (Join-Path $root 'config.example.json') $configPath }
Write-Host "Veritabani ayari: $configPath" -ForegroundColor Green
Write-Host 'Paneli baslatmak icin start.ps1 calistirin.' -ForegroundColor Green
