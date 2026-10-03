// Patron Raporu - C# SÜRÜM (30.09.2026, kullanici istegi: "patronu ... #c olsun"). Restoran bilgisayarindaki
// Node ajaninin (server.js + patron-cloud.js + tunnel-watch.js + updater.js) karsiligi. Ayni config.json, ayni
// ProgramData\EnsariPOS\PatronRaporu verileri (patron-auth.json sifreleri scrypt ile ayni), ayni HTTP uclari,
// ayni bulut sozlesmesi (/api/agent/push her 15 sn + /patron-ws komut kanali).
// Iki farkli Node surumu vardi ve birbirinde olmayan duzeltmeler tasiyordu - bu surum IKISININ BIRLESIMI:
//  - 7-Patron-Raporu (proje): coklu kullanici, /patron-ws komutlari (fiyat/adisyon/rapor), saat filtresi, menu gonderimi
//  - patron-update 1.4.0 (restoranlarda calisan): kalici oturumlar, TicketStates JSON'u kodda ayristirma
//    (SQL 2016 oncesi uyumluluk), Turkce karakter (SqlClient ile zaten sorun yok), otomatik guncelleme
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.ServiceProcess;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Alfa;

[assembly: System.Reflection.AssemblyTitle("Patron Raporu Sunucusu")]
[assembly: System.Reflection.AssemblyProduct("AlfaPOS Patron Raporu")]
[assembly: System.Reflection.AssemblyVersion("2.4.0.0")]

namespace Patron
{
    public static class Program
    {
        public const string ServiceName = "EnsariPatron";
        public static Dictionary<string, string> Opts = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public static string Opt(string k) { string v; return Opts.TryGetValue(k, out v) && v.Length > 0 ? v : null; }

        public static void Main(string[] args)
        {
            foreach (var a in args) { string s = a.TrimStart('/', '-'); int i = s.IndexOf(':'); if (i > 0) Opts[s.Substring(0, i)] = s.Substring(i + 1); else Opts[s] = ""; }
            if (!(Opts.ContainsKey("console") || Environment.UserInteractive)) { ServiceBase.Run(new Svc()); return; }
            try { App.Start(); } catch (Exception ex) { Console.WriteLine("BASLATILAMADI: " + ex); Environment.ExitCode = 1; return; }
            Console.WriteLine("Patron Raporu (konsol) http://127.0.0.1:" + App.Port + "  - Ctrl+C ile durdurun");
            Thread.Sleep(Timeout.Infinite);
        }
    }

    public class Svc : ServiceBase
    {
        public Svc() { ServiceName = Program.ServiceName; CanStop = true; CanShutdown = true; }
        protected override void OnStart(string[] args) { App.Start(); }
        protected override void OnStop() { App.Stop(); }
        protected override void OnShutdown() { App.Stop(); }
    }

    public static class App
    {
        public const string Version = "2.4.0";
        public static string Root, RuntimeDir;
        public static int Port = 8787;
        static string AppName = "Ensari POS Patron", CloudKey = "", CloudUrl = "https://app.ornek-alanadi.com", KuryeUrl = "http://127.0.0.1:4021", PublicUrl = "";
        static LocalHost _host;
        static Timer _push, _tunnelWatch;

        public static void Start()
        {
            Web.Init();
            Root = Path.GetFullPath(Program.Opt("root") ?? AppDomain.CurrentDomain.BaseDirectory).TrimEnd('\\');
            string pd = Environment.GetEnvironmentVariable("PROGRAMDATA") ?? Environment.GetEnvironmentVariable("TEMP") ?? Root;
            RuntimeDir = Program.Opt("data") ?? Path.Combine(pd, "EnsariPOS", "PatronRaporu");
            Directory.CreateDirectory(RuntimeDir);
            Log.Init(Program.Opt("logs") ?? Path.Combine(RuntimeDir, "logs"));
            Cfg.PathFile = Path.Combine(Root, "config.json");
            var c = Cfg.Read();
            int p;
            Port = int.TryParse(Program.Opt("port"), out p) ? p : (int)J.NumOr(J.Get(c, "port"), 8787);
            if (J.S(c, "appName").Length > 0) AppName = J.S(c, "appName");
            CloudKey = J.S(c, "cloudActivationKey").Trim();
            if (J.S(c, "cloudServerUrl").Length > 0) CloudUrl = J.S(c, "cloudServerUrl").TrimEnd('/');
            if (J.S(c, "kuryeInternalUrl").Length > 0) KuryeUrl = J.S(c, "kuryeInternalUrl").TrimEnd('/');
            PublicUrl = J.S(c, "publicUrl");
            // Node: config.server || config.sqlServer - ortak Db sadece "server" okur
            if (J.S(c, "server").Length == 0 && J.S(c, "sqlServer").Length > 0 && Environment.GetEnvironmentVariable("SAMBAPOS_SQL_SERVER") == null)
                Environment.SetEnvironmentVariable("SAMBAPOS_SQL_SERVER", J.S(c, "sqlServer"));
            License.CloudUrl = CloudUrl;   // Updater buradan okur (Patron'da lisans kontrolu yok - Node'daki gibi)
            License.Key = CloudKey; License.Product = "patron";   // 2.5: e-posta ile giris bulut hesabindan dogrulanir (License.VerifyPassword). Init CAGRILMAZ - lisans kontrolu baslamaz.
            int w, io; ThreadPool.GetMinThreads(out w, out io); ThreadPool.SetMinThreads(Math.Max(w, 24), Math.Max(io, 24));

            Auth.Init(RuntimeDir);
            if (!Program.Opts.ContainsKey("nopush")) Bildirim.Init(RuntimeDir);
            if (!Program.Opts.ContainsKey("nowatch")) Izleme.Start();
            _host = new LocalHost(Port, Handle, Program.Opt("bind") ?? "127.0.0.1");   // Node: listen(PORT, '127.0.0.1')
            _host.Start();
            Log.Write(AppName + " (C#) " + LocalVersion() + ": http://127.0.0.1:" + Port + "  veri: " + RuntimeDir);

            if (CloudKey.Length > 0 && !Program.Opts.ContainsKey("nocloud"))
            {
                Log.Write("Bulut gönderimi aktif: " + CloudUrl);
                _push = new Timer(_ => CloudPush(), null, 0, 15000);
                CloudChannel.Start(CloudUrl, CloudKey);
            }
            _tunnelWatch = new Timer(_ => TunnelWatch(), null, 10000, 10000);
            Updater.Root = Root; Updater.Channel = "patron-cs-update"; Updater.DefaultVersion = Version;
            Updater.Never = new[] { "config.json", "ddns.json" };
            if (!Program.Opts.ContainsKey("noupdate")) Updater.Start(Program.Opts.ContainsKey("updatenow"));
            ThreadPool.QueueUserWorkItem(delegate { try { Db.Query("SELECT 1"); Log.Write("SQL bağlantısı hazır: " + Db.Source); } catch (Exception ex) { Log.Write("UYARI - SQL'e bağlanılamadı: " + ex.Message); } });
        }
        static string LocalVersion() { try { string v = File.ReadAllText(Path.Combine(Root, "surum.txt")).Trim(); if (v.Length > 0) return v; } catch { } return Version; }
        public static void Stop() { try { CloudChannel.Stop(); _host.Stop(); } catch { } Log.Write(AppName + " durduruldu."); }

        // ============================================================== SQL (sqlcmd yerine SqlClient)
        /* 2.4: okumalar KILITSIZ (READ UNCOMMITTED) - rapor ne kadar agir olursa olsun SambaPOS'ta masa acmayi/siparisi bekletmez
           (rakip "Alfa Boss" yorumlarindaki "SambaPOS kitleniyor" sikayetinin cozumu). Yazma (UPDATE) sorgulari etkilenmez. */
        public const string NoLock = "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; ";
        static List<object[]> Sql(string q) { return Db.Query(q.IndexOf("UPDATE ", StringComparison.OrdinalIgnoreCase) >= 0 ? q : NoLock + q); }
        static string S(object o) { return Db.S(o); }
        static object N(object o) { return J.NumVal(Db.N(o)); }
        static bool ValidDate(string v) { return v != null && Regex.IsMatch(v, @"^\d{4}-\d{2}-\d{2}$"); }
        static string Today() { return DateTime.UtcNow.ToString("yyyy-MM-dd", J.Inv); }   // Node: new Date().toISOString().slice(0,10)
        static int? HourGuard(object v)
        {
            if (v == null) return null;
            string s = J.S(v);
            if (s.Length == 0) return null;
            double n = J.Num(v);
            return (!double.IsNaN(n) && n == Math.Floor(n) && n >= 0 && n <= 23) ? (int?)(int)n : null;
        }

