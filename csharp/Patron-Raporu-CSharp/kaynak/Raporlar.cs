// Patron Raporu 2.2 - rapor motoru (30.09.2026, kullanici istegi: "biraz gelismis olsun ... sambapos patron olarak
// yapilan her seyi incele bir ust seviyeye cikar"). Samba Patron / Metrik'teki rapor menusunun karsiligi + fazlasi:
// kasa, gun sonu, urun grubu, iskonto/yuvarlama, ikram-iade-zayi-iptal, kullanici tahsilat, personel, saat isi haritasi,
// saatlik urun, departman, iptal/iade adisyonlar, paketci, masa performansi, adisyon listesi + tam adisyon logu.
// KURAL: her bolum kendi try/catch'inde calisir - bir restoranin SambaPOS semasi farkliysa (kolon yok vs.) sadece o
// bolum bos + "errors" listesinde aciklama doner, raporun geri kalani yine gelir.
// Tarihler CONVERT(datetime,'...',120) ile verilir - SQL Server dil ayarindan (dmy/mdy) bagimsiz.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Alfa;

namespace Patron
{
    public static class Raporlar
    {
        /* masa / paketci / kurye DISINDAKI varlik (musteri, cari) - EntityTypes et ile birlikte kullanilir */
        const string NotStaffEntity = "LOWER(COALESCE(et.Name,'')) NOT LIKE N'%masa%' AND LOWER(COALESCE(et.Name,'')) NOT LIKE N'%table%' AND LOWER(COALESCE(et.Name,'')) NOT LIKE N'%paket%' AND LOWER(COALESCE(et.Name,'')) NOT LIKE N'%kurye%'";
        public static readonly string[] Kinds = { "stok", "karlilik", "veresiye", "musteri", "sepet", "urun-detay", "personel-detay", "kasa", "gunsonu", "urun", "iskonto", "ikram", "tahsilat", "personel", "saatlik", "saatlik-urun", "departman", "iptal-adisyon", "paketci", "masa", "adisyonlar" };

        static List<object[]> Q(string sql) { return Db.Query(App.NoLock + "SET NOCOUNT ON; " + sql); }
        static string S(object o) { return Db.S(o); }
        static object N(object o) { return J.NumVal(Db.N(o)); }
        static double D(object o) { return Db.N(o); }
        public static string Dt(DateTime d) { return "CONVERT(datetime,'" + d.ToString("yyyy-MM-dd HH:mm:ss", J.Inv) + "',120)"; }

        /* Siparis satiri siniflandirmasi (SambaPOS 5): once OrderStates metni (Gift/Void/Refund + Turkce karsiliklari),
           yoksa CalculatePrice=0 (fiyata yansimayan satir) -> stoktan dusuyorsa ikram, dusmuyorsa iptal. */
        public const string OrderKind =
            "CASE WHEN o.OrderStates LIKE N'%Gift%' OR o.OrderStates LIKE N'%kram%' THEN 'ikram' " +
            "WHEN o.OrderStates LIKE N'%Zayi%' OR o.OrderStates LIKE N'%Waste%' THEN 'zayi' " +
            "WHEN o.OrderStates LIKE N'%Refund%' OR o.OrderStates LIKE N'%ade\"%' THEN 'iade' " +
            "WHEN o.OrderStates LIKE N'%Void%' OR o.OrderStates LIKE N'%ptal%' THEN 'iptal' " +
            "WHEN o.CalculatePrice=0 AND o.DecreaseInventory=1 THEN 'ikram' " +
            "WHEN o.CalculatePrice=0 THEN 'iptal' ELSE NULL END";

        class Ctx
        {
            public string Start, End; public int? Hs, He;
            public DateTime A, B;
            public List<object> Errors = new List<object>();
            public string Range(string col) { return col + " >= " + Dt(A) + " AND " + col + " < " + Dt(B) + (Hs != null && He != null ? " AND DATEPART(hour," + col + ") BETWEEN " + Hs + " AND " + He : ""); }
            public string Closed { get { return "t.IsClosed=1 AND " + Range("t.Date"); } }
        }

        static void Part(Ctx c, Dictionary<string, object> outp, string key, Func<object> fn)
        {
            try { outp[key] = fn(); }
            catch (Exception ex) { outp[key] = null; c.Errors.Add(key + ": " + ex.Message); Log.Write("rapor bolumu hesaplanamadi (" + key + "): " + ex.Message); }
        }
        static List<object> Rows(List<object[]> r, params string[] names)
        {
            return r.Select(x =>
            {
                var d = new Dictionary<string, object>();
                for (int i = 0; i < names.Length && i < x.Length; i++)
                {
                    string n = names[i]; bool num = n.StartsWith("#"); if (num) n = n.Substring(1);
                    d[n] = num ? N(x[i]) : (object)S(x[i]);
                }
                return (object)d;
            }).ToList();
        }
        static int? Hour(object v) { if (v == null) return null; string s = J.S(v); int h; return s.Length > 0 && int.TryParse(s, out h) && h >= 0 && h <= 23 ? (int?)h : null; }
        static bool ValidDate(string v) { return v != null && Regex.IsMatch(v, @"^\d{4}-\d{2}-\d{2}$"); }

