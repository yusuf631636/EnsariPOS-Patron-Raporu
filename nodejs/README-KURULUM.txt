SAMBAPOS PATRON RAPORU KURULUMU

1) Gereksinimler
- Windows 10/11
- Node.js LTS, cloudflared (setup bunlari otomatik kurmaya calisir)
- SQL Server ve sqlcmd
- SambaPOS veritabani yedegi

2) Kurulum (PatronRaporuSetup.exe)
Setup'i calistirin. Sirasiyla:
  a) "SQL Server Veritabani Ayarlari" sayfasinda SQL sunucu adresini, veritabani
     adini, (SQL kimlik dogrulama kullanacaksaniz) kullanici adi/sifreyi girin.
     Windows kimlik dogrulama icin kullanici adi ve sifreyi bos birakin.
     Bu bilgiler kurulum sonunda config.json dosyasina otomatik yazilir; elle
     JSON duzenlemeye gerek yoktur. (Guncelleme kurulumunda config.json zaten
     varsa bu sayfa atlanir, mevcut ayarlar korunur.)
  b) Node.js ve cloudflared eksikse otomatik kurulmaya calisilir (winget ile).
     winget yoksa veya kurulum basarisiz olursa uyari gosterilir, kurulumu
     durdurmaz; eksik parca sonradan elle kurulabilir.
  c) Kurulum biter bitmez "Ensari POS Patron'u baslat ve erisim linkini goster"
     secili kutucukla panel baslar ve disaridan erisim linki ekranda gosterilir.

Elle kurulum (setup kullanmadan, kaynak klasorden calistırma) icin config.json
dosyasini config.example.json'dan kopyalayip asagidaki gibi duzenleyin:
{
  "server": "localhost",
  "database": "SAMBAPOS5",
  "user": "",
  "password": "",
  "options": { "encrypt": false, "trustServerCertificate": true },
  "port": 8787
}
Ornekler: yerel sunucu "localhost", adlandirilmis instance ".\\SQLEXPRESS",
uzak sunucu "192.168.1.20\\SQLEXPRESS". user/password bos ise Windows kimlik
dogrulama kullanilir.

3) Veri tabani
SambaPOS yedegini SQL Server'a geri yukleyin. database-template.sql dosyasi ile
tablo kontrolu yapin. Panel mevcut SambaPOS verisini okur; SambaPOS veritabanini
degistirmez.

4) Giris sifresi
Panel ilk calistiginda rastgele 6 haneli bir sifre uretilir ve su dosyaya yazilir:
  %ProgramData%\EnsariPOS\PatronRaporu\ILK-SIFRE.txt
Ayni sifre sunucu konsol ciktisinda da gorunur. Bu sifreyi panelden Ayarlar
(disli ikonu) > "Sifre degistir" ile hemen degistirin, sonra ILK-SIFRE.txt
dosyasini silin. Sifreyi unutursaniz o dosyayi ve
  %ProgramData%\EnsariPOS\PatronRaporu\patron-auth.json
dosyasini silip sunucuyu yeniden baslatin; yeni bir sifre uretilir.
5 hatali denemeden sonra giris 5 dakika kilitlenir.

5) Calistirma ve arka planda kalma
"Ensari POS Patron" kisayoluna (masaustu / Baslat menusu) tikladiginizda:
  - Node sunucusu ve (kuruluysa) Cloudflare tuneli GIZLI pencerede baslar ve
    bilgisayar acik oldugu surece arka planda calismaya devam eder,
  - Kisayolun kendi penceresi disaridan erisim linkini birkac saniye
    gosterip kendiliginden kapanir,
  - Bilgisayarı kapatip actiginizda ya da islem durursa panel otomatik
    baslamaz; ayni kisayola tekrar tiklamaniz yeterlidir (zaten calisiyorsa
    ikinci kopya baslatmaz, sadece guncel linki gosterir).