        /* hourStart/hourEnd verilirse sadece o saatlerdeki satislar (ör. "son bir hafta saat 01:00'de olanlar") */
        public static Dictionary<string, object> Report(string start, string end, object hourStart, object hourEnd, bool extra = false)
        {
            if (!ValidDate(start)) start = Today();
            if (!ValidDate(end)) end = Today();
            int? hs = HourGuard(hourStart), he = HourGuard(hourEnd);
            bool hasHour = hs != null && he != null;
            string hourClause = hasHour ? " AND DATEPART(hour,Date) BETWEEN " + hs + " AND " + he : "";
            // 2.2: CONVERT(...,120) - SQL dili Turkce (dmy) olan sunucuda '2026-09-30' ydm okunup hata veriyordu
            string dA = "CONVERT(datetime,'" + start + " 00:00:00',120)", dB = "DATEADD(day,1,CONVERT(datetime,'" + end + " 00:00:00',120))";
            string where = "IsClosed=1 AND Date >= " + dA + " AND Date < " + dB + hourClause;
            var summary = Sql("SET NOCOUNT ON; SELECT COALESCE(SUM(TotalAmount),0),COUNT(*),COALESCE(AVG(TotalAmount),0),COALESCE(SUM(RemainingAmount),0) FROM Tickets WHERE " + where);
            var daily = Sql("SET NOCOUNT ON; SELECT CONVERT(varchar(10),Date,23),COALESCE(SUM(TotalAmount),0),COUNT(*) FROM Tickets WHERE " + where + " GROUP BY CONVERT(varchar(10),Date,23) ORDER BY 1");
            var hourly = Sql("SET NOCOUNT ON; SELECT DATEPART(hour,Date),COALESCE(SUM(TotalAmount),0),COUNT(*) FROM Tickets WHERE " + where + " GROUP BY DATEPART(hour,Date) ORDER BY 1");
            var products = Sql("SET NOCOUNT ON; SELECT TOP 15 COALESCE(NULLIF(MenuItemName,''),'Bilinmeyen'),COALESCE(SUM(Quantity),0),COALESCE(SUM(Price*Quantity),0) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE t." + where + " AND o.CalculatePrice=1 GROUP BY COALESCE(NULLIF(MenuItemName,''),'Bilinmeyen') ORDER BY SUM(Price*Quantity) DESC");
            var payments = Sql("SET NOCOUNT ON; SELECT COALESCE(NULLIF(Name,''),'Bilinmeyen'),COALESCE(SUM(Amount),0),COUNT(*) FROM Payments WHERE Date >= " + dA + " AND Date < " + dB + hourClause + " GROUP BY COALESCE(NULLIF(Name,''),'Bilinmeyen') ORDER BY SUM(Amount) DESC");
            var users = Sql("SET NOCOUNT ON; SELECT TOP 15 COALESCE(NULLIF(CreatedUserName,''),'Bilinmeyen'),COALESCE(SUM(TotalAmount),0),COUNT(*) FROM Tickets WHERE " + where + " GROUP BY COALESCE(NULLIF(CreatedUserName,''),'Bilinmeyen') ORDER BY SUM(TotalAmount) DESC");
            var recent = Sql("SET NOCOUNT ON; SELECT TOP 12 CONVERT(varchar(19),Date,120),COALESCE(TicketNumber,''),COALESCE(TotalAmount,0),COALESCE(CreatedUserName,'') FROM Tickets WHERE " + where + " ORDER BY Date DESC");
            var departments = Sql("SET NOCOUNT ON; SELECT COALESCE(NULLIF(d.Name,''),'Bilinmeyen'),COALESCE(SUM(t.TotalAmount),0),COUNT(*) FROM Tickets t LEFT JOIN Departments d ON d.Id=t.DepartmentId WHERE " + where + " GROUP BY COALESCE(NULLIF(d.Name,''),'Bilinmeyen') ORDER BY SUM(t.TotalAmount) DESC");
            var tickets = Sql("SET NOCOUNT ON; SELECT TOP 100 CONVERT(varchar(19),t.Date,120),COALESCE(t.TicketNumber,''),COALESCE(NULLIF(te.EntityName,''),'Acik adisyon'),COALESCE(t.CreatedUserName,''),COALESCE(NULLIF(d.Name,''),'Bilinmeyen'),COALESCE(t.TotalAmount,0),COALESCE(t.RemainingAmount,0),t.IsClosed FROM Tickets t LEFT JOIN Departments d ON d.Id=t.DepartmentId OUTER APPLY (SELECT TOP 1 EntityName FROM TicketEntities WHERE Ticket_Id=t.Id ORDER BY Id DESC) te WHERE " + where + " ORDER BY t.Date DESC");
            var s = summary.Count > 0 ? summary[0] : new object[4];
            var result = J.Obj(
                "range", J.Obj("start", start, "end", end, "hourStart", hasHour ? (object)hs.Value : null, "hourEnd", hasHour ? (object)he.Value : null),
                "summary", J.Obj("sales", N(s[0]), "tickets", N(s[1]), "average", N(s[2]), "remaining", N(s[3])),
                "daily", daily.Select(r => (object)J.Obj("date", S(r[0]), "amount", N(r[1]), "count", N(r[2]))).ToList(),
                "hourly", hourly.Select(r => (object)J.Obj("hour", N(r[0]), "amount", N(r[1]), "count", N(r[2]))).ToList(),
                "products", products.Select(r => (object)J.Obj("name", S(r[0]), "quantity", N(r[1]), "amount", N(r[2]))).ToList(),
                "payments", payments.Select(r => (object)J.Obj("name", S(r[0]), "amount", N(r[1]), "count", N(r[2]))).ToList(),
                "users", users.Select(r => (object)J.Obj("name", S(r[0]), "amount", N(r[1]), "count", N(r[2]))).ToList(),
                "recent", recent.Select(r => (object)J.Obj("date", S(r[0]), "number", S(r[1]), "amount", N(r[2]), "user", S(r[3]))).ToList(),
                "departments", departments.Select(r => (object)J.Obj("name", S(r[0]), "amount", N(r[1]), "count", N(r[2]))).ToList(),
                "tickets", tickets.Select(r => (object)J.Obj("date", S(r[0]), "number", S(r[1]), "table", S(r[2]), "user", S(r[3]), "department", S(r[4]),
                    "amount", N(r[5]), "remaining", N(r[6]), "closed", S(r[7]) == "1")).ToList());
            if (extra) result["extra"] = ReportExtra(start, end, where, hourClause);
            return result;
        }

        /* 2.2.0 - Samba Patron tarzi rapor menusu icin ek kirilimlar (panel 'extra:true' isterse). Eski ajanlar bu
           alani hic gondermez, panel o raporlari "Patron'u guncelleyin" diye gosterir. */
        static Dictionary<string, object> ReportExtra(string start, string end, string where, string hourClause)
        {
            string tWhere = "t.Date >= '" + start + "' AND t.Date < DATEADD(day,1,'" + end + "')" + hourClause.Replace("Date", "t.Date");
            var groups = Sql("SET NOCOUNT ON; SELECT COALESCE(NULLIF(mi.GroupCode,''),'Diğer'),COALESCE(SUM(o.Quantity),0),COALESCE(SUM(o.Price*o.Quantity),0) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId LEFT JOIN MenuItems mi ON mi.Id=o.MenuItemId WHERE t." + where + " GROUP BY COALESCE(NULLIF(mi.GroupCode,''),'Diğer') ORDER BY 3 DESC");
            var allProducts = Sql("SET NOCOUNT ON; SELECT TOP 300 COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),COALESCE(NULLIF(mi.GroupCode,''),'Diğer'),COALESCE(SUM(o.Quantity),0),COALESCE(SUM(o.Price*o.Quantity),0) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId LEFT JOIN MenuItems mi ON mi.Id=o.MenuItemId WHERE t." + where + " GROUP BY COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),COALESCE(NULLIF(mi.GroupCode,''),'Diğer') ORDER BY 4 DESC");
            var userPay = Sql("SET NOCOUNT ON; SELECT COALESCE(NULLIF(u.Name,''),'Bilinmeyen'),COALESCE(NULLIF(p.Name,''),'Bilinmeyen'),COALESCE(SUM(p.Amount),0),COUNT(*) FROM Payments p LEFT JOIN Users u ON u.Id=p.UserId WHERE p.Date >= '" + start + "' AND p.Date < DATEADD(day,1,'" + end + "')" + hourClause.Replace("Date", "p.Date") + " GROUP BY COALESCE(NULLIF(u.Name,''),'Bilinmeyen'),COALESCE(NULLIF(p.Name,''),'Bilinmeyen') ORDER BY 1,3 DESC");
            var calcs = Sql("SET NOCOUNT ON; SELECT TOP 200 CONVERT(varchar(19),t.Date,120),COALESCE(t.TicketNumber,''),COALESCE(NULLIF(c.Name,''),'Bilinmeyen'),COALESCE(c.CalculationAmount,0),COALESCE(c.LastUpdatedUser,''),COALESCE(t.CreatedUserName,'') FROM Calculations c INNER JOIN Tickets t ON t.Id=c.TicketId WHERE " + tWhere + " AND COALESCE(c.CalculationAmount,0)<>0 ORDER BY t.Date DESC");
            var special = Sql("SET NOCOUNT ON; SELECT TOP 300 CONVERT(varchar(19),o.CreatedDateTime,120),COALESCE(t.TicketNumber,''),COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),COALESCE(o.Quantity,0),COALESCE(o.Price*o.Quantity,0),COALESCE(o.CreatingUserName,''),COALESCE(o.OrderStates,''),o.CalculatePrice,COALESCE(o.OrderTags,'') FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE " + tWhere + " AND (o.CalculatePrice=0 OR o.OrderStates LIKE '%Void%' OR o.OrderStates LIKE '%ptal%' OR o.OrderStates LIKE '%ade%' OR o.OrderStates LIKE '%ayi%' OR o.OrderStates LIKE '%Waste%' OR o.OrderStates LIKE '%kram%' OR o.OrderStates LIKE '%Gift%') ORDER BY o.CreatedDateTime DESC");
            var couriers = Sql("SET NOCOUNT ON; SELECT COALESCE(NULLIF(te.EntityName,''),'Bilinmeyen'),COUNT(DISTINCT t.Id),COALESCE(SUM(t.TotalAmount),0) FROM TicketEntities te INNER JOIN EntityTypes et ON et.Id=te.EntityTypeId INNER JOIN Tickets t ON t.Id=te.Ticket_Id WHERE t." + where + " AND (et.Name LIKE '%paket%' OR et.Name LIKE '%kurye%' OR et.Name LIKE '%courier%') GROUP BY COALESCE(NULLIF(te.EntityName,''),'Bilinmeyen') ORDER BY 3 DESC");
            var hourProd = Sql("SET NOCOUNT ON; SELECT TOP 400 DATEPART(hour,t.Date),COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),COALESCE(SUM(o.Quantity),0),COALESCE(SUM(o.Price*o.Quantity),0) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE t." + where + " GROUP BY DATEPART(hour,t.Date),COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen') ORDER BY 1,4 DESC");
            Func<object[], string> kind = r =>
            {
                string st = (S(r[6]) + " " + S(r[8])).ToLowerInvariant();
                if (st.Contains("void") || st.Contains("iptal") || st.Contains("iade") || st.Contains("ade")) return "iade";
                if (st.Contains("waste") || st.Contains("zayi") || st.Contains("ayi")) return "zayi";
                return "ikram";
            };
            return J.Obj(
                "groups", groups.Select(r => (object)J.Obj("name", S(r[0]), "quantity", N(r[1]), "amount", N(r[2]))).ToList(),
                "products", allProducts.Select(r => (object)J.Obj("name", S(r[0]), "group", S(r[1]), "quantity", N(r[2]), "amount", N(r[3]))).ToList(),
                "userPayments", userPay.Select(r => (object)J.Obj("user", S(r[0]), "type", S(r[1]), "amount", N(r[2]), "count", N(r[3]))).ToList(),
                "calculations", calcs.Select(r => (object)J.Obj("date", S(r[0]), "ticket", S(r[1]), "name", S(r[2]), "amount", N(r[3]), "user", S(r[4]).Length > 0 ? S(r[4]) : S(r[5]))).ToList(),
                "specials", special.Select(r => (object)J.Obj("date", S(r[0]), "ticket", S(r[1]), "name", S(r[2]), "quantity", N(r[3]), "amount", N(r[4]), "user", S(r[5]), "kind", kind(r))).ToList(),
                "couriers", couriers.Select(r => (object)J.Obj("name", S(r[0]), "count", N(r[1]), "amount", N(r[2]))).ToList(),
                "hourlyProducts", hourProd.Select(r => (object)J.Obj("hour", N(r[0]), "name", S(r[1]), "quantity", N(r[2]), "amount", N(r[3]))).ToList());
        }

