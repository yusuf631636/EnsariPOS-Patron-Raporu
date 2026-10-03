; Inno Setup 6 ile PatronRaporuSetup.exe uretir.
#define AppName "AlfaPOS Patron"
#define AppVersion "1.4.0"
#define AppPublisher "AlfaPOS"
#define AppExeName "PatronRaporu.exe"

[Setup]
AppId={{A41E9F4E-5C6A-4E3A-9A9F-202609060001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\EnsariPOS\PatronRaporu
OutputDir=dist
OutputBaseFilename=PatronRaporuSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin

[Files]
Source: "server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "patron-cloud.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "tunnel-watch.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "nssm.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "install-services.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "remove-services.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "show-link.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "package-lock.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "config.example.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "database-template.sql"; DestDir: "{app}"; Flags: ignoreversion
Source: "README-KURULUM.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "install-requirements.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "ddns.example.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "ddns.example.json"; DestDir: "{app}"; DestName: "ddns.json"; Flags: onlyifdoesntexist
Source: "tailscale.example.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "tailscale.example.json"; DestDir: "{app}"; DestName: "tailscale.json"; Flags: onlyifdoesntexist

[Icons]
Name: "{autodesktop}\AlfaPOS Patron"; Filename: "http://127.0.0.1:8787/patron"
Name: "{group}\AlfaPOS Patron"; Filename: "http://127.0.0.1:8787/patron"
Name: "{group}\Servisleri Yeniden Kur"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\install-services.ps1"""
Name: "{group}\Servisleri Durdur"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\remove-services.ps1"""
Name: "{group}\Tunel Linkini Goster"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\show-link.ps1"""

[Run]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\install-requirements.ps1"""; StatusMsg: "Gereksinimler kuruluyor (Node.js, cloudflared, caddy)..."; Flags: waituntilterminated runhidden
; Sabit IP/DDNS modu (Caddy) ve yerel panel icin gelen baglantilara izin ver - hangi PC'ye kurulursa kurulsun otomatik.
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""AlfaPOS Patron (Panel)"" dir=in action=allow protocol=TCP localport=8787"; Flags: runhidden; StatusMsg: "Guvenlik duvari kurallari ekleniyor..."
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""AlfaPOS Patron (Sabit IP HTTPS)"" dir=in action=allow protocol=TCP localport=80,443"; Flags: runhidden
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\install-services.ps1"""; StatusMsg: "Servisler kuruluyor ve baslatiliyor..."; Flags: waituntilterminated
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\show-link.ps1"""; Description: "Erişim linkini göster"; Flags: postinstall skipifsilent nowait

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\remove-services.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveServices"
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""AlfaPOS Patron (Panel)"""; Flags: runhidden; RunOnceId: "DelFwPanel"
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""AlfaPOS Patron (Sabit IP HTTPS)"""; Flags: runhidden; RunOnceId: "DelFwHttps"

[Code]
var
  DBPage: TInputQueryWizardPage;
  CloudPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  DBPage := CreateInputQueryPage(wpSelectDir,
    'SQL Server Veritabani Ayarlari',
    'SambaPOS veritabanina nasil baglanilacagini gir',
    'Bu bilgiler kurulum sonunda config.json dosyasina otomatik yazilacak. ' +
    'SQL kullanici adi ve sifresini bos birakirsan Windows kimlik dogrulamasi kullanilir.');
  DBPage.Add('SQL Server adresi  (ör: localhost  veya  .\SQLEXPRESS):', False);
  DBPage.Add('Veritabani adi:', False);
  DBPage.Add('SQL kullanici adi  (bos = Windows kimlik dogrulama):', False);
  DBPage.Add('SQL sifresi:', True);

  DBPage.Values[0] := 'localhost';
  DBPage.Values[1] := 'SAMBAPOS5';

  CloudPage := CreateInputQueryPage(DBPage.ID,
    'AlfaPOS Bulut (opsiyonel)',
    'Bu restoranı merkezi yönetim/bayi paneline bağla',
    'AlfaPOS Bulut yönetim panelinden bu restoran için oluşturulan aktivasyon anahtarınız varsa girin. ' +
    'Yoksa boş bırakıp devam edin - program normal şekilde çalışmaya devam eder.');
  CloudPage.Add('Bulut aktivasyon anahtari (varsa):', False);
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  { config.json zaten varsa (guncelleme kurulumu) tekrar sorma, mevcut ayarlari koru. }
  if (PageID = DBPage.ID) and FileExists(ExpandConstant('{app}\config.json')) then
    Result := True;
  if (PageID = CloudPage.ID) and FileExists(ExpandConstant('{app}\config.json')) then
    Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = DBPage.ID then
  begin
    if Trim(DBPage.Values[0]) = '' then
    begin
      MsgBox('SQL sunucu adresi bos birakilamaz.', mbError, MB_OK);
      Result := False;
    end
    else if Trim(DBPage.Values[1]) = '' then
    begin
      MsgBox('Veritabani adi bos birakilamaz.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function JsonEscape(S: String): String;
begin
  StringChangeEx(S, '\', '\\', True);
  StringChangeEx(S, '"', '\"', True);
  Result := S;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigPath: String;
  JsonContent: String;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigPath := ExpandConstant('{app}\config.json');
    if not FileExists(ConfigPath) then
    begin
      JsonContent :=
        '{' + #13#10 +
        '  "appName": "AlfaPOS Patron",' + #13#10 +
        '  "server": "' + JsonEscape(DBPage.Values[0]) + '",' + #13#10 +
        '  "database": "' + JsonEscape(DBPage.Values[1]) + '",' + #13#10 +
        '  "user": "' + JsonEscape(DBPage.Values[2]) + '",' + #13#10 +
        '  "password": "' + JsonEscape(DBPage.Values[3]) + '",' + #13#10 +
        '  "options": {' + #13#10 +
        '    "encrypt": false,' + #13#10 +
        '    "trustServerCertificate": true' + #13#10 +
        '  },' + #13#10 +
        '  "port": 8787,' + #13#10 +
        '  "cloudActivationKey": "' + JsonEscape(Trim(CloudPage.Values[0])) + '",' + #13#10 +
        '  "cloudServerUrl": "https://app.ornek-alanadi.com"' + #13#10 +
        '}';
      SaveStringToFile(ConfigPath, JsonContent, False);
    end;
  end;
end;
