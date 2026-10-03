# EnsariPOS Patron Direkt APK derleme. Cikti: dist\EnsariPatronDirekt.apk
# ek\ (index.html, kurulum.html, core.js) -> app\www kopyalanir; Cordova derler.
# Uygulama kimligi com.ensaripos.patrondirekt - mevcut PatronSistemi.apk ile yan yana kurulur.
# Surum: app\config.xml version + ek\core.js APP_VERSION; her yayinda ikisini de artirin.
# Ikon ve node_modules Garson Direkt projesinden (ayni Cordova/plugin) alinir.
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$www = Join-Path $PSScriptRoot "app\www"
if (Test-Path $www) { Remove-Item $www -Recurse -Force }
New-Item -ItemType Directory -Force $www | Out-Null
Copy-Item ek\index.html, ek\kurulum.html, ek\core.js -Destination $www -Force
if ($args -contains '-sadeceWww') { Write-Host "app\www hazir (derleme yapilmadi)"; return }

$garson = "C:\Projeler\5-Garson\apk-bagimsiz\app"
Set-Location app
if (!(Test-Path res)) { Copy-Item "$garson\..\..\apk\res" -Destination res -Recurse }
$env:JAVA_HOME = "C:\jdk17"
$env:ANDROID_HOME = "C:\Android\Sdk"; $env:ANDROID_SDK_ROOT = "C:\Android\Sdk"
$env:Path = "C:\jdk17\bin;C:\Android\gradle-extract\gradle-8.13\bin;" + $env:Path
if (!(Test-Path node_modules)) { Copy-Item "C:\Projeler\5-Garson\apk\node_modules" -Destination node_modules -Recurse }
if (!(Test-Path "platforms\android")) { cordova platform add android; if ($LASTEXITCODE -ne 0) { throw "platform add hatasi" } }
cordova build android --debug
if ($LASTEXITCODE -ne 0) { throw "Derleme hatasi" }
New-Item -ItemType Directory -Force ..\dist | Out-Null
Copy-Item "platforms\android\app\build\outputs\apk\debug\app-debug.apk" ..\dist\EnsariPatronDirekt.apk -Force
Get-Item ..\dist\EnsariPatronDirekt.apk | Select-Object FullName, Length, LastWriteTime
