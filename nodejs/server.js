const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const iconv = require('iconv-lite');
const config = fs.existsSync(path.join(__dirname, 'config.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')) : {};
const PORT = Number(process.env.PORT || config.port || 8787);
const ROOT = __dirname;
/* Program Files altina kurulduysa normal kullanici bu klasore yazamaz; kalici
   veriler (sifre, tunel linki, gunlukler) her zaman ProgramData altinda tutulur. */
const RUNTIME_DIR = path.join(process.env.PROGRAMDATA || process.env.TEMP || ROOT, 'EnsariPOS', 'PatronRaporu');
fs.mkdirSync(RUNTIME_DIR, { recursive: true });
const SQL_SERVER = process.env.SAMBAPOS_SQL_SERVER || config.server || config.sqlServer || 'localhost';
const SQL_DATABASE = process.env.SAMBAPOS_DB || config.database || 'SAMBAPOS5';
const SQL_USER = process.env.SAMBAPOS_SQL_USER || config.user || '';
const SQL_PASSWORD = process.env.SAMBAPOS_SQL_PASSWORD || config.password || '';
const APP_NAME = config.appName || 'Ensari POS Patron';
/* Bulut paneline (C:\genel) gonderim - SADECE config.json'da cloudActivationKey
   doluysa aktif olur. Bos ise hicbir sey yapmaz, mevcut kurulumlar etkilenmez. */
const CLOUD_ACTIVATION_KEY = config.cloudActivationKey || '';
const CLOUD_SERVER_URL = config.cloudServerUrl || 'https://app.ornek-alanadi.com';
const KURYE_INTERNAL_URL = config.kuryeInternalUrl || 'http://127.0.0.1:4021';
function json(res, status, data) { const body = JSON.stringify(data); res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(body); }
function sql(query) { return new Promise((resolve, reject) => { const auth = SQL_USER && SQL_PASSWORD ? ['-U', SQL_USER, '-P', SQL_PASSWORD] : ['-E']; const trust = config.options && config.options.trustServerCertificate ? ['-C'] : []; const args = ['-S', SQL_SERVER, ...auth, ...trust, '-d', SQL_DATABASE, '-h', '-1', '-W', '-s', '|', '-Q', query]; execFile('sqlcmd', args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024, encoding: 'buffer' }, (e, out, err) => { const decode = value => Buffer.isBuffer(value) ? iconv.decode(value, 'cp857') : String(value || ''); const stdout = decode(out); const stderr = decode(err); e ? reject(new Error(stderr.trim() || stdout.trim() || e.message)) : resolve(stdout.trim()); }); }); }
function rows(text, keys) { return text ? text.split(/\r?\n/).filter(Boolean).map(line => { const v=line.split('|').map(x=>x.trim()); return Object.fromEntries(keys.map((k,i)=>[k,v[i]||''])); }) : []; }
function validDate(value, fallback) { return /^\d{4}-\d{2}-\d{2}$/.test(value||'') ? value : fallback; }
function hourGuard(v) { if(v===null||v===undefined||v==='') return null; const n=Number(v); return Number.isInteger(n) && n>=0 && n<=23 ? n : null; }

/* hourStart/hourEnd: SambaPOS'ta bir siparisin gerceklestigi SAAT'e gore
   filtreleme (orn. "son bir hafta saat 1'de olan satislar"). Ikisi de
   verilmezse (varsayilan) hicbir saat filtresi uygulanmaz - mevcut davranis
   (tarih araligindaki tum saatler, hourly kirilimda ayri ayri) aynen kalir. */
