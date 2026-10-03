# Ensari POS Patron'u baslatir. Sunucu ve tunel gizli pencerede arka planda
# calismaya devam eder; bu pencere linki gosterdikten sonra kendiliginden kapanir.
# Panel durduysa (stop-patron.ps1 veya bilgisayar yeniden baslatma sonrasi) bu
# kisayola tekrar tiklamak yeterlidir.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')

$linkFile = Join-Path $env:ProgramData 'EnsariPOS\PatronRaporu\tunnel-link.txt'
# Zaten calisiyorsa (port acik) mevcut link hala gecerlidir; bekletmeden goster.
$alreadyRunning = [bool](Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
# Onceki calismadan kalan bayat link dosyasi varsa, "yeni link geldi" testini
# yanlislikla hemen gecmesin diye baslangic zamanini kaydediyoruz.
$before = if (Test-Path $linkFile) { (Get-Item $linkFile).LastWriteTime } else { $null }

Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$PSScriptRoot\run-patron.ps1"

Write-Host 'Ensari POS Patron baslatiliyor...' -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds(25)
Start-Sleep -Seconds 3
while (-not $alreadyRunning -and (Get-Date) -lt $deadline) {
  if (Test-Path $linkFile) {
    $current = (Get-Item $linkFile).LastWriteTime
    if (-not $before -or $current -gt $before) { break }
  }
  Start-Sleep -Milliseconds 800
}

Write-Host ''
Write-Host '  Yerel adres:            http://127.0.0.1:8787' -ForegroundColor Green
if (Test-Path $linkFile) {
  Write-Host ('  Disaridan erisim linki: ' + (Get-Content $linkFile)) -ForegroundColor Cyan
} else {
  Write-Host '  Dis erisim linki henuz hazir degil (cloudflared kurulu olmayabilir).' -ForegroundColor Yellow
  Write-Host '  Hazir olunca "Tunel Linkini Goster" kisayolundan görebilirsin.' -ForegroundColor DarkGray
}
$tailscaleLinkFile = Join-Path $env:ProgramData 'EnsariPOS\PatronRaporu\tailscale-link.txt'
if (Test-Path $tailscaleLinkFile) { Write-Host ('  Kalici erisim linki:    ' + (Get-Content $tailscaleLinkFile)) -ForegroundColor Green }
$ddnsLinkFile = Join-Path $env:ProgramData 'EnsariPOS\PatronRaporu\ddns-link.txt'
if (Test-Path $ddnsLinkFile) { Write-Host ('  Kalici erisim linki (DDNS): ' + (Get-Content $ddnsLinkFile)) -ForegroundColor Green }
Write-Host ''
Write-Host '  Panel arka planda calismaya devam edecek.' -ForegroundColor DarkGray
Write-Host '  Durdurmak icin "Ensari POS Patron - Durdur" kisayolunu kullanin.' -ForegroundColor DarkGray
Write-Host ''
Start-Sleep -Seconds 6