"Ensari POS Patron - Durdur" kisayolu sunucuyu ve tuneli tamamen kapatir.
"Tunel Linkini Goster" kisayolu güncel disaridan erisim linkini panoya
kopyalar ve tarayicida acar; ayni link panelin icinde Ayarlar > "Disaridan
erisim linki" altinda da gorunur.
Masaustundeki "Patron" kisayolu tek tikla panele goturur (yerel adrese acilir,
bilgisayar acik oldugu surece her zaman calisir). Kurulumdan sonra bilgisayar
her acildiginda panel ve tunel otomatik, gizli sekilde kendiliginden baslar;
elle baslatmaya gerek yoktur, sadece durdurulduysa tekrar baslatma gerekir.

Elle calistirma (PowerShell):
  Set-ExecutionPolicy -Scope Process Bypass
  .\\start.ps1
Yerel tarayici adresi: http://127.0.0.1:8787 (telefon -> patron modulu,
bilgisayar -> masaustu panel; /patron ve /masaustu ile zorlanabilir).
Uygulama adi config.json icindeki appName alanindan degistirilebilir.

6) Patron modulu (telefon)
Telefondan girildiginde ana adres (/) otomatik olarak mobil patron modulunu acar.
  /            telefon ise patron modulu, bilgisayar ise eski panel
  /patron      her cihazda mobil patron modulu
  /masaustu    her cihazda eski masaustu panel
Modul bes bolumden olusur:
  - Ozet: toplam ciro, altinda odeme turu dagilimi (Nakit/Kart/Online vb.),
    onceki esit donemle karsilastirma, "Bugun" seciliyken 45 saniyede bir
    sessizce tazelenen canli ciro ve "X sn once guncellendi" gostergesi.
  - Satis: urun/personel/departman/adisyon kirilimlari.
  - Acik: Masalar, Bekleyen paketler ve Yoldaki paketler olarak ayri sekmeler
    (paket durumu SambaPOS'taki "Paket" durum etiketinden okunur: Bekliyor/Yolda).
  - Kasa: odeme turleri, "Fiyat guncelle" (asagida) ve fiyat degisim gecmisi.
  - Bildirim: Iptal, Iade, Gun basi/sonu ayri filtrelerle.
Telefonda tarayici menusunden "Ana ekrana ekle" derseniz uygulama gibi tam ekran acilir.
Ozet ekranindaki "Ozeti paylas" dugmesi gun ozetini WhatsApp vb. uygulamalara gonderir.
Grafiklerdeki "Tablo" baglantisi ayni veriyi rakam olarak gosterir.
Disli ikonundaki Ayarlar'dan: gorunum (Acik/Koyu tema), sifre degistirme, guncel
tunel linki ve cikis yapma.

Fiyat guncelleme (Kasa > Fiyat guncelle)
Urun aranip yeni fiyat girildiginde degisiklik ANINDA SambaPOS veritabanina
(MenuItemPrices tablosu) yazilir; ayni telefon veya bilgisayardan yapilan normal
fiyat degisikligiyle aynidir. SambaPOS ekraninda gorunmesi icin terminalde
menuyu yenilemek/yeniden baslatmak gerekebilir (SambaPOS menuyu bir kere
belleğe yukler). Her degisiklik
  %ProgramData%\EnsariPOS\PatronRaporu\fiyat-degisiklikleri.log
dosyasina kaydedilir (tarih, urun, eski/yeni fiyat).

7) Setup EXE'yi elle derleme
PatronRaporu.iss Inno Setup 6 dosyasidir. Inno Setup Compiler ile derleyin.
Node uygulamasi, public klasoru, calistirma/durdurma betikleri ve bagimliliklar
setup icine dahil edilir. Cikti: dist\\PatronRaporuSetup.exe

8) Sabit (hic degismeyen) erisim linki - opsiyonel
Varsayilan Cloudflare Tunnel linki (trycloudflare.com) her yeniden baslatmada
degisir; bu ucretsiz Cloudflare hizmetinin tasarim geregi boyledir. Sabit bir
link icin iki yontem var; Tailscale router'a hic dokunmadigi icin daha kolay
ve daha az sorun cikartir, ONERILEN yontem budur.