        public static Dictionary<string, object> Run(string kind, string start, string end, object hourStart, object hourEnd, string key = null)
        {
            string today = DateTime.UtcNow.ToString("yyyy-MM-dd", J.Inv);
            if (!ValidDate(start)) start = today;
            if (!ValidDate(end)) end = start;
            if (string.CompareOrdinal(start, end) > 0) { var t = start; start = end; end = t; }
            var c = new Ctx { Start = start, End = end, Hs = Hour(hourStart), He = Hour(hourEnd ?? hourStart) };
            c.A = DateTime.ParseExact(start, "yyyy-MM-dd", J.Inv); c.B = DateTime.ParseExact(end, "yyyy-MM-dd", J.Inv).AddDays(1);
            if ((c.B - c.A).TotalDays > 400) throw new Exception("En fazla 400 günlük aralık seçilebilir.");
            var o = J.Obj("kind", kind, "key", key, "range", J.Obj("start", start, "end", end, "hourStart", c.Hs.HasValue ? (object)c.Hs.Value : null, "hourEnd", c.Hs.HasValue && c.He.HasValue ? (object)c.He.Value : null));

            switch (kind)
            {
                case "kasa":
                    Part(c, o, "summary", () => Summary(c));
                    Part(c, o, "payments", () => Payments(c));
                    Part(c, o, "calculations", () => CalcTotals(c));
                    Part(c, o, "orderKinds", () => OrderKindTotals(c));
                    Part(c, o, "departments", () => Departments(c));
                    Part(c, o, "daily", () => Daily(c));
                    break;
                case "gunsonu": Part(c, o, "periods", () => WorkPeriods(c)); break;
                case "urun":
                    Part(c, o, "groups", () => Rows(Q("SELECT COALESCE(NULLIF(mi.GroupCode,''),N'Diğer'),SUM(o.Quantity),SUM(o.Price*o.Quantity) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId LEFT JOIN MenuItems mi ON mi.Id=o.MenuItemId WHERE " + c.Closed + " AND o.CalculatePrice=1 GROUP BY COALESCE(NULLIF(mi.GroupCode,''),N'Diğer') ORDER BY 3 DESC"), "name", "#quantity", "#amount"));
                    Part(c, o, "products", () => Rows(Q("SELECT TOP 500 COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),COALESCE(NULLIF(o.PortionName,''),''),COALESCE(NULLIF(mi.GroupCode,''),N'Diğer'),SUM(o.Quantity),SUM(o.Price*o.Quantity) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId LEFT JOIN MenuItems mi ON mi.Id=o.MenuItemId WHERE " + c.Closed + " AND o.CalculatePrice=1 GROUP BY COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),COALESCE(NULLIF(o.PortionName,''),''),COALESCE(NULLIF(mi.GroupCode,''),N'Diğer') ORDER BY 5 DESC"), "name", "portion", "group", "#quantity", "#amount"));
                    break;
                case "iskonto":
                    Part(c, o, "totals", () => CalcTotals(c));
                    Part(c, o, "items", () => Rows(Q("SELECT TOP 300 CONVERT(varchar(19),t.Date,120),COALESCE(t.TicketNumber,''),COALESCE(NULLIF(c.Name,''),'Hesaplama'),c.CalculationAmount,COALESCE(t.CreatedUserName,''),COALESCE(NULLIF((SELECT TOP 1 EntityName FROM TicketEntities WHERE Ticket_Id=t.Id ORDER BY Id DESC),''),''),t.TotalAmount,t.Id FROM Calculations c INNER JOIN Tickets t ON t.Id=c.TicketId WHERE " + c.Closed + " AND c.CalculationAmount<>0 ORDER BY t.Date DESC"), "date", "number", "name", "#amount", "user", "table", "#total", "id"));
                    break;
                case "ikram":
                    Part(c, o, "totals", () => OrderKindTotals(c));
                    Part(c, o, "byUser", () => Rows(Q("SELECT k,COALESCE(NULLIF(u,''),'Bilinmeyen'),COUNT(*),SUM(q),SUM(a) FROM (SELECT " + OrderKind + " AS k,o.CreatingUserName AS u,o.Quantity AS q,o.Price*o.Quantity AS a FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE " + c.Range("o.CreatedDateTime") + ") x WHERE k IS NOT NULL GROUP BY k,COALESCE(NULLIF(u,''),'Bilinmeyen') ORDER BY 5 DESC"), "kind", "user", "#count", "#quantity", "#amount"));
                    Part(c, o, "items", () => Rows(Q("SELECT TOP 400 k,d,n,m,q,a,u,s,id FROM (SELECT " + OrderKind + " AS k,CONVERT(varchar(19),o.CreatedDateTime,120) AS d,COALESCE(t.TicketNumber,'') AS n,COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen') AS m,o.Quantity AS q,o.Price*o.Quantity AS a,COALESCE(o.CreatingUserName,'') AS u,COALESCE(o.OrderStates,'') AS s,t.Id AS id,o.CreatedDateTime AS cd FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE " + c.Range("o.CreatedDateTime") + ") x WHERE k IS NOT NULL ORDER BY cd DESC"), "kind", "date", "number", "name", "#quantity", "#amount", "user", "states", "id"));
                    if (o["items"] is List<object>) foreach (var it in (List<object>)o["items"]) { var d = (Dictionary<string, object>)it; d["reason"] = StateReason(J.S(d, "states")); d.Remove("states"); }
                    break;
                case "tahsilat":
                    Part(c, o, "rows", () => Rows(Q("SELECT COALESCE(NULLIF(u.Name,''),'Bilinmeyen'),COALESCE(NULLIF(p.Name,''),'Bilinmeyen'),SUM(p.Amount),COUNT(*) FROM Payments p LEFT JOIN Users u ON u.Id=p.UserId WHERE " + c.Range("p.Date") + " GROUP BY COALESCE(NULLIF(u.Name,''),'Bilinmeyen'),COALESCE(NULLIF(p.Name,''),'Bilinmeyen') ORDER BY 1,3 DESC"), "user", "type", "#amount", "#count"));
                    Part(c, o, "payments", () => Payments(c));
                    break;
                case "personel":
                    Part(c, o, "daily", () => Daily(c));
                    Part(c, o, "sales", () => Rows(Q("SELECT COALESCE(NULLIF(t.CreatedUserName,''),'Bilinmeyen'),SUM(t.TotalAmount),COUNT(*),AVG(t.TotalAmount) FROM Tickets t WHERE " + c.Closed + " GROUP BY COALESCE(NULLIF(t.CreatedUserName,''),'Bilinmeyen') ORDER BY 2 DESC"), "name", "#amount", "#count", "#average"));
                    Part(c, o, "orders", () => Rows(Q("SELECT COALESCE(NULLIF(o.CreatingUserName,''),'Bilinmeyen'),SUM(CASE WHEN o.CalculatePrice=1 THEN o.Quantity ELSE 0 END),SUM(CASE WHEN o.CalculatePrice=1 THEN o.Price*o.Quantity ELSE 0 END),SUM(CASE WHEN o.CalculatePrice=0 THEN o.Price*o.Quantity ELSE 0 END),SUM(CASE WHEN o.CalculatePrice=0 THEN 1 ELSE 0 END) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE " + c.Range("o.CreatedDateTime") + " GROUP BY COALESCE(NULLIF(o.CreatingUserName,''),'Bilinmeyen') ORDER BY 3 DESC"), "name", "#quantity", "#amount", "#lostAmount", "#lostCount"));
                    break;
                case "saatlik":
                    Part(c, o, "hourly", () => Rows(Q("SELECT DATEPART(hour,t.Date),SUM(t.TotalAmount),COUNT(*) FROM Tickets t WHERE " + c.Closed + " GROUP BY DATEPART(hour,t.Date) ORDER BY 1"), "#hour", "#amount", "#count"));
                    // haftanin gunu x saat isi haritasi: 0=Pazartesi (DATEFIRST ayarindan bagimsiz)
                    Part(c, o, "dow", () => Rows(Q("SELECT DATEDIFF(day,'19000101',t.Date)%7,SUM(t.TotalAmount),COUNT(*),COUNT(DISTINCT CONVERT(varchar(10),t.Date,23)) FROM Tickets t WHERE " + c.Closed + " GROUP BY DATEDIFF(day,'19000101',t.Date)%7 ORDER BY 1"), "#dow", "#amount", "#count", "#days"));
                    Part(c, o, "heat", () => Rows(Q("SELECT DATEDIFF(day,'19000101',t.Date)%7,DATEPART(hour,t.Date),SUM(t.TotalAmount),COUNT(*),COUNT(DISTINCT CONVERT(varchar(10),t.Date,23)) FROM Tickets t WHERE " + c.Closed + " GROUP BY DATEDIFF(day,'19000101',t.Date)%7,DATEPART(hour,t.Date)"), "#dow", "#hour", "#amount", "#count", "#days"));
                    break;
                case "saatlik-urun":
                    Part(c, o, "rows", () =>
                    {
                        var r = Q("SELECT DATEPART(hour,o.CreatedDateTime),COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),SUM(o.Quantity),SUM(o.Price*o.Quantity) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE " + c.Closed + " AND o.CalculatePrice=1 AND " + c.Range("o.CreatedDateTime") + " GROUP BY DATEPART(hour,o.CreatedDateTime),COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen')");
                        // her saat icin en cok satan 8 urun
                        return r.GroupBy(x => (int)D(x[0])).OrderBy(g => g.Key).Select(g => (object)J.Obj("hour", g.Key,
                            "amount", J.NumVal(g.Sum(x => D(x[3]))), "quantity", J.NumVal(g.Sum(x => D(x[2]))),
                            "items", g.OrderByDescending(x => D(x[2])).Take(8).Select(x => (object)J.Obj("name", S(x[1]), "quantity", N(x[2]), "amount", N(x[3]))).ToList())).ToList();
                    });
                    break;
                case "departman":
                    Part(c, o, "departments", () => Departments(c));
                    Part(c, o, "ticketTypes", () => Rows(Q("SELECT COALESCE(NULLIF(tt.Name,''),'Bilinmeyen'),SUM(t.TotalAmount),COUNT(*),AVG(t.TotalAmount) FROM Tickets t LEFT JOIN TicketTypes tt ON tt.Id=t.TicketTypeId WHERE " + c.Closed + " GROUP BY COALESCE(NULLIF(tt.Name,''),'Bilinmeyen') ORDER BY 2 DESC"), "name", "#amount", "#count", "#average"));
                    break;
                case "iptal-adisyon":
                    Part(c, o, "tickets", () => Rows(Q("SELECT TOP 300 t.Id,CONVERT(varchar(19),t.Date,120),COALESCE(t.TicketNumber,''),COALESCE(t.CreatedUserName,''),COALESCE(NULLIF((SELECT TOP 1 EntityName FROM TicketEntities WHERE Ticket_Id=t.Id ORDER BY Id DESC),''),''),t.TotalAmount,t.IsClosed,x.lost,x.cnt,x.kinds,COALESCE(t.Note,'') FROM Tickets t INNER JOIN (SELECT TicketId,SUM(a) AS lost,COUNT(*) AS cnt,MIN(k)+CASE WHEN MIN(k)<>MAX(k) THEN ','+MAX(k) ELSE '' END AS kinds FROM (SELECT o.TicketId," + OrderKind + " AS k,o.Price*o.Quantity AS a FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE " + c.Range("t.Date") + ") y WHERE k IN ('iptal','iade') GROUP BY TicketId) x ON x.TicketId=t.Id ORDER BY t.Date DESC"), "id", "date", "number", "user", "table", "#total", "closed", "#lost", "#count", "kinds", "note"));
                    Part(c, o, "refunds", () => Rows(Q("SELECT TOP 200 CONVERT(varchar(19),p.Date,120),COALESCE(t.TicketNumber,''),COALESCE(NULLIF(p.Name,''),''),p.Amount,t.Id FROM Payments p LEFT JOIN Tickets t ON t.Id=p.TicketId WHERE " + c.Range("p.Date") + " AND p.Amount<0 ORDER BY p.Date DESC"), "date", "number", "name", "#amount", "id"));
                    break;
                case "paketci":
                    Part(c, o, "couriers", () =>
                    {
                        long et = EntityType("paket", "kurye");
                        if (et == 0) return new List<object>();
                        return Rows(Q("SELECT COALESCE(NULLIF(te.EntityName,''),'Bilinmeyen'),COUNT(DISTINCT t.Id),SUM(t.TotalAmount),AVG(t.TotalAmount),MIN(CONVERT(varchar(19),t.Date,120)),MAX(CONVERT(varchar(19),t.Date,120)) FROM Tickets t INNER JOIN TicketEntities te ON te.Ticket_Id=t.Id AND te.EntityTypeId=" + et + " WHERE " + c.Closed + " GROUP BY COALESCE(NULLIF(te.EntityName,''),'Bilinmeyen') ORDER BY 2 DESC"), "name", "#count", "#amount", "#average", "first", "last");
                    });
                    Part(c, o, "packages", () => Rows(Q("SELECT COUNT(*),COALESCE(SUM(t.TotalAmount),0),COALESCE(AVG(t.TotalAmount),0) FROM Tickets t LEFT JOIN TicketTypes tt ON tt.Id=t.TicketTypeId WHERE " + c.Closed + " AND (LOWER(COALESCE(tt.Name,'')) LIKE N'%paket%' OR LOWER(COALESCE(tt.Name,'')) LIKE N'%takeaway%' OR LOWER(COALESCE(t.CreatedUserName,'')) IN ('yemek sepeti','trendyol','getir'))"), "#count", "#amount", "#average"));
                    break;
                case "stok":   // 2.4 - SambaPOS envanteri (son gun sonu kaydi) + araliktaki tuketim
                    Part(c, o, "items", () => StockItems().Cast<object>().ToList());
                    Part(c, o, "consumption", () => Rows(Q("SELECT TOP 300 pci.InventoryItemName,SUM(pci.Consumption),SUM(pci.Consumption*pci.Cost),MAX(COALESCE(ii.BaseUnit,'')) " + PciFrom() + " LEFT JOIN InventoryItems ii ON ii.Id=pci.InventoryItemId WHERE pc.StartDate >= " + Dt(c.A) + " AND pc.StartDate < " + Dt(c.B) + " GROUP BY pci.InventoryItemName HAVING SUM(pci.Consumption)<>0 ORDER BY 3 DESC"), "name", "#quantity", "#cost", "unit"));
                    break;
                case "karlilik":   // 2.4 - recete maliyeti (CostItems) x satis = urun basina kar / marj
                    Part(c, o, "products", () =>
                    {
                        var cost = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
                        foreach (var x in Q("SELECT ci.Name,COALESCE(ci.PortionName,''),CASE WHEN ci.Cost>0 THEN ci.Cost ELSE ci.CostPrediction END FROM CostItems ci WHERE ci.PeriodicConsumptionId=(SELECT MAX(PeriodicConsumptionId) FROM CostItems WHERE Cost>0 OR CostPrediction>0)"))
                            if (D(x[2]) > 0) cost[S(x[0]) + "|" + S(x[1])] = D(x[2]);
                        var sales = Q("SELECT TOP 500 COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),COALESCE(NULLIF(o.PortionName,''),'Normal'),COALESCE(NULLIF(mi.GroupCode,''),N'Diğer'),SUM(o.Quantity),SUM(o.Price*o.Quantity) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId LEFT JOIN MenuItems mi ON mi.Id=o.MenuItemId WHERE " + c.Closed + " AND o.CalculatePrice=1 GROUP BY COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),COALESCE(NULLIF(o.PortionName,''),'Normal'),COALESCE(NULLIF(mi.GroupCode,''),N'Diğer') ORDER BY 5 DESC");
                        return sales.Select(x =>
                        {
                            double q = D(x[3]), a = D(x[4]), uc; bool has = cost.TryGetValue(S(x[0]) + "|" + S(x[1]), out uc) || cost.TryGetValue(S(x[0]) + "|", out uc);
                            return (object)J.Obj("name", S(x[0]), "portion", S(x[1]), "group", S(x[2]), "quantity", J.NumVal(q), "amount", J.NumVal(a),
                                "unitCost", has ? J.NumVal(uc) : null, "cost", has ? J.NumVal(uc * q) : null, "profit", has ? J.NumVal(a - uc * q) : null);
                        }).ToList();
                    });
                    break;
                case "veresiye":
                    Part(c, o, "open", () => Rows(Q("SELECT TOP 300 COALESCE(NULLIF(x.n,''),N'(isimsiz)'),COUNT(*),SUM(t.RemainingAmount),MAX(CONVERT(varchar(19),t.Date,120)) FROM Tickets t OUTER APPLY (SELECT TOP 1 te.EntityName AS n FROM TicketEntities te LEFT JOIN EntityTypes et ON et.Id=te.EntityTypeId WHERE te.Ticket_Id=t.Id AND " + NotStaffEntity + " ORDER BY te.Id DESC) x WHERE t.RemainingAmount>0.009 AND t.IsClosed=1 GROUP BY COALESCE(NULLIF(x.n,''),N'(isimsiz)') ORDER BY 3 DESC"), "name", "#count", "#amount", "last"));
                    Part(c, o, "accounts", () => Rows(Q("SELECT TOP 300 COALESCE(a.Name,''),COALESCE(at.Name,''),SUM(v.Debit-v.Credit),MAX(CONVERT(varchar(19),v.Date,120)) FROM AccountTransactionValues v INNER JOIN Accounts a ON a.Id=v.AccountId LEFT JOIN AccountTypes at ON at.Id=a.AccountTypeId GROUP BY a.Name,at.Name HAVING ABS(SUM(v.Debit-v.Credit))>0.009 ORDER BY 2,3 DESC"), "name", "type", "#balance", "last"));
                    break;
                case "musteri":
                    Part(c, o, "customers", () => Rows(Q("SELECT TOP 300 x.n,COUNT(*),SUM(t.TotalAmount),AVG(t.TotalAmount),MAX(CONVERT(varchar(19),t.Date,120)),MIN(CONVERT(varchar(19),t.Date,120)) FROM Tickets t CROSS APPLY (SELECT TOP 1 te.EntityName AS n FROM TicketEntities te LEFT JOIN EntityTypes et ON et.Id=te.EntityTypeId WHERE te.Ticket_Id=t.Id AND " + NotStaffEntity + " AND COALESCE(te.EntityName,'')<>'' ORDER BY te.Id DESC) x WHERE " + c.Closed + " GROUP BY x.n ORDER BY 3 DESC"), "name", "#count", "#amount", "#average", "last", "first"));
                    break;
                case "sepet":
                    if ((c.B - c.A).TotalDays > 93) throw new Exception("Sepet analizi en fazla 3 aylık aralık için hesaplanır.");
                    Part(c, o, "pairs", () => Rows(Q("SELECT TOP 30 a.MenuItemName,b.MenuItemName,COUNT(DISTINCT a.TicketId) FROM Orders a INNER JOIN Orders b ON b.TicketId=a.TicketId AND a.MenuItemName<b.MenuItemName INNER JOIN Tickets t ON t.Id=a.TicketId WHERE " + c.Closed + " AND a.CalculatePrice=1 AND b.CalculatePrice=1 GROUP BY a.MenuItemName,b.MenuItemName ORDER BY 3 DESC"), "a", "b", "#count"));
                    Part(c, o, "sizes", () => Rows(Q("SELECT CASE WHEN n>=8 THEN 8 ELSE CAST(CEILING(n) AS int) END,COUNT(*),SUM(tot) FROM (SELECT t.Id,SUM(o.Quantity) AS n,MAX(t.TotalAmount) AS tot FROM Tickets t INNER JOIN Orders o ON o.TicketId=t.Id WHERE " + c.Closed + " AND o.CalculatePrice=1 GROUP BY t.Id) x GROUP BY CASE WHEN n>=8 THEN 8 ELSE CAST(CEILING(n) AS int) END ORDER BY 1"), "#items", "#count", "#amount"));
                    break;
                case "urun-detay":
                    if (string.IsNullOrEmpty(key)) throw new Exception("Ürün adı gerekli.");
                    { string w = c.Closed + " AND o.CalculatePrice=1 AND o.MenuItemName=N'" + Db.Esc(key) + "'";
                    Part(c, o, "daily", () => Rows(Q("SELECT CONVERT(varchar(10),t.Date,23),SUM(o.Quantity),SUM(o.Price*o.Quantity) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE " + w + " GROUP BY CONVERT(varchar(10),t.Date,23) ORDER BY 1"), "date", "#quantity", "#amount"));
                    Part(c, o, "hourly", () => Rows(Q("SELECT DATEPART(hour,o.CreatedDateTime),SUM(o.Quantity),SUM(o.Price*o.Quantity) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE " + w + " GROUP BY DATEPART(hour,o.CreatedDateTime) ORDER BY 1"), "#hour", "#quantity", "#amount"));
                    Part(c, o, "portions", () => Rows(Q("SELECT COALESCE(NULLIF(o.PortionName,''),'Normal'),SUM(o.Quantity),SUM(o.Price*o.Quantity),AVG(o.Price) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE " + w + " GROUP BY COALESCE(NULLIF(o.PortionName,''),'Normal') ORDER BY 2 DESC"), "name", "#quantity", "#amount", "#price"));
                    Part(c, o, "users", () => Rows(Q("SELECT COALESCE(NULLIF(o.CreatingUserName,''),'Bilinmeyen'),SUM(o.Quantity),SUM(o.Price*o.Quantity) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE " + w + " GROUP BY COALESCE(NULLIF(o.CreatingUserName,''),'Bilinmeyen') ORDER BY 2 DESC"), "name", "#quantity", "#amount"));
                    Part(c, o, "pairs", () => Rows(Q("SELECT TOP 10 b.MenuItemName,COUNT(DISTINCT b.TicketId) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId INNER JOIN Orders b ON b.TicketId=o.TicketId AND b.MenuItemName<>o.MenuItemName AND b.CalculatePrice=1 WHERE " + w + " GROUP BY b.MenuItemName ORDER BY 2 DESC"), "name", "#count"));
                    Part(c, o, "lost", () => Rows(Q("SELECT k,SUM(q),SUM(a) FROM (SELECT " + OrderKind + " AS k,o.Quantity AS q,o.Price*o.Quantity AS a FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE " + c.Range("o.CreatedDateTime") + " AND o.MenuItemName=N'" + Db.Esc(key) + "') x WHERE k IS NOT NULL GROUP BY k"), "kind", "#quantity", "#amount")); }
                    break;
                case "personel-detay":
                    if (string.IsNullOrEmpty(key)) throw new Exception("Personel adı gerekli.");
                    { string u = "N'" + Db.Esc(key) + "'";
                    Part(c, o, "daily", () => Rows(Q("SELECT CONVERT(varchar(10),t.Date,23),SUM(t.TotalAmount),COUNT(*) FROM Tickets t WHERE " + c.Closed + " AND t.CreatedUserName=" + u + " GROUP BY CONVERT(varchar(10),t.Date,23) ORDER BY 1"), "date", "#amount", "#count"));
                    Part(c, o, "hourly", () => Rows(Q("SELECT DATEPART(hour,t.Date),SUM(t.TotalAmount),COUNT(*) FROM Tickets t WHERE " + c.Closed + " AND t.CreatedUserName=" + u + " GROUP BY DATEPART(hour,t.Date) ORDER BY 1"), "#hour", "#amount", "#count"));
                    Part(c, o, "products", () => Rows(Q("SELECT TOP 30 COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),SUM(o.Quantity),SUM(o.Price*o.Quantity) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE " + c.Range("o.CreatedDateTime") + " AND o.CalculatePrice=1 AND o.CreatingUserName=" + u + " GROUP BY COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen') ORDER BY 3 DESC"), "name", "#quantity", "#amount"));
                    Part(c, o, "lost", () => Rows(Q("SELECT TOP 100 k,d,n,m,q,a,id FROM (SELECT " + OrderKind + " AS k,CONVERT(varchar(19),o.CreatedDateTime,120) AS d,COALESCE(t.TicketNumber,'') AS n,COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen') AS m,o.Quantity AS q,o.Price*o.Quantity AS a,t.Id AS id,o.CreatedDateTime AS cd FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE " + c.Range("o.CreatedDateTime") + " AND o.CreatingUserName=" + u + ") x WHERE k IS NOT NULL ORDER BY cd DESC"), "kind", "date", "number", "name", "#quantity", "#amount", "id"));
                    Part(c, o, "payments", () => Rows(Q("SELECT COALESCE(NULLIF(p.Name,''),'Bilinmeyen'),SUM(p.Amount),COUNT(*) FROM Payments p INNER JOIN Users us ON us.Id=p.UserId WHERE " + c.Range("p.Date") + " AND us.Name=" + u + " GROUP BY COALESCE(NULLIF(p.Name,''),'Bilinmeyen') ORDER BY 2 DESC"), "name", "#amount", "#count")); }
                    break;
                case "masa":
                    Part(c, o, "speed", () => Rows(Q("SELECT DATEPART(hour,t.Date),AVG(CAST(DATEDIFF(minute,t.Date,t.LastPaymentDate) AS float)),COUNT(*) FROM Tickets t WHERE " + c.Closed + " AND t.LastPaymentDate>t.Date AND DATEDIFF(minute,t.Date,t.LastPaymentDate)<720 GROUP BY DATEPART(hour,t.Date) ORDER BY 1"), "#hour", "#minutes", "#count"));
                    Part(c, o, "tables", () =>
                    {
                        long et = EntityType("masa", "table");
                        if (et == 0) return new List<object>();
                        return Rows(Q("SELECT COALESCE(NULLIF(te.EntityName,''),'Bilinmeyen'),COUNT(DISTINCT t.Id),SUM(t.TotalAmount),AVG(t.TotalAmount),AVG(CASE WHEN t.LastPaymentDate>t.Date THEN CAST(DATEDIFF(minute,t.Date,t.LastPaymentDate) AS float) END) FROM Tickets t INNER JOIN TicketEntities te ON te.Ticket_Id=t.Id AND te.EntityTypeId=" + et + " WHERE " + c.Closed + " GROUP BY COALESCE(NULLIF(te.EntityName,''),'Bilinmeyen') ORDER BY 3 DESC"), "name", "#count", "#amount", "#average", "#minutes");
                    });
                    break;
                case "adisyonlar":
                    Part(c, o, "tickets", () => Rows(Q("SELECT TOP 500 t.Id,CONVERT(varchar(19),t.Date,120),COALESCE(t.TicketNumber,''),COALESCE(NULLIF((SELECT TOP 1 EntityName FROM TicketEntities WHERE Ticket_Id=t.Id ORDER BY Id DESC),''),''),COALESCE(t.CreatedUserName,''),t.TotalAmount,t.RemainingAmount,t.IsClosed FROM Tickets t WHERE " + c.Range("t.Date") + " ORDER BY t.Date DESC"), "id", "date", "number", "table", "user", "#total", "#remaining", "closed"));
                    break;
                default: throw new Exception("Bilinmeyen rapor: " + kind);
            }
            o["errors"] = c.Errors;
            return o;
        }