        static List<object> PriceChanges(int days)
        {
            var r = Sql("SET NOCOUNT ON; WITH H AS (SELECT MenuItemId,COALESCE(NULLIF(MenuItemName,''),'Bilinmeyen') AS ItemName,Price,CreatedDateTime,LAG(Price) OVER(PARTITION BY MenuItemId ORDER BY CreatedDateTime) AS PreviousPrice FROM Orders WHERE CreatedDateTime >= DATEADD(day,-" + days + ",GETDATE()) AND Price IS NOT NULL) SELECT TOP 100 CONVERT(varchar(19),CreatedDateTime,120),ItemName,PreviousPrice,Price,Price-PreviousPrice FROM H WHERE PreviousPrice IS NOT NULL AND PreviousPrice<>Price ORDER BY CreatedDateTime DESC;");
            return r.Select(x => (object)J.Obj("date", S(x[0]), "name", S(x[1]), "oldPrice", N(x[2]), "newPrice", N(x[3]), "difference", N(x[4]))).ToList();
        }

        /* TicketStates JSON'u SQL'de (JSON_VALUE/OPENJSON) degil burada ayristirilir - SQL Server uyumluluk duzeyi
           130'un altindaysa o fonksiyonlar tum sorguyu patlatiyordu (1.4.0 duzeltmesi). */
        static string PackState(string json)
        {
            try
            {
                foreach (var it in J.LL(J.Parse(string.IsNullOrEmpty(json) ? "[]" : json)))
                {
                    var d = J.D(it);
                    if (d != null && J.S(d, "SN") == "Paket") return J.S(d, "S");
                }
            }
            catch { }
            return "";
        }
        public static Dictionary<string, object> OpenTables()
        {
            var r = Sql("SET NOCOUNT ON; SELECT t.Id,CASE WHEN LOWER(COALESCE(tt.Name,'')) LIKE '%paket%' OR LOWER(COALESCE(tt.Name,'')) LIKE '%takeaway%' OR LOWER(COALESCE(t.CreatedUserName,'')) IN ('yemek sepeti','trendyol','getir') THEN 'package' ELSE 'table' END,COALESCE(NULLIF((SELECT TOP 1 EntityName FROM TicketEntities WHERE Ticket_Id=t.Id ORDER BY Id DESC),''),'Acik masa'),COALESCE(t.TicketNumber,''),CONVERT(varchar(19),t.Date,120),COALESCE(t.TotalAmount,0),COALESCE(t.RemainingAmount,0),COALESCE(t.CreatedUserName,''),COALESCE(REPLACE(REPLACE(REPLACE(t.TicketStates,'|','/'),CHAR(13),' '),CHAR(10),' '),'') FROM Tickets t LEFT JOIN TicketTypes tt ON tt.Id=t.TicketTypeId WHERE t.IsClosed=0 ORDER BY t.Date;");
            var items = r.Select(x => J.Obj("id", S(x[0]), "kind", S(x[1]), "table", S(x[2]), "number", S(x[3]), "date", S(x[4]), "total", N(x[5]), "remaining", N(x[6]),
                "user", S(x[7]), "ticketStates", S(x[8]), "packState", PackState(S(x[8])))).ToList();
            var packages = items.Where(x => J.S(x, "kind") == "package").ToList();
            return J.Obj("tables", items.Where(x => J.S(x, "kind") == "table").ToList(),
                "packages", J.Obj("pending", packages.Where(x => J.S(x, "packState") != "Yolda").ToList(), "enroute", packages.Where(x => J.S(x, "packState") == "Yolda").ToList()));
        }

        public static List<object> OpenTicketDetail(object id)
        {
            string sid = J.S(id);
            if (!Regex.IsMatch(sid, @"^\d+$")) throw new Exception("Gecersiz adisyon numarasi.");
            var r = Sql("SET NOCOUNT ON; SELECT COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),COALESCE(o.PortionName,''),COALESCE(o.Quantity,0),COALESCE(o.Price,0),COALESCE(o.Price*o.Quantity,0) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE t.Id=" + long.Parse(sid) + " AND t.IsClosed=0 ORDER BY o.OrderNumber,o.Id;");
            return r.Select(x => (object)J.Obj("name", S(x[0]), "portion", S(x[1]), "quantity", N(x[2]), "price", N(x[3]), "total", N(x[4]))).ToList();
        }

