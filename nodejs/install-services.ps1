# Ensari POS Patron - NSSM ile iki Windows servisi kurar: node sunucusu ve
# kendi Cloudflare tuneli (C:\kurye takip ile ayni desen, tamamen ayri servis
# adlari/portlari - baska hicbir servise dokunulmaz).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Bu script Yonetici olarak calistirilmalidir (Windows servisi kurmak icin gerekli). Kurulum programi (setup.exe) bunu otomatik yukseltilmis olarak calistirir.' }

$nssm = Join-Path $PSScriptRoot 'nssm.exe'
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw 'node.exe bulunamadi. install-requirements.ps1 calistirin.' }
$nodeExe = $nodeCmd.Source

$config = Get-Content (Join-Path $PSScriptRoot 'config.json') -Raw | ConvertFrom-Json
$port = if ($config.port) { $config.port } else { 8787 }

$runtimeDir = Join-Path $env:ProgramData 'EnsariPOS\PatronRaporu'
$logDir = Join-Path $runtimeDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$anyFailed = $false
function Install-Service($name, $exePath, $exeArgs, $stdout, $stderr) {
  if (Get-Service -Name $name -ErrorAction SilentlyContinue) {
    Write-Host "$name zaten kurulu, durdurup guncelleniyor..." -ForegroundColor Yellow
    & $nssm stop $name 2>&1 | Out-Null
    & $nssm remove $name confirm 2>&1 | Out-Null
  }
  & $nssm install $name $exePath 2>&1 | Out-Null
  # AppParameters'i nssm'in kendi CLI'sine argüman olarak degil, dogrudan registry'ye
  # yaziyoruz: boslukli yollarda PowerShell'in tirnakli stringi native komuta aktarma
  # davranisi guvenilmez sekilde bozuluyor (gercek kurulumda tespit edildi - kurye
  # takip icin node.exe eksik/bolunmus bir yol aliyordu). Dogrudan registry yazimi
  # bu CLI aktarim katmanini tamamen atlar.
  if ($exeArgs) {
    Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$name\Parameters" -Name AppParameters -Value $exeArgs
  }
  & $nssm set $name AppDirectory $PSScriptRoot 2>&1 | Out-Null
  & $nssm set $name AppStdout $stdout 2>&1 | Out-Null
  & $nssm set $name AppStderr $stderr 2>&1 | Out-Null
  & $nssm set $name Start SERVICE_AUTO_START 2>&1 | Out-Null
  & $nssm set $name AppExit Default Restart 2>&1 | Out-Null
  & $nssm set $name AppThrottle 15000 2>&1 | Out-Null
  & $nssm start $name 2>&1 | Out-Null
  Start-Sleep -Seconds 3
  $service = Get-Service -Name $name -ErrorAction SilentlyContinue
  # Ilk baslatma bir onceki basarisiz denemeden kalan durum yuzunden (orn. Paused)
  # basarisiz olabilir - bir kez daha durdur/baslat deneriz once vazgecmeden.
  if ($service -and $service.Status -ne 'Running') {
    & $nssm stop $name 2>&1 | Out-Null
    Start-Sleep -Seconds 1
    & $nssm start $name 2>&1 | Out-Null
    Start-Sleep -Seconds 3
    $service = Get-Service -Name $name -ErrorAction SilentlyContinue
  }
  if ($service -and $service.Status -eq 'Running') {
    Write-Host "$name calisiyor." -ForegroundColor Green
  } else {
    Write-Warning "$name baslatilamadi (durum: $(if ($service) { $service.Status } else { 'kurulmadi' })). $logDir altindaki .err.log dosyasina bakin."
    $script:anyFailed = $true
  }
}

Install-Service 'EnsariPatron' $nodeExe "`"$PSScriptRoot\server.js`"" (Join-Path $logDir 'server.log') (Join-Path $logDir 'server.err.log')

$cfExe = Join-Path $PSScriptRoot 'bin\cloudflared.exe'
if (Test-Path $cfExe) {
  Install-Service 'EnsariPatronTunnel' $cfExe "tunnel --url http://127.0.0.1:$port" (Join-Path $logDir 'tunnel.out.log') (Join-Path $logDir 'tunnel.log')
} else {
  Write-Warning 'cloudflared.exe bulunamadi, tunel servisi kurulamadi. install-requirements.ps1 calistirip tekrar deneyin.'
  $anyFailed = $true
}

Write-Host ''
if ($anyFailed) {
  Write-Host 'Kurulum kismen tamamlandi - yukaridaki uyarilari kontrol edin.' -ForegroundColor Yellow
} else {
  Write-Host 'Kurulum tamamlandi. Sunucu ve tunel Windows ile birlikte otomatik baslayacak.' -ForegroundColor Green
}
Write-Host "Servisleri gormek icin: services.msc  (EnsariPatron, EnsariPatronTunnel)" -ForegroundColor DarkGray
Start-Sleep -Seconds 3
