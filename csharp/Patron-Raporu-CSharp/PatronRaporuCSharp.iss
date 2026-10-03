; Patron Raporu - C# SÜRÜM (30.09.2026, kullanici istegi: "patronu ... #c olsun"). Kurulumda Windows'un KENDI
; csc.exe'si ile derlenir, "EnsariPatron" Windows servisi olarak kurulur. Node.js / sqlcmd GEREKMEZ.
; Mevcut Patron kurulumu (AlfaPOS Bulut icindeki {app}\Patron, Node/NSSM) varsa AYNI klasore kurulur ve onun
; yerine gecer: config.json, ProgramData\EnsariPOS\PatronRaporu (sifreler, oturumlar, fiyat gunlugu) korunur,
; ayni bulut aktivasyon anahtari kullanilir. Cloudflare tunel servisi (EnsariPatronTunnel) dokunulmadan kalir.
; Sayfalar (public\) bu klasordeki public\'ten alinir (2.2: proje kendi basina yeterli).
#define AppName "Ensari POS Patron"
#define AppVersion "2.5.1"
#define AppPublisher "AlfaPOS"
#define Web RemoveBackslash(SourcePath)
#define Ortak "C:\Projeler\9-CSharp-Projeler\ortak"

[Setup]
AppId={{3D8A5C71-6E2F-4B9A-8C1D-PATRONCSHARP}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion} (C# sürüm)
AppPublisher={#AppPublisher}
AppPublisherURL=https://ornek-alanadi.com
DefaultDirName={code:DefaultPatronDir}
UsePreviousAppDir=yes
DefaultGroupName=Ensari POS Patron
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=PatronRaporuCSharpSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
SetupIconFile=kaynak\alfapos.ico
UninstallDisplayIcon={app}\PatronSrv.exe
UninstallDisplayName={#AppName} (C# sürüm)
VersionInfoVersion={#AppVersion}.0
VersionInfoDescription={#AppName} (C#) Kurulum

[Languages]
Name: "tr"; MessagesFile: "compiler:Languages\Turkish.isl"

[Messages]
tr.WelcomeLabel2=Bu program Patron Raporu'nun C# sürümünü kurar.%n%n• Satış, açık masa ve bildirimleri bulut paneline (patron2.ornek-alanadi.com) gönderir; panelden fiyat güncellemeyi uygular.%n• 14 rapor (kasa, gün sonu, ikram-iade-zayi, iskonto, tahsilat, ısı haritası...), adisyon logu ve telefona anlık bildirim.%n• Node.js gerekmez; Windows servisi olarak çalışır, bilgisayar açılınca kendiliğinden başlar.%n• AlfaPOS Bulut içindeki eski Patron kuruluysa onun yerine geçer; şifreler, ayarlar ve bulut anahtarı korunur.

[Files]
Source: "kaynak\*.cs"; DestDir: "{app}\kur\kaynak"; Flags: ignoreversion
Source: "kaynak\alfapos.ico"; DestDir: "{app}\kur\kaynak"; Flags: ignoreversion
Source: "{#Ortak}\*.cs"; DestDir: "{app}\kur\ortak"; Flags: ignoreversion
Source: "PatronSrv.exe"; DestDir: "{app}\kur"; DestName: "PatronSrv.prebuilt.exe"; Flags: ignoreversion
Source: "kur\Patron_Kurulum.ps1"; DestDir: "{app}\kur"; Flags: ignoreversion
Source: "kur\kaldir.ps1"; DestDir: "{app}\kur"; Flags: ignoreversion
Source: "kur\yeniden-baslat.bat"; DestDir: "{app}\kur"; Flags: ignoreversion
; AlfaPOS Bulut'un "Patron Servislerini Yeniden Kur" kisayolu artik C# servisini kurar
Source: "kur\install-services.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "surum.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Web}\public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; eski Node surumunun program dosyalari (config.json, nssm.exe ve bin\cloudflared.exe - tunel servisi bunlari kullanir - SILINMEZ)
Type: files; Name: "{app}\server.js"
Type: files; Name: "{app}\patron-cloud.js"
Type: files; Name: "{app}\tunnel-watch.js"
Type: files; Name: "{app}\updater.js"
Type: files; Name: "{app}\package.json"
Type: files; Name: "{app}\package-lock.json"
Type: files; Name: "{app}\remove-services.ps1"
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\update-backup"

[Icons]
Name: "{group}\Patron Raporu (bu bilgisayar)"; Filename: "http://127.0.0.1:8787/patron"
Name: "{group}\Patron Raporu (bulut paneli)"; Filename: "https://patron2.ornek-alanadi.com"
Name: "{group}\Servisi Yeniden Başlat"; Filename: "{app}\kur\yeniden-baslat.bat"; WorkingDir: "{app}\kur"
Name: "{group}\Kaldır"; Filename: "{uninstallexe}"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\kur\Patron_Kurulum.ps1"" -InstallDir ""{app}"" -Silent"; StatusMsg: "Patron servisi derleniyor ve kuruluyor..."; Flags: waituntilterminated runhidden

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\kur\kaldir.ps1"" -Silent"; Flags: runhidden waituntilterminated; RunOnceId: "RemovePatronService"

[UninstallDelete]
Type: files; Name: "{app}\PatronSrv.exe"
Type: files; Name: "{app}\PatronSrv.exe.old"

[Code]
var
  DBPage: TInputQueryWizardPage;

{ Mevcut Patron klasoru: eski Node/NSSM servisinin AppDirectory'si, yoksa C# servisinin exe klasoru }
function DefaultPatronDir(Param: String): String;
var
  S: String;
begin
  Result := ExpandConstant('{autopf}\AlfaPOS\Bulut\Patron');
  if RegQueryStringValue(HKLM, 'SYSTEM\CurrentControlSet\Services\EnsariPatron\Parameters', 'AppDirectory', S) and (S <> '') and DirExists(S) then
  begin
    Result := S;
    Exit;
  end;
  if RegQueryStringValue(HKLM, 'SYSTEM\CurrentControlSet\Services\EnsariPatron', 'ImagePath', S) and (Pos('PatronSrv.exe', S) > 0) then
  begin
    StringChangeEx(S, '"', '', True);
    Result := ExtractFileDir(S);
  end;
end;

function JsonEscape(S: String): String;
begin
  StringChangeEx(S, '\', '\\', True);
  StringChangeEx(S, '"', '\"', True);
  Result := S;
end;

procedure InitializeWizard;
begin
  DBPage := CreateInputQueryPage(wpSelectDir, 'Patron Ayarları', 'Bu klasörde ayar dosyası yok - ilk kurulum', 'Adres boş bırakılırsa SambaPOS/AlfaPOS ayar dosyasından otomatik bulunur.');
  DBPage.Add('SQL Server adresi (boş = otomatik bul):', False);
  DBPage.Add('Veritabanı adı (boş = otomatik bul):', False);
  DBPage.Add('SQL kullanıcı adı (boş = Windows kimlik doğrulama):', False);
  DBPage.Add('SQL şifresi:', True);
  DBPage.Add('Bulut aktivasyon anahtarı (patron2.ornek-alanadi.com için):', False);
end;

{ config.json zaten varsa (eski Patron'un ayarlari) bu sayfa hic gosterilmez - ayarlar oldugu gibi kalir }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = DBPage.ID) and FileExists(ExpandConstant('{app}\config.json'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  rc: Integer;
begin
  Exec(ExpandConstant('{sys}\sc.exe'), 'stop EnsariPatron', '', SW_HIDE, ewWaitUntilTerminated, rc);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM PatronSrv.exe', '', SW_HIDE, ewWaitUntilTerminated, rc);
  Sleep(2500);
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigPath, JsonContent: String;
  Lines: TArrayOfString;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigPath := ExpandConstant('{app}\config.json');
    if FileExists(ConfigPath) then Exit;
    JsonContent :=
      '{' + #13#10 +
      '  "appName": "AlfaPOS Patron",' + #13#10 +
      '  "server": "' + JsonEscape(Trim(DBPage.Values[0])) + '",' + #13#10 +
      '  "database": "' + JsonEscape(Trim(DBPage.Values[1])) + '",' + #13#10 +
      '  "user": "' + JsonEscape(Trim(DBPage.Values[2])) + '",' + #13#10 +
      '  "password": "' + JsonEscape(DBPage.Values[3]) + '",' + #13#10 +
      '  "options": { "encrypt": false, "trustServerCertificate": true },' + #13#10 +
      '  "port": 8787,' + #13#10 +
      '  "cloudActivationKey": "' + JsonEscape(Trim(DBPage.Values[4])) + '",' + #13#10 +
      '  "cloudServerUrl": "https://app.ornek-alanadi.com"' + #13#10 +
      '}';
    Lines := [JsonContent];
    SaveStringsToUTF8File(ConfigPath, Lines, False);
  end;
end;

