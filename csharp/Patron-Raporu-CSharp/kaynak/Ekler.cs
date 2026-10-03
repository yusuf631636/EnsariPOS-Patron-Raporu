// Patron 2.3 ekleri (30.09.2026, kullanici istegi: "ozellikleri cogalt, arastir, ilaveler, yeni gorunum").
// Toast Now / Owner.com / 7shifts'ten esinle: gunluk-aylik HEDEF (tum kullanicilar icin ortak, ProgramData'da),
// CANLI AKIS (son siparisler + odemeler + ikram/iptal dakika dakika), KASA SAYIMI (beklenen nakit vs sayilan, gecmis).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Alfa;

namespace Patron
{
    public static class Ekler
    {
        static readonly object _lock = new object();
        static string F(string name) { return Path.Combine(App.RuntimeDir, name); }
        static List<object[]> Q(string sql) { return Db.Query(App.NoLock + "SET NOCOUNT ON; " + sql); }
        static string S(object o) { return Db.S(o); }
        static object N(object o) { return J.NumVal(Db.N(o)); }

        // ============================================================== hedefler
        public static Dictionary<string, object> Settings()
        {
            lock (_lock) { try { if (File.Exists(F("patron-ayarlar.json"))) return J.ParseObj(Files.Read(F("patron-ayarlar.json"))) ?? new Dictionary<string, object>(); } catch { } }
            return new Dictionary<string, object>();
        }
        public static Dictionary<string, object> SaveSettings(Dictionary<string, object> b, string user)
        {
            var s = Settings();
            foreach (var k in new[] { "dailyTarget", "monthlyTarget", "staleMinutes" })
            {
                if (!J.Has(b, k)) continue;
                double v = J.Num(J.Get(b, k)); if (double.IsNaN(v) || v < 0 || v > 1e9) throw new Exception("Geçersiz hedef tutarı.");
                s[k] = J.NumVal(Math.Round(v, 2));
            }
            s["updatedBy"] = user; s["updatedAt"] = J.IsoNow();
            lock (_lock) Files.WriteAtomic(F("patron-ayarlar.json"), J.Pretty(s));
            return s;
        }

        // ============================================================== canli akis
        public static List<object> Feed(int minutes)
        {
            minutes = Math.Max(10, Math.Min(minutes, 24 * 60));
            var list = new List<Dictionary<string, object>>();
            var errors = new List<string>();
            try
            {
                foreach (var x in Q("SELECT TOP 80 CONVERT(varchar(19),o.CreatedDateTime,120),COALESCE(NULLIF(t.TicketNumber,''),CONVERT(varchar(20),t.Id)),COALESCE(NULLIF((SELECT TOP 1 EntityName FROM TicketEntities WHERE Ticket_Id=t.Id ORDER BY Id DESC),''),''),COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),o.Quantity,o.Price*o.Quantity,COALESCE(o.CreatingUserName,''),t.Id," + Raporlar.OrderKind + " FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE o.CreatedDateTime >= DATEADD(minute,-" + minutes + ",GETDATE()) ORDER BY o.CreatedDateTime DESC,o.Id DESC"))
                {
                    string k = S(x[8]);
                    list.Add(J.Obj("type", k.Length > 0 ? k : "order", "date", S(x[0]), "ticket", S(x[1]), "table", S(x[2]), "name", S(x[3]), "quantity", N(x[4]), "amount", N(x[5]), "user", S(x[6]), "id", S(x[7])));
                }
            }
            catch (Exception ex) { errors.Add(ex.Message); }
            try
            {
                foreach (var x in Q("SELECT TOP 60 CONVERT(varchar(19),p.Date,120),COALESCE(NULLIF(t.TicketNumber,''),CONVERT(varchar(20),p.TicketId)),COALESCE(NULLIF((SELECT TOP 1 EntityName FROM TicketEntities WHERE Ticket_Id=p.TicketId ORDER BY Id DESC),''),''),COALESCE(NULLIF(p.Name,''),'Ödeme'),p.Amount,p.TicketId FROM Payments p LEFT JOIN Tickets t ON t.Id=p.TicketId WHERE p.Date >= DATEADD(minute,-" + minutes + ",GETDATE()) ORDER BY p.Date DESC"))
                    list.Add(J.Obj("type", "payment", "date", S(x[0]), "ticket", S(x[1]), "table", S(x[2]), "name", S(x[3]), "amount", N(x[4]), "id", S(x[5])));
            }
            catch (Exception ex) { errors.Add(ex.Message); }
            if (list.Count == 0 && errors.Count > 0) throw new Exception(errors[0]);
            return list.OrderByDescending(x => J.S(x, "date"), StringComparer.Ordinal).Take(120).Cast<object>().ToList();
        }