async function report(start,end,hourStart,hourEnd) {
  const hs=hourGuard(hourStart), he=hourGuard(hourEnd);
  const hasHour = hs!==null && he!==null;
  const hourClause = hasHour ? ` AND DATEPART(hour,Date) BETWEEN ${hs} AND ${he}` : '';
  const where=`IsClosed=1 AND Date >= '${start}' AND Date < DATEADD(day,1,'${end}')${hourClause}`;
  const q=[
    `SET NOCOUNT ON; SELECT COALESCE(SUM(TotalAmount),0),COUNT(*),COALESCE(AVG(TotalAmount),0),COALESCE(SUM(RemainingAmount),0) FROM Tickets WHERE ${where}`,
    `SET NOCOUNT ON; SELECT CONVERT(varchar(10),Date,23),COALESCE(SUM(TotalAmount),0),COUNT(*) FROM Tickets WHERE ${where} GROUP BY CONVERT(varchar(10),Date,23) ORDER BY 1`,
    `SET NOCOUNT ON; SELECT DATEPART(hour,Date),COALESCE(SUM(TotalAmount),0),COUNT(*) FROM Tickets WHERE ${where} GROUP BY DATEPART(hour,Date) ORDER BY 1`,
    `SET NOCOUNT ON; SELECT TOP 15 COALESCE(NULLIF(MenuItemName,''),'Bilinmeyen'),COALESCE(SUM(Quantity),0),COALESCE(SUM(Price*Quantity),0) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE t.${where} GROUP BY COALESCE(NULLIF(MenuItemName,''),'Bilinmeyen') ORDER BY SUM(Price*Quantity) DESC`,
    `SET NOCOUNT ON; SELECT COALESCE(NULLIF(Name,''),'Bilinmeyen'),COALESCE(SUM(Amount),0),COUNT(*) FROM Payments WHERE Date >= '${start}' AND Date < DATEADD(day,1,'${end}')${hourClause} GROUP BY COALESCE(NULLIF(Name,''),'Bilinmeyen') ORDER BY SUM(Amount) DESC`,
    `SET NOCOUNT ON; SELECT TOP 15 COALESCE(NULLIF(CreatedUserName,''),'Bilinmeyen'),COALESCE(SUM(TotalAmount),0),COUNT(*) FROM Tickets WHERE ${where} GROUP BY COALESCE(NULLIF(CreatedUserName,''),'Bilinmeyen') ORDER BY SUM(TotalAmount) DESC`,
    `SET NOCOUNT ON; SELECT TOP 12 CONVERT(varchar(19),Date,120),COALESCE(TicketNumber,''),COALESCE(TotalAmount,0),COALESCE(CreatedUserName,'') FROM Tickets WHERE ${where} ORDER BY Date DESC`,
    `SET NOCOUNT ON; SELECT COALESCE(NULLIF(d.Name,''),'Bilinmeyen'),COALESCE(SUM(t.TotalAmount),0),COUNT(*) FROM Tickets t LEFT JOIN Departments d ON d.Id=t.DepartmentId WHERE ${where} GROUP BY COALESCE(NULLIF(d.Name,''),'Bilinmeyen') ORDER BY SUM(t.TotalAmount) DESC`,
    `SET NOCOUNT ON; SELECT TOP 100 CONVERT(varchar(19),t.Date,120),COALESCE(t.TicketNumber,''),COALESCE(NULLIF(te.EntityName,''),'Acik adisyon'),COALESCE(t.CreatedUserName,''),COALESCE(NULLIF(d.Name,''),'Bilinmeyen'),COALESCE(t.TotalAmount,0),COALESCE(t.RemainingAmount,0),t.IsClosed FROM Tickets t LEFT JOIN Departments d ON d.Id=t.DepartmentId OUTER APPLY (SELECT TOP 1 EntityName FROM TicketEntities WHERE Ticket_Id=t.Id ORDER BY Id DESC) te WHERE ${where} ORDER BY t.Date DESC`
  ];
  const [summary,daily,hourly,products,payments,users,recent,departments,tickets]=await Promise.all(q.map(sql));
  const s=summary.split('|').map(x=>x.trim());
  return {range:{start,end,hourStart:hasHour?hs:null,hourEnd:hasHour?he:null},summary:{sales:+s[0]||0,tickets:+s[1]||0,average:+s[2]||0,remaining:+s[3]||0},daily:rows(daily,['date','amount','count']).map(r=>({...r,amount:+r.amount,count:+r.count})),hourly:rows(hourly,['hour','amount','count']).map(r=>({...r,hour:+r.hour,amount:+r.amount,count:+r.count})),products:rows(products,['name','quantity','amount']).map(r=>({...r,quantity:+r.quantity,amount:+r.amount})),payments:rows(payments,['name','amount','count']).map(r=>({...r,amount:+r.amount,count:+r.count})),users:rows(users,['name','amount','count']).map(r=>({...r,amount:+r.amount,count:+r.count})),recent:rows(recent,['date','number','amount','user']).map(r=>({...r,amount:+r.amount})),departments:rows(departments,['name','amount','count']).map(r=>({...r,amount:+r.amount,count:+r.count})),tickets:rows(tickets,['date','number','table','user','department','amount','remaining','closed']).map(r=>({...r,amount:+r.amount,remaining:+r.remaining,closed:r.closed==='1'}))};
}
async function priceChanges(days) {
  const query = `SET NOCOUNT ON; WITH H AS (SELECT MenuItemId,COALESCE(NULLIF(MenuItemName,''),'Bilinmeyen') AS ItemName,Price,CreatedDateTime,LAG(Price) OVER(PARTITION BY MenuItemId ORDER BY CreatedDateTime) AS PreviousPrice FROM Orders WHERE CreatedDateTime >= DATEADD(day,-${days},GETDATE()) AND Price IS NOT NULL) SELECT TOP 100 CONVERT(varchar(19),CreatedDateTime,120),ItemName,PreviousPrice,Price,Price-PreviousPrice FROM H WHERE PreviousPrice IS NOT NULL AND PreviousPrice<>Price ORDER BY CreatedDateTime DESC;`;
  return rows(await sql(query), ['date','name','oldPrice','newPrice','difference']).map(r => ({...r,oldPrice:+r.oldPrice,newPrice:+r.newPrice,difference:+r.difference}));
}
async function openTables() {
  const query = `SET NOCOUNT ON; SELECT t.Id,CASE WHEN LOWER(COALESCE(tt.Name,'')) LIKE '%paket%' OR LOWER(COALESCE(tt.Name,'')) LIKE '%takeaway%' OR LOWER(COALESCE(t.CreatedUserName,'')) IN ('yemek sepeti','trendyol','getir') THEN 'package' ELSE 'table' END,COALESCE(NULLIF((SELECT TOP 1 EntityName FROM TicketEntities WHERE Ticket_Id=t.Id ORDER BY Id DESC),''),'Acik masa'),COALESCE(t.TicketNumber,''),CONVERT(varchar(19),t.Date,120),COALESCE(t.TotalAmount,0),COALESCE(t.RemainingAmount,0),COALESCE(t.CreatedUserName,''),COALESCE(pk.S,'') FROM Tickets t LEFT JOIN TicketTypes tt ON tt.Id=t.TicketTypeId OUTER APPLY (SELECT TOP 1 JSON_VALUE(value,'$.S') AS S FROM OPENJSON(CASE WHEN ISJSON(t.TicketStates)=1 THEN t.TicketStates END) WHERE JSON_VALUE(value,'$.SN')='Paket') pk WHERE t.IsClosed=0 ORDER BY t.Date;`;
  const items = rows(await sql(query), ['id','kind','table','number','date','total','remaining','user','packState']).map(row => ({...row,total:+row.total,remaining:+row.remaining}));
  const tables = items.filter(row => row.kind === 'table');
  const packages = items.filter(row => row.kind === 'package');
  return {
    tables,
    packages: {
      pending: packages.filter(row => row.packState !== 'Yolda'),
      enroute: packages.filter(row => row.packState === 'Yolda')
    }
  };
}
async function openTicketDetail(id) {
  if (!/^\d+$/.test(String(id))) throw new Error('Gecersiz adisyon numarasi.');
  const query = `SET NOCOUNT ON; SELECT COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),COALESCE(o.PortionName,''),COALESCE(o.Quantity,0),COALESCE(o.Price,0),COALESCE(o.Price*o.Quantity,0) FROM Orders o INNER JOIN Tickets t ON t.Id=o.TicketId WHERE t.Id=${Number(id)} AND t.IsClosed=0 ORDER BY o.OrderNumber,o.Id;`;
  return rows(await sql(query), ['name','portion','quantity','price','total']).map(row => ({...row,quantity:+row.quantity,price:+row.price,total:+row.total}));
}
async function notifications() {
  const query = `SET NOCOUNT ON; WITH N AS (SELECT CASE WHEN t.TicketStates LIKE '%ptal%' OR t.Note LIKE '%ptal%' THEN 'iptal' ELSE 'iade' END AS Kind,CONVERT(varchar(19),t.Date,120) AS EventDate,COALESCE(NULLIF(t.TicketNumber,''),CONVERT(varchar(20),t.Id)) AS TicketNumber,COALESCE(t.TotalAmount,0) AS Amount,COALESCE(NULLIF(t.Note,''),t.TicketStates,'') AS Detail FROM Tickets t WHERE t.TicketStates LIKE '%ade%' OR t.TicketStates LIKE '%ptal%' OR t.Note LIKE '%ade%' OR t.Note LIKE '%ptal%' UNION ALL SELECT CASE WHEN p.Name LIKE '%ptal%' THEN 'iptal' ELSE 'iade' END,CONVERT(varchar(19),p.Date,120),COALESCE(NULLIF(t.TicketNumber,''),CONVERT(varchar(20),p.TicketId)),p.Amount,COALESCE(p.Name,p.Description,'') FROM Payments p LEFT JOIN Tickets t ON t.Id=p.TicketId WHERE p.Amount<0 OR p.Name LIKE '%ade%' OR p.Name LIKE '%ptal%' OR p.Name LIKE '%refund%' UNION ALL SELECT CASE WHEN c.Name LIKE '%ptal%' THEN 'iptal' ELSE 'iade' END,CONVERT(varchar(19),c.Date,120),COALESCE(NULLIF(t.TicketNumber,''),CONVERT(varchar(20),c.TicketId)),c.Amount,COALESCE(c.Name,'') FROM ChangePayments c LEFT JOIN Tickets t ON t.Id=c.TicketId WHERE c.Name LIKE '%ade%' OR c.Name LIKE '%ptal%' OR c.Name LIKE '%refund%' UNION ALL SELECT CASE WHEN w.EndByName IS NULL THEN 'gun-basi' ELSE 'gun-sonu' END,CONVERT(varchar(19),COALESCE(w.EndDate,w.StartDate),120),CONVERT(varchar(20),w.WorkPeriodNumber),0,COALESCE(NULLIF(CASE WHEN w.EndByName IS NULL THEN w.StartDescription ELSE w.EndDescription END,''),CASE WHEN w.EndByName IS NULL THEN 'Gun basi yapildi' ELSE 'Gun sonu yapildi' END) FROM WorkPeriods w WHERE w.StartDate IS NOT NULL) SELECT TOP 100 Kind,EventDate,TicketNumber,Amount,Detail FROM N ORDER BY EventDate DESC;`;
  return rows(await sql(query), ['kind','date','ticket','amount','detail']).map(row => ({...row, id:`${row.kind}-${row.date}-${row.ticket}`, amount:+row.amount}));
}
const tunnelWatch = require('./tunnel-watch');
/* Kurye takip ayni bilgisayarda kuruluysa /api/internal/summary'sinden veri
   cekilir; kurulu degilse (ag hatasi/404) sessizce yok sayilir - bu ozellik
   olmadan da bulut gonderimi calismaya devam eder. */