        static object Summary(Ctx c)
        {
            var r = Q("SELECT COALESCE(SUM(t.TotalAmount),0),COUNT(*),COALESCE(AVG(t.TotalAmount),0),COALESCE(SUM(t.RemainingAmount),0) FROM Tickets t WHERE " + c.Closed);
            var x = r.Count > 0 ? r[0] : new object[4];
            return J.Obj("sales", N(x[0]), "tickets", N(x[1]), "average", N(x[2]), "remaining", N(x[3]));
        }
        /* SambaPOS surumune gore PeriodicConsumptionItems ya dogrudan PeriodicConsumptionId tasir ya da WarehouseConsumptions uzerinden baglanir */
        static string _pciFrom;
        static string PciFrom()
        {
            if (_pciFrom != null) return _pciFrom;
            // sadece BASARILI denemede hatirlanir - SQL o an kapaliysa yanlis bicim onbellege yazilmasin
            try { Q("SELECT TOP 0 PeriodicConsumptionId FROM PeriodicConsumptionItems"); return _pciFrom = "FROM PeriodicConsumptionItems pci INNER JOIN PeriodicConsumptions pc ON pc.Id=pci.PeriodicConsumptionId"; }
            catch { }
            Q("SELECT TOP 0 WarehouseConsumptionId FROM PeriodicConsumptionItems");   // bu da olmazsa hata yukari gider (bolum bos gelir)
            return _pciFrom = "FROM PeriodicConsumptionItems pci INNER JOIN WarehouseConsumptions wc ON wc.Id=pci.WarehouseConsumptionId INNER JOIN PeriodicConsumptions pc ON pc.Id=wc.PeriodicConsumptionId";
        }
        /* Guncel stok: son gun sonu (PeriodicConsumption) kaydi; sayim girildiyse PhysicalInventory, yoksa InStock+Added-Removed-Consumption.
           Deger = Cost x stok (SambaPOS forumundaki standart stok raporu formulu). */
        public static List<Dictionary<string, object>> StockItems()
        {
            string sel = "SELECT pci.InventoryItemName,{0},pci.InStock,pci.Added,pci.Removed,pci.Consumption,pci.PhysicalInventory,pci.Cost " + PciFrom() + "{1} WHERE pc.Id=(SELECT MAX(Id) FROM PeriodicConsumptions) ORDER BY pci.InventoryItemName";
            List<object[]> r;
            try { r = Q(string.Format(sel, "COALESCE(ii.GroupCode,''),COALESCE(ii.BaseUnit,'')", " LEFT JOIN InventoryItems ii ON ii.Id=pci.InventoryItemId")); }
            catch { r = Q(string.Format(sel, "'',''", "")); }
            return r.Select(x =>
            {
                double calc = D(x[3]) + D(x[4]) - D(x[5]) - D(x[6]), st = x[7] != null ? D(x[7]) : calc, cost = D(x[8]);
                return J.Obj("name", S(x[0]), "group", S(x[1]), "unit", S(x[2]), "inStock", N(x[3]), "added", N(x[4]), "removed", N(x[5]), "consumption", N(x[6]),
                    "physical", x[7] != null ? N(x[7]) : null, "stock", J.NumVal(Math.Round(st, 3)), "cost", J.NumVal(cost), "value", J.NumVal(Math.Round(cost * st, 2)));
            }).ToList();
        }
        static object Daily(Ctx c) { return Rows(Q("SELECT CONVERT(varchar(10),t.Date,23),SUM(t.TotalAmount),COUNT(*) FROM Tickets t WHERE " + c.Closed + " GROUP BY CONVERT(varchar(10),t.Date,23) ORDER BY 1"), "date", "#amount", "#count"); }
        static object Payments(Ctx c) { return Rows(Q("SELECT COALESCE(NULLIF(p.Name,''),'Bilinmeyen'),SUM(p.Amount),COUNT(*) FROM Payments p WHERE " + c.Range("p.Date") + " GROUP BY COALESCE(NULLIF(p.Name,''),'Bilinmeyen') ORDER BY 2 DESC"), "name", "#amount", "#count"); }
        static object Departments(Ctx c) { return Rows(Q("SELECT COALESCE(NULLIF(d.Name,''),'Bilinmeyen'),SUM(t.TotalAmount),COUNT(*),AVG(t.TotalAmount) FROM Tickets t LEFT JOIN Departments d ON d.Id=t.DepartmentId WHERE " + c.Closed + " GROUP BY COALESCE(NULLIF(d.Name,''),'Bilinmeyen') ORDER BY 2 DESC"), "name", "#amount", "#count", "#average"); }
        static object CalcTotals(Ctx c) { return Rows(Q("SELECT COALESCE(NULLIF(c.Name,''),'Hesaplama'),SUM(c.CalculationAmount),COUNT(DISTINCT c.TicketId) FROM Calculations c INNER JOIN Tickets t ON t.Id=c.TicketId WHERE " + c.Closed + " AND c.CalculationAmount<>0 GROUP BY COALESCE(NULLIF(c.Name,''),'Hesaplama') ORDER BY 2"), "name", "#amount", "#count"); }
        static object OrderKindTotals(Ctx c) { return Rows(Q("SELECT k,COUNT(*),SUM(q),SUM(a) FROM (SELECT " + OrderKind + " AS k,o.Quantity AS q,o.Price*o.Quantity AS a FROM Orders o WHERE " + c.Range("o.CreatedDateTime") + ") x WHERE k IS NOT NULL GROUP BY k ORDER BY 4 DESC"), "kind", "#count", "#quantity", "#amount"); }

