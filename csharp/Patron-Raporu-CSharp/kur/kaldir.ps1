# Ensari POS Patron (C#) - servisi kaldirir (verilere ve Cloudflare tunel servisine dokunmaz).
param([switch]$Silent)
$ErrorActionPreference = "SilentlyContinue"
$ServiceName = "EnsariPatron"
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    & sc.exe stop $ServiceName | Out-Null
    for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Milliseconds 500; $s = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue; if (-not $s -or $s.Status -eq 'Stopped') { break } }
    & sc.exe delete $ServiceName | Out-Null
    Write-Host "$ServiceName servisi kaldirildi." -ForegroundColor Yellow
}
Get-Process -Name PatronSrv -ErrorAction SilentlyContinue | Stop-Process -Force