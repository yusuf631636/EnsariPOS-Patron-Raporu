# Ensari POS Patron - arka plan denetleyicisi.
# Node sunucusunu ve Cloudflare tunelini surekli ayakta tutar; biri coker veya
# kapanirsa otomatik yeniden baslatir. start.ps1 tarafindan gizli pencerede
# calistirilir; kullanici bilgisayari kapatana kadar arka planda kalir.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

# Yeni kurulan Node/cloudflared PATH'e yeni eklenmis olabilir; guncel PATH'i oku.
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')

$runtimeDir = Join-Path $env:ProgramData 'EnsariPOS\PatronRaporu'
$logDir = Join-Path $runtimeDir 'logs'
$runDir = Join-Path $runtimeDir 'run'
New-Item -ItemType Directory -Force -Path $logDir, $runDir | Out-Null
$tunnelLinkFile = Join-Path $runtimeDir 'tunnel-link.txt'
# cloudflared linki stderr'e yazar; Start-Process stdout/stderr icin ayni dosyayi kabul etmez.
$tunnelLogFile = Join-Path $logDir 'tunnel.log'
$tunnelOutFile = Join-Path $logDir 'tunnel.out.log'
$supervisorPidFile = Join-Path $runDir 'supervisor.pid'

# Ayni anda iki denetleyici calismasin: onceki denetleyici hala yasiyorsa cik.
if (Test-Path $supervisorPidFile) {
  $existingId = Get-Content $supervisorPidFile -ErrorAction SilentlyContinue
  if ($existingId) {
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$existingId" -ErrorAction SilentlyContinue
    if ($existing -and $existing.CommandLine -match 'run-patron\.ps1') {
      Write-Host 'Ensari POS Patron zaten arka planda calisiyor.' -ForegroundColor Yellow
      if (Test-Path $tunnelLinkFile) { Write-Host ('Guncel disaridan erisim linki: ' + (Get-Content $tunnelLinkFile)) -ForegroundColor Cyan }
      exit 0
    }
  }
}
Set-Content -Path $supervisorPidFile -Value $PID

function Start-NodeIfNeeded {
  if (-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Warning 'node.exe bulunamadi. install-requirements.ps1 calistirin.'; return }
    $proc = Start-Process node -ArgumentList 'server.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $logDir 'server.log') -RedirectStandardError (Join-Path $logDir 'server.err.log')
    Set-Content -Path (Join-Path $runDir 'node.pid') -Value $proc.Id
  }
}

function Start-Tunnel {
  if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { return $null }
  Remove-Item $tunnelLogFile, $tunnelOutFile, $tunnelLinkFile -ErrorAction SilentlyContinue
  try {
    $proc = Start-Process cloudflared -ArgumentList 'tunnel', '--url', 'http://127.0.0.1:8787' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $tunnelOutFile -RedirectStandardError $tunnelLogFile
  } catch {
    Write-Warning "cloudflared baslatilamadi: $($_.Exception.Message)"
    return $null
  }
  Set-Content -Path (Join-Path $runDir 'tunnel.pid') -Value $proc.Id
  return $proc
}

function Wait-ForLink([int]$timeoutSec = 25) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $tunnelLogFile) {
      $match = Select-String -Path $tunnelLogFile -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($match) { $url = $match.Matches[0].Value; Set-Content -Path $tunnelLinkFile -Value $url; return $url }
    }
    Start-Sleep -Milliseconds 700
  }
  return $null
}

# ---- sabit IP / DDNS modu (opsiyonel) ----
$ddnsConfigFile = Join-Path $PSScriptRoot 'ddns.json'
$ddnsLinkFile = Join-Path $runtimeDir 'ddns-link.txt'
$caddyfile = Join-Path $runtimeDir 'Caddyfile'
function Get-DdnsConfig {
  if (-not (Test-Path $ddnsConfigFile)) { return $null }
  try { $conf = Get-Content $ddnsConfigFile -Raw | ConvertFrom-Json } catch { return $null }
  if (-not $conf.enabled -or -not $conf.subdomain -or -not $conf.token -or $conf.token -eq 'DUCKDNS_TOKEN_BURAYA') { return $null }
  return $conf
}
function Update-DuckDns($conf) {
  try { Invoke-RestMethod -Uri "https://www.duckdns.org/update?domains=$($conf.subdomain)&token=$($conf.token)&ip=" -TimeoutSec 10 | Out-Null } catch { Write-Warning "DuckDNS guncellenemedi: $($_.Exception.Message)" }
}
function Start-Ddns {
  $conf = Get-DdnsConfig
  if (-not $conf) { return $null }
  if (-not (Get-Command caddy -ErrorAction SilentlyContinue)) { Write-Warning 'caddy kurulu degil; sabit IP modu calismayacak. install-requirements.ps1 calistirin.'; return $null }
  Update-DuckDns $conf
  $hostname = "$($conf.subdomain).duckdns.org"
  Set-Content -Path $caddyfile -Value "$hostname {`n  reverse_proxy 127.0.0.1:8787`n}`n"
  Set-Content -Path $ddnsLinkFile -Value "https://$hostname"
  $caddyLog = Join-Path $logDir 'caddy.log'
  try {
    $proc = Start-Process caddy -ArgumentList 'run', '--config', $caddyfile, '--adapter', 'caddyfile' -WorkingDirectory $runtimeDir -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $caddyLog -RedirectStandardError (Join-Path $logDir 'caddy.err.log')
  } catch {
    Write-Warning "caddy baslatilamadi: $($_.Exception.Message)"
    return $null
  }
  Set-Content -Path (Join-Path $runDir 'caddy.pid') -Value $proc.Id
  return $proc
}