        static object WorkPeriods(Ctx c)
        {
            string w = "w.StartDate < " + Dt(c.B) + " AND COALESCE(w.EndDate,GETDATE()) >= " + Dt(c.A);
            var periods = Q("SELECT TOP 62 w.Id,CONVERT(varchar(19),w.StartDate,120),CONVERT(varchar(19),w.EndDate,120),COALESCE(CONVERT(varchar(20),w.WorkPeriodNumber),''),(SELECT COALESCE(SUM(TotalAmount),0) FROM Tickets WHERE IsClosed=1 AND Date>=w.StartDate AND Date<COALESCE(w.EndDate,GETDATE())),(SELECT COUNT(*) FROM Tickets WHERE IsClosed=1 AND Date>=w.StartDate AND Date<COALESCE(w.EndDate,GETDATE())),(SELECT COUNT(*) FROM Tickets WHERE IsClosed=0 AND Date>=w.StartDate AND Date<COALESCE(w.EndDate,GETDATE())) FROM WorkPeriods w WHERE " + w + " ORDER BY w.StartDate DESC");
            var pay = new Dictionary<string, List<object>>();
            try
            {
                foreach (var r in Q("SELECT w.Id,COALESCE(NULLIF(p.Name,''),'Bilinmeyen'),SUM(p.Amount),COUNT(*) FROM WorkPeriods w INNER JOIN Payments p ON p.Date>=w.StartDate AND p.Date<COALESCE(w.EndDate,GETDATE()) WHERE " + w + " GROUP BY w.Id,COALESCE(NULLIF(p.Name,''),'Bilinmeyen') ORDER BY 3 DESC"))
                {
                    List<object> l; if (!pay.TryGetValue(S(r[0]), out l)) pay[S(r[0])] = l = new List<object>();
                    l.Add(J.Obj("name", S(r[1]), "amount", N(r[2]), "count", N(r[3])));
                }
            }
            catch (Exception ex) { c.Errors.Add("gün sonu ödemeleri: " + ex.Message); }
            return periods.Select(r => { List<object> l; pay.TryGetValue(S(r[0]), out l);
                return (object)J.Obj("id", S(r[0]), "start", S(r[1]), "end", S(r[2]), "number", S(r[3]), "sales", N(r[4]), "tickets", N(r[5]), "open", N(r[6]), "payments", l ?? new List<object>()); }).ToList();
        }

