# Ensari POS Patron - arka planda calisan sureci durdurur.
# Tekrar baslatmak icin "Ensari POS Patron" kisayoluna (start.ps1) tiklaman yeterli.
$ErrorActionPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot
$runDir = Join-Path $env:ProgramData 'EnsariPOS\PatronRaporu\run'

function Stop-ByPidFile([string]$fileName) {
  $file = Join-Path $runDir $fileName
  if (Test-Path $file) {
    $processId = Get-Content $file -ErrorAction SilentlyContinue
    if ($processId) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
    Remove-Item $file -ErrorAction SilentlyContinue
  }
}

Stop-ByPidFile 'tunnel.pid'
Stop-ByPidFile 'caddy.pid'
Stop-ByPidFile 'node.pid'
Stop-ByPidFile 'supervisor.pid'

# Panel kapaliyken disaridan erisim de kapansin: Tailscale Funnel kuralini kaldir
# (Tailscale servisinin kendisi/VPN baglantisi acik kalir, sadece 8787 disariya kapanir).
$tsExe = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $tsExe) { $tsExe = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe' }
if (Test-Path $tsExe) { & $tsExe funnel 8787 off 2>&1 | Out-Null }

# Eski linklerin kalip yeni baslatmada yanlislikla "guncel" gibi okunmasini onle.
Remove-Item (Join-Path $env:ProgramData 'EnsariPOS\PatronRaporu\tunnel-link.txt') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:ProgramData 'EnsariPOS\PatronRaporu\ddns-link.txt') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:ProgramData 'EnsariPOS\PatronRaporu\tailscale-link.txt') -ErrorAction SilentlyContinue

Write-Host 'Ensari POS Patron durduruldu.' -ForegroundColor Yellow
Write-Host 'Tekrar baslatmak icin "Ensari POS Patron" kisayoluna tiklayin.' -ForegroundColor DarkGray
Start-Sleep -Seconds 4
