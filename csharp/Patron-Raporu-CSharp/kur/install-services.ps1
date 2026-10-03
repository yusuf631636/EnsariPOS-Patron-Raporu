# Ensari POS Patron (C# sürüm) - AlfaPOS Bulut'un "Patron Servislerini Yeniden Kur" kisayolu bu dosyayi calistirir.
# Eskiden Node (server.js) servisini kurardi; C# surumunde: Patron servisini kur\Patron_Kurulum.ps1 ile (C#) kurar,
# Cloudflare tunel servisini (EnsariPatronTunnel) eskisi gibi NSSM + bin\cloudflared.exe ile kurar.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Bu script Yonetici olarak calistirilmalidir.' }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'kur\Patron_Kurulum.ps1') -InstallDir $PSScriptRoot -Silent

$nssm = Join-Path $PSScriptRoot 'nssm.exe'
$cfExe = Join-Path $PSScriptRoot 'bin\cloudflared.exe'
$port = 8787
$cfgPath = Join-Path $PSScriptRoot 'config.json'
if (Test-Path $cfgPath) { $m = [regex]::Match([IO.File]::ReadAllText($cfgPath), '"port"\s*:\s*(\d+)'); if ($m.Success) { $port = [int]$m.Groups[1].Value } }
$logDir = Join-Path $env:ProgramData 'EnsariPOS\PatronRaporu\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if ((Test-Path $nssm) -and (Test-Path $cfExe)) {
  $name = 'EnsariPatronTunnel'
  if (Get-Service -Name $name -ErrorAction SilentlyContinue) { & $nssm stop $name 2>&1 | Out-Null; & $nssm remove $name confirm 2>&1 | Out-Null }
  & $nssm install $name $cfExe 2>&1 | Out-Null
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$name\Parameters" -Name AppParameters -Value "tunnel --url http://127.0.0.1:$port"
  & $nssm set $name AppDirectory $PSScriptRoot 2>&1 | Out-Null
  & $nssm set $name AppStdout (Join-Path $logDir 'tunnel.out.log') 2>&1 | Out-Null
  & $nssm set $name AppStderr (Join-Path $logDir 'tunnel.log') 2>&1 | Out-Null
  & $nssm set $name Start SERVICE_AUTO_START 2>&1 | Out-Null
  & $nssm set $name AppExit Default Restart 2>&1 | Out-Null
  & $nssm start $name 2>&1 | Out-Null
  Write-Host "$name kuruldu." -ForegroundColor Green
} else {
  Write-Host 'cloudflared.exe / nssm.exe yok - tunel servisi kurulmadi (bulut paneli yine calisir).' -ForegroundColor Yellow
}
Start-Sleep -Seconds 2