        /* 2.2: adisyon/odeme seviyesi olaylar + siparis seviyesi (ikram/iptal/iade/zayi) + iskonto - 10 sn onbellekli
           (15 sn'lik bulut gonderimi, bildirim zamanlayicisi ve panel ayni listeyi paylasir) */
        static List<object> _notes; static long _notesAt;
        static readonly object _notesLock = new object();
        public static List<object> Notifications()
        {
            lock (_notesLock)
            {
                if (_notes != null && J.NowMs() - _notesAt < 10000) return _notes;
                _notes = Bildirim.AllEvents().Take(200).Cast<object>().ToList(); _notesAt = J.NowMs();
                return _notes;
            }
        }
        public static List<Dictionary<string, object>> NotificationsRaw()
        {
            var r = Sql("SET NOCOUNT ON; WITH N AS (SELECT CASE WHEN t.TicketStates LIKE '%ptal%' OR t.Note LIKE '%ptal%' THEN 'iptal' ELSE 'iade' END AS Kind,CONVERT(varchar(19),t.Date,120) AS EventDate,COALESCE(NULLIF(t.TicketNumber,''),CONVERT(varchar(20),t.Id)) AS TicketNumber,COALESCE(t.TotalAmount,0) AS Amount,COALESCE(NULLIF(t.Note,''),t.TicketStates,'') AS Detail FROM Tickets t WHERE t.TicketStates LIKE '%ade%' OR t.TicketStates LIKE '%ptal%' OR t.Note LIKE '%ade%' OR t.Note LIKE '%ptal%' UNION ALL SELECT CASE WHEN p.Name LIKE '%ptal%' THEN 'iptal' ELSE 'iade' END,CONVERT(varchar(19),p.Date,120),COALESCE(NULLIF(t.TicketNumber,''),CONVERT(varchar(20),p.TicketId)),p.Amount,COALESCE(p.Name,p.Description,'') FROM Payments p LEFT JOIN Tickets t ON t.Id=p.TicketId WHERE p.Amount<0 OR p.Name LIKE '%ade%' OR p.Name LIKE '%ptal%' OR p.Name LIKE '%refund%' UNION ALL SELECT CASE WHEN c.Name LIKE '%ptal%' THEN 'iptal' ELSE 'iade' END,CONVERT(varchar(19),c.Date,120),COALESCE(NULLIF(t.TicketNumber,''),CONVERT(varchar(20),c.TicketId)),c.Amount,COALESCE(c.Name,'') FROM ChangePayments c LEFT JOIN Tickets t ON t.Id=c.TicketId WHERE c.Name LIKE '%ade%' OR c.Name LIKE '%ptal%' OR c.Name LIKE '%refund%' UNION ALL SELECT CASE WHEN w.EndByName IS NULL THEN 'gun-basi' ELSE 'gun-sonu' END,CONVERT(varchar(19),COALESCE(w.EndDate,w.StartDate),120),CONVERT(varchar(20),w.WorkPeriodNumber),0,COALESCE(NULLIF(CASE WHEN w.EndByName IS NULL THEN w.StartDescription ELSE w.EndDescription END,''),CASE WHEN w.EndByName IS NULL THEN 'Gun basi yapildi' ELSE 'Gun sonu yapildi' END) FROM WorkPeriods w WHERE w.StartDate IS NOT NULL) SELECT TOP 100 Kind,EventDate,TicketNumber,Amount,Detail FROM N ORDER BY EventDate DESC;");
            return r.Select(x => J.Obj("kind", S(x[0]), "date", S(x[1]), "ticket", S(x[2]), "amount", N(x[3]), "detail", S(x[4]), "id", S(x[0]) + "-" + S(x[1]) + "-" + S(x[2]))).ToList();
        }

        // ============================================================== fiyat yonetimi
        /* Sema: MenuItems -1:N- MenuItemPortions -1:N- MenuItemPrices (PriceTag NULL = standart, digerleri
           MenuItemPriceDefinitions'da adlandirilir, ör. PAKET). */
        public static List<Dictionary<string, object>> MenuItems()
        {
            var items = Sql("SET NOCOUNT ON; SELECT mi.Id,COALESCE(NULLIF(mi.Name,''),'Bilinmeyen'),mp.Id,COALESCE(NULLIF(mp.Name,''),'Normal'),pr.Id,COALESCE(pr.PriceTag,''),COALESCE(pr.Price,0),COALESCE(mi.GroupCode,'') FROM MenuItems mi INNER JOIN MenuItemPortions mp ON mp.MenuItemId=mi.Id INNER JOIN MenuItemPrices pr ON pr.MenuItemPortionId=mp.Id ORDER BY mi.Name,mp.Name,pr.PriceTag;");
            var tags = new Dictionary<string, string>();
            foreach (var t in Sql("SET NOCOUNT ON; SELECT PriceTag,COALESCE(NULLIF(Name,''),PriceTag) FROM MenuItemPriceDefinitions;")) tags[S(t[0])] = S(t[1]);
            return items.Select(x =>
            {
                string tag = S(x[5]); string label;
                if (tag.Length == 0) label = "Standart"; else if (!tags.TryGetValue(tag, out label) || label.Length == 0) label = tag;
                return J.Obj("itemId", S(x[0]), "name", S(x[1]), "portionId", S(x[2]), "portion", S(x[3]), "priceId", S(x[4]), "tag", tag, "price", N(x[6]), "tagLabel", label, "group", S(x[7]));
            }).ToList();
        }
        public static Dictionary<string, object> UpdateMenuPrice(object priceId, object price)
        {
            string pid = J.S(priceId), ps = J.S(price).Trim();
            if (!Regex.IsMatch(pid, @"^\d+$")) throw new Exception("Gecersiz fiyat kaydi.");
            if (!Regex.IsMatch(ps, @"^\d+(\.\d{1,2})?$")) throw new Exception("Gecersiz fiyat formati.");
            double value = double.Parse(ps, J.Inv);
            if (value < 0 || value > 999999) throw new Exception("Fiyat 0 ile 999999 arasinda olmali.");
            var r = Sql("SET NOCOUNT ON; UPDATE MenuItemPrices SET Price=" + J.NumStr(value) + " OUTPUT deleted.Price,inserted.Price WHERE Id=" + long.Parse(pid) + ";");
            if (r.Count == 0) throw new Exception("Fiyat kaydi bulunamadi (silinmis olabilir).");
            return J.Obj("oldPrice", N(r[0][0]), "newPrice", N(r[0][1]));
        }
        static readonly object _priceLogLock = new object();
        public static void LogPriceChange(object name, object portion, object tagLabel, object oldPrice, object newPrice)
        {
            Func<object, string> clean = v => Regex.Replace(J.S(v), @"[\r\n|]", " ").Trim();
            string line = J.IsoNow() + " | " + clean(name) + " / " + clean(portion) + " / " + clean(tagLabel) + " | " + J.S(oldPrice) + " -> " + J.S(newPrice) + "\n";
            lock (_priceLogLock) File.AppendAllText(Path.Combine(RuntimeDir, "fiyat-degisiklikleri.log"), line, Files.Utf8);
        }
        static List<object> RecentPriceLog(int limit)
        {
            string f = Path.Combine(RuntimeDir, "fiyat-degisiklikleri.log");
            if (!File.Exists(f)) return new List<object>();
            var lines = File.ReadAllText(f, Encoding.UTF8).Split(new[] { "\r\n", "\n" }, StringSplitOptions.None).Where(l => l.Length > 0).ToList();
            return lines.Skip(Math.Max(0, lines.Count - limit)).Reverse().Select(l => (object)l).ToList();
        }

