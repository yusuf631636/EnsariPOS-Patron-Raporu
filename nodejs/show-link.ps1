# Guncel disaridan erisim linkini(leri) gosterir, panoya kopyalar ve tarayicida acar.
# Oncelik: Tailscale (router'a dokunmaz) > DDNS (port yonlendirmeye bagli) > degisken Cloudflare linki.
$ErrorActionPreference = 'SilentlyContinue'
$dataDir = Join-Path $env:ProgramData 'EnsariPOS\PatronRaporu'
$tailscaleLinkFile = Join-Path $dataDir 'tailscale-link.txt'
$ddnsLinkFile = Join-Path $dataDir 'ddns-link.txt'
$tunnelLinkFile = Join-Path $dataDir 'tunnel-link.txt'

function Read-First([string]$file) { if (Test-Path $file) { Get-Content $file -ErrorAction SilentlyContinue | Select-Object -First 1 } else { $null } }
$tailscaleUrl = Read-First $tailscaleLinkFile
$ddnsUrl = Read-First $ddnsLinkFile
$tunnelUrl = Read-First $tunnelLinkFile

if ($tailscaleUrl) { Write-Host "Kalici erisim linki (Tailscale): $tailscaleUrl" -ForegroundColor Green }
if ($ddnsUrl) { Write-Host "Kalici erisim linki (DDNS): $ddnsUrl" -ForegroundColor Green }
if ($tunnelUrl) { Write-Host "Degisken tunel linki: $tunnelUrl" -ForegroundColor Cyan }

$primary = if ($tailscaleUrl) { $tailscaleUrl } elseif ($ddnsUrl) { $ddnsUrl } else { $tunnelUrl }
if ($primary) {
  try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText($primary); Write-Host 'Link panoya kopyalandi.' -ForegroundColor Green } catch {}
  Start-Process $primary
} else {
  Write-Host 'Henuz hazir bir dis erisim linki yok.' -ForegroundColor Yellow
  Write-Host 'Once "Ensari POS Patron" kisayolunu calistirin, birkac saniye bekleyin, sonra tekrar deneyin.' -ForegroundColor DarkGray
}
Start-Sleep -Seconds 6