        // ============================================================== kasa sayimi
        /* Beklenen: acik (ya da son) is gununun baslangicindan beri odeme turlerine gore tahsilat; nakit = adinda nakit/cash gecenler */
        public static Dictionary<string, object> CashExpected()
        {
            var wp = Q("SELECT TOP 1 w.Id,CONVERT(varchar(19),w.StartDate,120),CONVERT(varchar(19),w.EndDate,120),COALESCE(CONVERT(varchar(20),w.WorkPeriodNumber),'') FROM WorkPeriods w ORDER BY w.StartDate DESC");
            DateTime start; string end = "", no = "", sid = "";
            if (wp.Count > 0 && DateTime.TryParse(S(wp[0][1]), J.Inv, System.Globalization.DateTimeStyles.None, out start)) { end = S(wp[0][2]); no = S(wp[0][3]); sid = S(wp[0][0]); }
            else start = DateTime.Today;
            string until = end.Length > 0 ? "CONVERT(datetime,'" + end + "',120)" : "GETDATE()";
            var pays = Q("SELECT COALESCE(NULLIF(p.Name,''),'Bilinmeyen'),SUM(p.Amount),COUNT(*) FROM Payments p WHERE p.Date >= " + Raporlar.Dt(start) + " AND p.Date < " + until + " GROUP BY COALESCE(NULLIF(p.Name,''),'Bilinmeyen') ORDER BY 2 DESC");
            var list = pays.Select(x => (object)J.Obj("name", S(x[0]), "amount", N(x[1]), "count", N(x[2]))).ToList();
            double cash = pays.Where(x => { string n = J.LowerTr(S(x[0])); return n.Contains("nakit") || n.Contains("cash"); }).Sum(x => Db.N(x[1]));
            return J.Obj("workPeriod", J.Obj("id", sid, "number", no, "start", start.ToString("yyyy-MM-dd HH:mm:ss", J.Inv), "end", end), "payments", list, "cash", J.NumVal(cash));
        }
        public static Dictionary<string, object> SaveCashCount(Dictionary<string, object> b, string user)
        {
            double counted = J.Num(J.Get(b, "counted")), expected = J.Num(J.Get(b, "expected"));
            if (double.IsNaN(counted) || counted < 0 || counted > 1e9) throw new Exception("Geçersiz sayım tutarı.");
            if (double.IsNaN(expected)) expected = 0;
            double opening = J.Num(J.Get(b, "opening")); if (double.IsNaN(opening) || opening < 0) opening = 0;   // acilis kasasi (para ustu)
            var rec = J.Obj("at", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", J.Inv), "user", user, "counted", J.NumVal(counted), "expected", J.NumVal(expected),
                "diff", J.NumVal(Math.Round(counted - (expected + opening), 2)), "opening", J.NumVal(opening),
                "workPeriod", J.Clip(J.S(b, "workPeriod"), 20), "note", J.Clip(J.S(b, "note"), 300), "details", J.Get(b, "details") as Dictionary<string, object>);
            lock (_lock) File.AppendAllText(F("kasa-sayim.jsonl"), J.Str(rec) + "\n", Files.Utf8);
            return rec;
        }
        public static List<object> CashCounts(int limit)
        {
            string f = F("kasa-sayim.jsonl");
            if (!File.Exists(f)) return new List<object>();
            List<string> lines; lock (_lock) lines = File.ReadAllLines(f, System.Text.Encoding.UTF8).Where(l => l.Trim().Length > 0).ToList();
            var outp = new List<object>();
            for (int i = lines.Count - 1; i >= 0 && outp.Count < limit; i--) { try { outp.Add(J.Parse(lines[i])); } catch { } }
            return outp;
        }
    }
}