8a) Tailscale Funnel (onerilen - router'a dokunmaz, CGNAT'ta bile calisir)
  a) https://login.tailscale.com adresine gidip ucretsiz hesap acin
     (Google/Microsoft/GitHub ile tek tikla).
  b) Sol menuden "Settings" > "Keys" > "Generate auth key" ile bir anahtar
     uretin (Reusable secenegini isaretlemeniz onerilir).
  c) Uygulama klasorundeki tailscale.example.json dosyasini tailscale.json
     olarak kopyalayip icini doldurun:
     { "enabled": true, "authkey": "tskey-...", "hostname": "restoranadi" }
  d) "Ensari POS Patron - Durdur" ve ardindan "Ensari POS Patron" kisayoluna
     tiklayip yeniden baslatin. Birkac saniye icinde panelin Ayarlar
     bolumunde "Kalici link" olarak https://restoranadi.tailXXXX.ts.net
     gorunur. Bu link BIR DAHA DEGISMEZ ve router ayari GEREKTIRMEZ.
Not: Tailscale programi install-requirements.ps1 tarafindan otomatik kurulur.

8b) DuckDNS + Caddy (alternatif - router'da port yonlendirme gerektirir)
Bilgisayariniz normal (CGNAT olmayan) bir genel IP aliyorsa bu yontemi de
kullanabilirsiniz:
  a) https://www.duckdns.org adresine gidip GitHub/Google hesabinizla giris yapin.
  b) Bir alt alan adi (subdomain) olusturun, orn. "restoranadi" ->
     restoranadi.duckdns.org
  c) Sayfanin ustunde goreceginiz "token" degerini kopyalayin.
  d) Uygulama klasorundeki ddns.example.json dosyasini ddns.json olarak
     kopyalayip icini doldurun:
     { "enabled": true, "subdomain": "restoranadi", "token": "..." }
  e) Modeminizde/routerinizde su iki portu bu bilgisayarin yerel IP adresine
     yonlendirin (port forwarding): 80 ve 443. Yerel IP adresinizi
     "ipconfig" komutuyla (IPv4 Address) ogrenebilirsiniz. Router arayuzune
     genelde 192.168.1.1 adresinden girilir; marka/modele gore adimlar
     degisir, router kilavuzuna veya "[marka model] port yonlendirme"
     aramasina bakin.
  f) "Ensari POS Patron - Durdur" ve ardindan "Ensari POS Patron" kisayoluna
     tiklayip yeniden baslatin. Birkac saniye icinde
       %ProgramData%\EnsariPOS\PatronRaporu\ddns-link.txt
     dosyasinda ve panelin Ayarlar bolumunde "Kalici link" olarak
     https://restoranadi.duckdns.org gorunur.
Not: Bu ozellik icin gerekli Caddy programi install-requirements.ps1
tarafindan otomatik kurulur; kurulum programi (setup) da 80/443/8787
portlarina gelen baglantilara izin veren guvenlik duvari kurallarini otomatik
ekler. Router'a port yonlendirme yalniz sizin yapabileceginiz tek elle adimdir.
Sirket aginiz CGNAT arkasindaysa (IP'niz 100.64.x.x gibiyse veya operator
"paylasimli IP" kullaniyorsa) bu yontem calismaz, Tailscale (8a) kullanin.

Her iki yontem de ayni anda acik birakilabilir; panel Tailscale linkini varsa
onceliklendirir.

Guvenlik
Panel bir sifreyle korunur (bkz. madde 4); config.json icindeki SQL sifresini
kimseyle paylasmayin. Paneli internete Cloudflare Tunnel ile actiginizda link
elinde olan herkes panele (sifre ekraniyla) erisebilir; linki sadece guvendiginiz
kisilerle paylasin.