        static readonly Dictionary<string, long> _types = new Dictionary<string, long>();
        static long EntityType(params string[] likes)
        {
            string key = string.Join("|", likes);
            lock (_types) { long v; if (_types.TryGetValue(key, out v)) return v; }
            var r = Q("SELECT TOP 1 Id FROM EntityTypes WHERE " + string.Join(" OR ", likes.Select(l => "LOWER(Name) LIKE N'%" + Db.Esc(l) + "%'")) + " ORDER BY Id");
            long id = r.Count > 0 ? Db.I(r[0][0]) : 0;
            lock (_types) _types[key] = id;
            return id;
        }

        /* OrderStates JSON'undan okunabilir aciklama: [{"SN":"GStatus","S":"Gift","SV":"Musteri memnuniyeti"}] -> "Gift · Musteri memnuniyeti" */
        public static string StateReason(string json)
        {
            try
            {
                var parts = new List<string>();
                foreach (var it in J.LL(J.Parse(string.IsNullOrEmpty(json) ? "[]" : json)))
                {
                    var d = J.D(it); if (d == null) continue;
                    string s = J.S(d, "S"), sv = J.S(d, "SV");
                    if (s.Length == 0 || s == "Submitted" || s == "New" || s == "Status") continue;
                    parts.Add(sv.Length > 0 ? s + " · " + sv : s);
                }
                return string.Join(", ", parts.Distinct());
            }
            catch { return ""; }
        }

