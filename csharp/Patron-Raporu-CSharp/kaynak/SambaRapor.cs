// SambaPOS rapor motoru (Metrik mantigi) - 03.10.2026
// Patron, rakamlari elle SQL yerine SambaPOS'un KENDI rapor motorundan (getCustomReport,
// mesaj sunucusu :9000) ceker; boylece sonuclar SambaPOS'un kendi raporlariyla BIREBIR tutar.
// Rapor sablonlari SambaPOS'un REPORT etiket dilindedir; hazir (Metrik) set + panelden
// EKLENEN ozel raporlar birlikte sunulur. Sonuc genel tablo (kolon+satir) olarak doner,
// boylece HANGI rapor olursa olsun ayni ekranda gosterilebilir.
//
// Baglanti: SambaPOS'ta kayitli "EnsariGarson" uygulamasi + bir YONETICI kullanici (ad+Sifre).
// Bunlar config.json'a yazilir (panelden /api/samba/conn ile) - PIN degil, kullanicinin Sifre alani.
using System;
using System.Collections.Generic;
using System.Linq;
using Alfa;

namespace Patron
{
    public static class SambaRapor
    {
        static readonly object _lock = new object();
        static string _token; static DateTime _tokenExp;

        static string Host { get { return (J.S(Cfg.Read(), "sambaMsgHost") ?? "").Trim().Length > 0 ? J.S(Cfg.Read(), "sambaMsgHost").Trim() : "localhost"; } }
        static int Port { get { int p; return int.TryParse(J.S(Cfg.Read(), "sambaMsgPort"), out p) && p > 0 ? p : 9000; } }
        static string ClientId { get { string c = J.S(Cfg.Read(), "sambaClientId"); return string.IsNullOrEmpty(c) ? "EnsariGarson" : c; } }
        static string Base()
        {
            string h = Host;
            if (h.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || h.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return h.TrimEnd('/');
            return "http://" + h + ":" + Port;
        }

        // ---- baglanti ayari (panelden) ----
        public static bool HasConn() { var c = Cfg.Read(); return J.S(c, "sambaUser").Length > 0 && J.S(c, "sambaPass").Length > 0; }
        public static void SaveConn(string host, string user, string pass)
        {
            Cfg.Update(c => {
                if (host != null) c["sambaMsgHost"] = host.Trim();
                if (user != null) c["sambaUser"] = user;
                if (pass != null && pass != "********") c["sambaPass"] = pass;
            });
            lock (_lock) { _token = null; }
        }

        // ---- token ----
        static string Token(bool force)
        {
            lock (_lock) { if (!force && _token != null && _tokenExp > DateTime.UtcNow) return _token; }
            var c = Cfg.Read();
            string user = J.S(c, "sambaUser"), pass = J.S(c, "sambaPass");
            if (user.Length == 0 || pass.Length == 0) throw new Exception("SambaPOS yonetici baglanti kullanicisi ayarlanmamis. Patron panelinde 'SambaPOS Baglantisi' bolumunden girin.");
            string body = "grant_type=password&client_id=" + Uri.EscapeDataString(ClientId) +
                          "&username=" + Uri.EscapeDataString(user) + "&password=" + Uri.EscapeDataString(pass);
            var hdr = new Dictionary<string, string> { { "Content-Type", "application/x-www-form-urlencoded" } };
            var r = Web.Request("POST", Base() + "/Token", body, hdr, 12000);
            if (r.Status == 0) throw new Exception("SambaPOS mesaj sunucusuna ulasilamadi (" + Base() + "). SambaPOS acik ve Mesaj Sunucusu calisiyor mu?");
            var j = J.DD(J.Parse(r.Text));
            string acc = J.S(j, "access_token");
            if (r.Ok && acc.Length > 0)
            {
                double ein = J.Num(j, "expires_in"); if (!(ein > 60)) ein = 3600;
                lock (_lock) { _token = acc; _tokenExp = DateTime.UtcNow.AddSeconds(ein - 120); }
                return acc;
            }
            string err = J.S(j, "error");
            if (err == "invalid_client") throw new Exception("SambaPOS'ta \"" + ClientId + "\" uygulama kaydi yok. Restoran bilgisayarinda hazirlik araci bir kez calistirilmali.");
            if (err == "invalid_grant") throw new Exception("SambaPOS baglanti kullanicisi adi/sifresi hatali (kullanicinin 'Sifre' alani, PIN degil).");
            throw new Exception("SambaPOS girisi reddetti: " + (J.S(j, "error_description").Length > 0 ? J.S(j, "error_description") : ("HTTP " + r.Status)));
        }

        static Dictionary<string, object> Gql(string query, Dictionary<string, object> variables)
        {
            string tok = Token(false);
            var payload = J.Obj("query", query, "variables", variables ?? new Dictionary<string, object>());
            var hdr = new Dictionary<string, string> { { "Authorization", "Bearer " + tok } };
            var r = Web.PostJson(Base() + "/api/graphql", payload, 30000, hdr);
            if (r.Status == 401) { tok = Token(true); hdr["Authorization"] = "Bearer " + tok; r = Web.PostJson(Base() + "/api/graphql", payload, 30000, hdr); }
            if (r.Status == 0) throw new Exception("SambaPOS mesaj sunucusuna ulasilamadi.");
            var j = J.DD(J.Parse(r.Text));
            var errs = J.L(J.Get(j, "errors"));
            if ((J.Get(j, "data") == null) && errs != null && errs.Count > 0)
            {
                string m = J.S(J.DD(errs[0]), "message");
                if (m.IndexOf("authorization is required", StringComparison.OrdinalIgnoreCase) >= 0 || m.IndexOf("access get", StringComparison.OrdinalIgnoreCase) >= 0)
                    m = "Baglanti kullanicisinin yonetici yetkisi yok. SambaPOS'ta bu kullaniciyi Yonetici (Admin) rolune alin.";
                throw new Exception(m.Length > 0 ? m : "SambaPOS rapor hatasi.");
            }
            return J.DD(J.Get(j, "data"));
        }

        // ---- hazir (Metrik) rapor seti ----
        // Her biri tek bir tablo ureten, SambaPOS REPORT etiketli sablon. Kullanici panelden yenisini ekleyebilir.
        public class Rapor { public string Id; public string Ad; public string Sablon; public bool Builtin; }
        static readonly List<Rapor> Builtins = new List<Rapor>
        {
            new Rapor{ Id="ozet", Ad="Özet (Ciro / Adisyon / İskonto)", Builtin=true, Sablon=
                "[Özet:65,35]\nCiro|{REPORT TICKET TOTAL}\nAdisyon Sayısı|{REPORT TICKET COUNT}\nİskonto|{REPORT CALCULATION TOTAL:(CT=İskonto)}\nYuvarlama|{REPORT CALCULATION TOTAL:(CT=Yuvarla)}" },
            new Rapor{ Id="odeme", Ad="Ödeme Tipleri", Builtin=true, Sablon=
                "[Ödeme Tipleri:50,25,25]\n{REPORT PAYMENT DETAILS:P.Name,P.Amount.Sum,P.Amount.Percent:Payment.Amount > 0}" },
            new Rapor{ Id="urun", Ad="Ürün Satışları", Builtin=true, Sablon=
                "[Ürün Satışları:50,25,25]\n{REPORT ORDER DETAILS:O.Name,O.Quantity.Sum,O.Total.Sum:O.CalculatePrice=true}" },
            new Rapor{ Id="personel", Ad="Personel Satışları", Builtin=true, Sablon=
                "[Personel:50,25,25]\n{REPORT ORDER DETAILS:O.User,O.Quantity.Sum,O.Total.Sum}" },
            new Rapor{ Id="saatlik", Ad="Saatlik Ciro", Builtin=true, Sablon=
                "[Saatlik Ciro:50,50]\n{REPORT ORDER DETAILS:FT([O.Time],'HH'),O.Total.Sum}" },
            new Rapor{ Id="kategori", Ad="Ürün Grubu / Kategori", Builtin=true, Sablon=
                "[Ürün Grubu:50,25,25]\n{REPORT ORDER DETAILS:O.MenuItemGroupCode,O.Quantity.Sum,O.Total.Sum:O.CalculatePrice=true}" }
        };
        static List<Rapor> Custom()
        {
            var list = new List<Rapor>();
            foreach (var o in J.LL(J.Get(Cfg.Read(), "sambaReports")))
            {
                var d = J.DD(o);
                if (J.S(d, "ad").Length > 0 && J.S(d, "sablon").Length > 0)
                    list.Add(new Rapor { Id = J.S(d, "id"), Ad = J.S(d, "ad"), Sablon = J.S(d, "sablon"), Builtin = false });
            }
            return list;
        }
        static List<Rapor> All() { return Builtins.Concat(Custom()).ToList(); }

        public static Dictionary<string, object> ListMeta()
        {
            var arr = All().Select(r => (object)J.Obj("id", r.Id, "ad", r.Ad, "builtin", r.Builtin)).ToList();
            return J.Obj("reports", arr, "connected", HasConn(), "host", Base());
        }

        public static void AddCustom(string ad, string sablon)
        {
            if (string.IsNullOrWhiteSpace(ad) || string.IsNullOrWhiteSpace(sablon)) throw new Exception("Rapor adi ve sablonu gerekli.");
            string id = "c" + J.NowMs().ToString();
            Cfg.Update(c => {
                var list = J.LL(J.Get(c, "sambaReports"));
                list.Add(J.Obj("id", id, "ad", ad.Trim(), "sablon", sablon));
                c["sambaReports"] = list;
            });
        }
        public static void RemoveCustom(string id)
        {
            Cfg.Update(c => {
                var list = J.LL(J.Get(c, "sambaReports")).Where(o => J.S(J.DD(o), "id") != id).ToList();
                c["sambaReports"] = list;
            });
        }

        // ---- rapor calistir ----
        public static Dictionary<string, object> Run(string id, string start, string end)
        {
            var rap = All().FirstOrDefault(r => r.Id == id);
            if (rap == null) throw new Exception("Rapor bulunamadi.");
            const string q = "query($r:String,$s:String,$e:String){ r:getCustomReport(report:$r,startDate:$s,endDate:$e){ name tables{ name columns{ header } rows{ cells } } } }";
            var vars = J.Obj("r", rap.Sablon, "s", (start ?? "") + " 00:00:00", "e", (end ?? start ?? "") + " 23:59:59");
            var data = Gql(q, vars);
            var rep = J.DD(J.Get(data, "r"));
            // Genel tablo cikti: [{name, columns:[...], rows:[[...]]}]
            var tables = new List<object>();
            foreach (var t in J.LL(J.Get(rep, "tables")))
            {
                var td = J.DD(t);
                var cols = J.LL(J.Get(td, "columns")).Select(c => (object)J.S(J.DD(c), "header")).ToList();
                var rows = J.LL(J.Get(td, "rows")).Select(rw => (object)J.LL(J.Get(J.DD(rw), "cells"))).ToList();
                tables.Add(J.Obj("name", J.S(td, "name"), "columns", cols, "rows", rows));
            }
            return J.Obj("id", id, "ad", rap.Ad, "name", J.S(rep, "name"), "tables", tables, "start", start, "end", end);
        }
    }
}
