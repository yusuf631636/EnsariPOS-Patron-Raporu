// Patron Raporu 2.2 - telefona ANLIK bildirim (Web Push). Uygulama kapaliyken de iptal / ikram / iade / zayi / iskonto /
// gun basi-sonu olaylari telefona duser (Samba Patron'daki "push notification"un karsiligi). Her kullanici kendi
// telefonunda hangi turleri ve hangi tutarin ustunu istedigini secer. VAPID anahtarlari ProgramData'da bir kez uretilir.
// Olay kaynagi: App.Notifications() (ticket/odeme seviyesi) + Raporlar.RecentEvents() (siparis/iskonto seviyesi).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using Alfa;

namespace Patron
{
    public static class Bildirim
    {
        public static readonly string[] AllKinds = { "iptal", "iade", "ikram", "zayi", "iskonto", "gun-basi", "gun-sonu", "fiyat", "eksi-stok", "bekleyen" };
        static WebPush _push;
        static string _subsFile;
        static readonly object _lock = new object();
        static List<Dictionary<string, object>> _subs = new List<Dictionary<string, object>>();
        static HashSet<string> _seen;
        static Timer _timer;
        static int _busy;

        public static string PublicKey { get { return _push != null ? _push.PublicKey : null; } }

        public static void Init(string dir)
        {
            try
            {
                string f = Path.Combine(dir, "vapid.json");
                Dictionary<string, object> keys = null;
                try { if (File.Exists(f)) keys = J.ParseObj(Files.Read(f)); } catch { keys = null; }
                if (keys == null || J.S(keys, "publicKey").Length == 0) { keys = WebPush.GenerateKeys(); Files.WriteAtomic(f, J.Pretty(keys)); }
                _push = new WebPush(J.S(keys, "publicKey"), J.S(keys, "privateKey"), "mailto:destek@ornek-alanadi.com");
            }
            catch (Exception ex) { Log.Write("anlık bildirim anahtarları hazırlanamadı (bildirim kapalı): " + ex.Message); return; }
            _subsFile = Path.Combine(dir, "push-subs.json");
            try { if (File.Exists(_subsFile)) _subs = J.LL(J.Parse(Files.Read(_subsFile))).Select(J.D).Where(d => d != null).ToList(); } catch { }
            _timer = new Timer(_ => Tick(), null, 20000, 20000);
        }
        static void Save() { try { Files.WriteAtomic(_subsFile, J.Str(_subs)); } catch (Exception ex) { Log.Write("push-subs.json yazılamadı: " + ex.Message); } }

        public static Dictionary<string, object> Subscribe(string userId, Dictionary<string, object> sub, object kinds, object min)
        {
            if (_push == null) throw new Exception("Bu bilgisayarda anlık bildirim hazır değil.");
            string ep = J.S(sub, "endpoint");
            if (!ep.StartsWith("https://")) throw new Exception("Geçersiz abonelik.");
            var k = J.LL(kinds).Select(x => J.S(x)).Where(x => AllKinds.Contains(x)).Distinct().ToList();
            double m = J.Num(min); if (double.IsNaN(m) || m < 0) m = 0;
            lock (_lock)
            {
                _subs.RemoveAll(s => J.S(J.D(J.Get(s, "sub")), "endpoint") == ep);
                _subs.Add(J.Obj("userId", userId, "sub", sub, "kinds", k.Cast<object>().ToList(), "min", m, "at", J.IsoNow()));
                Save();
            }
            return J.Obj("ok", true, "kinds", k, "min", m);
        }
        public static void Unsubscribe(string endpoint) { lock (_lock) { if (_subs.RemoveAll(s => J.S(J.D(J.Get(s, "sub")), "endpoint") == endpoint) > 0) Save(); } }
        public static Dictionary<string, object> Status(string endpoint)
        {
            lock (_lock)
            {
                var s = _subs.FirstOrDefault(x => J.S(J.D(J.Get(x, "sub")), "endpoint") == endpoint);
                return J.Obj("key", PublicKey, "subscribed", s != null, "kinds", s != null ? J.Get(s, "kinds") : null, "min", s != null ? J.Get(s, "min") : null, "devices", _subs.Count);
            }
        }
        public static void ForgetUser(string userId) { lock (_lock) { if (_subs.RemoveAll(s => J.S(s, "userId") == userId) > 0) Save(); } }

        public static int Test(string endpoint)
        {
            Dictionary<string, object> s; lock (_lock) s = _subs.FirstOrDefault(x => J.S(J.D(J.Get(x, "sub")), "endpoint") == endpoint);
            if (s == null) throw new Exception("Bu cihaz bildirime abone değil.");
            return SendTo(s, J.Str(J.Obj("title", "Patron — deneme bildirimi", "body", "Bildirimler bu telefonda çalışıyor ✓", "tag", "test", "url", "/patron#bildirim")));
        }

        static int SendTo(Dictionary<string, object> s, string payload)
        {
            int code;
            try { code = _push.Send(J.D(J.Get(s, "sub")), payload, 6 * 3600); }
            catch (Exception ex) { Log.Write("bildirim gönderilemedi: " + ex.Message); return 0; }
            if (code == 404 || code == 410) { lock (_lock) { _subs.Remove(s); Save(); } }
            return code;
        }