        // ============================================================== adisyon logu (kapali adisyonlar dahil)
        public static Dictionary<string, object> TicketLog(object id)
        {
            string sid = J.S(id);
            if (!Regex.IsMatch(sid, @"^\d+$")) throw new Exception("Geçersiz adisyon numarası.");
            long tid = long.Parse(sid);
            var tr = Q("SELECT t.Id,CONVERT(varchar(19),t.Date,120),COALESCE(t.TicketNumber,''),COALESCE(t.CreatedUserName,''),t.TotalAmount,t.RemainingAmount,t.IsClosed,COALESCE(t.Note,''),CONVERT(varchar(19),t.LastPaymentDate,120),COALESCE(NULLIF(d.Name,''),''),COALESCE(t.TicketStates,'') FROM Tickets t LEFT JOIN Departments d ON d.Id=t.DepartmentId WHERE t.Id=" + tid);
            if (tr.Count == 0) throw new Exception("Adisyon bulunamadı.");
            var t = tr[0];
            var o = J.Obj("id", S(t[0]), "date", S(t[1]), "number", S(t[2]), "user", S(t[3]), "total", N(t[4]), "remaining", N(t[5]), "closed", S(t[6]) == "1",
                "note", S(t[7]), "lastPayment", S(t[8]), "department", S(t[9]));
            var errors = new List<object>(); o["errors"] = errors;
            try { o["entities"] = Rows(Q("SELECT COALESCE(et.Name,''),COALESCE(te.EntityName,'') FROM TicketEntities te LEFT JOIN EntityTypes et ON et.Id=te.EntityTypeId WHERE te.Ticket_Id=" + tid + " ORDER BY te.Id"), "type", "name"); } catch (Exception ex) { errors.Add(ex.Message); }
            try
            {
                var orders = Q("SELECT CONVERT(varchar(19),o.CreatedDateTime,120),COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),COALESCE(o.PortionName,''),o.Quantity,o.Price,o.Price*o.Quantity,COALESCE(o.CreatingUserName,''),o.CalculatePrice," + OrderKind + ",COALESCE(o.OrderStates,''),COALESCE(o.OrderTags,'') FROM Orders o WHERE o.TicketId=" + tid + " ORDER BY o.CreatedDateTime,o.Id");
                o["orders"] = orders.Select(x => (object)J.Obj("date", S(x[0]), "name", S(x[1]), "portion", S(x[2]), "quantity", N(x[3]), "price", N(x[4]), "total", N(x[5]),
                    "user", S(x[6]), "counted", S(x[7]) == "1", "kind", S(x[8]), "reason", StateReason(S(x[9])), "tags", TagText(S(x[10])))).ToList();
            }
            catch (Exception ex) { errors.Add(ex.Message); }
            try { o["payments"] = Rows(Q("SELECT CONVERT(varchar(19),p.Date,120),COALESCE(NULLIF(p.Name,''),''),p.Amount,COALESCE(u.Name,'') FROM Payments p LEFT JOIN Users u ON u.Id=p.UserId WHERE p.TicketId=" + tid + " ORDER BY p.Date"), "date", "name", "#amount", "user"); } catch (Exception ex) { errors.Add(ex.Message); }
            try { o["calculations"] = Rows(Q("SELECT COALESCE(NULLIF(Name,''),'Hesaplama'),CalculationAmount FROM Calculations WHERE TicketId=" + tid + " AND CalculationAmount<>0"), "name", "#amount"); } catch (Exception ex) { errors.Add(ex.Message); }
            return o;
        }
        static string TagText(string json)
        {
            try { return string.Join(", ", J.LL(J.Parse(string.IsNullOrEmpty(json) ? "[]" : json)).Select(J.D).Where(d => d != null && J.S(d, "TV").Length > 0).Select(d => J.S(d, "TV"))); }
            catch { return ""; }
        }