async function courierSnapshot() {
  try {
    const res = await fetch(`${KURYE_INTERNAL_URL}/api/internal/summary`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
/* menuItems()'i cloud icin sadeleştirir: fiyat guncelleme aramasinda gruba/
   porsiyona ihtiyac yok, sadece isim/porsiyon/etiket/fiyat + price_id. */
async function cloudMenu() {
  try { return (await menuItems()).map(i => ({ priceId: i.priceId, itemId: i.itemId, portionId: i.portionId, name: i.name, portion: i.portion, tagLabel: i.tagLabel, price: i.price })); }
  catch { return []; }
}
async function cloudPush() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [sales, tables, notifs, courier, menu] = await Promise.all([
      report(today, today), openTables(), notifications(), courierSnapshot(), cloudMenu()
    ]);
    await fetch(`${CLOUD_SERVER_URL}/api/agent/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activationKey: CLOUD_ACTIVATION_KEY, sales, openTables: tables, notifications: notifs, courier, menu }),
      signal: AbortSignal.timeout(8000)
    });
  } catch { /* bulut ulasilamazsa restoranin kendi calismasini etkilemez, sonraki denemede devam eder */ }
}
/* ------------------------------------------------------- fiyat yonetimi ---- */
/* Sema: MenuItems -1:N- MenuItemPortions -1:N- MenuItemPrices (PriceTag NULL = standart,
   diger etiketler MenuItemPriceDefinitions'da adlandirilir, ör. PAKET = uzak musteri fiyati). */
async function menuItems() {
  const itemsQuery = `SET NOCOUNT ON; SELECT mi.Id,COALESCE(NULLIF(mi.Name,''),'Bilinmeyen'),mp.Id,COALESCE(NULLIF(mp.Name,''),'Normal'),pr.Id,COALESCE(pr.PriceTag,''),COALESCE(pr.Price,0) FROM MenuItems mi INNER JOIN MenuItemPortions mp ON mp.MenuItemId=mi.Id INNER JOIN MenuItemPrices pr ON pr.MenuItemPortionId=mp.Id ORDER BY mi.Name,mp.Name,pr.PriceTag;`;
  const tagsQuery = `SET NOCOUNT ON; SELECT PriceTag,COALESCE(NULLIF(Name,''),PriceTag) FROM MenuItemPriceDefinitions;`;
  const [itemsText, tagsText] = await Promise.all([sql(itemsQuery), sql(tagsQuery)]);
  const tagNames = Object.fromEntries(rows(tagsText, ['tag', 'name']).map(row => [row.tag, row.name]));
  return rows(itemsText, ['itemId', 'name', 'portionId', 'portion', 'priceId', 'tag', 'price']).map(row => ({
    ...row, price: +row.price, tagLabel: row.tag ? (tagNames[row.tag] || row.tag) : 'Standart'
  }));
}
async function updateMenuPrice(priceId, price) {
  if (!/^\d+$/.test(String(priceId))) throw new Error('Gecersiz fiyat kaydi.');
  if (!/^\d+(\.\d{1,2})?$/.test(String(price).trim())) throw new Error('Gecersiz fiyat formati.');
  const value = Number(price);
  if (!Number.isFinite(value) || value < 0 || value > 999999) throw new Error('Fiyat 0 ile 999999 arasinda olmali.');
  const query = `SET NOCOUNT ON; UPDATE MenuItemPrices SET Price=${value} OUTPUT deleted.Price,inserted.Price WHERE Id=${Number(priceId)};`;
  const result = rows(await sql(query), ['oldPrice', 'newPrice']);
  if (!result.length) throw new Error('Fiyat kaydi bulunamadi (silinmis olabilir).');
  return { oldPrice: +result[0].oldPrice, newPrice: +result[0].newPrice };
}
function logPriceChange(entry) {
  const clean = value => String(value || '').replace(/[\r\n|]/g, ' ').trim();
  const line = `${new Date().toISOString()} | ${clean(entry.name)} / ${clean(entry.portion)} / ${clean(entry.tagLabel)} | ${entry.oldPrice} -> ${entry.newPrice}\n`;
  fs.appendFileSync(path.join(RUNTIME_DIR, 'fiyat-degisiklikleri.log'), line, 'utf8');
}
function recentPriceLog(limit) {
  const file = path.join(RUNTIME_DIR, 'fiyat-degisiklikleri.log');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-limit).reverse();
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
/* patron.html hem telefonda hem masaustunde calisacak sekilde tasarlandi
   (bkz. patron.css @media(min-width:720px)) - eski index.html (masaustu
   icin ayri, bakimsiz kalmis bir dashboard) artik kullanilmiyor. */
function page(pathname){ if(pathname==='/'||pathname==='/patron'||pathname==='/masaustu')return 'public/patron.html'; return `public${pathname}`; }

/* ------------------------------------------------------------- giris (auth) ---- */
const AUTH_FILE = path.join(RUNTIME_DIR, 'patron-auth.json');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 saat, her istekte yenilenir
const LOCK_THRESHOLD = 5, LOCK_MS = 5 * 60 * 1000;
const sessions = new Map(); // token -> sonExpires
const attempts = new Map(); // ip -> {count, lockUntil}
const PUBLIC_PATHS = new Set(['/login', '/api/login', '/icon.svg', '/manifest.webmanifest']);

function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64).toString('hex'); }
function loadAuth() { try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch { return null; } }
function saveAuth(record) { fs.writeFileSync(AUTH_FILE, JSON.stringify(record, null, 2)); }
function newUserId() { return crypto.randomBytes(6).toString('hex'); }
/* Coklu kullanici destegi. ESKI dosya formati (tek kullanicili) {salt, hash,
   updatedAt} idi - burada TEK SEFERLIK, sessiz bir gecise (migration) tabi
   tutulur: eski kaydin sifresi/salt'i AYNEN korunarak "Patron" adinda tek bir
   kullaniciya donusturulur. Boylece zaten kurulu olan restoranlar guncelleme
   sonrasi DISARIDA KALMAZ - eski sifreleriyle ayni sekilde girmeye devam
   ederler, sadece artik birden fazla kullanici ekleyebilirler. */
function ensureAuth() {
  let data = loadAuth();
  if (data && data.salt && data.hash && !data.users) {
    data = { users: [{ id: newUserId(), name: 'Patron', salt: data.salt, hash: data.hash, createdAt: data.updatedAt || new Date().toISOString() }] };
    saveAuth(data);
  }
  if (data && Array.isArray(data.users) && data.users.length) return data;
  const pin = String(crypto.randomInt(100000, 1000000));
  const salt = crypto.randomBytes(16).toString('hex');
  const record = { users: [{ id: newUserId(), name: 'Patron', salt, hash: hashPassword(pin, salt), createdAt: new Date().toISOString() }] };
  saveAuth(record);
  const notice = `ENSARI POS PATRON - ILK GIRIS SIFRESI\n\nKullanici: Patron\nSifre: ${pin}\n\nBu dosyayi okuduktan sonra silin ve uygulama icinden (Ayarlar > Sifre degistir)\nsifreyi degistirin.\n\nOlusturulma: ${record.users[0].createdAt}\n`;
  fs.writeFileSync(path.join(RUNTIME_DIR, 'ILK-SIFRE.txt'), notice, 'utf8');
  console.log(`\n>>> Ilk giris sifresi: ${pin}\n>>> Ayrica su dosyaya yazildi: ${path.join(RUNTIME_DIR, 'ILK-SIFRE.txt')}\n`);
  return record;
}
let authData = ensureAuth();
function findUserById(id) { return authData.users.find(u => u.id === id); }
function findUserByName(name) { return authData.users.find(u => u.name.toLowerCase() === String(name || '').trim().toLowerCase()); }
function checkPassword(password, user) {
  if (!password || typeof password !== 'string' || !user) return false;
  const attempt = Buffer.from(hashPassword(password, user.salt), 'hex');
  const stored = Buffer.from(user.hash, 'hex');
  return attempt.length === stored.length && crypto.timingSafeEqual(attempt, stored);
}
/* Kullanici adi BOS gecilirse (eski giris ekranini hala kullanan bir sekme/
   PWA cache'i gibi) sifreyi TUM kullanicilara karsi dener - tek kullanicili
   kurulumlarda eski "sadece sifre" deneyimini degistirmeden korur. */
function findUserByCredentials(name, password) {
  if (name) { const user = findUserByName(name); return checkPassword(password, user) ? user : null; }
  return authData.users.find(u => checkPassword(password, u)) || null;
}
function parseCookies(req) {
  const header = req.headers.cookie, out = {};
  if (!header) return out;
  header.split(';').forEach(part => { const i = part.indexOf('='); if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); });
  return out;
}
function isHttps(req) { return req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted; }
function setSessionCookie(req, res, token) {
  const parts = [`patron_session=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(req, res) {
  const parts = ['patron_session=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function currentSession(req) {
  const token = parseCookies(req).patron_session;
  if (!token || !sessions.has(token)) return null;
  const record = sessions.get(token);
  if (record.expires < Date.now()) { sessions.delete(token); return null; }
  record.expires = Date.now() + SESSION_TTL_MS; // kaydirmali oturum
  return record;
}
function newSession(userId) { const token = crypto.randomBytes(24).toString('hex'); sessions.set(token, { userId, expires: Date.now() + SESSION_TTL_MS }); return token; }
/* Sadece BELIRLI bir kullanicinin oturumlarini kapatir (sifresini degistirdiginde
   ya da hesabi silindiginde) - eskiden TEK kullanici oldugu icin clearAllSessions()
   herkesi cikartiyordu; coklu kullanicida bu artik BASKA kullanicilari etkilememeli. */
function clearSessionsForUser(userId) { for (const [token, rec] of sessions) if (rec.userId === userId) sessions.delete(token); }
function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function lockedForMs(ip) { const state = attempts.get(ip); return state && state.lockUntil > Date.now() ? state.lockUntil - Date.now() : 0; }
function registerFail(ip) {
  const state = attempts.get(ip) || { count: 0, lockUntil: 0 };
  state.count += 1;
  if (state.count >= LOCK_THRESHOLD) { state.lockUntil = Date.now() + LOCK_MS; state.count = 0; }
  attempts.set(ip, state);
}
function registerSuccess(ip) { attempts.delete(ip); }
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(new Error('İstek çok büyük.')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

http.createServer(async(req,res)=>{try{
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = clientIp(req);

  if (u.pathname === '/api/login') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Yalnızca POST kabul edilir.' });
    const wait = lockedForMs(ip);
    if (wait > 0) return json(res, 429, { error: `Çok fazla hatalı deneme. ${Math.ceil(wait / 1000)} saniye sonra tekrar deneyin.` });
    const body = await readJsonBody(req);
    const user = findUserByCredentials(body.name, body.password);
    if (!user) { registerFail(ip); return json(res, 401, { error: 'Kullanıcı adı veya şifre hatalı.' }); }
    registerSuccess(ip);
    setSessionCookie(req, res, newSession(user.id));
    return json(res, 200, { ok: true, name: user.name });
  }
  if (u.pathname === '/api/logout') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Yalnızca POST kabul edilir.' });
    const token = parseCookies(req).patron_session;
    if (token) sessions.delete(token);
    clearSessionCookie(req, res);
    return json(res, 200, { ok: true });
  }

  const session = currentSession(req);
  if (!PUBLIC_PATHS.has(u.pathname) && !session) {
    if (u.pathname.startsWith('/api/')) return json(res, 401, { error: 'Oturum gerekli.' });
    res.writeHead(302, { Location: `/login?next=${encodeURIComponent(u.pathname + u.search)}` });
    return res.end();
  }

  if (u.pathname === '/api/change-password') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Yalnızca POST kabul edilir.' });
    const me = findUserById(session.userId);
    if (!me) return json(res, 401, { error: 'Oturum gerekli.' });
    const body = await readJsonBody(req);
    if (!checkPassword(body.current, me)) return json(res, 401, { error: 'Mevcut şifre hatalı.' });
    const next = String(body.next || '');
    if (next.length < 4) return json(res, 400, { error: 'Yeni şifre en az 4 karakter olmalı.' });
    const salt = crypto.randomBytes(16).toString('hex');
    me.salt = salt; me.hash = hashPassword(next, salt);
    saveAuth(authData);
    clearSessionsForUser(me.id); // sadece KENDI diger oturumlarini kapatir
    setSessionCookie(req, res, newSession(me.id));
    return json(res, 200, { ok: true });
  }

  /* Kullanici yonetimi - mevcut guven modeliyle AYNI: sifreyi bilen herkes
     zaten sifreyi degistirebiliyordu (yukarida), o yuzden kullanici
     ekleme/silme de ayni sekilde oturum acmis HERKESE acik - ayri bir
     "yonetici" rolu bu surumde yok, kapsam disi tutuldu. */
  if (u.pathname === '/api/users' && req.method === 'GET') {
    return json(res, 200, { users: authData.users.map(x => ({ id: x.id, name: x.name, createdAt: x.createdAt })) });
  }
  if (u.pathname === '/api/users' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    if (!name) return json(res, 400, { error: 'Kullanıcı adı gerekli.' });
    if (password.length < 4) return json(res, 400, { error: 'Şifre en az 4 karakter olmalı.' });
    if (findUserByName(name)) return json(res, 409, { error: 'Bu isimde bir kullanıcı zaten var.' });
    const salt = crypto.randomBytes(16).toString('hex');
    const newUser = { id: newUserId(), name, salt, hash: hashPassword(password, salt), createdAt: new Date().toISOString() };
    authData.users.push(newUser);
    saveAuth(authData);
    return json(res, 200, { ok: true, id: newUser.id });
  }
  if (u.pathname === '/api/users/remove') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Yalnızca POST kabul edilir.' });
    const body = await readJsonBody(req);
    const id = String(body.id || '');
    if (authData.users.length <= 1) return json(res, 400, { error: 'Son kullanıcı silinemez.' });
    const idx = authData.users.findIndex(x => x.id === id);
    if (idx === -1) return json(res, 404, { error: 'Kullanıcı bulunamadı.' });
    authData.users.splice(idx, 1);
    saveAuth(authData);
    clearSessionsForUser(id);
    return json(res, 200, { ok: true });
  }
  if (u.pathname === '/api/tunnel') {
    const readLink = name => { const file = path.join(RUNTIME_DIR, name); return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : ''; };
    /* config.json'da kalici bir domain (publicUrl) tanimliysa (Named Tunnel ile
       kurulmus bu restoranda oldugu gibi) her seyden once o gosterilir. */
    const stableUrl = config.publicUrl || readLink('tailscale-link.txt') || readLink('ddns-link.txt');
    return json(res, 200, { url: readLink('tunnel-link.txt') || config.publicUrl, stableUrl });
  }

  if(u.pathname==='/api/config')return json(res,200,{appName:APP_NAME});
  if(u.pathname==='/api/notifications')return json(res,200,{items:await notifications()});
  if(u.pathname==='/api/report'){const now=new Date(),today=now.toISOString().slice(0,10),start=validDate(u.searchParams.get('start'),today),end=validDate(u.searchParams.get('end'),today);if(start>end)return json(res,400,{error:'Baslangic tarihi bitis tarihinden buyuk olamaz.'});const hourStart=u.searchParams.get('hourStart'),hourEnd=u.searchParams.get('hourEnd');return json(res,200,await report(start,end,hourStart,hourEnd===null?hourStart:hourEnd));}
  if(u.pathname==='/api/price-changes'){const days=Math.min(Math.max(Number(u.searchParams.get('days')||90),1),365);return json(res,200,{days,changes:await priceChanges(days)});}
  if(u.pathname==='/api/open-tables')return json(res,200,await openTables());
  if(u.pathname==='/api/open-ticket'){return json(res,200,{items:await openTicketDetail(u.searchParams.get('id'))});}
  if(u.pathname==='/api/menu-items')return json(res,200,{items:await menuItems(), recent: recentPriceLog(15)});
  if(u.pathname==='/api/menu-price'){
    if (req.method !== 'POST') return json(res, 405, { error: 'Yalnızca POST kabul edilir.' });
    const body = await readJsonBody(req);
    try {
      const result = await updateMenuPrice(body.priceId, body.price);
      logPriceChange({ name: body.name, portion: body.portion, tagLabel: body.tagLabel, oldPrice: result.oldPrice, newPrice: result.newPrice });
      return json(res, 200, { ok: true, oldPrice: result.oldPrice, newPrice: result.newPrice });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  const file = u.pathname === '/login' ? path.join(ROOT, 'public/login.html') : path.join(ROOT, page(u.pathname));
  if(!file.startsWith(path.join(ROOT,'public')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Bulunamadi'});
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
  fs.createReadStream(file).pipe(res);
}catch(e){json(res,500,{error:e.message});}}).listen(PORT,'127.0.0.1',()=>console.log(`${APP_NAME}: http://127.0.0.1:${PORT}`));

if (CLOUD_ACTIVATION_KEY) {
  console.log(`Bulut gönderimi aktif: ${CLOUD_SERVER_URL}`);
  cloudPush();
  setInterval(cloudPush, 15000);
  // Ayri, izole bir modul - basarisiz olsa/coksekse bile yukaridaki cloudPush
  // dongusunu ETKILEMEZ (updater.js/menu-agent.js icin agent.js'deki ayni ilke).
  try { require('./patron-cloud').start({ activationKey: CLOUD_ACTIVATION_KEY, cloudServerUrl: CLOUD_SERVER_URL, menuItems, updateMenuPrice, logPriceChange, openTicketDetail, report }); }
  catch (error) { console.log('Patron canlı komut kanalı başlatılamadı (yoksayıldı):', error.message); }
}
tunnelWatch.start();
