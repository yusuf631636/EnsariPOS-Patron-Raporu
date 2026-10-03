$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { throw 'cloudflared kurulu degil. Cloudflare Tunnel istemcisini kurduktan sonra tekrar deneyin.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js kurulu degil. install-requirements.ps1 calistirin.' }
if (-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)) {
	Start-Process node -ArgumentList '.\server.js' -WorkingDirectory $PSScriptRoot -WindowStyle Minimized
	Write-Host 'Ensari POS Patron yerel sunucusu baslatildi.' -ForegroundColor Green
}
Write-Host 'Dis erisim linki asagida verilecek:' -ForegroundColor Yellow
cloudflared tunnel --url http://127.0.0.1:8787
