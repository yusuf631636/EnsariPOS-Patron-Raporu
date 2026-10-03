/* Patron Direkt (bağımsız) - SambaPOS'a DOĞRUDAN bağlanan patron rapor uygulaması.
   Garson Direkt ile aynı mantık: exe/bulut yok, telefon aynı ağdan (ya da sabit IP ile)
   SambaPOS mesaj sunucusuna (IP:9000) bağlanır. Veri "Metrik" gibi SambaPOS'un kendi
   GraphQL'inden alınır (getTickets + getCustomReport). Patron kendi (yönetici) PIN'iyle girer.
   ES5 yazım (eski Android WebView). PIN hiçbir yere kaydedilmez. */
(function () {
    'use strict';
    var LS = window.localStorage;
    var CLIENT_ID = 'EnsariGarson';   // SambaPOS'ta kayıtlı ortak uygulama (Garson Direkt ile aynı kayıt)
    var APP_VERSION = '1.0.0';
    var RX = window.XMLHttpRequest;

    function jget(k, d) { try { var v = JSON.parse(LS.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
    function jset(k, v) { try { if (v == null) LS.removeItem(k); else LS.setItem(k, JSON.stringify(v)); } catch (e) { } }
    function form(o) { var a = []; for (var k in o) if (o.hasOwnProperty(k)) a.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k] == null ? '' : o[k])); return a.join('&'); }
    function gqlStr(s) { return JSON.stringify(String(s == null ? '' : s)); }
    function fold(s) { return String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/\s+/g, ' ').trim(); }

    var BG = window.BG = { version: APP_VERSION, clientId: CLIENT_ID, jget: jget, jset: jset, fold: fold };

    // ------------------------------------------------------------ bağlantı adresi
    BG.conn = function () { return jget('bgConn', null); };
    BG.parseHost = function (host, port) {
        var h = String(host || '').trim().replace(/\/+$/, '');
        if (!h) return null;
        if (/^https?:\/\//i.test(h)) return { host: h, port: null };
        var m = h.match(/^\[?([^\]\/]+?)\]?:(\d{1,5})$/);
        if (m) return { host: m[1], port: parseInt(m[2], 10) };
        return { host: h, port: parseInt(port, 10) || 9000 };
    };
    BG.base = function (c) {
        c = c || BG.conn();
        if (!c || !c.host) return '';
        if (/^https?:\/\//i.test(c.host)) return String(c.host).replace(/\/+$/, '');
        return 'http://' + c.host + ':' + (c.port || 9000);
    };
    BG.label = function (c) { c = c || BG.conn(); return c ? String(BG.base(c)).replace(/^https?:\/\//, '') : ''; };

    // ------------------------------------------------------------ düşük seviye istek
    BG.raw = function (method, url, headers, body, timeout, cb) {
        var x = new RX(), done = false;
        function fin(st, txt) { if (done) return; done = true; cb(st, txt || '', x); }
        try {
            x.open(method, url, true);
            for (var k in headers) if (headers.hasOwnProperty(k)) x.setRequestHeader(k, headers[k]);
            if (timeout) x.timeout = timeout;
            x.onreadystatechange = function () { if (x.readyState === 4) fin(x.status, x.responseText); };
            x.ontimeout = function () { fin(0, ''); };
            x.onerror = function () { fin(0, ''); };
            x.send(body == null ? null : body);
        } catch (e) { setTimeout(function () { fin(0, ''); }, 0); }
        return x;
    };
    BG.probe = function (base, timeout, cb) {
        BG.raw('GET', base + '/signalr/negotiate?clientProtocol=1.5&connectionData=%5B%5D&_=' + Date.now(), {}, null, timeout || 2500, function (st, txt) {
            cb(st === 200 && /ConnectionToken/.test(txt));
        });
    };

    // ------------------------------------------------------------ token (bağlantı kullanıcısı)
    function tokenError(st, txt) {
        if (st === 0) return 'SambaPOS mesaj sunucusuna ulaşılamıyor (' + BG.label() + '). Bilgisayar ve SambaPOS açık mı, telefon aynı ağda mı?';
        var e = {}; try { e = JSON.parse(txt || '{}'); } catch (x) { }
        if (e.error === 'invalid_client') return 'SambaPOS\'ta "' + CLIENT_ID + '" uygulama kaydı yok. Restoran bilgisayarında hazırlık aracını bir kez çalıştırın.';
        if (e.error === 'invalid_grant') return 'Bağlantı kullanıcısı adı veya şifresi hatalı. (SambaPOS kullanıcısının "Şifre" alanı yazılır, PIN değil.)';
        return 'SambaPOS girişi reddetti: ' + (e.error_description || e.error || ('HTTP ' + st));
    }
    var tokWait = null;
    BG.login = function (c, cb) {   // cb(err, tok)
        BG.raw('POST', BG.base(c) + '/Token', { 'Content-Type': 'application/x-www-form-urlencoded' },
            form({ grant_type: 'password', client_id: CLIENT_ID, username: c.user, password: c.pass }), 12000, function (st, txt) {
                var t = null; try { t = JSON.parse(txt); } catch (e) { }
                if (st === 200 && t && t.access_token) return cb(null, { access: t.access_token, exp: Date.now() + Math.max(60, (t.expires_in || 3600) - 120) * 1000 });
                cb(tokenError(st, txt));
            });
    };
    BG.token = function (cb, force) {
        var t = jget('bgTok', null);
        if (!force && t && t.access && t.exp > Date.now() && t.base === BG.base()) return cb(t.access);
        if (tokWait) { tokWait.push(cb); return; }
        var c = BG.conn();
        if (!c || !c.user) return cb(null, 'Bağlantı ayarı yapılmamış.');
        tokWait = [cb];
        BG.login(c, function (err, tok) {
            if (tok) { tok.base = BG.base(c); jset('bgTok', tok); }
            var list = tokWait; tokWait = null;
            list.forEach(function (f) { f(tok ? tok.access : null, err); });
        });
    };
    BG.gql = function (query, cb) {   // cb(err, data, errors)
        BG.token(function (tok, err) {
            if (!tok) return cb(err || 'Token alınamadı.');
            (function send(tk, retried) {
                BG.raw('POST', BG.base() + '/api/graphql', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tk },
                    JSON.stringify({ query: query }), 25000, function (st, txt) {
                        if (st === 401 && !retried) return BG.token(function (t2, e2) { if (!t2) cb(e2); else send(t2, true); }, true);
                        if (st === 0) return cb('SambaPOS mesaj sunucusuna ulaşılamıyor.');
                        var r = null; try { r = JSON.parse(txt); } catch (e) { }
                        if (!r) return cb('SambaPOS cevabı okunamadı (HTTP ' + st + ').');
                        if (r.errors && r.errors.length && !r.data) {
                            var m = r.errors[0].message || 'GraphQL hatası';
                            if (/authorization is required|auth-required|access get/i.test(m))
                                m = 'Bağlantı kullanıcısının yönetici yetkisi yok. SambaPOS\'ta bu uygulamanın bağlantı kullanıcısını Yönetici (Admin) rolüne alın.';
                            return cb(m);
                        }
                        cb(null, r.data || {}, r.errors);
                    });
            })(tok, false);
        });
    };

    // ------------------------------------------------------------ PIN -> SambaPOS kullanıcısı (yönetici kontrolü)
    var LOCK_KEY = 'bgPinFail';
    function lockedSeconds() { var f = jget(LOCK_KEY, null); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; }
    function pinFail() { var f = jget(LOCK_KEY, { n: 0 }); f.n = (f.n || 0) + 1; if (f.n >= 5) f.until = Date.now() + 30000 * Math.min(10, f.n - 4); jset(LOCK_KEY, f); }
    BG.userByPin = function (pin, cb) {   // cb(err, user)
        var w = lockedSeconds();
        if (w) return cb('Çok fazla hatalı deneme. ' + w + ' saniye sonra tekrar deneyin.', null, 429);
        if (!/^\d{1,12}$/.test(pin || '')) { pinFail(); return cb('PIN hatalı.', null, 401); }
        BG.gql('{u:getUser(pin:' + gqlStr(pin) + '){name userRole{id name isAdmin}}}', function (err, d) {
            if (err) return cb(err, null, 502);
            var u = d && d.u;
            if (!u || !u.name || u.name === '*') { pinFail(); return cb('PIN hatalı.', null, 401); }
            jset(LOCK_KEY, null);
            var role = u.userRole || {};
            var isAdmin = role.isAdmin != null ? !!role.isAdmin : /admin|yonetici|patron|mudur|sahip/.test(fold(role.name));
            cb(null, { userName: u.name, roleId: role.id || 0, roleName: role.name || '', isAdmin: isAdmin });
        });
    };

    // ------------------------------------------------------------ ağ taraması (Sunucu Bul)
    BG.myIp = function (cb) {
        var ni = window.networkinterface, called = false;
        function once(v) { if (!called) { called = true; cb(typeof v === 'string' ? v : (v && v.ip) || null); } }
        if (!ni || !ni.getWiFiIPAddress) return once(null);
        setTimeout(function () { once(null); }, 3000);
        try { ni.getWiFiIPAddress(once, function () { once(null); }); } catch (e) { once(null); }
    };
    BG.scan = function (port, onFound, onDone, onProgress) {
        port = parseInt(port, 10) || 9000;
        BG.myIp(function (ip) {
            var m = /^(\d+\.\d+\.\d+)\.(\d+)$/.exec(String(ip || ''));
            if (!m) return onDone({ scanned: false, ip: ip });
            var pre = m[1], list = [], i, next = 0, active = 0, done = 0, found = [], mine = parseInt(m[2], 10);
            for (i = 1; i < 255; i++) list.push(i);
            list.sort(function (a, b) { return Math.abs(a - mine) - Math.abs(b - mine); });
            function pump() {
                while (active < 32 && next < list.length) {
                    (function (host) {
                        active++;
                        BG.probe('http://' + host + ':' + port, 1800, function (ok) {
                            active--; done++;
                            if (ok) { found.push(host); onFound(host, port); }
                            if (onProgress) onProgress(done, list.length);
                            if (done === list.length) onDone({ scanned: true, ip: ip, found: found, port: port });
                            else pump();
                        });
                    })(pre + '.' + list[next++]);
                }
            }
            pump();
        });
    };

    // ------------------------------------------------------------ oturum (patron girişi)
    var SESSION_MS = 12 * 3600 * 1000;
    BG.session = function () { var s = jget('bgSession', null); return s && s.exp > Date.now() ? s : null; };
    BG.setSession = function (u) { jset('bgSession', { userName: u.userName, roleName: u.roleName, isAdmin: u.isAdmin, exp: Date.now() + SESSION_MS }); };
    BG.logout = function () { jset('bgSession', null); };

    // ------------------------------------------------------------ RAPOR: SambaPOS'tan veri (Metrik mantığı)
    // Patron raporlari getTickets'tan (dogrudan SambaPOS GraphQL) cekilip telefonda ozetlenir.
    // Tarih araligi: {start:Date, end:Date}. SambaPOS 'start'/'end' ISO ister.
    function iso(d) { // yerel saat, SambaPOS sunucusuyla ayni makine mantigi
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }
    BG.rangeDates = function (key) {
        var now = new Date(), s = new Date(now), e = new Date(now);
        s.setHours(0, 0, 0, 0); e.setHours(23, 59, 59, 0);
        if (key === 'dun') { s.setDate(s.getDate() - 1); e.setDate(e.getDate() - 1); }
        else if (key === '7gun') { s.setDate(s.getDate() - 6); }
        else if (key === 'ay') { s.setDate(1); }
        else if (key === 'gecenay') { s.setMonth(s.getMonth() - 1, 1); e = new Date(s.getFullYear(), s.getMonth() + 1, 0, 23, 59, 59); }
        return { start: s, end: e };
    };
    // Adisyonlari getir (gerekirse sayfalayarak) ve ozetle
    BG.report = function (range, cb) {   // cb(err, summary)
        var r = BG.rangeDates(range), startISO = iso(r.start), endISO = iso(r.end);
        var all = [], PAGE = 500;
        function page(skip) {
            var q = '{t:getTickets(start:' + gqlStr(startISO) + ',end:' + gqlStr(endISO) + ',isClosed:true,take:' + PAGE + ',skip:' + skip + ',orderBy:"Id")' +
                '{date totalAmount remainingAmount orders{name quantity price user} payments{name amount} calculations{name calculationAmount} entities{name type}}}';
            BG.gql(q, function (err, d) {
                if (err) return cb(err);
                var list = (d && d.t) || [];
                all = all.concat(list);
                if (list.length === PAGE && all.length < 8000) return page(skip + PAGE);
                finish();
            });
        }
        function finish() {
            // acik masalar (bekleyen tutar) ayri sorgu
            BG.gql('{o:getTickets(isClosed:false,take:2000){totalAmount remainingAmount date entities{name type}}}', function (e2, d2) {
                var open = (d2 && d2.o) || [];
                cb(null, BG.summarize(all, open, r));
            });
        }
        page(0);
    };
    BG.summarize = function (closed, open, range) {
        var sum = 0, cnt = closed.length, remain = 0;
        var pay = {}, hour = {}, prod = {}, staff = {}, calc = {}, daily = {};
        function add(map, key, field, val) { key = key || 'Bilinmeyen'; (map[key] || (map[key] = { name: key, qty: 0, total: 0 }))[field] += (Number(val) || 0); }
        closed.forEach(function (t) {
            var tot = Number(t.totalAmount) || 0; sum += tot; remain += Number(t.remainingAmount) || 0;
            var d = t.date ? new Date(t.date) : null;
            if (d && !isNaN(d)) { var h = d.getHours(); hour[h] = (hour[h] || 0) + tot; var dk = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); daily[dk] = (daily[dk] || 0) + tot; }
            (t.payments || []).forEach(function (p) { add(pay, p.name, 'total', p.amount); });
            (t.orders || []).forEach(function (o) {
                var line = (Number(o.price) || 0) * (Number(o.quantity) || 0);
                var pr = prod[o.name] || (prod[o.name] = { name: o.name || 'Bilinmeyen', qty: 0, total: 0 }); pr.qty += Number(o.quantity) || 0; pr.total += line;
                var st = staff[o.user] || (staff[o.user] = { name: o.user || 'Bilinmeyen', qty: 0, total: 0 }); st.total += line;
            });
            (t.calculations || []).forEach(function (c) { add(calc, c.name, 'total', c.calculationAmount); });
        });
        var openCnt = open.length, openRemain = 0;
        open.forEach(function (t) { openRemain += (Number(t.remainingAmount) || Number(t.totalAmount) || 0); });
        function arr(map) { var a = []; for (var k in map) if (map.hasOwnProperty(k)) a.push(map[k]); return a; }
        function topBy(map, f, n) { return arr(map).sort(function (a, b) { return b[f] - a[f]; }).slice(0, n || 100); }
        return {
            range: range, ciro: sum, adisyon: cnt, ortalama: cnt ? sum / cnt : 0, bekleyenTutar: remain,
            odemeler: topBy(pay, 'total'), saatlik: hour, gunluk: daily,
            urunler: topBy(prod, 'qty', 50), personel: topBy(staff, 'total', 50), hesaplamalar: topBy(calc, 'total'),
            acikMasa: openCnt, acikTutar: openRemain
        };
    };

    // ------------------------------------------------------------ ilk açılış yönlendirmesi
    BG.needsSetup = function () { var c = BG.conn(); return !(c && c.user); };
    document.addEventListener('deviceready', function () {
        document.addEventListener('backbutton', function () {
            var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
            if (page === 'index.html' || page === 'kurulum.html') { if (navigator.app && navigator.app.exitApp) navigator.app.exitApp(); }
            else history.back();
        }, false);
    }, false);
})();