# ---- Tailscale Funnel modu (opsiyonel, router'a hic dokunmaz) ----
$tailscaleConfigFile = Join-Path $PSScriptRoot 'tailscale.json'
$tailscaleLinkFile = Join-Path $runtimeDir 'tailscale-link.txt'
function Get-TailscaleConfig {
  if (-not (Test-Path $tailscaleConfigFile)) { return $null }
  try { $conf = Get-Content $tailscaleConfigFile -Raw | ConvertFrom-Json } catch { return $null }
  if (-not $conf.enabled -or -not $conf.authkey -or $conf.authkey -eq 'TSKEY_BURAYA') { return $null }
  return $conf
}
function Find-TailscaleExe {
  $cmd = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidate = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
  if (Test-Path $candidate) { return $candidate }
  return $null
}
function Start-TailscaleFunnel {
  $conf = Get-TailscaleConfig
  if (-not $conf) { return $false }
  $exe = Find-TailscaleExe
  if (-not $exe) { Write-Warning 'tailscale kurulu degil; install-requirements.ps1 calistirin.'; return $false }
  $hostname = if ($conf.hostname) { $conf.hostname } else { 'ensari-patron' }
  try {
    $statusJson = & $exe status --json 2>$null
    $status = if ($statusJson) { $statusJson | ConvertFrom-Json } else { $null }
  } catch { $status = $null }
  if (-not $status -or -not $status.Self -or $status.Self.HostName -ne $hostname) {
    & $exe up --authkey=$($conf.authkey) --hostname=$hostname --accept-dns=false --ssh=$false 2>&1 | Out-Null
    Start-Sleep -Seconds 3
  }
  & $exe funnel --bg 8787 2>&1 | Out-Null
  Start-Sleep -Seconds 2
  $funnelStatus = & $exe funnel status 2>&1 | Out-String
  $match = [regex]::Match($funnelStatus, 'https://[a-zA-Z0-9.-]+\.ts\.net')
  if ($match.Success) { Set-Content -Path $tailscaleLinkFile -Value $match.Value; return $true }
  return $false
}

Start-NodeIfNeeded
Start-Sleep -Seconds 2
$tunnelProc = Start-Tunnel
$ddnsProc = Start-Ddns
$tailscaleOk = Start-TailscaleFunnel

if ($tunnelProc) {
  $url = Wait-ForLink
  if ($url) { Write-Host "`nDisaridan erisim linki (degisken): $url" -ForegroundColor Cyan }
  else { Write-Warning "Tunel linki alinamadi. $tunnelLogFile dosyasini kontrol edin." }
} else {
  Write-Host 'cloudflared kurulu degil; panel sadece yerel agda calisiyor: http://127.0.0.1:8787' -ForegroundColor Yellow
}
if ($ddnsProc) { Write-Host ("Kalici erisim linki (DDNS): " + (Get-Content $ddnsLinkFile)) -ForegroundColor Green }
if ($tailscaleOk) { Write-Host ("Kalici erisim linki (Tailscale): " + (Get-Content $tailscaleLinkFile)) -ForegroundColor Green }

# Sonsuz denetim dongusu: kopan sureci yeniden baslatir, DuckDNS kaydini tazeler.
$ddnsTick = 0
while ($true) {
  Start-Sleep -Seconds 15
  Start-NodeIfNeeded
  if ($tunnelProc -and $tunnelProc.HasExited) {
    Write-Host 'Tunel koptu, yeniden baslatiliyor...' -ForegroundColor Yellow
    $tunnelProc = Start-Tunnel
    if ($tunnelProc) { Start-Sleep -Seconds 3; $url = Wait-ForLink; if ($url) { Write-Host "Yeni link: $url" -ForegroundColor Cyan } }
  } elseif (-not $tunnelProc) {
    $tunnelProc = Start-Tunnel
  }
  if ($ddnsProc -and $ddnsProc.HasExited) { $ddnsProc = Start-Ddns }
  elseif (-not $ddnsProc) { $ddnsProc = Start-Ddns }
  $ddnsTick++
  if ($ddnsProc -and $ddnsTick -ge 20) { $ddnsTick = 0; $conf = Get-DdnsConfig; if ($conf) { Update-DuckDns $conf } } # ~5 dk'da bir IP tazele
  if (-not $tailscaleOk -and (Get-TailscaleConfig)) { $tailscaleOk = Start-TailscaleFunnel } # tailscale.json sonradan eklendiyse yakala
}
