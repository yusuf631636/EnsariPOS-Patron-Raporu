// Patron 2.4 - arka plan IZLEYICILERI (30.09.2026, rakip incelemesi: Samba Boss "fiyat degisikligi" ve "eksi stok"
// bildirimleri gonderiyor). Burada uretilen olaylar bildirim listesine ve telefona (push) gider:
//   fiyat     - SambaPOS'ta (ya da panelden) bir urun fiyati degisti          (her 60 sn karsilastirma)
//   eksi-stok - envanterde stogu eksiye dusen malzeme                        (her 10 dk, malzeme basina gunde 1 kez)
//   bekleyen  - acik masaya X dakikadir yeni siparis girilmedi (Ayarlar'dan)  (her 60 sn, masa basina 1 kez)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Alfa;

namespace Patron
{
    public static class Izleme
    {
        static Timer _t;
        static int _busy, _tick;
        static readonly object _lock = new object();
        static readonly List<Dictionary<string, object>> _events = new List<Dictionary<string, object>>();
        static Dictionary<string, string> _prices;   // priceId -> "fiyat|ad / porsiyon / etiket"
        static readonly HashSet<string> _once = new HashSet<string>();
        static string Now() { return DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", J.Inv); }

        public static void Start() { _t = new Timer(_ => Tick(), null, 30000, 60000); }
        public static List<Dictionary<string, object>> Events() { lock (_lock) return _events.ToList(); }
        static void Add(string kind, string ticket, double amount, string detail, string id)
        {
            lock (_lock)
            {
                if (!_once.Add(id)) return;
                _events.Insert(0, J.Obj("kind", kind, "date", Now(), "ticket", ticket, "amount", J.NumVal(amount), "detail", detail, "id", id));
                if (_events.Count > 150) _events.RemoveRange(150, _events.Count - 150);
                if (_once.Count > 5000) _once.Clear();
            }
        }

        static void Tick()
        {
            if (Interlocked.Exchange(ref _busy, 1) == 1) return;
            try
            {
                _tick++;
                try { Prices(); } catch (Exception ex) { LogOnce("fiyat izleme", ex); }
                try { Stale(); } catch (Exception ex) { LogOnce("bekleyen masa izleme", ex); }
                if (_tick % 10 == 1) { try { NegativeStock(); } catch (Exception ex) { LogOnce("stok izleme", ex); } }
            }
            finally { Interlocked.Exchange(ref _busy, 0); }
        }

        static void Prices()
        {
            var now = new Dictionary<string, string>();
            foreach (var i in App.MenuItems())
                now[J.S(i, "priceId")] = J.S(i, "price") + "|" + J.S(i, "name") + (J.S(i, "portion") != "Normal" ? " / " + J.S(i, "portion") : "") + (J.S(i, "tagLabel") != "Standart" ? " (" + J.S(i, "tagLabel") + ")" : "");
            var old = _prices; _prices = now;
            if (old == null) return;
            int n = 0;
            foreach (var kv in now)
            {
                string was; if (!old.TryGetValue(kv.Key, out was) || was == kv.Value) continue;
                string p0 = was.Split('|')[0], p1 = kv.Value.Split('|')[0];
                if (p0 == p1) continue;
                double a = J.Num(p0), b = J.Num(p1);
                if (++n > 25) break;   // toplu zam: listeyi bogma
                Add("fiyat", "", b, kv.Value.Substring(kv.Value.IndexOf('|') + 1) + ": " + a.ToString("N2", J.Tr) + " → " + b.ToString("N2", J.Tr) + " ₺", "wP" + kv.Key + "|" + p1 + "|" + DateTime.Now.Ticks);
            }
        }

        static void Stale()
        {
            double m = J.Num(J.Get(Ekler.Settings(), "staleMinutes")); if (double.IsNaN(m)) m = 45;
            if (m <= 0) return;
            var r = Db.Query(App.NoLock + "SET NOCOUNT ON; SELECT x.Id,COALESCE(NULLIF((SELECT TOP 1 EntityName FROM TicketEntities WHERE Ticket_Id=x.Id ORDER BY Id DESC),''),'Açık masa'),x.n,x.rem,CONVERT(varchar(19),x.lo,120),DATEDIFF(minute,x.lo,GETDATE()) FROM (SELECT t.Id,COALESCE(NULLIF(t.TicketNumber,''),CONVERT(varchar(20),t.Id)) AS n,t.RemainingAmount AS rem,MAX(o.CreatedDateTime) AS lo FROM Tickets t INNER JOIN Orders o ON o.TicketId=t.Id WHERE t.IsClosed=0 GROUP BY t.Id,t.TicketNumber,t.RemainingAmount) x WHERE DATEDIFF(minute,x.lo,GETDATE()) >= " + (int)m + " AND DATEDIFF(minute,x.lo,GETDATE()) < 720");
            foreach (var x in r)
                Add("bekleyen", Db.S(x[2]), Db.N(x[3]), Db.S(x[1]) + " — " + Db.S(x[5]) + " dakikadır yeni sipariş yok (son sipariş " + Db.S(x[4]).Substring(11, 5) + ")", "wB" + Db.S(x[0]) + "|" + Db.S(x[4]));
        }

        static void NegativeStock()
        {
            string day = DateTime.Now.ToString("yyyy-MM-dd", J.Inv);
            foreach (var it in Raporlar.StockItems())
            {
                double st = J.Num(it, "stock"); if (double.IsNaN(st) || st >= -0.001) continue;
                Add("eksi-stok", "", J.Num(it, "value"), J.S(it, "name") + ": stok " + st.ToString("N2", J.Tr) + " " + J.S(it, "unit") + " (eksiye düştü)", "wS" + J.S(it, "name") + "|" + day);
            }
        }
        static readonly HashSet<string> _logged = new HashSet<string>();
        static void LogOnce(string what, Exception ex) { lock (_logged) if (_logged.Add(what)) Log.Write(what + " yapilamadi (bu SambaPOS kurulumunda desteklenmiyor olabilir): " + ex.Message); }
    }
}