        // ============================================================== siparis seviyesi olaylar (bildirimler icin)
        /* Son 2 gunun ikram / iptal / iade / zayi satirlari + iskontolari. Bildirim listesine eklenir ve push'u tetikler. */
        public static List<Dictionary<string, object>> RecentEvents()
        {
            var list = new List<Dictionary<string, object>>();
            try
            {
                foreach (var x in Q("SELECT TOP 150 k,d,n,m,q,a,u,s,oid FROM (SELECT " + OrderKind + " AS k,CONVERT(varchar(19),o.CreatedDateTime,120) AS d,COALESCE(NULLIF(t.TicketNumber,''),CONVERT(varchar(20),t.Id)) AS n,COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen') AS m,o.Quantity AS q,o.Price*o.Quantity AS a,COALESCE(o.CreatingUserName,'') AS u,COALESCE(o.OrderStates,'') AS s,o.Id AS oid,o.CreatedDateTime AS cd FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE o.CreatedDateTime >= DATEADD(day,-2,GETDATE())) x WHERE k IS NOT NULL ORDER BY cd DESC"))
                {
                    string reason = StateReason(S(x[7]));
                    list.Add(J.Obj("kind", S(x[0]), "date", S(x[1]), "ticket", S(x[2]), "amount", N(x[5]),
                        "detail", J.NumStr(D(x[4])) + " × " + S(x[3]) + (reason.Length > 0 ? " — " + reason : "") + (S(x[6]).Length > 0 ? " · " + S(x[6]) : ""),
                        "user", S(x[6]), "id", "o" + S(x[8])));
                }
            }
            catch (Exception ex) { LogOnce("siparis olaylari", ex); }
            try
            {
                foreach (var x in Q("SELECT TOP 80 CONVERT(varchar(19),COALESCE(t.LastPaymentDate,t.Date),120),COALESCE(NULLIF(t.TicketNumber,''),CONVERT(varchar(20),t.Id)),COALESCE(NULLIF(c.Name,''),'Hesaplama'),c.CalculationAmount,COALESCE(t.CreatedUserName,''),c.Id FROM Calculations c INNER JOIN Tickets t ON t.Id=c.TicketId WHERE t.Date >= DATEADD(day,-2,GETDATE()) AND c.CalculationAmount<0 ORDER BY c.Id DESC"))
                    list.Add(J.Obj("kind", "iskonto", "date", S(x[0]), "ticket", S(x[1]), "amount", N(x[3]), "detail", S(x[2]) + (S(x[4]).Length > 0 ? " · " + S(x[4]) : ""), "user", S(x[4]), "id", "c" + S(x[5])));
            }
            catch (Exception ex) { LogOnce("iskonto olaylari", ex); }
            return list;
        }
        static readonly HashSet<string> _logged = new HashSet<string>();
        static void LogOnce(string what, Exception ex) { lock (_logged) if (_logged.Add(what)) Log.Write(what + " okunamadi (bu sema desteklemiyor olabilir): " + ex.Message); }
    }
}