        public static List<Dictionary<string, object>> AllEvents()
        {
            var list = new List<Dictionary<string, object>>();
            try { list.AddRange(App.NotificationsRaw()); } catch { }
            list.AddRange(Raporlar.RecentEvents());
            list.AddRange(Izleme.Events());
            return list.OrderByDescending(x => J.S(x, "date"), StringComparer.Ordinal).ToList();
        }

        static readonly Dictionary<string, string> Titles = new Dictionary<string, string> {
            { "iptal", "❌ İptal" }, { "iade", "↩ İade" }, { "ikram", "🧡 İkram" }, { "zayi", "🗑 Zayi" }, { "iskonto", "💸 İskonto" }, { "gun-basi", "🌅 Gün başı" }, { "gun-sonu", "🌓 Gün sonu" }, { "fiyat", "🏷 Fiyat değişti" }, { "eksi-stok", "📉 Eksi stok" }, { "bekleyen", "⏰ Bekleyen masa" } };

        // siparis/iskonto olaylarinin kalici SQL Id'si var; digerleri icerikten anahtarlanir
        static string EvId(Dictionary<string, object> e)
        {
            string id = J.S(e, "id");
            return id.StartsWith("o") || id.StartsWith("c") || id.StartsWith("w") ? id : J.S(e, "kind") + "|" + J.S(e, "date") + "|" + J.S(e, "ticket") + "|" + J.S(e, "amount");
        }

        /* Gun sonu bildirimi: bugunun cirosu, adisyon, ortalama, en cok satan ve kayip (ikram/iptal) tek satirda */
        static string DaySummary()
        {
            try
            {
                string today = DateTime.UtcNow.ToString("yyyy-MM-dd", J.Inv);
                var r = App.Report(today, today, null, null); var s = J.DD(J.Get(r, "summary"));
                var top = J.LL(J.Get(r, "products")).Select(J.D).FirstOrDefault();
                double lost = AllEvents().Where(x => J.S(x, "date").StartsWith(today) && (J.S(x, "kind") == "iptal" || J.S(x, "kind") == "ikram" || J.S(x, "kind") == "iade")).Sum(x => Math.Abs(J.Num(x, "amount")));
                return "Ciro " + J.Num(s, "sales").ToString("N0", J.Tr) + " ₺ · " + J.Num(s, "tickets").ToString("N0", J.Tr) + " adisyon · ort. " + J.Num(s, "average").ToString("N0", J.Tr) + " ₺" +
                    (top != null ? "\nEn çok: " + J.S(top, "name") : "") + (lost > 0 ? " · ikram/iptal " + lost.ToString("N0", J.Tr) + " ₺" : "");
            }
            catch { return null; }
        }

        static void Tick()
        {
            if (Interlocked.Exchange(ref _busy, 1) == 1) return;
            try
            {
                List<Dictionary<string, object>> subs; lock (_lock) subs = _subs.ToList();
                var events = AllEvents();
                if (_seen == null) { _seen = new HashSet<string>(events.Select(EvId)); return; }   // ilk tur: eskiler icin bildirim YAGDIRMA
                var fresh = events.Where(e => !_seen.Contains(EvId(e))).ToList();
                foreach (var e in fresh) _seen.Add(EvId(e));
                if (_seen.Count > 5000) _seen = new HashSet<string>(events.Select(EvId));
                if (fresh.Count == 0 || subs.Count == 0) return;
                if (fresh.Count > 12) fresh = fresh.Take(12).ToList();   // toplu iptal vs. -> telefonu bogma
                foreach (var e in fresh.AsEnumerable().Reverse())
                {
                    string kind = J.S(e, "kind"); double amt = Math.Abs(J.Num(e, "amount")); if (double.IsNaN(amt)) amt = 0;
                    string title; if (!Titles.TryGetValue(kind, out title)) title = kind;
                    bool plain = kind.StartsWith("gun") || kind == "fiyat" || kind == "eksi-stok";   // tutar basliga yazilmaz
                    string body = (plain || J.S(e, "ticket").Length == 0 ? "" : "Fiş " + J.S(e, "ticket") + " · " + amt.ToString("N2", J.Tr) + " ₺\n") + J.Clip(J.S(e, "detail"), 140);
                    if (kind == "gun-sonu") body = DaySummary() ?? body;   // 2.4: gun sonunda gunun ozeti telefona
                    string payload = J.Str(J.Obj("title", title + (plain ? "" : " — " + amt.ToString("N0", J.Tr) + " ₺"), "body", body, "tag", EvId(e), "url", "/patron#bildirim", "kind", kind));
                    foreach (var s in subs)
                    {
                        var kinds = J.LL(J.Get(s, "kinds")).Select(x => J.S(x)).ToList();
                        if (!kinds.Contains(kind)) continue;
                        if (!kind.StartsWith("gun") && amt < J.Num(s, "min")) continue;
                        SendTo(s, payload);
                    }
                }
            }
            catch (Exception ex) { Log.Write("bildirim turu atlandı: " + ex.Message); }
            finally { Interlocked.Exchange(ref _busy, 0); }
        }
    }
}