        // ============================================================== bulut gonderimi (her 15 sn)
        static object CourierSnapshot()
        {
            try { var r = Web.Get(KuryeUrl + "/api/internal/summary", 4000); return r.Ok ? J.Parse(r.Text) : null; }
            catch { return null; }
        }
        static List<object> CloudMenu()
        {
            try { return MenuItems().Select(i => (object)J.Obj("priceId", i["priceId"], "itemId", i["itemId"], "portionId", i["portionId"], "name", i["name"], "portion", i["portion"], "tagLabel", i["tagLabel"], "price", i["price"], "group", i["group"])).ToList(); }
            catch { return new List<object>(); }
        }
        static int _pushing, _pushFails;
        static void CloudPush()
        {
            if (Interlocked.Exchange(ref _pushing, 1) == 1) return;
            try
            {
                string today = Today();
                var payload = J.Obj("activationKey", CloudKey, "sales", Report(today, today, null, null), "openTables", OpenTables(), "notifications", Notifications(),
                    "courier", CourierSnapshot(), "menu", CloudMenu(), "compare", CompareCached(today), "clock", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", J.Inv));
                Web.PostJson(CloudUrl + "/api/agent/push", payload, 8000);
                if (_pushFails > 0) Log.Write("bulut gönderimi yeniden çalışıyor.");
                _pushFails = 0;
            }
            catch (Exception ex)
            {
                // Node bu hatayi sessizce yutuyordu (1.4.0'daki JSON_VALUE hatasi bu yuzden aylarca fark edilmedi) - ilkini ve sonra 40'ta bir logla
                if (_pushFails++ % 40 == 0) Log.Write("bulut gönderimi başarısız (sonraki denemede devam edilecek): " + ex.Message);
            }
            finally { Interlocked.Exchange(ref _pushing, 0); }
        }

        // ============================================================== kiyas (yeni panel, 2.1.0)
        /* "Bugun" Node'daki gibi UTC tarihi (Turkiye'de gece 03:00'te degisir - is gunu gibi calisir); pencere o gunun
           yerel 00:00'inden SIMDIYE kadar. Dun ve gecen hafta AYNI uzunluktaki pencereyle kiyaslanir ("dun bu saate kadar").
           Tarihler CONVERT(datetime,'...',120) ile verilir - SQL Server dil ayarindan (dmy/mdy) bagimsiz. */
        static Dictionary<string, object> _cmp; static long _cmpAt; static string _cmpDay;
        static Dictionary<string, object> CompareCached(string today)
        {
            if (_cmp != null && _cmpDay == today && J.NowMs() - _cmpAt < 60000) return _cmp;
            try { _cmp = Compare(today); _cmpAt = J.NowMs(); _cmpDay = today; }
            catch (Exception ex) { if (_cmp == null) Log.Write("kıyas verisi hesaplanamadı: " + ex.Message); }
            return _cmp;
        }
        static string Dt(DateTime d) { return "CONVERT(datetime,'" + d.ToString("yyyy-MM-dd HH:mm:ss", J.Inv) + "',120)"; }
        static Dictionary<string, object> Window(DateTime a, DateTime b)
        {
            var r = Sql("SET NOCOUNT ON; SELECT COALESCE(SUM(TotalAmount),0),COUNT(*),COALESCE(SUM(RemainingAmount),0) FROM Tickets WHERE IsClosed=1 AND Date >= " + Dt(a) + " AND Date < " + Dt(b));
            var x = r.Count > 0 ? r[0] : new object[3];
            return J.Obj("sales", N(x[0]), "tickets", N(x[1]), "remaining", N(x[2]));
        }
        public static Dictionary<string, object> Compare(string today)
        {
            var day0 = DateTime.ParseExact(today, "yyyy-MM-dd", J.Inv);
            var now = DateTime.Now;
            var len = now - day0; if (len < TimeSpan.Zero) len = TimeSpan.Zero;
            var hourly = Sql("SET NOCOUNT ON; SELECT DATEPART(hour,Date),COALESCE(SUM(TotalAmount),0),COUNT(*) FROM Tickets WHERE IsClosed=1 AND Date >= " + Dt(day0.AddDays(-1)) + " AND Date < " + Dt(day0) + " GROUP BY DATEPART(hour,Date) ORDER BY 1");
            var days = Sql("SET NOCOUNT ON; SELECT CONVERT(varchar(10),Date,23),COALESCE(SUM(TotalAmount),0),COUNT(*) FROM Tickets WHERE IsClosed=1 AND Date >= " + Dt(day0.AddDays(-6)) + " AND Date < " + Dt(day0.AddDays(1)) + " GROUP BY CONVERT(varchar(10),Date,23) ORDER BY 1");
            var o = J.Obj(
                "until", now.ToString("HH:mm", J.Inv),
                "yesterday", Window(day0.AddDays(-1), day0.AddDays(-1) + len),
                "lastWeek", Window(day0.AddDays(-7), day0.AddDays(-7) + len),
                "yesterdayHourly", hourly.Select(r => (object)J.Obj("hour", N(r[0]), "amount", N(r[1]), "count", N(r[2]))).ToList(),
                "days", days.Select(r => (object)J.Obj("date", S(r[0]), "amount", N(r[1]), "count", N(r[2]))).ToList());
            // 2.3: gecen yilin AYNI HAFTA GUNU (364 gun once), gun sonu tahmini, ay toplami - her biri bagimsiz
            try { o["lastYear"] = Window(day0.AddDays(-364), day0.AddDays(-364) + len); } catch { }
            try { o["forecast"] = Forecast(day0, len); } catch (Exception ex) { LogOnce("tahmin", ex); }
            try
            {
                var m0 = new DateTime(day0.Year, day0.Month, 1);
                var pm0 = m0.AddMonths(-1); var pmEnd = pm0 + (day0 + len - m0); if (pmEnd > m0) pmEnd = m0;
                o["month"] = J.Obj("start", m0.ToString("yyyy-MM-dd", J.Inv), "days", DateTime.DaysInMonth(day0.Year, day0.Month), "day", day0.Day,
                    "now", Window(m0, day0 + len), "lastMonth", Window(pm0, pmEnd), "lastMonthTotal", Window(pm0, m0));
            }
            catch (Exception ex) { LogOnce("ay toplami", ex); }
            return o;
        }
        /* Gun sonu tahmini: son 4 haftanin ayni gununde, SU ANKI saate kadar yapilan ciro gunun yuzde kacini tutuyordu?
           bugunku ciro / o oran = tahmin. Oran cok kucukse (gun yeni basladi) tahmin verilmez, sadece ortalama gun doner. */
        static Dictionary<string, object> Forecast(DateTime day0, TimeSpan len)
        {
            int sec = (int)Math.Min(len.TotalSeconds, 86399);
            var r = Sql("SET NOCOUNT ON; SELECT COALESCE(SUM(TotalAmount),0),COALESCE(SUM(CASE WHEN DATEDIFF(second,CAST(CAST(Date AS date) AS datetime),Date) < " + sec + " THEN TotalAmount ELSE 0 END),0),COUNT(DISTINCT CAST(Date AS date)) FROM Tickets WHERE IsClosed=1 AND Date >= " + Dt(day0.AddDays(-28)) + " AND Date < " + Dt(day0) + " AND DATEDIFF(day,Date," + Dt(day0) + ")%7=0");
            var x = r.Count > 0 ? r[0] : new object[3];
            double tot = Db.N(x[0]), until = Db.N(x[1]), n = Db.N(x[2]);
            return J.Obj("weeks", J.NumVal(n), "avgDay", J.NumVal(n > 0 ? tot / n : 0), "ratio", J.NumVal(tot > 0 ? until / tot : 0));
        }
        static readonly HashSet<string> _logged = new HashSet<string>();
        static void LogOnce(string what, Exception ex) { lock (_logged) if (_logged.Add(what)) Log.Write(what + " hesaplanamadi: " + ex.Message); }

        // ============================================================== tunel linki (tunnel-watch.js)
        static string _lastTunnel;
        static void TunnelWatch()
        {
            try
            {
                string log = Path.Combine(RuntimeDir, "logs", "tunnel.log"), link = Path.Combine(RuntimeDir, "tunnel-link.txt");
                if (_lastTunnel == null) _lastTunnel = File.Exists(link) ? File.ReadAllText(link).Trim() : "";
                if (!File.Exists(log)) return;
                string text;
                using (var fs = new FileStream(log, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var sr = new StreamReader(fs, Encoding.UTF8)) text = sr.ReadToEnd();
                var ms = Regex.Matches(text, @"https://[a-z0-9-]+\.trycloudflare\.com");
                if (ms.Count == 0) return;
                string url = ms[ms.Count - 1].Value;
                if (url == _lastTunnel) return;
                _lastTunnel = url;
                Files.Write(link, url);
            }
            catch { }
        }
        static string ReadLink(string name) { try { string f = Path.Combine(RuntimeDir, name); return File.Exists(f) ? File.ReadAllText(f, Encoding.UTF8).Trim() : ""; } catch { return ""; } }

        // ============================================================== HTTP (server.js)
        static readonly Dictionary<string, string> Types = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            { ".html", "text/html; charset=utf-8" }, { ".css", "text/css; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" }, { ".svg", "image/svg+xml" },
            { ".webmanifest", "application/manifest+json; charset=utf-8" }, { ".json", "application/json; charset=utf-8" }, { ".png", "image/png" }, { ".ico", "image/x-icon" } };
        static readonly HashSet<string> PublicPaths = new HashSet<string> { "/login", "/api/login", "/icon.svg", "/manifest.webmanifest" };
        static Dictionary<string, object> Err(string m) { return J.Obj("error", m); }
        static string ClientIp(Req req) { string xf = req.Header("x-forwarded-for"); return (string.IsNullOrEmpty(xf) ? req.RemoteIp : xf).Split(',')[0].Trim(); }
        static bool IsHttps(Req req) { return req.Header("x-forwarded-proto") == "https"; }
        static void SetCookie(Req req, Res res, string token)
        {
            res.SetHeader("Set-Cookie", "patron_session=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + (Auth.SessionTtl / 1000) + (IsHttps(req) ? "; Secure" : ""));
        }
        static void ClearCookie(Req req, Res res) { res.SetHeader("Set-Cookie", "patron_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + (IsHttps(req) ? "; Secure" : "")); }

        public static void Handle(Req req, Res res)
        {
            try { Route(req, res); }
            catch (Exception ex)
            {
                Log.Write("HATA " + req.Method + " " + req.Path + ": " + ex.Message);
                res.Headers.Clear(); res.Body.SetLength(0);
                res.Json(500, Err(ex.Message));
            }
        }

        static void Route(Req req, Res res)
        {
            string path = req.Path, ip = ClientIp(req);
            bool POST = req.Method == "POST";

            if (path == "/api/login")
            {
                if (!POST) { res.Json(405, Err("Yalnızca POST kabul edilir.")); return; }
                long wait = Auth.LockedMs(ip);
                if (wait > 0) { res.Json(429, Err("Çok fazla hatalı deneme. " + (long)Math.Ceiling(wait / 1000.0) + " saniye sonra tekrar deneyin.")); return; }
                var b = req.JsonBody();
                string email = J.S(b, "email").Trim(); if (email.Length == 0) email = J.S(b, "name").Trim();
                string pass = J.Get(b, "password") as string ?? "";
                // 1) E-posta ile BULUT hesabi dogrulamasi (restoranin app.ornek-alanadi.com hesabi). Metrik gibi.
                if (CloudKey.Length > 0 && email.Length > 0 && pass.Length > 0)
                {
                    Dictionary<string, object> vr = null;
                    try { vr = License.VerifyPassword(email, pass); } catch { vr = null; }
                    if (vr != null && J.Truthy(J.Get(vr, "ok")))
                    {
                        var cu = Auth.FindByName(email);
                        string cid = cu != null ? J.S(cu, "id") : Auth.AddUser(email, Crypto.RandomHex(24));
                        Auth.Success(ip);
                        SetCookie(req, res, Auth.NewSession(cid));
                        res.Json(200, J.Obj("ok", true, "name", email));
                        return;
                    }
                }
                // 2) Yerel kullanici/sifre (internet yoksa veya bulut hesabi disinda tanimli kullanici)
                var user = Auth.FindByCredentials(email, pass);
                if (user == null) { Auth.Fail(ip); res.Json(401, Err("E-posta veya şifre hatalı.")); return; }
                Auth.Success(ip);
                SetCookie(req, res, Auth.NewSession(J.S(user, "id")));
                res.Json(200, J.Obj("ok", true, "name", user["name"]));
                return;
            }
            if (path == "/api/logout")
            {
                if (!POST) { res.Json(405, Err("Yalnızca POST kabul edilir.")); return; }
                string t = req.Cookie("patron_session");
                if (!string.IsNullOrEmpty(t)) Auth.DeleteSession(t);
                ClearCookie(req, res);
                res.Json(200, J.Obj("ok", true));
                return;
            }

            string userId = Auth.CurrentUserId(req.Cookie("patron_session"));
            if (!PublicPaths.Contains(path) && userId == null)
            {
                if (path.StartsWith("/api/")) { res.Json(401, Err("Oturum gerekli.")); return; }
                res.Status = 302; res.SetHeader("Location", "/login?next=" + Uri.EscapeDataString(path + req.Search)); res.Handled = true;
                return;
            }

            if (path == "/api/change-password")
            {
                if (!POST) { res.Json(405, Err("Yalnızca POST kabul edilir.")); return; }
                var me = Auth.FindById(userId);
                if (me == null) { res.Json(401, Err("Oturum gerekli.")); return; }
                var b = req.JsonBody();
                if (!Auth.Check(J.Get(b, "current") as string, me)) { res.Json(401, Err("Mevcut şifre hatalı.")); return; }
                string next = J.S(b, "next");
                if (next.Length < 4) { res.Json(400, Err("Yeni şifre en az 4 karakter olmalı.")); return; }
                Auth.SetPassword(me, next);
                Auth.ClearSessionsForUser(J.S(me, "id"));
                SetCookie(req, res, Auth.NewSession(J.S(me, "id")));
                res.Json(200, J.Obj("ok", true));
                return;
            }
            if (path == "/api/users" && req.Method == "GET") { res.Json(200, J.Obj("users", Auth.PublicUsers())); return; }
            if (path == "/api/users" && POST)
            {
                var b = req.JsonBody();
                string name = J.S(b, "name").Trim(), password = J.S(b, "password");
                if (name.Length == 0) { res.Json(400, Err("Kullanıcı adı gerekli.")); return; }
                if (password.Length < 4) { res.Json(400, Err("Şifre en az 4 karakter olmalı.")); return; }
                if (Auth.FindByName(name) != null) { res.Json(409, Err("Bu isimde bir kullanıcı zaten var.")); return; }
                res.Json(200, J.Obj("ok", true, "id", Auth.AddUser(name, password)));
                return;
            }
            if (path == "/api/users/remove")
            {
                if (!POST) { res.Json(405, Err("Yalnızca POST kabul edilir.")); return; }
                string id = J.S(req.JsonBody(), "id");
                string e = Auth.RemoveUser(id);
                if (e == "last") { res.Json(400, Err("Son kullanıcı silinemez.")); return; }
                if (e == "missing") { res.Json(404, Err("Kullanıcı bulunamadı.")); return; }
                Bildirim.ForgetUser(id);
                res.Json(200, J.Obj("ok", true));
                return;
            }
            if (path == "/api/tunnel")
            {
                string stable = PublicUrl.Length > 0 ? PublicUrl : (ReadLink("tailscale-link.txt").Length > 0 ? ReadLink("tailscale-link.txt") : ReadLink("ddns-link.txt"));
                string url = ReadLink("tunnel-link.txt");
                if (url.Length == 0) url = PublicUrl;
                // Node: url undefined ise JSON'da hic yer almaz
                res.Json(200, url.Length > 0 ? J.Obj("url", url, "stableUrl", stable) : J.Obj("stableUrl", stable));
                return;
            }
            if (path == "/api/config") { res.Json(200, J.Obj("appName", AppName)); return; }
            if (path == "/api/notifications") { res.Json(200, J.Obj("items", Notifications())); return; }
            if (path == "/api/report")
            {
                string today = Today();
                string start = ValidDate(req.Q("start")) ? req.Q("start") : today, end = ValidDate(req.Q("end")) ? req.Q("end") : today;
                if (string.CompareOrdinal(start, end) > 0) { res.Json(400, Err("Baslangic tarihi bitis tarihinden buyuk olamaz.")); return; }
                string hs = req.Q("hourStart"), he = req.Q("hourEnd");
                res.Json(200, Report(start, end, hs, he ?? hs, req.Q("extra") == "1"));
                return;
            }
            if (path == "/api/price-changes")
            {
                double d = J.Num(req.Q("days") ?? "90"); if (double.IsNaN(d) || d == 0) d = 90;
                int days = (int)Math.Min(Math.Max(d, 1), 365);
                res.Json(200, J.Obj("days", days, "changes", PriceChanges(days)));
                return;
            }
            // ---- 2.2: rapor menusu, adisyon logu, kiyas, anlik bildirim
            if (path == "/api/reports")
            {
                try { res.Json(200, Raporlar.Run(req.Q("kind") ?? "", req.Q("start"), req.Q("end"), req.Q("hourStart"), req.Q("hourEnd"), req.Q("key"))); }
                catch (Exception e) { res.Json(400, Err(e.Message)); }
                return;
            }
            if (path == "/api/ticket-log")
            {
                try { res.Json(200, Raporlar.TicketLog(req.Q("id"))); } catch (Exception e) { res.Json(400, Err(e.Message)); }
                return;
            }
            // ---- 2.5: SambaPOS'un KENDI rapor motoru (Metrik mantigi) - getCustomReport, mesaj sunucusu :9000.
            // Rakamlar SambaPOS'un kendi raporlariyla birebir tutar; panelden yeni rapor eklenebilir.
            if (path == "/api/samba/meta") { try { res.Json(200, SambaRapor.ListMeta()); } catch (Exception e) { res.Json(400, Err(e.Message)); } return; }
            if (path == "/api/samba/run")
            {
                string today = Today();
                string start = ValidDate(req.Q("start")) ? req.Q("start") : today, end = ValidDate(req.Q("end")) ? req.Q("end") : today;
                try { res.Json(200, SambaRapor.Run(req.Q("id") ?? "", start, end)); } catch (Exception e) { res.Json(400, Err(e.Message)); }
                return;
            }
            if (path == "/api/samba/add")
            {
                if (!POST) { res.Json(405, Err("Yalnızca POST.")); return; }
                var b = req.JsonBody();
                try { SambaRapor.AddCustom(J.S(b, "ad"), J.S(b, "sablon")); res.Json(200, SambaRapor.ListMeta()); } catch (Exception e) { res.Json(400, Err(e.Message)); }
                return;
            }
            if (path == "/api/samba/remove")
            {
                if (!POST) { res.Json(405, Err("Yalnızca POST.")); return; }
                try { SambaRapor.RemoveCustom(J.S(req.JsonBody(), "id")); res.Json(200, SambaRapor.ListMeta()); } catch (Exception e) { res.Json(400, Err(e.Message)); }
                return;
            }
            if (path == "/api/samba/conn")
            {
                if (POST) { var b = req.JsonBody(); try { SambaRapor.SaveConn(J.S(b, "host"), J.S(b, "user"), J.S(b, "pass")); res.Json(200, SambaRapor.ListMeta()); } catch (Exception e) { res.Json(400, Err(e.Message)); } }
                else res.Json(200, SambaRapor.ListMeta());
                return;
            }
            if (path == "/api/home")
            {
                string today = Today();
                res.Json(200, J.Obj("version", LocalVersion(), "appName", AppName, "clock", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", J.Inv),
                    "sales", Report(today, today, null, null), "compare", CompareCached(today), "openTables", OpenTables(), "notifications", Notifications().Take(60).ToList(), "settings", Ekler.Settings()));
                return;
            }
            // ---- 2.3: hedef, canli akis, kasa sayimi
            if (path == "/api/settings")
            {
                if (POST) { try { var me = Auth.FindById(userId); res.Json(200, Ekler.SaveSettings(req.JsonBody(), me != null ? J.S(me, "name") : "")); } catch (Exception e) { res.Json(400, Err(e.Message)); } }
                else res.Json(200, Ekler.Settings());
                return;
            }
            if (path == "/api/feed")
            {
                double m = J.Num(req.Q("minutes") ?? "120"); if (double.IsNaN(m)) m = 120;
                try { res.Json(200, J.Obj("items", Ekler.Feed((int)m))); } catch (Exception e) { res.Json(500, Err(e.Message)); }
                return;
            }
            if (path == "/api/cash")
            {
                if (POST) { try { var me = Auth.FindById(userId); res.Json(200, Ekler.SaveCashCount(req.JsonBody(), me != null ? J.S(me, "name") : "")); } catch (Exception e) { res.Json(400, Err(e.Message)); } }
                else { try { var o = Ekler.CashExpected(); o["history"] = Ekler.CashCounts(30); res.Json(200, o); } catch (Exception e) { res.Json(500, Err(e.Message)); } }
                return;
            }
            if (path == "/api/push/status") { res.Json(200, Bildirim.Status(req.Q("endpoint") ?? "")); return; }
            if (path == "/api/push/subscribe")
            {
                if (!POST) { res.Json(405, Err("Yalnızca POST kabul edilir.")); return; }
                var b = req.JsonBody();
                try { res.Json(200, Bildirim.Subscribe(userId, J.D(J.Get(b, "subscription")), J.Get(b, "kinds"), J.Get(b, "min"))); } catch (Exception e) { res.Json(400, Err(e.Message)); }
                return;
            }
            if (path == "/api/push/unsubscribe")
            {
                if (!POST) { res.Json(405, Err("Yalnızca POST kabul edilir.")); return; }
                Bildirim.Unsubscribe(J.S(req.JsonBody(), "endpoint"));
                res.Json(200, J.Obj("ok", true));
                return;
            }
            if (path == "/api/push/test")
            {
                if (!POST) { res.Json(405, Err("Yalnızca POST kabul edilir.")); return; }
                try { int code = Bildirim.Test(J.S(req.JsonBody(), "endpoint")); res.Json(200, J.Obj("ok", code >= 200 && code < 300, "status", code)); } catch (Exception e) { res.Json(400, Err(e.Message)); }
                return;
            }
            if (path == "/api/open-tables") { res.Json(200, OpenTables()); return; }
            if (path == "/api/open-ticket") { res.Json(200, J.Obj("items", OpenTicketDetail(req.Q("id")))); return; }
            if (path == "/api/menu-items") { res.Json(200, J.Obj("items", MenuItems(), "recent", RecentPriceLog(15))); return; }
            if (path == "/api/menu-price")
            {
                if (!POST) { res.Json(405, Err("Yalnızca POST kabul edilir.")); return; }
                var b = req.JsonBody();
                try
                {
                    var r = UpdateMenuPrice(J.Get(b, "priceId"), J.Get(b, "price"));
                    LogPriceChange(J.Get(b, "name"), J.Get(b, "portion"), J.Get(b, "tagLabel"), r["oldPrice"], r["newPrice"]);
                    res.Json(200, J.Obj("ok", true, "oldPrice", r["oldPrice"], "newPrice", r["newPrice"]));
                }
                catch (Exception e) { res.Json(400, Err(e.Message)); }
                return;
            }
            ServeStatic(res, path);
        }

        static void ServeStatic(Res res, string pathname)
        {
            string rel = pathname == "/login" ? "/login.html" : pathname == "/klasik" ? "/klasik.html" : (pathname == "/" || pathname == "/patron" || pathname == "/masaustu" ? "/patron.html" : pathname);
            string pub = Path.Combine(Root, "public"), file;
            try { file = Path.GetFullPath(Path.Combine(pub, Uri.UnescapeDataString(rel).TrimStart('/').Replace('/', '\\'))); } catch { res.Json(404, Err("Bulunamadi")); return; }
            if (!file.StartsWith(pub + "\\", StringComparison.OrdinalIgnoreCase) || !File.Exists(file)) { res.Json(404, Err("Bulunamadi")); return; }
            string t; if (!Types.TryGetValue(Path.GetExtension(file), out t)) t = "application/octet-stream";
            res.Send(200, t, File.ReadAllBytes(file), "no-store");
        }
    }

    // ================================================================== giris (coklu kullanici + kalici oturum)
    public static class Auth
    {
        public const long SessionTtl = 12L * 60 * 60 * 1000;   // 12 saat, kaydirmali
        static string _authFile, _sessionsFile, _dir;
        static Dictionary<string, object> _data;
        static readonly object _lock = new object();
        class Sess { public string UserId; public long Expires; }
        static readonly ConcurrentDictionary<string, Sess> _sessions = new ConcurrentDictionary<string, Sess>();
        class Lk { public int Count; public long Until; }
        static readonly ConcurrentDictionary<string, Lk> _attempts = new ConcurrentDictionary<string, Lk>();

        public static void Init(string dir)
        {
            _dir = dir; _authFile = Path.Combine(dir, "patron-auth.json"); _sessionsFile = Path.Combine(dir, "sessions.json");
            _data = Ensure();
            LoadSessions();
        }
        static List<Dictionary<string, object>> Users { get { return J.LL(J.Get(_data, "users")).Select(J.D).Where(u => u != null).ToList(); } }
        static string NewId() { return Crypto.RandomHex(6); }
        static void Save() { Files.Write(_authFile, J.Pretty(_data)); }

        /* Eski tek kullanicili bicim {salt, hash, updatedAt} (1.4.0) sessizce "Patron" kullanicisina donusturulur -
           sifre degismez, kurulu restoranlar disarida kalmaz. Hic kayit yoksa rastgele 6 haneli ilk sifre uretilir. */
        static Dictionary<string, object> Ensure()
        {
            Dictionary<string, object> data = null;
            try { if (File.Exists(_authFile)) data = J.D(J.Parse(Files.Read(_authFile))); } catch { data = null; }
            if (data != null && J.S(data, "salt").Length > 0 && J.S(data, "hash").Length > 0 && !data.ContainsKey("users"))
            {
                string created = J.S(data, "updatedAt").Length > 0 ? J.S(data, "updatedAt") : J.IsoNow();
                data = J.Obj("users", new List<object> { J.Obj("id", NewId(), "name", "Patron", "salt", J.S(data, "salt"), "hash", J.S(data, "hash"), "createdAt", created) });
                _data = data; Save();
                Log.Write("patron-auth.json eski tek kullanıcı biçiminden çok kullanıcılı biçime taşındı (şifre değişmedi).");
            }
            if (data != null && J.LL(J.Get(data, "users")).Count > 0) return data;
            var rnd = new byte[4]; using (var g = System.Security.Cryptography.RandomNumberGenerator.Create()) g.GetBytes(rnd);
            string pin = (100000 + BitConverter.ToUInt32(rnd, 0) % 900000).ToString();
            string salt = Crypto.RandomHex(16), now = J.IsoNow();
            _data = J.Obj("users", new List<object> { J.Obj("id", NewId(), "name", "Patron", "salt", salt, "hash", Scrypt.HashHex(pin, salt), "createdAt", now) });
            Save();
            Files.Write(Path.Combine(_dir, "ILK-SIFRE.txt"), "ENSARI POS PATRON - ILK GIRIS SIFRESI\n\nKullanici: Patron\nSifre: " + pin +
                "\n\nBu dosyayi okuduktan sonra silin ve uygulama icinden (Ayarlar > Sifre degistir)\nsifreyi degistirin.\n\nOlusturulma: " + now + "\n");
            Log.Write("İlk giriş şifresi oluşturuldu: " + Path.Combine(_dir, "ILK-SIFRE.txt"));
            return _data;
        }

        public static bool Check(string password, Dictionary<string, object> user)
        {
            if (string.IsNullOrEmpty(password) || user == null) return false;
            return Crypto.FixedEquals(Scrypt.HashHex(password, J.S(user, "salt")), J.S(user, "hash").ToLowerInvariant());
        }
        public static Dictionary<string, object> FindById(string id) { lock (_lock) return Users.FirstOrDefault(u => J.S(u, "id") == id); }
        public static Dictionary<string, object> FindByName(string name)
        {
            string n = (name ?? "").Trim().ToLowerInvariant();
            lock (_lock) return Users.FirstOrDefault(u => J.S(u, "name").ToLowerInvariant() == n);
        }
        /* Ad bos gelirse (eski "sadece sifre" giris ekrani/PWA onbellegi) sifre tum kullanicilarda denenir */
        public static Dictionary<string, object> FindByCredentials(string name, string password)
        {
            if (!string.IsNullOrEmpty(name)) { var u = FindByName(name); return Check(password, u) ? u : null; }
            List<Dictionary<string, object>> all; lock (_lock) all = Users;
            return all.FirstOrDefault(u => Check(password, u));
        }
        public static void SetPassword(Dictionary<string, object> user, string next)
        {
            lock (_lock) { string salt = Crypto.RandomHex(16); user["salt"] = salt; user["hash"] = Scrypt.HashHex(next, salt); Save(); }
        }
        public static List<object> PublicUsers() { lock (_lock) return Users.Select(u => (object)J.Obj("id", u["id"], "name", u["name"], "createdAt", J.Get(u, "createdAt"))).ToList(); }
        public static string AddUser(string name, string password)
        {
            lock (_lock)
            {
                string salt = Crypto.RandomHex(16), id = NewId();
                var list = J.LL(J.Get(_data, "users"));
                list.Add(J.Obj("id", id, "name", name, "salt", salt, "hash", Scrypt.HashHex(password, salt), "createdAt", J.IsoNow()));
                _data["users"] = list; Save();
                return id;
            }
        }
        public static string RemoveUser(string id)
        {
            lock (_lock)
            {
                var list = J.LL(J.Get(_data, "users"));
                if (list.Count <= 1) return "last";
                int idx = list.FindIndex(u => J.S(J.D(u), "id") == id);
                if (idx < 0) return "missing";
                list.RemoveAt(idx); _data["users"] = list; Save();
            }
            ClearSessionsForUser(id);
            return null;
        }

        // ---- oturumlar: diske de yazilir (servis yeniden baslayinca herkes cikisa atilmasin - 1.4.0)
        static void LoadSessions()
        {
            try
            {
                if (!File.Exists(_sessionsFile)) return;
                var raw = J.D(J.Parse(Files.Read(_sessionsFile)));
                if (raw == null) return;
                long now = J.NowMs();
                string firstUser; lock (_lock) firstUser = Users.Select(u => J.S(u, "id")).FirstOrDefault();
                foreach (var kv in raw)
                {
                    var d = J.D(kv.Value);
                    // 1.4.0 bicimi: token -> sonGecerlilik (kullanici bilgisi yok; tek kullanici vardi)
                    long exp = d != null ? (long)J.Num(d, "expires") : (long)J.Num(kv.Value);
                    string uid = d != null ? J.S(d, "userId") : firstUser;
                    if (exp > now && !string.IsNullOrEmpty(uid)) _sessions[kv.Key] = new Sess { UserId = uid, Expires = exp };
                }
            }
            catch { }
        }
        static void SaveSessions()
        {
            try
            {
                var o = new Dictionary<string, object>();
                foreach (var kv in _sessions) o[kv.Key] = J.Obj("userId", kv.Value.UserId, "expires", kv.Value.Expires);
                lock (_lock) Files.Write(_sessionsFile, J.Str(o));
            }
            catch { }
        }
        public static string NewSession(string userId)
        {
            string token = Crypto.RandomHex(24);
            _sessions[token] = new Sess { UserId = userId, Expires = J.NowMs() + SessionTtl };
            SaveSessions();
            return token;
        }
        public static string CurrentUserId(string token)
        {
            if (string.IsNullOrEmpty(token)) return null;
            Sess s;
            if (!_sessions.TryGetValue(token, out s)) return null;
            if (s.Expires < J.NowMs()) { _sessions.TryRemove(token, out s); SaveSessions(); return null; }
            if (FindById(s.UserId) == null) { _sessions.TryRemove(token, out s); SaveSessions(); return null; }   // silinmis kullanici
            s.Expires = J.NowMs() + SessionTtl;   // kaydirmali (sadece bellekte)
            return s.UserId;
        }
        public static void DeleteSession(string token) { Sess s; if (_sessions.TryRemove(token, out s)) SaveSessions(); }
        public static void ClearSessionsForUser(string userId)
        {
            bool any = false; Sess s;
            foreach (var kv in _sessions.ToArray()) if (kv.Value.UserId == userId) any |= _sessions.TryRemove(kv.Key, out s);
            if (any) SaveSessions();
        }

        // ---- hatali deneme kilidi (5 hata -> 5 dk)
        public static long LockedMs(string ip) { Lk s; return _attempts.TryGetValue(ip, out s) && s.Until > J.NowMs() ? s.Until - J.NowMs() : 0; }
        public static void Fail(string ip) { var s = _attempts.GetOrAdd(ip, _ => new Lk()); lock (s) { s.Count++; if (s.Count >= 5) { s.Until = J.NowMs() + 5 * 60 * 1000; s.Count = 0; } } }
        public static void Success(string ip) { Lk s; _attempts.TryRemove(ip, out s); }
    }

    // ================================================================== buluttan komut kanali (patron-cloud.js)
    /* Bulut paneli fiyat degistir / acik adisyon icerigi / tarih-saat raporu ister, burada uygulanip 'ack' doner.
       Tamamen izole: buradaki hicbir hata yerel paneli ya da 15 sn'lik gonderimi etkilemez. */
    public static class CloudChannel
    {
        static volatile bool _stop;
        static int _delay = 2000;
        static WsClient _ws;
        static void L(string m) { Log.Write("[patron-cloud] " + m); }

        public static void Start(string cloudUrl, string key)
        {
            string url = cloudUrl.Replace("https://", "wss://").Replace("http://", "ws://") + "/patron-ws?activationKey=" + Uri.EscapeDataString(key);
            new Thread(() =>
            {
                while (!_stop)
                {
                    bool quiet = false;
                    try { quiet = RunOnce(url); }
                    catch (Exception ex) { L("bağlantı hatası (yoksayıldı): " + ex.Message); }
                    if (_stop) break;
                    if (quiet) { Thread.Sleep(1000); continue; }   // sadece sessizlik zaman asimi - hemen yeniden baglan
                    Thread.Sleep(_delay);
                    _delay = Math.Min((int)(_delay * 1.5), 30000);
                }
            }) { IsBackground = true, Name = "patron-cloud" }.Start();
        }
        public static void Stop() { _stop = true; try { if (_ws != null) _ws.Dispose(); } catch { } }

        // true: baglanti sadece uzun sessizlik yuzunden kapandi (patron-ws sunucusu ping atmiyor)
        static bool RunOnce(string url)
        {
            using (var ws = WsClient.Connect(url))
            {
                _ws = ws;
                ws.ReceiveTimeoutMs = 10 * 60 * 1000;
                _delay = 2000;
                L("buluta bağlandı (canlı komut kanalı).");
                while (!_stop)
                {
                    string text;
                    try { text = ws.Receive(); }
                    catch (IOException ex) { if (ex.InnerException is System.Net.Sockets.SocketException && ((System.Net.Sockets.SocketException)ex.InnerException).SocketErrorCode == System.Net.Sockets.SocketError.TimedOut) return true; throw; }
                    if (text == null) return false;
                    Dictionary<string, object> msg;
                    try { msg = J.D(J.Parse(text)); } catch { continue; }
                    if (msg == null || J.S(msg, "type") != "action") continue;
                    var m = msg;
                    ThreadPool.QueueUserWorkItem(delegate { Handle(ws, m); });
                }
            }
            return false;
        }

        static void Ack(WsClient ws, Dictionary<string, object> payload)
        {
            try { ws.SendText(J.Str(payload)); } catch (Exception ex) { L("ack gönderilemedi (yoksayıldı): " + ex.Message); }
        }

        static void Handle(WsClient ws, Dictionary<string, object> msg)
        {
            string action = J.S(msg, "action");
            object id = J.Get(msg, "id");
            try
            {
                if (action == "set-price")
                {
                    Dictionary<string, object> r = null; string error = null;
                    try
                    {
                        r = App.UpdateMenuPrice(J.Get(msg, "priceId"), J.Get(msg, "price"));
                        L("fiyat güncellendi: kayıt " + J.S(msg, "priceId") + " " + J.S(r["oldPrice"]) + " -> " + J.S(r["newPrice"]));
                        try { App.LogPriceChange("(bulut)", "", "kayit " + J.S(msg, "priceId"), r["oldPrice"], r["newPrice"]); } catch { }
                    }
                    catch (Exception e) { error = e.Message; L("fiyat güncellenemedi (kayıt " + J.S(msg, "priceId") + "): " + error); }
                    Ack(ws, J.Obj("type", "ack", "id", id, "ok", error == null, "oldPrice", r != null ? r["oldPrice"] : null, "newPrice", r != null ? r["newPrice"] : null, "error", error));
                }
                else if (action == "get-ticket-items")
                {
                    List<object> items = null; string error = null;
                    try { items = App.OpenTicketDetail(J.Get(msg, "ticketId")); }
                    catch (Exception e) { error = e.Message; L("adisyon detayı okunamadı (" + J.S(msg, "ticketId") + "): " + error); }
                    Ack(ws, J.Obj("type", "ack", "id", id, "ok", error == null, "items", items, "error", error));
                }
                else if (action == "get-report")
                {
                    Dictionary<string, object> data = null; string error = null;
                    try { data = App.Report(J.S(msg, "start"), J.S(msg, "end"), J.Get(msg, "hourStart"), J.Get(msg, "hourEnd"), J.IsTrue(msg, "extra")); }
                    catch (Exception e) { error = e.Message; L("rapor okunamadı (" + J.S(msg, "start") + ".." + J.S(msg, "end") + "): " + error); }
                    Ack(ws, J.Obj("type", "ack", "id", id, "ok", error == null, "data", data, "error", error));
                }
                else if (action == "get-special-report")   // 2.2: bulut panelinin rapor menusu (kasa, ikram, gun sonu ...)
                {
                    Dictionary<string, object> data = null; string error = null;
                    try { data = Raporlar.Run(J.S(msg, "kind"), J.S(msg, "start"), J.S(msg, "end"), J.Get(msg, "hourStart"), J.Get(msg, "hourEnd"), J.S(msg, "key")); }
                    catch (Exception e) { error = e.Message; L("özel rapor okunamadı (" + J.S(msg, "kind") + "): " + error); }
                    Ack(ws, J.Obj("type", "ack", "id", id, "ok", error == null, "data", data, "error", error));
                }
                else if (action == "update-now" || action == "guncelle")   // 2.5.1: bulut "hemen guncelle" derse saatlik beklemeden hemen kontrol et
                {
                    L("bulut 'hemen güncelle' komutu aldı - güncelleme kontrolü tetikleniyor.");
                    ThreadPool.QueueUserWorkItem(delegate { try { Updater.RunCheck(); } catch { } });
                    Ack(ws, J.Obj("type", "ack", "id", id, "ok", true));
                }
                else if (action == "get-ticket-log")
                {
                    Dictionary<string, object> data = null; string error = null;
                    try { data = Raporlar.TicketLog(J.Get(msg, "ticketId")); }
                    catch (Exception e) { error = e.Message; }
                    Ack(ws, J.Obj("type", "ack", "id", id, "ok", error == null, "data", data, "error", error));
                }
                // bilinmeyen eylemler sessizce yoksayilir (Node'daki gibi)
            }
            catch (Exception ex) { L("komut işlenemedi (yoksayıldı): " + ex.Message); }
        }
    }
}
