/* Patron 2.2 paneli (30.09.2026). Samba Patron / Metrik / Toast / Lightspeed / Menulux'un rapor setleri ornek alinarak:
   Ana Sayfa (canli ciro, kiyas, uyarilar), Canli (masa sureleri, paket), Raporlar (21 rapor, kategorili menu, akilli ozet,
   grafikler, her satirdan DETAYA INME: urun -> urun raporu, personel -> personel raporu, gun -> o gunun kasasi,
   saat -> o saatte satilanlar, adisyon -> tam log), Fiyat (tekli + toplu + gecmis), Bildirim (liste + telefona push).
   Tum veri bu bilgisayardaki PatronSrv.exe'den (SambaPOS SQL) gelir. Adres: #ana #canli #rapor #rapor/<tur> #fiyat #bildirim */
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const money = n => nf2.format(Number(n) || 0) + ' ₺';
const m2 = n => nf2.format(Number(n) || 0);
const m0 = n => nf0.format(Number(n) || 0) + ' ₺';
const mk = n => { n = Number(n) || 0; const a = Math.abs(n); return a >= 1e6 ? nf1.format(n / 1e6) + ' Mn ₺' : a >= 1e4 ? nf1.format(n / 1e3) + ' B ₺' : m0(n); };
const num = n => nf1.format(Number(n) || 0);
const pct1 = (a, b) => b ? nf1.format(a / b * 100) : '0';
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : null; };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const nDays = r => Math.round((parse(r.end) - parse(r.start)) / 86400000) + 1;
const dur = min => { min = Math.max(0, Math.round(min)); return min < 60 ? `${min} dk` : `${Math.floor(min / 60)} sa ${min % 60} dk`; };
const sum = (l, k) => (l || []).reduce((a, x) => a + (+x[k] || 0), 0);
const GUN = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const GUN3 = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const DOW = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];   // sunucu: 0=Pazartesi
const AY3 = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const COL = ['#4f8cff', '#22c55e', '#f59e0b', '#a78bfa', '#2dd4bf', '#f472b6', '#ef4444', '#94a3b8'];
const KIND = { iptal: 'İptal', iade: 'İade', ikram: 'İkram', zayi: 'Zayi', iskonto: 'İskonto', 'gun-basi': 'Gün başı', 'gun-sonu': 'Gün sonu', bekleyen: 'Bekleyen masa', 'eksi-stok': 'Eksi stok', fiyat: 'Fiyat değişti' };
const MONEYK = ['iptal', 'iade', 'ikram', 'zayi', 'iskonto'], OPSK = ['bekleyen', 'eksi-stok', 'fiyat'], PLAINK = ['gun-basi', 'gun-sonu', 'eksi-stok', 'fiyat'];   // 2.4
const KICON = { iptal: '❌', iade: '↩️', ikram: '🧡', zayi: '🗑️', iskonto: '💸', 'gun-basi': '🌅', 'gun-sonu': '🌓', bekleyen: '⏰', 'eksi-stok': '📉', fiyat: '🏷' };
const KCOL = { iptal: '#ef4444', iade: '#a78bfa', ikram: '#f59e0b', zayi: '#b08968', iskonto: '#4f8cff', bekleyen: '#f97316', 'eksi-stok': '#e11d48', fiyat: '#2dd4bf' };
const tag = k => `<span class="tag ${esc(k)}">${esc(KIND[k] || k)}</span>`;
const fmtDay = s => { const d = parse(s); return d ? `${d.getDate()} ${AY3[d.getMonth()]} ${GUN3[d.getDay()]}` : ''; };
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* gizli mod */ } } };
const dr = (t, v) => ` data-dr="${t}" data-dv="${esc(v)}"`;   // detaya inme isareti

async function api(path, opt) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opt });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Bir hata oluştu.');
  return data;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
function delta(now, prev) {
  now = Number(now) || 0; prev = Number(prev) || 0;
  if (prev <= 0) return { cls: 'flat', txt: now > 0 ? 'yeni' : '—', p: 0 };
  const p = (now - prev) / prev * 100;
  if (Math.abs(p) < 0.5) return { cls: 'flat', txt: '＝ aynı', p: 0 };
  return { cls: p > 0 ? 'up' : 'down', txt: `${p > 0 ? '▲' : '▼'} %${nf1.format(Math.abs(p))}`, p };
}
const skel = (n = 3) => Array.from({ length: n }, (_, i) => `<div class="sk" style="height:${i ? 140 : 90}px;margin-bottom:12px"></div>`).join('');

/* ================================================================== GRAFIKLER */
function donut(items, val, lbl, opt = {}) {
  let list = items.filter(x => Math.abs(+x[val] || 0) > 0).map(x => ({ n: lbl(x), v: Math.abs(+x[val] || 0), x }));
  if (!list.length) return '<p class="empty">Kayıt yok.</p>';
  list.sort((a, b) => b.v - a.v);
  if (list.length > 6) { const rest = list.slice(5); list = list.slice(0, 5).concat([{ n: 'Diğer', v: rest.reduce((a, b) => a + b.v, 0) }]); }
  const tot = list.reduce((a, b) => a + b.v, 0), R = 52, C = 2 * Math.PI * R; let off = 0;
  const arcs = list.map((it, i) => { const len = it.v / tot * C; const s = `<circle r="${R}" cx="66" cy="66" fill="none" stroke="${opt.colors ? opt.colors(it.x, i) : COL[i % COL.length]}" stroke-width="18" stroke-dasharray="${Math.max(0, len - 1.5).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 66 66)"><title>${esc(it.n)}: ${money(it.v)}</title></circle>`; off += len; return s; }).join('');
  return `<div class="donut"><svg viewBox="0 0 132 132" width="132" height="132">${arcs}<text x="66" y="62" text-anchor="middle" font-size="10" fill="var(--mut)">${esc(opt.center || 'Toplam')}</text><text x="66" y="79" text-anchor="middle" font-size="15" font-weight="800" fill="var(--ink)">${esc(opt.fmt ? opt.fmt(tot) : mk(tot))}</text></svg>
    <div class="dl">${list.map((it, i) => `<div${opt.drill && it.x ? dr(opt.drill, lbl(it.x)) : ''} style="${opt.drill && it.x ? 'cursor:pointer' : ''}"><i style="background:${opt.colors && it.x ? opt.colors(it.x, i) : COL[i % COL.length]}"></i><span>${esc(it.n)}</span><b>${pct1(it.v, tot)}%<small>${opt.fmt ? opt.fmt(it.v) : mk(it.v)}</small></b></div>`).join('')}</div></div>`;
}
function vbars(items, key, lbl, opt = {}) {
  if (!items.length) return '<p class="empty">Kayıt yok.</p>';
  const W = 340, H = opt.h || 150, T = 18, B = 18, n = items.length, gap = n > 24 ? 2 : n > 12 ? 4 : 7, bw = (W - gap * (n + 1)) / n;
  const max = Math.max(1, ...items.map(i => +i[key] || 0)), best = items.reduce((a, b) => ((+b[key] || 0) > (+a[key] || 0) ? b : a), items[0]), every = Math.ceil(n / (opt.labels || 8));
  const fmt = opt.fmt || mk;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
    ${[0.25, 0.5, 0.75].map(g => `<line x1="0" x2="${W}" y1="${(T + (H - T - B) * g).toFixed(1)}" y2="${(T + (H - T - B) * g).toFixed(1)}" stroke="var(--line)" stroke-dasharray="3 4"/>`).join('')}
    ${items.map((it, i) => {
      const v = +it[key] || 0, h = Math.max(2, v / max * (H - T - B)), x = gap + i * (bw + gap), isB = it === best && v > 0;
      return `<rect x="${x.toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(5, bw / 3).toFixed(1)}" fill="${isB ? (opt.best || 'var(--good)') : (opt.color || 'var(--acc)')}" opacity="${isB ? 1 : .85}"${opt.drill ? dr(opt.drill, opt.dv(it)) + ' style="cursor:pointer"' : ''}><title>${esc(lbl(it))}: ${fmt(v)}</title></rect>` +
        (isB && bw > 8 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(H - B - h - 5).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="var(--ink2)">${esc(fmt(v))}</text>` : '') +
        (i % every === 0 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="var(--mut)">${esc(lbl(it))}</text>` : '');
    }).join('')}</svg>${opt.drill ? '<p class="note" style="margin-top:2px">Çubuğa dokunun: detay</p>' : ''}`;
}
/* cizgi: a (ana) + b (kiyas, kesikli); noktalar {l, v} */
function lineChart(a, b, opt = {}) {
  const pts = a.concat(b || []); if (!pts.length) return '<p class="empty">Kayıt yok.</p>';
  const W = 340, H = opt.h || 150, T = 20, B = 18, n = Math.max(a.length, (b || []).length), max = Math.max(1, ...pts.map(p => p.v));
  const X = i => 8 + (n > 1 ? i / (n - 1) : 0.5) * (W - 16), Y = v => T + (1 - v / max) * (H - T - B);
  const path = l => l.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const every = Math.ceil(n / 7), pk = a.reduce((m, p, i) => (p.v > a[m].v ? i : m), 0);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
    <defs><linearGradient id="lg${opt.id || 0}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--acc)" stop-opacity=".35"/><stop offset="1" stop-color="var(--acc)" stop-opacity="0"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map(g => `<line x1="0" x2="${W}" y1="${(T + (H - T - B) * g).toFixed(1)}" y2="${(T + (H - T - B) * g).toFixed(1)}" stroke="var(--line)" stroke-dasharray="3 4"/>`).join('')}
    ${b && b.length ? `<path d="${path(b)}" fill="none" stroke="var(--mut)" stroke-width="1.6" stroke-dasharray="5 4"/>` : ''}
    ${a.length > 1 ? `<path d="${path(a)}L${X(a.length - 1).toFixed(1)},${H - B}L${X(0).toFixed(1)},${H - B}Z" fill="url(#lg${opt.id || 0})"/>` : ''}
    <path d="${path(a)}" fill="none" stroke="var(--acc)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
    ${a.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${i === pk ? 4 : 2.2}" fill="${i === pk ? 'var(--good)' : 'var(--acc)'}"${opt.drill && p.k ? dr(opt.drill, p.k) + ' style="cursor:pointer"' : ''}><title>${esc(p.l)}: ${(opt.fmt || money)(p.v)}</title></circle>`).join('')}
    ${a[pk] && a[pk].v ? `<text x="${Math.min(Math.max(X(pk), 30), W - 30).toFixed(1)}" y="${Math.max(Y(a[pk].v) - 8, 11).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--ink2)">${esc((opt.fmt || mk)(a[pk].v))}</text>` : ''}
    ${a.map((p, i) => i % every === 0 || i === a.length - 1 ? `<text x="${X(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="var(--mut)">${esc(p.l)}</text>` : '').join('')}</svg>
    ${opt.legend ? `<div class="legend"><span><i style="background:var(--acc)"></i>${esc(opt.legend[0])}</span>${b && b.length ? `<span><i style="background:var(--mut)"></i>${esc(opt.legend[1])}</span>` : ''}</div>` : ''}`;
}
function ranks(items, o) {
  if (!items.length) return '<p class="empty">Kayıt yok.</p>';
  const lim = o.limit || 8, max = Math.max(1, ...items.map(x => Math.abs(+x[o.val] || 0)));
  return items.slice(0, lim).map((x, i) => `<div class="rank"${o.drill ? dr(o.drill, o.dv ? o.dv(x) : o.name(x)) : ''}><span class="no">${i + 1}</span><div class="nm"><div>${esc(o.name(x))}</div>${o.sub ? `<div class="mut" style="font-size:11.5px">${o.sub(x)}</div>` : ''}<div class="bar2"><i style="width:${(Math.abs(+x[o.val] || 0) / max * 100).toFixed(1)}%;background:${o.color || COL[i % COL.length]}"></i></div></div><div class="v">${(o.fmt || money)(x[o.val])}${o.right ? `<small>${o.right(x)}</small>` : ''}</div></div>`).join('');
}
/* tablo: cols [{l, n:1}], rows [{c:[html], dr, dv}], opt {total, limit, sub} */
function tbl(title, cols, rows, opt = {}) {
  const lim = opt.limit === 0 ? 1e9 : (opt.limit || 10);
  if (!rows.length) return `<div class="tb"><div class="th">${esc(title)}</div><p class="empty">Bu aralıkta kayıt yok.</p></div>`;
  return `<div class="tb"><div class="th"><span>${esc(title)}</span><small>${opt.sub || rows.length + ' satır'}</small></div><table><thead><tr>${cols.map(c => `<th class="${c.n ? 'n' : ''}">${esc(c.l)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr class="${r.dr ? 'click' : ''}${i >= lim ? ' hid hide' : ''}"${r.dr ? dr(r.dr, r.dv) : ''}>${r.c.map((v, j) => `<td class="${cols[j] && cols[j].n ? 'n' : ''}">${v}</td>`).join('')}</tr>`).join('')}${opt.total ? `<tr class="tot">${opt.total.map((v, j) => `<td class="${cols[j] && cols[j].n ? 'n' : ''}">${v}</td>`).join('')}</tr>` : ''}</tbody></table>${rows.length > lim ? `<button class="more">Tümünü göster (${rows.length}) ▾</button>` : ''}</div>`;
}
const pcell = (v, tot) => { const p = tot ? Math.abs(v) / tot * 100 : 0; return `<div class="pc"><i style="width:${Math.max(2, Math.min(60, p * 0.6)).toFixed(0)}px"></i><span>${nf1.format(p)}%</span></div>`; };
const kpi = (ic, col, l, v, d, extra) => `<div class="kpi"><div class="ic" style="background:${col}22;color:${col}">${ic}</div><div class="l">${esc(l)}</div><div class="v">${v}</div>${d ? `<div class="d ${d.cls}">${d.txt} <span class="mut" style="font-weight:500">${esc(extra || 'önceki döneme göre')}</span></div>` : extra ? `<div class="d mut" style="font-weight:500">${extra}</div>` : ''}</div>`;
const insight = list => { list = list.filter(Boolean); return list.length ? `<div class="insight">💡 <b>Özet</b><ul>${list.map(x => `<li>${x}</li>`).join('')}</ul></div>` : ''; };
const card = (title, body, small) => `<div class="card"><div class="ch"><span>${title}</span>${small ? `<small>${small}</small>` : ''}</div>${body}</div>`;
document.addEventListener('click', e => { const m = e.target.closest('.tb .more'); if (!m) return; m.closest('.tb').querySelectorAll('tr.hid').forEach(tr => tr.classList.remove('hide', 'hid')); m.remove(); });

/* ================================================================== YONLENDIRME (#adres) */
let view = 'ana', home = null, homeAt = 0, appName = 'Patron', barSub = '';
const VIEWS = ['ana', 'canli', 'rapor', 'fiyat', 'bildirim'];
function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }
function route() {
  const h = decodeURIComponent(location.hash.replace(/^#/, '')), [v, k] = h.split('/');
  view = VIEWS.includes(v) ? v : 'ana';
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + view));
  closeSheets();
  if (view === 'rapor') { if (k && REP[k] && !REP[k].hidden) openReport(k); else { repKind = null; $('repPage').classList.add('hide'); $('repMenu').classList.remove('hide'); renderRepMenu(); } }
  if (view === 'fiyat') loadMenu();
  if (view === 'bildirim') { renderNotes(); renderPush(); store.set('p3-seen', noteKeyTop()); }
  renderNoteCount(); setBar(); window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
$('nav').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) go('#' + b.dataset.v); });
function setBar() {
  const t = $('barTitle');
  if (view === 'rapor' && repKind) t.innerHTML = `<button class="back" onclick="history.length>1?history.back():go('#rapor')" aria-label="Geri">‹</button><div style="min-width:0"><span class="nm">${esc(REP[repKind].t)}</span><span class="sub">${esc(appName)}</span></div>`;
  else t.innerHTML = `<img src="/icons/icon-192.png" alt=""><div style="min-width:0"><span class="nm">${esc(appName)}</span><span class="sub">${esc(barSub || 'Patron')}</span></div>`;
}
$('refresh').onclick = async () => {
  const b = $('refresh'); b.classList.add('spin');
  await loadHome();
  if (view === 'rapor' && repKind) runReport();
  if (view === 'fiyat') loadMenu(true);
  setTimeout(() => b.classList.remove('spin'), 400);
};

/* ================================================================== ANA SAYFA */
async function loadHome() {
  try {
    const [h] = await Promise.all([api('/api/home'), loadFeed()]); home = h; homeAt = Date.now();
    appName = home.appName || 'Patron'; document.title = appName;
    renderHome(); renderLive(); renderNoteCount(); if (view === 'bildirim') renderNotes();
    setLive(true);
  } catch (err) { setLive(false); if (!home) $('homeBox').innerHTML = `<div class="errbox">⚠️ ${esc(err.message)}</div>`; }
  setBar();
}
function setLive(ok) { const l = $('live'); l.className = 'live' + (ok ? '' : ' off'); l.querySelector('span').textContent = ok ? 'canlı' : 'bağlantı yok'; }
function restNow() { const c = home && parse(home.clock); return c ? new Date(c.getTime() + (Date.now() - homeAt)) : new Date(); }
function baseToday() { return (home && home.sales && home.sales.range && home.sales.range.start) || ymd(new Date()); }
function sparkHero(today, yest) {
  const t = {}, y = {}; (today || []).forEach(h => { t[h.hour] = +h.amount || 0; }); (yest || []).forEach(h => { y[h.hour] = +h.amount || 0; });
  const hs = Object.keys(t).concat(Object.keys(y)).map(Number); if (!hs.length) return '';
  let h0 = Math.min(...hs), h1 = Math.max(...hs); if (h1 === h0) { h0 = Math.max(0, h0 - 1); h1 = Math.min(23, h1 + 1); }
  const W = 320, H = 64, n = h1 - h0, max = Math.max(1, ...Object.values(t), ...Object.values(y)), X = h => 4 + (h - h0) / n * (W - 8), Y = v => 6 + (1 - v / max) * (H - 18);
  const p = o => Array.from({ length: n + 1 }, (_, i) => `${i ? 'L' : 'M'}${X(h0 + i).toFixed(1)},${Y(o[h0 + i] || 0).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">${Object.keys(y).length ? `<path d="${p(y)}" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.4" stroke-dasharray="4 3"/>` : ''}<path d="${p(t)}L${X(h1)},${H - 12}L${X(h0)},${H - 12}Z" fill="rgba(255,255,255,.14)"/><path d="${p(t)}" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>${[h0, Math.round((h0 + h1) / 2), h1].map((h, i) => `<text x="${X(h)}" y="${H - 1}" text-anchor="${['start', 'middle', 'end'][i]}" font-size="9" fill="rgba(255,255,255,.7)">${pad2(h)}:00</text>`).join('')}</svg>`;
}
/* ---- 2.3 ana sayfa: kutu (bento) duzeni, hedef halkasi, gun sonu tahmini, ay karti, canli akis, duzenlenebilir kartlar */
const HOME_CARDS = [['hero', 'Ciro + hedef'], ['kpis', 'Göstergeler'], ['alerts', 'Uyarılar'], ['month', 'Bu ay'], ['feed', 'Canlı akış'], ['pay', 'Ödeme dağılımı'], ['week', 'Son 7 gün'], ['top', 'En çok satan'], ['staff', 'Personel'], ['quick', 'Hızlı raporlar']];
function homeOrder() { const saved = store.get('p3-cards', null), ids = HOME_CARDS.map(c => c[0]); if (!saved) return ids.map(id => ({ id, on: true })); const l = saved.filter(x => ids.includes(x.id)); ids.forEach(id => { if (!l.some(x => x.id === id)) l.push({ id, on: true }); }); return l; }
let feed = [], feedAt = 0;
async function loadFeed() { try { feed = (await api('/api/feed?minutes=180')).items || []; feedAt = Date.now(); } catch { /* eski surum / hata: akis gizlenir */ } }
function ring(pct, size, label, sub) {
  const R = size / 2 - 7, C = 2 * Math.PI * R, p = Math.max(0, Math.min(1, pct));
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle r="${R}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="9"/><circle r="${R}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="47%" text-anchor="middle" font-size="${size / 5.2}" font-weight="800" fill="#fff">${label}</text><text x="50%" y="63%" text-anchor="middle" font-size="${size / 11}" fill="rgba(255,255,255,.8)">${sub}</text></svg>`;
}
const FEEDICON = { order: '🧾', payment: '💳', ikram: '🧡', iptal: '❌', iade: '↩️', zayi: '🗑️' };
function feedRow(x) {
  const t = String(x.date).slice(11, 16), k = x.type;
  const txt = k === 'payment' ? `<b>${esc(x.name)}</b> ödeme${x.table ? ' · ' + esc(x.table) : ''}` : `${num(x.quantity)} × <b>${esc(x.name)}</b>${x.table ? ' · ' + esc(x.table) : ''}${KIND[k] ? ' ' + tag(k) : ''}`;
  return `<div class="fd"${dr('ticket', x.id)}><span class="e ${k}">${FEEDICON[k] || '•'}</span><div class="x">${txt}<small>${t} · Fiş ${esc(x.ticket)}${x.user ? ' · ' + esc(x.user) : ''}</small></div><b class="${k === 'payment' ? 'up' : KIND[k] ? 'down' : ''}">${k === 'payment' ? '+' : ''}${mk(x.amount)}</b></div>`;
}
function renderHome() {
  const d = home; if (!d || !d.sales) { $('homeBox').innerHTML = skel(4); return; }
  const s = d.sales.summary || {}, c = d.compare || null, now = restNow(), today = d.sales.range && d.sales.range.start, set = d.settings || {};
  barSub = `${GUN[now.getDay()]}, ${now.getDate()} ${AY3[now.getMonth()]} · ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const total = (+s.sales || 0) + (+s.remaining || 0), pays = d.sales.payments || [];
  const ot = d.openTables || {}, tables = ot.tables || [], pk = ((ot.packages || {}).pending || []).concat((ot.packages || {}).enroute || []);
  const openSum = tables.concat(pk).reduce((a, t) => a + (+t.remaining || 0), 0);
  const tot = w => w ? (+w.sales || 0) + (+w.remaining || 0) : 0;
  let chips = '';
  if (c && c.yesterday) {
    const dy = delta(total, tot(c.yesterday)); chips += `<span class="chip ${dy.cls}">${dy.txt} dün</span>`;
    if (c.lastWeek) { const lw = delta(total, tot(c.lastWeek)); chips += `<span class="chip ${lw.cls}">${lw.txt} geçen ${GUN[now.getDay()].toLocaleLowerCase('tr')}</span>`; }
    if (c.lastYear && tot(c.lastYear) > 0) { const ly = delta(total, tot(c.lastYear)); chips += `<span class="chip ${ly.cls}">${ly.txt} geçen yıl</span>`; }
  }
  // gun sonu tahmini: 4 haftalik ayni gun deseni
  const fc = c && c.forecast, est = fc && fc.ratio > 0.08 ? total / fc.ratio : null;
  const target = +set.dailyTarget || 0, pct = target ? total / target : 0;
  const ev = (d.notifications || []).filter(n => today && String(n.date) >= today && MONEYK.includes(n.kind));
  const ops = {}; (d.notifications || []).filter(n => today && String(n.date) >= today && OPSK.includes(n.kind)).forEach(n => { ops[n.kind] = (ops[n.kind] || 0) + 1; });
  const evBy = {}; ev.forEach(n => { const b = evBy[n.kind] || (evBy[n.kind] = { n: 0, a: 0 }); b.n++; b.a += Math.abs(+n.amount || 0); });
  const gb = (d.notifications || []).find(n => n.kind === 'gun-basi' || n.kind === 'gun-sonu');
  const ages = tables.map(t => (now - parse(t.date)) / 60000).filter(isFinite).sort((a, b) => b - a);
  const products = d.sales.products || [], users = d.sales.users || [];
  const days = c && Array.isArray(c.days) ? (() => { const by = {}; c.days.forEach(x => { by[x.date] = x; }); const l = []; for (let i = 6; i >= 0; i--) { const dd = addDays(today, -i); l.push({ ...(by[dd] || { amount: 0, count: 0 }), date: dd, lbl: i ? GUN3[parse(dd).getDay()] : 'Bugün' }); } return l; })() : null;
  const avg7 = days ? sum(days.slice(0, 6), 'amount') / 6 : 0, yT = c && c.yesterday ? (+c.yesterday.tickets || 0) : null;
  const M = c && c.month, mNow = M ? tot(M.now) : 0, mTarget = +set.monthlyTarget || 0, mProj = M ? mNow / Math.max(1, M.day - 1 + (now.getHours() * 60 + now.getMinutes()) / 1440) * M.days : 0;
  const parts = {
    hero: `<div class="hero hero2"><div class="hl"><div class="biz"><span>Bugünkü ciro</span></div>
        <div class="n">${nf0.format(total)} <small>₺</small></div><div class="chips">${chips || '<span class="chip">kıyas verisi bekleniyor</span>'}</div>
        ${est ? `<div class="fc">🔮 Gün sonu tahmini <b>≈ ${mk(est)}</b>${fc.avgDay ? ` <span>· 4 hafta ort. ${mk(fc.avgDay)}</span>` : ''}</div>` : fc && fc.avgDay ? `<div class="fc">📊 Bu günün 4 haftalık ortalaması <b>${mk(fc.avgDay)}</b></div>` : ''}</div>
        <button class="hr" onclick="targetSheet()" title="Günlük hedef">${target ? ring(pct, 104, Math.round(pct * 100) + '%', 'hedef ' + mk(target)) : `<div class="notarget">🎯<span>Günlük hedef<br>belirle</span></div>`}</button>
        <div class="sp">${sparkHero(d.sales.hourly, c && c.yesterdayHourly)}</div>
        <div class="row"><span>Tahsil edilen <b>${money(s.sales)}</b></span><span>Açık bakiye <b>${money(s.remaining)}</b></span></div></div>`,
    kpis: `<div class="kpis">
        ${kpi('🧾', 'var(--acc)', 'Adisyon', num(s.tickets), yT !== null ? delta(s.tickets, yT) : null, 'düne göre')}
        ${kpi('🛒', '#22c55e', 'Ortalama fiş', money(s.average), c && c.yesterday && c.yesterday.tickets ? delta(s.average, c.yesterday.sales / c.yesterday.tickets) : null, 'düne göre')}
        <button class="kpi" onclick="go('#canli')"><div class="ic" style="background:#f59e0b22;color:#f59e0b">🍽</div><div class="l">Açık masa / paket</div><div class="v">${tables.length} / ${pk.length}</div><div class="d ${ages[0] > 90 ? 'down' : 'mut'}" style="font-weight:600">${ages.length ? 'en uzun ' + dur(ages[0]) : 'açık masa yok'}</div></button>
        ${kpi('⏳', '#a78bfa', 'Açıkta bekleyen', money(openSum), null, avg7 ? `7 gün ort. ${mk(avg7)}` : 'henüz ödenmedi')}</div>`,
    alerts: (Object.keys(evBy).length ? `<button class="strip bad" onclick="go('#bildirim')"><span class="e">⚠️</span><span class="x"><b>Bugün ${Object.keys(evBy).map(k => `${evBy[k].n} ${KIND[k].toLocaleLowerCase('tr')}`).join(', ')}</b><small>${esc(String(ev[0].date).slice(11, 16))} · Fiş ${esc(ev[0].ticket)} · ${esc(String(ev[0].detail || '').slice(0, 60))}</small></span><span class="a">${money(Object.values(evBy).reduce((a, b) => a + b.a, 0))} ›</span></button>` : '<div class="strip ok"><span class="e">✅</span><span class="x"><b>Bugün iptal / iade / ikram yok</b><small>Olursa telefonunuza bildirim gelebilir (Bildirim sekmesi)</small></span></div>') +
      (Object.keys(ops).length ? `<button class="strip warn2" onclick="go('#bildirim')"><span class="e">🔔</span><span class="x"><b>${Object.keys(ops).map(k => `${KICON[k]} ${ops[k]} ${KIND[k].toLocaleLowerCase('tr')}`).join(' · ')}</b><small>Bugünkü operasyon uyarıları — dokunun: ayrıntı</small></span><span class="a">›</span></button>` : '') +
      (gb ? `<div class="strip"><span class="e">${gb.kind === 'gun-basi' ? '🌅' : '🌓'}</span><span class="x"><b>${gb.kind === 'gun-basi' ? 'Gün başı yapıldı' : 'Gün sonu yapıldı'}</b><small>${esc(String(gb.date).slice(0, 16))}${gb.detail ? ' · ' + esc(gb.detail) : ''}</small></span><button class="btng" onclick="cashSheet()" style="flex:none">💵 Kasa say</button></div>` : ''),
    month: M ? card(`📅 ${AY3[now.getMonth()]} ${now.getFullYear()}`, `<div class="mo"><div><div class="mv">${mk(mNow)}</div><div class="mut" style="font-size:11.5px">${M.day}. gün / ${M.days} · ay sonu tahmini <b style="color:var(--ink)">${mk(mProj)}</b></div></div>${(() => { const dl = delta(mNow, tot(M.lastMonth)); return `<span class="chip2 ${dl.cls}">${dl.txt} geçen ayın aynı dönemi</span>`; })()}</div>
        <div class="pbar"><i style="width:${Math.min(100, mTarget ? mNow / mTarget * 100 : M.day / M.days * 100).toFixed(1)}%"></i>${mTarget ? `<em style="left:${Math.min(100, M.day / M.days * 100).toFixed(1)}%" title="bugüne kadar olması gereken"></em>` : ''}</div>
        <div class="mut" style="font-size:11.5px;display:flex;justify-content:space-between;margin-top:5px"><span>${mTarget ? `Aylık hedef ${mk(mTarget)} · %${pct1(mNow, mTarget)}` : `<a href="#" onclick="targetSheet();return false">🎯 Aylık hedef belirle</a>`}</span><span>geçen ay toplam ${mk(tot(M.lastMonthTotal))}</span></div>`, `<button class="lnk" onclick="go('#rapor/takvim')">takvim ›</button>`) : '',
    feed: feed.length ? card('⚡ Canlı akış', feed.slice(0, 6).map(feedRow).join(''), `<button class="lnk" onclick="liveTab='akis';go('#canli')">tümü ›</button>`) : '',
    pay: card('Ödeme dağılımı', donut(pays, 'amount', p => p.name), 'bugün'),
    week: days ? card('Son 7 gün', vbars(days, 'amount', x => x.lbl, { drill: 'day', dv: x => x.date }), `toplam ${mk(sum(days, 'amount'))}`) : '',
    top: card('En çok satan', ranks(products, { name: p => p.name, val: 'amount', right: p => num(p.quantity) + ' adet', drill: 'prod', limit: 6 }), `<button class="lnk" onclick="go('#rapor/urun')">tümü ›</button>`),
    staff: card('Personel', ranks(users, { name: u => u.name, val: 'amount', right: u => num(u.count) + ' adisyon', drill: 'user', limit: 6 }), `<button class="lnk" onclick="go('#rapor/personel')">rapor ›</button>`),
    quick: `<div class="ch" style="margin:6px 4px 10px"><span>Hızlı işlemler</span><button class="lnk" onclick="go('#rapor')">tüm raporlar ›</button></div>
      <div class="qa"><button onclick="cashSheet()"><span>💵</span>Kasa sayımı</button><button onclick="targetSheet()"><span>🎯</span>Hedefler</button><button onclick="go('#rapor/takvim')"><span>🗓</span>Ay takvimi</button><button onclick="go('#rapor/karsilastir')"><span>⚖️</span>Karşılaştır</button><button onclick="go('#rapor/kasa')"><span>🗄</span>Kasa raporu</button><button onclick="go('#rapor/menu')"><span>⭐</span>Menü müh.</button></div>`
  };
  const order = homeOrder().filter(x => x.on && parts[x.id]);
  $('homeBox').innerHTML = `<div class="bento">${order.map(x => `<div class="bx bx-${x.id}">${parts[x.id]}</div>`).join('')}</div>
    <button class="btng" style="width:100%;margin-top:4px" onclick="editHome()">✏️ Ana ekranı düzenle</button>`;
}
function editHome() {
  const b = sheet('Ana ekranı düzenle', 'kartları aç/kapat, sırala');
  const draw = () => {
    const l = homeOrder();
    b.innerHTML = `<div class="card">${l.map((x, i) => `<div class="li"><label style="display:flex;gap:10px;align-items:center;flex:1"><input type="checkbox" data-t="${x.id}" ${x.on ? 'checked' : ''} style="min-height:0;width:18px;height:18px;accent-color:var(--acc)">${esc((HOME_CARDS.find(c => c[0] === x.id) || [])[1])}</label><span><button class="btng" data-u="${i}" ${i ? '' : 'disabled'}>▲</button> <button class="btng" data-d="${i}" ${i < l.length - 1 ? '' : 'disabled'}>▼</button></span></div>`).join('')}</div>
      <button class="btng" id="hReset" style="width:100%">Varsayılana dön</button>`;
  };
  draw();
  b.addEventListener('click', e => {
    const l = homeOrder(), u = e.target.closest('[data-u]'), dn = e.target.closest('[data-d]');
    if (u) { const i = +u.dataset.u; [l[i - 1], l[i]] = [l[i], l[i - 1]]; }
    else if (dn) { const i = +dn.dataset.d; [l[i + 1], l[i]] = [l[i], l[i + 1]]; }
    else if (e.target.id === 'hReset') { store.set('p3-cards', null); draw(); renderHome(); return; }
    else return;
    store.set('p3-cards', l); draw(); renderHome();
  });
  b.addEventListener('change', e => { const t = e.target.dataset.t; if (!t) return; const l = homeOrder(); l.find(x => x.id === t).on = e.target.checked; store.set('p3-cards', l); renderHome(); });
}
/* ---- hedefler (tum kullanicilar icin ortak - bilgisayarda saklanir) */
function targetSheet() {
  const b = sheet('🎯 Hedefler', 'tüm kullanıcılar için ortak'), set = (home && home.settings) || {}, fc = home && home.compare && home.compare.forecast, M = home && home.compare && home.compare.month;
  b.innerHTML = `<div class="card"><div class="custom" style="margin-top:0"><label>Günlük ciro hedefi (₺)<input id="tDay" type="number" inputmode="decimal" value="${+set.dailyTarget || ''}" placeholder="${fc && fc.avgDay ? 'öneri: ' + Math.round(fc.avgDay * 1.1 / 100) * 100 : 'ör. 50000'}"></label><label>Bekleyen masa uyarısı (dk, 0 = kapalı)<input id="tStale" type="number" inputmode="numeric" value="${set.staleMinutes != null ? +set.staleMinutes : 45}"></label><label>Aylık ciro hedefi (₺)<input id="tMon" type="number" inputmode="decimal" value="${+set.monthlyTarget || ''}" placeholder="${M && M.lastMonthTotal ? 'öneri: ' + Math.round((+M.lastMonthTotal.sales || 0) * 1.1 / 1000) * 1000 : 'ör. 1500000'}"></label></div>
    <p class="note">Öneri: bu günün son 4 haftalık ortalamasının / geçen ayın %10 fazlası. Boş bırakırsanız hedef gösterilmez.</p>
    <button class="btnp" id="tSave" style="width:100%;margin-top:10px">Kaydet</button><p class="note" id="tMsg"></p></div>`;
  $('tSave').onclick = async () => {
    try { const r = await post('/api/settings', { dailyTarget: Number($('tDay').value) || 0, monthlyTarget: Number($('tMon').value) || 0, staleMinutes: Math.max(0, Number($('tStale').value) || 0) }); if (home) home.settings = r; renderHome(); toast('Hedefler kaydedildi 🎯'); history.back(); }
    catch (err) { $('tMsg').className = 'bad'; $('tMsg').textContent = err.message; }
  };
}
/* ---- kasa sayimi: banknot banknot, beklenen nakitle fark, gecmis */
const DENOMS = [200, 100, 50, 20, 10, 5, 1];
async function cashSheet() {
  const b = sheet('💵 Kasa sayımı', 'beklenen nakit ile karşılaştır');
  let d; try { d = await api('/api/cash'); } catch (err) { b.innerHTML = `<div class="errbox">${esc(err.message)}</div>`; return; }
  const wp = d.workPeriod || {}, open = store.get('p3-opening', 0);
  b.innerHTML = `<div class="kpis">${kpi('🌅', '#2dd4bf', 'İş günü', wp.number ? '#' + esc(wp.number) : '—', null, `${esc(String(wp.start).slice(5, 16))} → ${wp.end ? esc(wp.end.slice(11, 16)) : 'açık'}`)}${kpi('💵', '#22c55e', 'Beklenen nakit', money(d.cash), null, 'nakit tahsilat')}</div>
    <div class="card"><div class="ch">Banknotlar <small>adet girin</small></div><div class="den">${DENOMS.map(v => `<label><span>${v} ₺</span><input type="number" inputmode="numeric" min="0" data-v="${v}" placeholder="0"></label>`).join('')}<label><span>Bozuk para (₺)</span><input type="number" inputmode="decimal" id="cCoins" placeholder="0"></label><label><span>Açılış kasası (₺)</span><input type="number" inputmode="decimal" id="cOpen" value="${open || ''}" placeholder="0"></label></div>
      <div class="cres" id="cRes"></div><input id="cNote" placeholder="Not (isteğe bağlı)" style="width:100%;margin-top:10px"><button class="btnp" id="cSave" style="width:100%;margin-top:10px">Sayımı kaydet</button><p class="note" id="cMsg"></p></div>
    ${card('Bu iş günü tahsilat (tüm ödeme türleri)', (d.payments || []).map(p => `<div class="li"><div>${esc(p.name)}<div class="m">${num(p.count)} ödeme</div></div><b class="r">${money(p.amount)}</b></div>`).join('') || '<p class="empty">Ödeme yok.</p>')}
    ${card('Sayım geçmişi', (d.history || []).map(h => `<div class="li"><div>${esc(String(h.at).slice(5, 16))} · ${esc(h.user)}<div class="m">sayılan ${money(h.counted)} · beklenen ${money(+h.expected + (+h.opening || 0))}${h.note ? ' · ' + esc(h.note) : ''}</div></div><b class="r ${Math.abs(h.diff) < 1 ? 'up' : 'down'}">${h.diff > 0 ? '+' : ''}${money(h.diff)}</b></div>`).join('') || '<p class="empty">Henüz sayım yok.</p>')}`;
  const calc = () => {
    let c = 0; b.querySelectorAll('[data-v]').forEach(i => { c += (+i.value || 0) * +i.dataset.v; }); c += +$('cCoins').value || 0;
    const op = +$('cOpen').value || 0, exp = (+d.cash || 0) + op, df = c - exp;
    $('cRes').innerHTML = `<div><span>Sayılan</span><b>${money(c)}</b></div><div><span>Olması gereken</span><b>${money(exp)}</b></div><div class="${Math.abs(df) < 1 ? 'up' : 'down'}"><span>${Math.abs(df) < 1 ? '✓ Kasa tutuyor' : df > 0 ? 'Fazla' : 'Eksik'}</span><b>${df > 0 ? '+' : ''}${money(df)}</b></div>`;
    return { c, op };
  };
  b.addEventListener('input', calc); calc();
  $('cSave').onclick = async () => {
    const { c, op } = calc(), det = {}; b.querySelectorAll('[data-v]').forEach(i => { if (+i.value) det[i.dataset.v] = +i.value; }); if (+$('cCoins').value) det.bozuk = +$('cCoins').value;
    store.set('p3-opening', op);
    try { await post('/api/cash', { counted: c, expected: d.cash, opening: op, workPeriod: wp.number || '', note: $('cNote').value, details: det }); toast('Sayım kaydedildi ✓'); history.back(); }
    catch (err) { $('cMsg').className = 'bad'; $('cMsg').textContent = err.message; }
  };
}

/* ================================================================== CANLI */
let liveTab = 'masa';
function renderLive() {
  const d = home; if (!d) return;
  const now = restNow(), ot = d.openTables || {}, tables = (ot.tables || []).slice(), pend = (ot.packages || {}).pending || [], enr = (ot.packages || {}).enroute || [];
  const age = t => (now - parse(t.date)) / 60000;
  $('liveTabs').innerHTML = `<button data-t="masa" class="${liveTab === 'masa' ? 'on' : ''}">🍽 Masalar ${tables.length}</button><button data-t="paket" class="${liveTab === 'paket' ? 'on' : ''}">🛵 Paket ${pend.length + enr.length}</button><button data-t="akis" class="${liveTab === 'akis' ? 'on' : ''}">⚡ Akış</button>`;
  const all = tables.concat(pend, enr), tot = all.reduce((a, t) => a + (+t.remaining || 0), 0), ta = tables.map(age).filter(isFinite);
  let h = `<div class="kpis">${kpi('⏳', '#f59e0b', 'Açıkta bekleyen', money(tot))}${kpi('⏱', '#a78bfa', 'Ortalama masa süresi', ta.length ? dur(ta.reduce((a, b) => a + b, 0) / ta.length) : '—')}${kpi('🔴', '#ef4444', '90 dk üstü', num(ta.filter(m => m > 90).length))}${kpi('🛵', '#2dd4bf', 'Yolda paket', num(enr.length))}</div>`;
  if (liveTab === 'masa') {
    tables.sort((a, b) => age(b) - age(a));
    h += tables.length ? `<div class="ttiles">${tables.map(t => { const m = age(t); return `<button class="tt ${m > 90 ? 'c' : m > 45 ? 'w' : ''}"${dr('ticket', t.id)}><span class="age">${isFinite(m) ? dur(m) : ''}</span><div class="t">${esc(t.table)}</div><div class="a">${money(t.total)}</div><div class="m">${t.user ? esc(t.user) : ''}${+t.remaining !== +t.total ? ' · kalan ' + money(t.remaining) : ''}</div></button>`; }).join('')}</div><p class="note">Yeşil 45 dk altı · sarı 45–90 dk · kırmızı 90 dk üstü. Masaya dokunun: siparişler ve işlem geçmişi.</p>` : '<p class="empty">Şu an açık masa yok.</p>';
  } else if (liveTab === 'akis') {
    h += feed.length ? `<div class="card">${feed.map(feedRow).join('')}</div><p class="note">Son 3 saatin siparişleri, ödemeleri, ikram ve iptalleri — 20 sn'de bir yenilenir. Satıra dokunun: adisyon.</p>` : '<p class="empty">Son 3 saatte hareket yok.</p>';
  } else {
    const row = (p, y) => { const m = age(p); return `<div class="nt"${dr('ticket', p.id)}><span class="e">${y ? '🛵' : '📦'}</span><div><div class="h">${esc(p.table)}${p.number ? ` #${esc(p.number)}` : ''}<span class="tag ${y ? 'iskonto' : m > 30 ? 'iptal' : 'acik'}">${y ? 'Yolda' : 'Bekliyor'} · ${isFinite(m) ? dur(m) : ''}</span></div><div class="b">${money(p.total)}${p.user ? ' · ' + esc(p.user) : ''}</div></div></div>`; };
    h += pend.length + enr.length ? pend.map(p => row(p, false)).join('') + enr.map(p => row(p, true)).join('') : '<p class="empty">Şu an açık paket yok.</p>';
  }
  $('liveBox').innerHTML = h;
}
$('liveTabs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) { liveTab = b.dataset.t; renderLive(); } });

/* ================================================================== ALT SAYFA + DETAYA INME */
const sheets = [];
function sheet(title, sub) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="sheet"><div class="grip"></div><h3><span><span class="stt">${esc(title)}</span><small>${esc(sub || '')}</small></span><button aria-label="Kapat">✕</button></h3><div class="sb">${skel(3)}</div></div>`;
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('h3 button')) history.back(); });
  document.body.appendChild(ov); sheets.push(ov);
  history.pushState({ sheet: sheets.length }, '');   // telefonun geri tusu alt sayfayi kapatir
  return ov.querySelector('.sb');
}
window.addEventListener('popstate', () => { const s = sheets.pop(); if (s) s.remove(); });
function closeSheets() { while (sheets.length) sheets.pop().remove(); }
document.addEventListener('click', e => {
  const el = e.target.closest('[data-dr]'); if (!el) return;
  e.preventDefault();
  drill(el.dataset.dr, el.dataset.dv);
});
function curRange() { return repCtx && view === 'rapor' ? repCtx.r : { start: baseToday(), end: baseToday() }; }
function drill(t, v) {
  const r = curRange();
  if (t === 'ticket') return ticketSheet(v);
  if (t === 'tno') return ticketByNumber(v);
  if (t === 'prod') return reportSheet('urun-detay', r, v, v);
  if (t === 'user') return reportSheet('personel-detay', r, v, v);
  if (t === 'day') return reportSheet('kasa', { start: v, end: v }, null, 'Kasa · ' + fmtDay(v));
  if (t === 'hour') return reportSheet('saatlik-urun', { ...r, hs: v, he: v }, null, `${pad2(v)}:00 – ${pad2(v)}:59 satılanlar`);
  if (t === 'group') {
    const pr = ((lastData.urun || {}).products || []).filter(p => p.group === v), b = sheet(v, 'ürün grubu');
    b.innerHTML = card(`${esc(v)} · ${num(sum(pr, 'quantity'))} adet · ${money(sum(pr, 'amount'))}`, ranks(pr, { name: p => p.name + (p.portion && p.portion !== 'Normal' ? ' · ' + p.portion : ''), dv: p => p.name, val: 'amount', right: p => num(p.quantity) + ' adet', drill: 'prod', limit: 100 }));
  }
}
/* bildirimlerde fis NUMARASI var (Id degil) - son 3 gunun adisyon listesinden bulunur */
async function ticketByNumber(no) {
  try { const d = await api(repUrl('adisyonlar', { start: addDays(baseToday(), -2), end: baseToday() })); const x = (d.tickets || []).find(k => String(k.number) === String(no)); if (x) ticketSheet(x.id); else toast('Adisyon bulunamadı'); } catch (err) { toast(err.message); }
}
const rangeText = r => `${fmtDay(r.start)}${r.end !== r.start ? ' → ' + fmtDay(r.end) : ''}${r.hs !== undefined && r.hs !== '' && r.hs !== null ? ` · ${pad2(r.hs)}:00–${pad2(r.he)}:59` : ''}`;
function repUrl(kind, r, key) { return `/api/reports?kind=${encodeURIComponent(kind)}&start=${r.start}&end=${r.end}` + (r.hs !== undefined && r.hs !== '' && r.hs !== null ? `&hourStart=${r.hs}&hourEnd=${r.he}` : '') + (key ? '&key=' + encodeURIComponent(key) : ''); }
async function reportSheet(kind, r, key, title) {
  const b = sheet(title || REP[kind].t, rangeText(r));
  try {
    const d = await api(repUrl(kind, r, key));
    b.innerHTML = errList(d) + REP[kind].render(d, { r, key, csv: [], sheet: true });
  } catch (err) { b.innerHTML = `<div class="errbox">${esc(err.message)}</div>`; }
}
const errList = d => d && d.errors && d.errors.length ? `<div class="errbox">Bazı bölümler bu SambaPOS kurulumunda okunamadı:<br><small>${d.errors.map(esc).join('<br>')}</small></div>` : '';

async function ticketSheet(id) {
  const b = sheet('Adisyon', 'yükleniyor…');
  try {
    const t = await api('/api/ticket-log?id=' + encodeURIComponent(id));
    const ents = (t.entities || []).map(e => `${esc(e.type)}: <b>${esc(e.name)}</b>`).join(' · ');
    const orders = t.orders || [], counted = orders.filter(o => o.counted), lost = orders.filter(o => o.kind);
    const h3 = b.parentNode.querySelector('h3'); h3.querySelector('.stt').textContent = `Fiş ${t.number || t.id}`; h3.querySelector('small').textContent = `${t.date} · ${t.closed ? 'kapalı' : 'AÇIK'}`;
    b.innerHTML = `
      <div class="kpis">${kpi('🧾', '#4f8cff', 'Toplam', money(t.total))}${kpi(t.closed ? '✅' : '⏳', t.closed ? '#22c55e' : '#f59e0b', t.closed ? 'Kapandı' : 'Kalan', t.closed ? esc(String(t.lastPayment || '').slice(11, 16) || '✓') : money(t.remaining))}${kpi('👤', '#a78bfa', 'Açan', esc(t.user || '—'))}${kpi('⚠️', '#ef4444', 'İkram / iptal', money(sum(lost, 'total')), null, `${lost.length} satır`)}</div>
      ${ents || t.note || t.department ? `<div class="card" style="font-size:12.5px">${ents}${t.department ? `${ents ? '<br>' : ''}Departman: <b>${esc(t.department)}</b>` : ''}${t.note ? '<br>Not: ' + esc(t.note) : ''}</div>` : ''}
      ${tbl('Siparişler — işlem sırasıyla', [{ l: 'Saat' }, { l: 'Ürün' }, { l: 'Tutar', n: 1 }], orders.map(o => ({ c: [esc(String(o.date).slice(11, 16)), `<span class="${o.counted ? '' : 'x'}">${num(o.quantity)} × ${esc(o.name)}</span>${o.portion && o.portion !== 'Normal' ? ` <span class="sub">${esc(o.portion)}</span>` : ''} ${o.kind ? tag(o.kind) : ''}<div class="sub">${esc(o.user)}${o.tags ? ' · ' + esc(o.tags) : ''}${o.reason ? ' · ' + esc(o.reason) : ''}</div>`, m2(o.total)] })), { total: ['', 'Hesaba yansıyan', m2(sum(counted, 'total'))], limit: 0 })}
      ${(t.calculations || []).length ? tbl('İskonto / yuvarlama / servis', [{ l: 'Tür' }, { l: 'Tutar', n: 1 }], t.calculations.map(c => ({ c: [esc(c.name), m2(c.amount)] })), { limit: 0 }) : ''}
      ${(t.payments || []).length ? tbl('Ödemeler', [{ l: 'Saat' }, { l: 'Tür' }, { l: 'Tutar', n: 1 }], t.payments.map(p => ({ c: [esc(String(p.date).slice(11, 16)), esc(p.name) + (p.user ? `<div class="sub">${esc(p.user)}</div>` : ''), m2(p.amount)] })), { limit: 0 }) : ''}
      ${lost.length ? '<p class="note">Üstü çizili satırlar hesaba yansımayan (ikram / iptal / iade) siparişlerdir.</p>' : ''}${errList(t)}`;
  } catch (err) { b.innerHTML = `<div class="errbox">${esc(err.message)}</div>`; }
}

/* ================================================================== RAPOR TANIMLARI */
const CATS = [['satis', 'Satış & Kasa'], ['stok', 'Stok & Maliyet'], ['zaman', 'Zaman analizi'], ['personel', 'Personel'], ['kontrol', 'Kontrol & Kayıp'], ['musteri', 'Müşteri & Paket'], ['operasyon', 'Operasyon']];
let lastData = {};
const REP = {
  karlilik: { cat: 'stok', i: '💹', c: '#22c55e', t: 'Kârlılık (Reçete Maliyeti)', d: 'Ürün başına maliyet, kâr, marj', nw: 1, defRange: '30', render: rKarlilik },
  stok: { cat: 'stok', i: '📦', c: '#f59e0b', t: 'Stok Durumu', d: 'Güncel stok, değer, eksiye düşenler, tüketim', nw: 1, defRange: '7', render: rStok },
  kasa: { cat: 'satis', i: '🗄', c: '#4f8cff', t: 'Kasa Raporu', d: 'Ödeme türleri, iskonto, ikram, günlük ciro', prev: true, render: rKasa },
  gunsonu: { cat: 'satis', i: '🌓', c: '#2dd4bf', t: 'Gün Sonu Raporu', d: 'İş günü bazında ciro ve tahsilat', render: rGunsonu },
  karsilastir: { cat: 'satis', i: '⚖️', c: '#a78bfa', t: 'Dönem Karşılaştırma', d: 'Bu dönem ↔ önceki dönem, yükselen/düşen ürünler', nw: 1, load: lKarsilastir, render: rKarsilastir },
  urun: { cat: 'satis', i: '🥗', c: '#22c55e', t: 'Ürün Satış Raporu', d: 'Grup ve ürün bazında, % pay', prev: true, render: rUrun },
  menu: { cat: 'satis', i: '⭐', c: '#f59e0b', defRange: '30', t: 'Menü Mühendisliği', d: 'Yıldız · Beygir · Bulmaca · Köpek', nw: 1, src: 'urun', render: rMenu },
  departman: { cat: 'satis', i: '💰', c: '#f472b6', t: 'Departman / Adisyon Türü', d: 'Masa, paket, online dağılımı', render: rDepartman },
  saatlik: { cat: 'zaman', i: '📈', c: '#4f8cff', t: 'Saatlik Ciro + Isı Haritası', d: 'Gün × saat yoğunluk', render: rSaatlik },
  takvim: { cat: 'zaman', i: '🗓', c: '#22c55e', t: 'Ay Takvimi', d: 'Günlük ciro takvim üzerinde', nw: 1, defRange: 'month', src: 'kasa', render: rTakvim },
  haftagunu: { cat: 'zaman', i: '📅', c: '#2dd4bf', defRange: '30', t: 'Haftanın Günleri', d: 'Hangi gün ne kadar kazandırıyor', nw: 1, src: 'saatlik', render: rHaftagunu },
  gundilimi: { cat: 'zaman', i: '🌤', c: '#f59e0b', t: 'Gün Dilimleri', d: 'Kahvaltı · öğle · akşam · gece', nw: 1, src: 'saatlik', render: rGundilimi },
  'saatlik-urun': { cat: 'zaman', i: '🕓', c: '#a78bfa', t: 'Saatlik Ürün Satış', d: 'Hangi saatte ne satıldı', render: rSaatlikUrun },
  personel: { cat: 'personel', i: '🏆', c: '#22c55e', t: 'Personel Performansı', d: 'Ciro, adisyon, ikram/iptal', prev: true, render: rPersonel },
  tahsilat: { cat: 'personel', i: '💳', c: '#4f8cff', t: 'Kullanıcı Tahsilat', d: 'Kasiyer × ödeme türü', render: rTahsilat },
  ikram: { cat: 'kontrol', i: '🧡', c: '#f59e0b', t: 'İkram - İade - Zayi - İptal', d: 'Kim, ne, neden', render: rIkram },
  iskonto: { cat: 'kontrol', i: '💸', c: '#4f8cff', t: 'İskonto ve Yuvarlama', d: 'Adisyon adisyon indirimler', render: rIskonto },
  'iptal-adisyon': { cat: 'kontrol', i: '📛', c: '#ef4444', t: 'İptal / İade Adisyonlar', d: 'Adisyon + eksi ödemeler', render: rIptalAdisyon },
  musteri: { cat: 'musteri', i: '👥', c: '#f472b6', defRange: '30', t: 'Müşteri Raporu', d: 'En değerli ve sadık müşteriler', nw: 1, render: rMusteri },
  veresiye: { cat: 'musteri', i: '📒', c: '#ef4444', t: 'Veresiye / Cari Bakiyeler', d: 'Açık hesaplar ve hesap bakiyeleri', nw: 1, render: rVeresiye },
  paketci: { cat: 'musteri', i: '🛵', c: '#2dd4bf', t: 'Paketçi Raporu', d: 'Kurye bazında teslimat', render: rPaketci },
  sepet: { cat: 'musteri', i: '🛒', c: '#22c55e', defRange: '30', t: 'Sepet Analizi', d: 'Birlikte satılan ürünler, sepet büyüklüğü', nw: 1, render: rSepet },
  masa: { cat: 'operasyon', i: '⏱', c: '#a78bfa', t: 'Servis Hızı + Masa', d: 'Oturma süresi, masa verimi', render: rMasa },
  adisyonlar: { cat: 'operasyon', i: '🧾', c: '#94a3b8', t: 'Adisyon Listesi + Log', d: 'Ara, dokun, tüm geçmişi gör', render: rAdisyonlar },
  'urun-detay': { hidden: 1, t: 'Ürün Detayı', render: rUrunDetay },
  'personel-detay': { hidden: 1, t: 'Personel Detayı', render: rPersonelDetay }
};

/* ================================================================== RAPOR MENUSU + SAYFA */
let repKind = null, repRange = store.get('p3-range', 'today'), repCtx = null, repSeq = 0;
function renderRepMenu() {
  const recent = store.get('p3-recent', []).filter(k => REP[k] && !REP[k].hidden).slice(0, 6), q = ($('repQ') && $('repQ').value || '').toLocaleLowerCase('tr');
  const vis = Object.keys(REP).filter(k => !REP[k].hidden && (!q || (REP[k].t + ' ' + REP[k].d).toLocaleLowerCase('tr').includes(q)));
  const tile = k => `<button class="rt" onclick="go('#rapor/${k}')">${REP[k].nw ? '<span class="nw">YENİ</span>' : ''}<span class="ic" style="background:${REP[k].c}22;color:${REP[k].c}">${REP[k].i}</span><b>${esc(REP[k].t)}</b><small>${esc(REP[k].d)}</small></button>`;
  const html = `${recent.length && !q ? `<div class="cat">Son açılanlar</div><div class="fav">${recent.map(k => `<button onclick="go('#rapor/${k}')"><span>${REP[k].i}</span>${esc(REP[k].t)}</button>`).join('')}</div>` : ''}
    ${CATS.map(([c, l]) => { const ks = vis.filter(k => REP[k].cat === c); return ks.length ? `<div class="cat">${l}</div><div class="tiles">${ks.map(tile).join('')}</div>` : ''; }).join('') || '<p class="empty">Rapor bulunamadı.</p>'}
    <p class="note" style="margin-top:14px">Tüm raporlar bu bilgisayardaki SambaPOS veritabanından canlı hesaplanır. Raporlarda ürün, personel, gün, saat ve adisyonlara dokunarak detaya inebilirsiniz.</p>`;
  if (!$('repQ')) { $('repMenu').innerHTML = `<input id="repQ" class="search" type="search" placeholder="🔍  Rapor ara… (ör. ikram, saat, müşteri)"><div id="repList"></div>`; $('repQ').addEventListener('input', renderRepMenu); }
  $('repList').innerHTML = html;
}
const RANGES = [['today', 'Bugün'], ['yesterday', 'Dün'], ['7', '7 gün'], ['30', '30 gün'], ['month', 'Bu ay'], ['lastmonth', 'Geçen ay'], ['90', '3 ay'], ['custom', 'Özel…']];
function openReport(k) {
  // uzun donem isteyen raporlar kisa aralikla acilmasin (kayitli secim degismez)
  if (REP[k].defRange && ['today', 'yesterday', '7'].includes(store.get('p3-range', 'today'))) repRange = REP[k].defRange; else repRange = store.get('p3-range', 'today');
  repKind = k; store.set('p3-recent', [k].concat(store.get('p3-recent', []).filter(x => x !== k)).slice(0, 8));
  $('repMenu').classList.add('hide'); const p = $('repPage'); p.classList.remove('hide');
  const o = '<option value="">— tüm gün —</option>' + Array.from({ length: 24 }, (_, h) => `<option value="${h}">${pad2(h)}:00</option>`).join('');
  const t = ymd(new Date());
  p.innerHTML = `<div class="rbar"><div class="seg" id="rSeg">${RANGES.map(([k2, l]) => `<button data-r="${k2}" class="${repRange === k2 ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="custom ${repRange === 'custom' ? '' : 'hide'}" id="rCustom"><label>Başlangıç<input type="date" id="rStart" value="${store.get('p3-cs', addDays(t, -6))}"></label><label>Bitiş<input type="date" id="rEnd" value="${store.get('p3-ce', t)}"></label><label>Saatten<select id="rHs">${o}</select></label><label>Saate<select id="rHe">${o}</select></label><button class="btnp" id="rGo">Getir</button></div>
      <div class="rdate"><span id="rTxt"></span><span class="tools noprint"><button class="btng" id="rCsv">⬇ Excel</button><button class="btng" id="rPrint">🖨</button><button class="btng" id="rShare">📤</button></span></div></div>
    <div class="rhead"><div><h1>${REP[k].i} ${esc(REP[k].t)}</h1><p>${esc(REP[k].d || '')}</p></div></div>
    <div id="repBox"></div>`;
  $('rSeg').onclick = e => { const b = e.target.closest('[data-r]'); if (!b) return; repRange = b.dataset.r; store.set('p3-range', repRange); $('rSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); $('rCustom').classList.toggle('hide', repRange !== 'custom'); if (repRange !== 'custom') runReport(); };
  $('rGo').onclick = () => { store.set('p3-cs', $('rStart').value); store.set('p3-ce', $('rEnd').value); runReport(); };
  $('rCsv').onclick = exportCsv; $('rPrint').onclick = () => window.print(); $('rShare').onclick = shareReport;
  $('repBox').addEventListener('input', e => { if (e.target.dataset.filter !== undefined) filterRows(e.target); });
  setBar(); runReport();
}
function rangeFor(k) {
  const t = baseToday();
  if (k === 'today') return { start: t, end: t, pl: 'dün' };
  if (k === 'yesterday') return { start: addDays(t, -1), end: addDays(t, -1), pl: 'önceki gün' };
  if (k === '7') return { start: addDays(t, -6), end: t, pl: 'önceki 7 gün' };
  if (k === '30') return { start: addDays(t, -29), end: t, pl: 'önceki 30 gün' };
  if (k === '90') return { start: addDays(t, -89), end: t, pl: 'önceki 3 ay' };
  if (k === 'month') return { start: t.slice(0, 8) + '01', end: t, pl: 'önceki dönem' };
  if (k === 'lastmonth') { const d = parse(t.slice(0, 8) + '01'); d.setDate(0); const e = ymd(d); return { start: e.slice(0, 8) + '01', end: e, pl: 'önceki ay' }; }
  let s = ($('rStart') && $('rStart').value) || t, e = ($('rEnd') && $('rEnd').value) || t; if (s > e) [s, e] = [e, s];
  const hs = $('rHs') ? $('rHs').value : '', he = $('rHe') && $('rHe').value !== '' ? $('rHe').value : hs;
  return { start: s, end: e, hs, he, pl: 'önceki dönem' };
}
function prevOf(r) { const n = nDays(r); return { start: addDays(r.start, -n), end: addDays(r.start, -1), hs: r.hs, he: r.he }; }
async function runReport() {
  const seq = ++repSeq, k = repKind, def = REP[k], r = rangeFor(repRange);
  $('rTxt').textContent = `📅 ${rangeText(r)}${nDays(r) > 1 ? ` · ${nDays(r)} gün` : ''}`;
  $('repBox').innerHTML = skel(4);
  try {
    let data, prev = null;
    if (def.load) data = await def.load(r);
    else [data, prev] = await Promise.all([api(repUrl(def.src || k, r)), def.prev ? api(repUrl(def.src || k, prevOf(r))).catch(() => null) : null]);
    if (seq !== repSeq) return;
    lastData[def.src || k] = data;
    repCtx = { k, r, data, prev, csv: [] };
    $('repBox').innerHTML = errList(data) + def.render(data, repCtx);
  } catch (err) { if (seq === repSeq) $('repBox').innerHTML = `<div class="errbox">⚠️ ${esc(err.message)}</div>`; }
}
function filterRows(inp) { const q = inp.value.trim().toLocaleLowerCase('tr'), tb = inp.nextElementSibling; if (!tb) return; tb.querySelectorAll('tbody tr:not(.tot)').forEach(tr => { const hit = !q || tr.textContent.toLocaleLowerCase('tr').includes(q); tr.classList.toggle('hide', !hit || (!q && tr.classList.contains('hid'))); }); const m = tb.querySelector('.more'); if (m) m.classList.toggle('hide', !!q); }
const filterBox = ph => `<input class="search" data-filter placeholder="🔍  ${esc(ph)}" style="margin-bottom:8px">`;
const csv = (ctx, title, head, rows) => { if (ctx.csv) ctx.csv.push({ title, head, rows }); };
function exportCsv() {
  if (!repCtx) return;
  const q = v => typeof v === 'number' ? String(v.toFixed(2)).replace('.', ',') : `"${String(v ?? '').replace(/"/g, '""')}"`;
  const L = [[q(appName), q(REP[repCtx.k].t), q(repCtx.r.start + ' / ' + repCtx.r.end)].join(';'), ''];
  repCtx.csv.forEach(t => { L.push(q(t.title)); L.push(t.head.map(q).join(';')); t.rows.forEach(r => L.push(r.map(q).join(';'))); L.push(''); });
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + L.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `patron-${repCtx.k}-${repCtx.r.start}_${repCtx.r.end}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
async function shareReport() {
  if (!repCtx) return;
  const ins = [...document.querySelectorAll('#repBox .insight li')].map(li => '• ' + li.textContent).join('\n'), t0 = repCtx.csv[0];
  const text = `${appName} — ${REP[repCtx.k].t}\n${rangeText(repCtx.r)}\n\n${ins || (t0 ? t0.rows.slice(0, 10).map(r => r.map(v => typeof v === 'number' ? m2(v) : v).join(' · ')).join('\n') : '')}`;
  if (navigator.share) { try { await navigator.share({ title: REP[repCtx.k].t, text }); } catch { /* vazgecti */ } }
  else { try { await navigator.clipboard.writeText(text); toast('Özet panoya kopyalandı — WhatsApp\'a yapıştırabilirsiniz'); } catch { toast('Paylaşım desteklenmiyor'); } }
}

/* ================================================================== RAPOR CIZICILERI */
const dailyPts = (list, r, key = 'amount') => { const by = {}; (list || []).forEach(x => { by[x.date] = x; }); const out = []; for (let d = r.start; d <= r.end && out.length < 400; d = addDays(d, 1)) out.push({ l: nDays(r) <= 14 ? GUN3[parse(d).getDay()] + ' ' + parse(d).getDate() : d.slice(8, 10) + '.' + d.slice(5, 7), v: +(by[d] || {})[key] || 0, k: d }); return out; };

function rKasa(d, ctx) {
  const s = d.summary || {}, p = ctx.prev, ps = p && p.summary, pays = d.payments || [], payT = sum(pays, 'amount');
  const calc = d.calculations || [], ok = d.orderKinds || [], deps = d.departments || [], lost = sum(ok, 'amount'), disc = sum(calc.filter(c => c.amount < 0), 'amount');
  csv(ctx, 'Özet', ['Ciro', 'Adisyon', 'Ortalama', 'Açık bakiye', 'Tahsilat'], [[s.sales, s.tickets, s.average, s.remaining, payT]]);
  csv(ctx, 'Ödeme türleri', ['Tür', 'Adet', 'Tutar'], pays.map(x => [x.name, x.count, x.amount]));
  csv(ctx, 'Hesaplamalar', ['Tür', 'Adisyon', 'Tutar'], calc.map(x => [x.name, x.count, x.amount]));
  csv(ctx, 'İkram/İade/İptal', ['Tür', 'Satır', 'Adet', 'Tutar'], ok.map(x => [KIND[x.kind] || x.kind, x.count, x.quantity, x.amount]));
  csv(ctx, 'Günlük', ['Tarih', 'Adisyon', 'Ciro'], (d.daily || []).map(x => [x.date, x.count, x.amount]));
  const topPay = pays[0], pts = dailyPts(d.daily, ctx.r), best = pts.reduce((a, b) => (b.v > a.v ? b : a), pts[0] || { v: 0 });
  return insight([
    ps ? `Ciro önceki döneme göre <b>${delta(s.sales, ps.sales).txt}</b> (${money(ps.sales)} → ${money(s.sales)}).` : null,
    topPay ? `En çok kullanılan ödeme: <b>${esc(topPay.name)}</b> — tahsilatın %${pct1(topPay.amount, payT)}'i.` : null,
    lost ? `İkram / iptal / iade ile hesaba yansımayan tutar: <b>${money(lost)}</b> (cironun %${pct1(lost, s.sales)}'i).` : 'Bu dönemde ikram / iptal / iade yok.',
    disc ? `Verilen iskonto: <b>${money(Math.abs(disc))}</b>.` : null,
    pts.length > 1 && best.v ? `En iyi gün: <b>${esc(fmtDay(best.k))}</b> · ${money(best.v)}.` : null,
    +s.remaining ? `Kapalı adisyonlarda tahsil edilmemiş (veresiye) <b>${money(s.remaining)}</b> var.` : null]) +
    `<div class="kpis">${kpi('💰', '#4f8cff', 'Ciro', money(s.sales), ps && delta(s.sales, ps.sales))}${kpi('🧾', '#22c55e', 'Adisyon', num(s.tickets), ps && delta(s.tickets, ps.tickets))}${kpi('🛒', '#f59e0b', 'Ortalama fiş', money(s.average), ps && delta(s.average, ps.average))}${kpi('💳', '#a78bfa', 'Tahsilat', money(payT), null, `${num(sum(pays, 'count'))} ödeme`)}</div>
    ${pts.length > 1 ? card('Günlük ciro', lineChart(pts, p ? dailyPts(p.daily, prevOf(ctx.r)) : null, { drill: 'day', legend: ['bu dönem', 'önceki dönem'] }) + '<p class="note" style="margin-top:2px">Noktaya dokunun: o günün kasası</p>') : ''}
    <div class="cols">${card('Ödeme türleri', donut(pays, 'amount', x => x.name))}${card('Hesaba yansımayan', ok.length ? donut(ok, 'amount', x => KIND[x.kind] || x.kind, { colors: x => KCOL[x.kind] || '#94a3b8', center: 'Kayıp' }) : '<p class="empty">✓ İkram / iptal / iade yok</p>', `<button class="lnk" onclick="go('#rapor/ikram')">detay ›</button>`)}</div>
    <div class="cols"><div>
    ${tbl('Ödeme Türleri', [{ l: 'Tür' }, { l: 'Pay', n: 1 }, { l: 'Tutar', n: 1 }], pays.map(x => ({ c: [`${esc(x.name)}<div class="sub">${num(x.count)} ödeme</div>`, pcell(x.amount, payT), m2(x.amount)] })), { total: ['Toplam', '', m2(payT)] })}
    ${tbl('İskonto / Yuvarlama / Servis', [{ l: 'Tür' }, { l: 'Adisyon', n: 1 }, { l: 'Tutar', n: 1 }], calc.map(x => ({ c: [esc(x.name), num(x.count), m2(x.amount)] })), { total: ['Toplam', '', m2(sum(calc, 'amount'))] })}
    </div><div>
    ${tbl('Kasa Özeti', [{ l: '' }, { l: 'Tutar', n: 1 }], [{ c: ['Satış (kapalı adisyon)', m2(s.sales)] }, { c: ['Tahsilat', m2(payT)] }, { c: ['Açık bakiye (veresiye / kalan)', m2(s.remaining)] }, { c: ['İskonto / yuvarlama', m2(sum(calc, 'amount'))] }, { c: ['İkram + iptal + iade', m2(lost)] }], { limit: 0 })}
    ${deps.length > 1 ? tbl('Departman', [{ l: 'Departman' }, { l: 'Pay', n: 1 }, { l: 'Ciro', n: 1 }], deps.map(x => ({ c: [`${esc(x.name)}<div class="sub">${num(x.count)} adisyon</div>`, pcell(x.amount, sum(deps, 'amount')), m2(x.amount)] }))) : ''}
    </div></div>`;
}
function rGunsonu(d, ctx) {
  const ps = d.periods || [];
  csv(ctx, 'Gün sonu', ['No', 'Başlangıç', 'Bitiş', 'Adisyon', 'Açık', 'Ciro'], ps.map(x => [x.number, x.start, x.end || 'açık', x.tickets, x.open, x.sales]));
  if (!ps.length) return '<p class="empty">Bu aralıkta iş günü (gün başı) kaydı yok.</p>';
  const best = ps.reduce((a, b) => (+b.sales > +a.sales ? b : a), ps[0]), avg = sum(ps, 'sales') / ps.length;
  return insight([`${ps.length} iş günü · toplam <b>${money(sum(ps, 'sales'))}</b> · iş günü ortalaması <b>${money(avg)}</b>.`, ps.length > 1 ? `En yüksek iş günü: <b>${esc(best.start.slice(0, 10))}</b> · ${money(best.sales)}.` : null, ps.some(x => !x.end) ? '⚠️ Gün sonu yapılmamış (açık) bir iş günü var.' : null]) +
    (ps.length > 1 ? card('İş günü cirosu', vbars(ps.slice().reverse(), 'sales', x => x.start.slice(8, 10) + '.' + x.start.slice(5, 7))) : '') +
    `<div class="cols">${ps.map(x => { const pt = sum(x.payments, 'amount'), h = (parse(x.end) || restNow()) - parse(x.start); return `<div class="card"><div class="ch"><span>İş günü ${esc(x.number)} ${x.end ? '' : '<span class="tag acik">AÇIK</span>'}</span><small>${esc(x.start.slice(5, 16))} → ${x.end ? esc(x.end.slice(5, 16)) : 'devam ediyor'} · ${dur(h / 60000)}</small></div>
      <div class="kpis" style="margin-bottom:8px">${kpi('💰', '#4f8cff', 'Ciro', money(x.sales))}${kpi('🧾', '#22c55e', 'Adisyon', num(x.tickets), null, x.open ? `<span class="tag acik">${num(x.open)} açık</span>` : 'hepsi kapalı')}</div>
      ${(x.payments || []).map(p => `<div class="li"><div>${esc(p.name)}<div class="m">${num(p.count)} ödeme · %${pct1(p.amount, pt)}</div></div><b class="r">${money(p.amount)}</b></div>`).join('')}<div class="li"><b>Tahsilat</b><b class="r">${money(pt)}</b></div></div>`; }).join('')}</div>`;
}
async function lKarsilastir(r) {
  const p = prevOf(r); const [a, b, ua, ub] = await Promise.all([api(repUrl('kasa', r)), api(repUrl('kasa', p)), api(repUrl('urun', r)), api(repUrl('urun', p))]);
  lastData.urun = ua;
  return { a, b, ua, ub, p, errors: [].concat(a.errors || [], ua.errors || []) };
}
function rKarsilastir(d, ctx) {
  const s = d.a.summary || {}, ps = d.b.summary || {}, r = ctx.r;
  const pa = dailyPts(d.a.daily, r), pb = dailyPts(d.b.daily, d.p);
  const prevBy = {}; (d.ub.products || []).forEach(x => { prevBy[x.name + '|' + x.portion] = x; });
  const curBy = {}; (d.ua.products || []).forEach(x => { curBy[x.name + '|' + x.portion] = x; });
  const keys = [...new Set(Object.keys(prevBy).concat(Object.keys(curBy)))];
  const ch = keys.map(k => { const c = curBy[k] || {}, o = prevBy[k] || {}; return { name: (c.name || o.name), portion: c.portion || o.portion, now: +c.amount || 0, was: +o.amount || 0, qn: +c.quantity || 0, qw: +o.quantity || 0, diff: (+c.amount || 0) - (+o.amount || 0) }; });
  const up = ch.filter(x => x.diff > 0).sort((a, b) => b.diff - a.diff), down = ch.filter(x => x.diff < 0).sort((a, b) => a.diff - b.diff);
  const gB = {}; (d.ub.groups || []).forEach(g => { gB[g.name] = +g.amount || 0; });
  csv(ctx, 'Özet', ['', 'Bu dönem', 'Önceki dönem'], [['Ciro', s.sales, ps.sales], ['Adisyon', s.tickets, ps.tickets], ['Ortalama', s.average, ps.average]]);
  csv(ctx, 'Ürün değişimi', ['Ürün', 'Porsiyon', 'Bu dönem', 'Önceki', 'Fark'], ch.sort((a, b) => b.diff - a.diff).map(x => [x.name, x.portion, x.now, x.was, x.diff]));
  const lc = (l, pos) => ranks(l, { name: x => x.name + (x.portion && x.portion !== 'Normal' ? ' · ' + x.portion : ''), dv: x => x.name, val: 'diff', fmt: v => `${v > 0 ? '+' : ''}${mk(v)}`, right: x => `${mk(x.was)} → ${mk(x.now)}`, drill: 'prod', color: pos ? 'var(--good)' : 'var(--bad)', limit: 8 });
  const ds = delta(s.sales, ps.sales);
  return insight([`Ciro <b>${ds.txt}</b>: ${money(ps.sales)} → ${money(s.sales)} (${ds.p >= 0 ? '+' : ''}${money(s.sales - ps.sales)}).`,
    `Adisyon ${delta(s.tickets, ps.tickets).txt}, ortalama fiş ${delta(s.average, ps.average).txt} — ${Math.abs(delta(s.tickets, ps.tickets).p) > Math.abs(delta(s.average, ps.average).p) ? 'değişimin ana nedeni müşteri sayısı' : 'değişimin ana nedeni sepet tutarı'}.`,
    up[0] ? `En çok yükselen: <b>${esc(up[0].name)}</b> (+${money(up[0].diff)}).` : null, down[0] ? `En çok düşen: <b>${esc(down[0].name)}</b> (${money(down[0].diff)}).` : null]) +
    `<div class="kpis">${kpi('💰', '#4f8cff', 'Ciro', money(s.sales), ds, 'önceki: ' + mk(ps.sales))}${kpi('🧾', '#22c55e', 'Adisyon', num(s.tickets), delta(s.tickets, ps.tickets), 'önceki: ' + num(ps.tickets))}${kpi('🛒', '#f59e0b', 'Ortalama fiş', money(s.average), delta(s.average, ps.average), 'önceki: ' + mk(ps.average))}${kpi('💳', '#a78bfa', 'Tahsilat', money(sum(d.a.payments, 'amount')), delta(sum(d.a.payments, 'amount'), sum(d.b.payments, 'amount')), 'önceki: ' + mk(sum(d.b.payments, 'amount')))}</div>
    ${pa.length > 1 ? card('Gün gün karşılaştırma', lineChart(pa, pb, { legend: [rangeText(r), rangeText(d.p)], drill: 'day' })) : ''}
    <div class="cols">${card('📈 Yükselen ürünler', lc(up, true))}${card('📉 Düşen ürünler', lc(down, false))}</div>
    ${tbl('Ürün grupları', [{ l: 'Grup' }, { l: 'Önceki', n: 1 }, { l: 'Bu dönem', n: 1 }], (d.ua.groups || []).map(g => { const dd = delta(g.amount, gB[g.name] || 0); return { dr: 'group', dv: g.name, c: [`${esc(g.name)}<div class="sub ${dd.cls}">${dd.txt}</div>`, m2(gB[g.name] || 0), m2(g.amount)] }; }))}`;
}
function rUrun(d, ctx) {
  const g = d.groups || [], pr = d.products || [], gt = sum(g, 'amount'), p = ctx.prev, prevBy = {};
  ((p && p.products) || []).forEach(x => { prevBy[x.name + '|' + x.portion] = +x.amount || 0; });
  csv(ctx, 'Ürün grupları', ['Grup', 'Adet', 'Tutar'], g.map(x => [x.name, x.quantity, x.amount]));
  csv(ctx, 'Ürünler', ['Ürün', 'Porsiyon', 'Grup', 'Adet', 'Tutar'], pr.map(x => [x.name, x.portion, x.group, x.quantity, x.amount]));
  const tq = sum(pr, 'quantity'), top = pr[0], top5 = sum(pr.slice(0, 5), 'amount');
  return insight([top ? `En çok kazandıran: <b>${esc(top.name)}</b> · ${money(top.amount)} (%${pct1(top.amount, gt)}).` : null, pr.length > 5 ? `İlk 5 ürün cironun <b>%${pct1(top5, gt)}</b>'ini getiriyor.` : null, g[0] ? `En güçlü grup: <b>${esc(g[0].name)}</b> (%${pct1(g[0].amount, gt)}).` : null]) +
    `<div class="kpis">${kpi('💰', '#4f8cff', 'Ürün cirosu', money(gt), p && delta(gt, sum(p.groups, 'amount')))}${kpi('📦', '#22c55e', 'Satılan adet', num(tq), p && delta(tq, sum(p.products, 'quantity')))}${kpi('🥗', '#f59e0b', 'Çeşit', num(pr.length))}${kpi('🏷', '#a78bfa', 'Ortalama birim fiyat', money(tq ? gt / tq : 0))}</div>
    <div class="cols">${card('Ürün grupları', donut(g, 'amount', x => x.name, { drill: 'group' }) + '<p class="note">Gruba dokunun: gruptaki ürünler</p>')}${card('En çok kazandıran 8', ranks(pr, { name: x => x.name + (x.portion && x.portion !== 'Normal' ? ' · ' + x.portion : ''), dv: x => x.name, val: 'amount', right: x => num(x.quantity) + ' adet', drill: 'prod' }))}</div>
    ${tbl('Ürün Grubu Bazında', [{ l: 'Grup' }, { l: 'Pay', n: 1 }, { l: 'Tutar', n: 1 }], g.map(x => ({ dr: 'group', dv: x.name, c: [`${esc(x.name)}<div class="sub">${num(x.quantity)} adet</div>`, pcell(x.amount, gt), m2(x.amount)] })), { total: ['Toplam', '', m2(gt)] })}
    ${filterBox('Ürün ya da grup ara…')}${tbl('Tüm ürünler — dokunun: ürün detayı', [{ l: 'Ürün' }, { l: 'Adet', n: 1 }, { l: 'Tutar', n: 1 }], pr.map(x => { const dd = p ? delta(x.amount, prevBy[x.name + '|' + x.portion] || 0) : null; return { dr: 'prod', dv: x.name, c: [`${esc(x.name)}${x.portion && x.portion !== 'Normal' ? ` <span class="sub">${esc(x.portion)}</span>` : ''}<div class="sub">${esc(x.group)}${dd ? ` · <span class="${dd.cls}">${dd.txt}</span>` : ''}</div>`, num(x.quantity), m2(x.amount)] }; }), { total: ['Toplam', num(tq), m2(sum(pr, 'amount'))], limit: 15 })}`;
}
/* Menu muhendisligi (Kasavana & Smith): populerlik esigi = ortalama pay × %70; karlilik yerine birim fiyat (maliyet verisi yok) */
function rMenu(d, ctx) {
  const pr = (d.products || []).filter(x => +x.quantity > 0), n = pr.length, tq = sum(pr, 'quantity'), ta = sum(pr, 'amount');
  if (n < 4) return '<p class="empty">Menü mühendisliği için bu aralıkta yeterli satış yok (en az 4 ürün). Daha uzun bir aralık seçin (30 gün önerilir).</p>';
  const popT = tq / n * 0.7, priceT = ta / tq;
  const Q = { star: ['⭐ Yıldız', 'Çok satıyor, fiyatı yüksek. Koruyun, menüde öne çıkarın, kaliteyi bozmayın.', '#22c55e'], horse: ['🐴 Beygir', 'Çok satıyor ama birim fiyatı düşük. Küçük zam, porsiyon/maliyet optimizasyonu deneyin.', '#4f8cff'], puzzle: ['🧩 Bulmaca', 'Fiyatı yüksek ama az satıyor. Garsona önerdirin, menüde görünür yere taşıyın, fotoğraf ekleyin.', '#f59e0b'], dog: ['🐶 Köpek', 'Az satıyor, fiyatı düşük. Menüden çıkarmayı ya da yeniden tasarlamayı düşünün.', '#ef4444'] };
  pr.forEach(x => { const pop = +x.quantity >= popT, hi = (+x.amount / +x.quantity) >= priceT; x.q = pop ? (hi ? 'star' : 'horse') : (hi ? 'puzzle' : 'dog'); x.up = +x.amount / +x.quantity; });
  const by = k => pr.filter(x => x.q === k);
  csv(ctx, 'Menü mühendisliği', ['Ürün', 'Porsiyon', 'Adet', 'Birim fiyat', 'Ciro', 'Sınıf'], pr.map(x => [x.name, x.portion, x.quantity, x.up, x.amount, Q[x.q][0].replace(/^\S+ /, '')]));
  const W = 340, H = 220, mq = Math.max(...pr.map(x => +x.quantity)), mp = Math.max(...pr.map(x => x.up));
  const X = v => 20 + Math.sqrt(v / mq) * (W - 30), Y = v => H - 20 - (v / mp) * (H - 34);
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}"><line x1="${X(popT)}" x2="${X(popT)}" y1="8" y2="${H - 20}" stroke="var(--mut)" stroke-dasharray="4 4"/><line x1="16" x2="${W - 6}" y1="${Y(priceT)}" y2="${Y(priceT)}" stroke="var(--mut)" stroke-dasharray="4 4"/>
    <text x="${W - 8}" y="16" text-anchor="end" font-size="10" fill="#22c55e" font-weight="700">⭐ Yıldız</text><text x="${W - 8}" y="${H - 26}" text-anchor="end" font-size="10" fill="#4f8cff" font-weight="700">🐴 Beygir</text><text x="22" y="16" font-size="10" fill="#f59e0b" font-weight="700">🧩 Bulmaca</text><text x="22" y="${H - 26}" font-size="10" fill="#ef4444" font-weight="700">🐶 Köpek</text>
    ${pr.map(x => `<circle cx="${X(+x.quantity).toFixed(1)}" cy="${Y(x.up).toFixed(1)}" r="${(3 + Math.sqrt(+x.amount / ta) * 16).toFixed(1)}" fill="${Q[x.q][2]}" fill-opacity=".55" stroke="${Q[x.q][2]}"${dr('prod', x.name)} style="cursor:pointer"><title>${esc(x.name)} · ${num(x.quantity)} adet · birim ${money(x.up)}</title></circle>`).join('')}
    <text x="${W / 2}" y="${H - 4}" text-anchor="middle" font-size="9.5" fill="var(--mut)">satış adedi (popülerlik) →</text><text x="8" y="${H / 2}" font-size="9.5" fill="var(--mut)" transform="rotate(-90 8 ${H / 2})" text-anchor="middle">birim fiyat →</text></svg>`;
  return insight([`${n} ürün incelendi. Popülerlik eşiği ${num(popT)} adet, fiyat eşiği ${money(priceT)}.`, by('star').length ? `Yıldızlarınız: <b>${by('star').slice(0, 4).map(x => esc(x.name)).join(', ')}</b>.` : null, by('dog').length ? `Gözden geçirilecekler (köpek): <b>${by('dog').slice(0, 4).map(x => esc(x.name)).join(', ')}</b>.` : null, 'Not: maliyet bilgisi SambaPOS\'ta olmadığından kârlılık yerine birim satış fiyatı kullanıldı.']) +
    `<div class="quad">${['puzzle', 'star', 'dog', 'horse'].map(k => `<div style="border-color:${Q[k][2]}55"><b style="color:${Q[k][2]}">${Q[k][0]}</b><small>${Q[k][1]}</small><div class="n">${by(k).length} <small style="display:inline">ürün · ${mk(sum(by(k), 'amount'))}</small></div></div>`).join('')}</div>
    ${card('Ürün haritası', svg + '<p class="note">Daire büyüklüğü = ciro. Daireye dokunun: ürün detayı.</p>')}
    ${['star', 'horse', 'puzzle', 'dog'].map(k => by(k).length ? tbl(Q[k][0], [{ l: 'Ürün' }, { l: 'Adet', n: 1 }, { l: 'Birim', n: 1 }], by(k).sort((a, b) => b.amount - a.amount).map(x => ({ dr: 'prod', dv: x.name, c: [`${esc(x.name)}${x.portion && x.portion !== 'Normal' ? ` <span class="sub">${esc(x.portion)}</span>` : ''}<div class="sub">${mk(x.amount)} ciro</div>`, num(x.quantity), m2(x.up)] })), { limit: 8 }) : '').join('')}`;
}
/* Ay takvimi: aralikta kalan her ay icin Pazartesi baslangicli izgara; renk koyulugu = ciro, dokun = o gunun kasasi */
function rTakvim(d, ctx) {
  const by = {}; (d.daily || []).forEach(x => { by[x.date] = x; });
  const vals = Object.values(by).map(x => +x.amount || 0), mx = Math.max(1, ...vals), r = ctx.r, tday = baseToday();
  csv(ctx, 'Günlük ciro', ['Tarih', 'Adisyon', 'Ciro'], (d.daily || []).map(x => [x.date, x.count, x.amount]));
  const months = []; for (let m = parse(r.start.slice(0, 8) + '01'); ymd(m) <= r.end && months.length < 4; m.setMonth(m.getMonth() + 1)) months.push(new Date(m));
  const cal = m => {
    const y = m.getFullYear(), mo = m.getMonth(), first = (new Date(y, mo, 1).getDay() + 6) % 7, n = new Date(y, mo + 1, 0).getDate();
    let cells = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map(x => `<div class="cw">${x}</div>`).join('') + '<div></div>'.repeat(first);
    let mt = 0;
    for (let dd = 1; dd <= n; dd++) {
      const k = `${y}-${pad2(mo + 1)}-${pad2(dd)}`, x = by[k], v = x ? +x.amount : 0, inR = k >= r.start && k <= r.end; mt += v;
      cells += `<div class="cd${inR ? '' : ' out'}${k === tday ? ' today' : ''}"${v ? dr('day', k) : ''} style="${v ? `background:rgba(34,197,94,${(0.14 + v / mx * 0.8).toFixed(2)})` : ''}"><b>${dd}</b>${v ? `<span>${esc(mk(v).replace(' ₺', ''))}</span>` : ''}</div>`;
    }
    return card(`${['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'][mo]} ${y}`, `<div class="cal">${cells}</div>`, `toplam ${mk(mt)}`);
  };
  const dl = (d.daily || []).filter(x => +x.amount > 0), best = dl.reduce((a, b) => (+b.amount > +a.amount ? b : a), dl[0]);
  const wk = dl.filter(x => [0, 6].includes(parse(x.date).getDay())), wd = dl.filter(x => ![0, 6].includes(parse(x.date).getDay()));
  return insight([best ? `En iyi gün <b>${esc(fmtDay(best.date))}</b> · ${money(best.amount)}.` : null, wk.length && wd.length ? `Hafta sonu günlük ortalaması <b>${mk(sum(wk, 'amount') / wk.length)}</b>, hafta içi <b>${mk(sum(wd, 'amount') / wd.length)}</b>.` : null, nDays(r) < 20 ? 'Takvim için "Bu ay", "Geçen ay" ya da "3 ay" seçin.' : null]) +
    `<div class="cols">${months.map(cal).join('')}</div><p class="note">Koyu yeşil = yüksek ciro. Güne dokunun: o günün kasa raporu.</p>`;
}
/* 2.4 Stok: SambaPOS envanteri (son gun sonu kaydi) - rakiplerden Metrik'in stok raporunun karsiligi + eksi stok ve tuketim */
function rStok(d, ctx) {
  const it = d.items || [], cons = d.consumption || [], neg = it.filter(x => +x.stock < -0.001), tv = sum(it.filter(x => +x.stock > 0), 'value');
  csv(ctx, 'Stok', ['Malzeme', 'Grup', 'Birim', 'Stok', 'Birim maliyet', 'Değer'], it.map(x => [x.name, x.group, x.unit, x.stock, x.cost, x.value]));
  csv(ctx, 'Tüketim', ['Malzeme', 'Miktar', 'Birim', 'Maliyet'], cons.map(x => [x.name, x.quantity, x.unit, x.cost]));
  if (!it.length) return (d.errors && d.errors.length ? '' : '') + '<div class="strip"><span class="e">📦</span><span class="x"><b>Stok kaydı bulunamadı</b><small>SambaPOS\'ta envanter (stok malzemesi + reçete) tanımlı değilse ya da henüz gün sonu yapılmadıysa bu rapor boş gelir.</small></span></div>';
  const top = it.filter(x => +x.stock > 0).sort((a, b) => b.value - a.value);
  return insight([`${num(it.length)} malzeme · stok değeri <b>${money(tv)}</b>.`, neg.length ? `⚠️ <b>${neg.length} malzemenin stoğu eksiye düşmüş</b> — reçete, sayım ya da alım girişi eksik olabilir.` : 'Eksiye düşen stok yok ✓', cons[0] ? `Bu aralıkta en çok maliyet: <b>${esc(cons[0].name)}</b> (${money(cons[0].cost)}).` : null, 'Stok, SambaPOS\'taki son gün sonu envanter kaydından okunur.']) +
    `<div class="kpis">${kpi('📦', '#f59e0b', 'Stok değeri', money(tv))}${kpi('🧮', 'var(--acc)', 'Malzeme', num(it.length))}${kpi('📉', '#e11d48', 'Eksi stok', num(neg.length))}${kpi('🔥', '#22c55e', 'Aralıkta tüketim', money(sum(cons, 'cost')))}</div>
    ${neg.length ? tbl('📉 Eksiye düşen stoklar', [{ l: 'Malzeme' }, { l: 'Stok', n: 1 }], neg.map(x => ({ c: [`<b>${esc(x.name)}</b><div class="sub">${esc(x.group)}</div>`, `<span class="down">${nf1.format(x.stock)} ${esc(x.unit)}</span>`] })), { limit: 0 }) : ''}
    <div class="cols">${card('En değerli stoklar', ranks(top, { name: x => x.name, val: 'value', right: x => `${nf1.format(x.stock)} ${x.unit}`, limit: 8 }))}${card('En çok tüketilen (maliyet)', ranks(cons, { name: x => x.name, val: 'cost', right: x => `${nf1.format(x.quantity)} ${x.unit}`, limit: 8, color: 'var(--warn)' }))}</div>
    ${filterBox('Malzeme ya da grup ara…')}${tbl('Tüm stok', [{ l: 'Malzeme' }, { l: 'Stok', n: 1 }, { l: 'Değer', n: 1 }], it.map(x => ({ c: [`${esc(x.name)}<div class="sub">${esc(x.group)}${x.physical != null ? ' · sayım girildi' : ''} · giriş ${nf1.format(x.added)} · tüketim ${nf1.format(x.consumption)}</div>`, `<span class="${+x.stock < 0 ? 'down' : ''}">${nf1.format(x.stock)} ${esc(x.unit)}</span>`, m2(x.value)] })), { total: ['Toplam', '', m2(sum(it, 'value'))], limit: 20 })}`;
}
/* 2.4 Karlilik: SambaPOS recete maliyeti (CostItems) - hicbir rakipte yok. Menu muhendisligi burada GERCEK birim kar ile yapilir. */
function rKarlilik(d, ctx) {
  const all = d.products || [], pr = all.filter(x => x.unitCost != null && +x.quantity > 0), nc = all.filter(x => x.unitCost == null);
  csv(ctx, 'Kârlılık', ['Ürün', 'Porsiyon', 'Grup', 'Adet', 'Ciro', 'Birim maliyet', 'Maliyet', 'Kâr', 'Marj %'], all.map(x => [x.name, x.portion, x.group, x.quantity, x.amount, x.unitCost ?? '', x.cost ?? '', x.profit ?? '', x.unitCost != null && x.amount ? x.profit / x.amount * 100 : '']));
  if (!pr.length) return '<div class="strip"><span class="e">💹</span><span class="x"><b>Reçete maliyeti bulunamadı</b><small>SambaPOS\'ta ürünlere reçete (Ürünler › Reçeteler) ve stok malzemelerine alış fiyatı tanımlanıp gün sonu yapıldığında maliyet ve kâr burada hesaplanır.</small></span></div>';
  const rev = sum(pr, 'amount'), cost = sum(pr, 'cost'), prof = rev - cost;
  pr.forEach(x => { x.margin = x.amount ? x.profit / x.amount * 100 : 0; x.unitProfit = x.profit / x.quantity; });
  const g = {}; pr.forEach(x => { const b = g[x.group] || (g[x.group] = { name: x.group, profit: 0, amount: 0 }); b.profit += x.profit; b.amount += x.amount; });
  // menu muhendisligi (Kasavana-Smith): populerlik esigi ort. x %70, birim kar esigi = agirlikli ortalama
  const popT = sum(pr, 'quantity') / pr.length * 0.7, upT = prof / sum(pr, 'quantity');
  const Q = x => +x.quantity >= popT ? (x.unitProfit >= upT ? ['⭐ Yıldız', 'star'] : ['🐴 Beygir', 'iskonto']) : (x.unitProfit >= upT ? ['🧩 Bulmaca', 'ikram'] : ['🐶 Köpek', 'iptal']);
  const best = pr.slice().sort((a, b) => b.profit - a.profit), low = pr.filter(x => x.quantity >= 3).sort((a, b) => a.margin - b.margin);
  return insight([`Maliyeti tanımlı ürünlerde brüt kâr <b>${money(prof)}</b>, ortalama marj <b>%${pct1(prof, rev)}</b>.`, best[0] ? `En çok kâr getiren: <b>${esc(best[0].name)}</b> (${money(best[0].profit)}).` : null, low[0] ? `En düşük marj: <b>${esc(low[0].name)}</b> (%${nf1.format(low[0].margin)}) — fiyatı ya da reçeteyi gözden geçirin.` : null, nc.length ? `${nc.length} ürünün reçete maliyeti tanımlı değil (hesaba katılmadı).` : null]) +
    `<div class="kpis">${kpi('💰', 'var(--acc)', 'Ciro', money(rev))}${kpi('🧾', '#f59e0b', 'Maliyet', money(cost))}${kpi('💹', '#22c55e', 'Brüt kâr', money(prof))}${kpi('📊', '#a78bfa', 'Ortalama marj', '%' + pct1(prof, rev))}</div>
    <div class="cols">${card('Kâr — ürün grubuna göre', donut(Object.values(g), 'profit', x => x.name, { center: 'Kâr' }))}${card('En çok kâr getiren', ranks(best, { name: x => x.name + (x.portion !== 'Normal' ? ' · ' + x.portion : ''), dv: x => x.name, val: 'profit', right: x => `marj %${nf1.format(x.margin)} · ${num(x.quantity)} adet`, drill: 'prod', color: 'var(--good)' }))}</div>
    ${card('En düşük marjlı ürünler', ranks(low, { name: x => x.name + (x.portion !== 'Normal' ? ' · ' + x.portion : ''), dv: x => x.name, val: 'margin', fmt: v => '%' + nf1.format(v), right: x => `satış ${m2(x.amount / x.quantity)} · maliyet ${m2(x.unitCost)}`, drill: 'prod', color: 'var(--bad)', limit: 8 }))}
    ${filterBox('Ürün ya da grup ara…')}${tbl('Ürün kârlılığı + menü sınıfı (birim kâra göre)', [{ l: 'Ürün' }, { l: 'Marj', n: 1 }, { l: 'Kâr', n: 1 }], pr.sort((a, b) => b.profit - a.profit).map(x => ({ dr: 'prod', dv: x.name, c: [`${esc(x.name)}${x.portion !== 'Normal' ? ` <span class="sub">${esc(x.portion)}</span>` : ''} <span class="tag ${Q(x)[1]}">${Q(x)[0]}</span><div class="sub">${num(x.quantity)} adet · satış ${m2(x.amount / x.quantity)} · maliyet ${m2(x.unitCost)}</div>`, `%${nf1.format(x.margin)}`, m2(x.profit)] })), { total: ['Toplam', '%' + pct1(prof, rev), m2(prof)], limit: 20 })}`;
}
function rDepartman(d, ctx) {
  const dp = d.departments || [], tt = d.ticketTypes || [];
  csv(ctx, 'Departman', ['Departman', 'Adisyon', 'Ciro'], dp.map(x => [x.name, x.count, x.amount])); csv(ctx, 'Adisyon türü', ['Tür', 'Adisyon', 'Ciro'], tt.map(x => [x.name, x.count, x.amount]));
  const f = (l, t) => l.map(x => ({ c: [`${esc(x.name)}<div class="sub">${num(x.count)} adisyon · ort. ${m2(x.average)}</div>`, pcell(x.amount, t), m2(x.amount)] }));
  return insight([tt[0] ? `En büyük satış kanalı: <b>${esc(tt[0].name)}</b> (%${pct1(tt[0].amount, sum(tt, 'amount'))}).` : null, tt.length > 1 ? `En yüksek ortalama fiş: <b>${esc(tt.slice().sort((a, b) => b.average - a.average)[0].name)}</b>.` : null]) +
    `<div class="cols">${card('Adisyon türü', donut(tt, 'amount', x => x.name))}${card('Departman', donut(dp, 'amount', x => x.name))}</div>
    <div class="cols"><div>${tbl('Adisyon Türü', [{ l: 'Tür' }, { l: 'Pay', n: 1 }, { l: 'Ciro', n: 1 }], f(tt, sum(tt, 'amount')), { total: ['Toplam', '', m2(sum(tt, 'amount'))] })}</div><div>${tbl('Departman', [{ l: 'Departman' }, { l: 'Pay', n: 1 }, { l: 'Ciro', n: 1 }], f(dp, sum(dp, 'amount')), { total: ['Toplam', '', m2(sum(dp, 'amount'))] })}</div></div>`;
}
function rSaatlik(d, ctx) {
  const h = d.hourly || [], heat = d.heat || [], ht = sum(h, 'amount'), days = nDays(ctx.r);
  csv(ctx, 'Saatlik', ['Saat', 'Adisyon', 'Ciro'], h.map(x => [pad2(x.hour) + ':00', x.count, x.amount]));
  const by = {}; heat.forEach(x => { by[x.dow + '-' + x.hour] = x.days ? x.amount / x.days : x.amount; });
  const mx = Math.max(1, ...Object.values(by)), dn = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  let grid = '<div></div>' + Array.from({ length: 24 }, (_, i) => `<div>${i % 3 === 0 ? pad2(i) : ''}</div>`).join('');
  dn.forEach((n, di) => { grid += `<div>${n}</div>` + Array.from({ length: 24 }, (_, hh) => { const v = by[di + '-' + hh] || 0; return `<div class="c" title="${n} ${pad2(hh)}:00 · ortalama ${m0(v)}" style="${v ? `background:rgba(79,140,255,${(0.15 + v / mx * 0.85).toFixed(2)})` : ''}"></div>`; }).join(''); });
  const pk = h.reduce((a, b) => (+b.amount > +a.amount ? b : a), h[0] || {}), q = h.filter(x => +x.amount > 0).sort((a, b) => a.amount - b.amount)[0];
  const hotCell = heat.slice().sort((a, b) => (b.amount / (b.days || 1)) - (a.amount / (a.days || 1)))[0];
  return insight([pk.hour !== undefined ? `En yoğun saat <b>${pad2(pk.hour)}:00</b> · ${money(pk.amount)} (%${pct1(pk.amount, ht)}).` : null, q ? `En sakin açık saat: <b>${pad2(q.hour)}:00</b> — kampanya / happy hour için aday.` : null, hotCell && days >= 7 ? `Haftanın en yoğun anı: <b>${dn[hotCell.dow]} ${pad2(hotCell.hour)}:00</b> (ortalama ${m0(hotCell.amount / (hotCell.days || 1))}).` : null]) +
    `<div class="kpis">${kpi('🔥', '#ef4444', 'Zirve saat', pk.hour !== undefined ? pad2(pk.hour) + ':00' : '—', null, pk.amount ? mk(pk.amount) : '')}${kpi('⏱', '#4f8cff', 'Saat başı ortalama', mk(h.length ? ht / h.length : 0), null, `${h.length} açık saat`)}${kpi('🧾', '#22c55e', 'Adisyon', num(sum(h, 'count')))}${kpi('💰', '#f59e0b', 'Ciro', money(ht))}</div>
    ${card('Saatlik ciro', vbars(h.map(x => ({ ...x, lbl: pad2(x.hour) })), 'amount', x => x.lbl, { drill: 'hour', dv: x => x.hour, labels: 12 }))}
    ${heat.length ? card('Isı haritası', `<div class="heat">${grid}</div><p class="note">Gün başına ortalama ciro; koyu = yoğun. Personel vardiyası için 30 gün ya da 3 ay seçin.</p>`, 'gün × saat') : ''}
    ${tbl('Saat - Adisyon - Ciro', [{ l: 'Saat' }, { l: 'Pay', n: 1 }, { l: 'Ciro', n: 1 }], h.map(x => ({ dr: 'hour', dv: x.hour, c: [`${pad2(x.hour)}:00 – ${pad2(x.hour)}:59<div class="sub">${num(x.count)} adisyon · ort. ${m2(x.count ? x.amount / x.count : 0)}</div>`, pcell(x.amount, ht), m2(x.amount)] })), { total: ['Toplam', '', m2(ht)], limit: 24 })}`;
}
function rHaftagunu(d, ctx) {
  const l = (d.dow || []).map(x => ({ ...x, n: DOW[x.dow], avg: x.days ? x.amount / x.days : 0, avgC: x.days ? x.count / x.days : 0 }));
  csv(ctx, 'Haftanın günleri', ['Gün', 'Gün sayısı', 'Toplam', 'Günlük ortalama', 'Ort. adisyon'], l.map(x => [x.n, x.days, x.amount, x.avg, x.avgC]));
  if (!l.length) return '<p class="empty">Kayıt yok.</p>';
  const best = l.reduce((a, b) => (b.avg > a.avg ? b : a), l[0]), worst = l.reduce((a, b) => (b.avg < a.avg ? b : a), l[0]), tot = sum(l, 'amount');
  return insight([`En kazançlı gün <b>${best.n}</b> (günlük ort. ${money(best.avg)}), en zayıf <b>${worst.n}</b> (${money(worst.avg)}).`, best.avg && worst.avg ? `Fark <b>${nf1.format(best.avg / worst.avg)} kat</b> — ${worst.n} için kampanya düşünülebilir.` : null, nDays(ctx.r) < 14 ? 'Daha güvenilir sonuç için 30 gün ya da 3 ay seçin.' : null]) +
    card('Gün başına ortalama ciro', vbars(l, 'avg', x => x.n.slice(0, 3), { labels: 7 })) +
    tbl('Haftanın günleri', [{ l: 'Gün' }, { l: 'Pay', n: 1 }, { l: 'Günlük ort.', n: 1 }], l.map(x => ({ c: [`${x.n}<div class="sub">${num(x.days)} gün · ort. ${num(x.avgC)} adisyon · toplam ${mk(x.amount)}</div>`, pcell(x.amount, tot), m2(x.avg)] })), { limit: 0 });
}
function rGundilimi(d, ctx) {
  const B = [['🌅 Kahvaltı', 6, 10], ['☀️ Öğle', 11, 14], ['🌤 İkindi', 15, 17], ['🌙 Akşam', 18, 21], ['🌃 Gece', 22, 29]];
  const h = d.hourly || [], l = B.map(([n, a, b]) => { const hs = h.filter(x => { const hh = x.hour < 6 ? x.hour + 24 : x.hour; return hh >= a && hh <= b; }); return { name: n, range: `${pad2(a % 24)}:00–${pad2(b % 24)}:59`, amount: sum(hs, 'amount'), count: sum(hs, 'count') }; }).filter(x => x.amount > 0 || x.count > 0);
  const tot = sum(l, 'amount'); csv(ctx, 'Gün dilimleri', ['Dilim', 'Saat', 'Adisyon', 'Ciro'], l.map(x => [x.name, x.range, x.count, x.amount]));
  const best = l.reduce((a, b) => (b.amount > a.amount ? b : a), l[0] || {}), bestAvg = l.slice().sort((a, b) => (b.count ? b.amount / b.count : 0) - (a.count ? a.amount / a.count : 0))[0];
  return insight([best.name ? `Cironun en büyük kısmı <b>${best.name}</b> diliminden (%${pct1(best.amount, tot)}).` : null, bestAvg ? `En yüksek ortalama fiş: <b>${bestAvg.name}</b> (${money(bestAvg.count ? bestAvg.amount / bestAvg.count : 0)}).` : null]) +
    `<div class="cols">${card('Ciro dağılımı', donut(l, 'amount', x => x.name))}<div>${tbl('Gün dilimleri', [{ l: 'Dilim' }, { l: 'Pay', n: 1 }, { l: 'Ciro', n: 1 }], l.map(x => ({ c: [`${x.name}<div class="sub">${x.range} · ${num(x.count)} adisyon · ort. ${m2(x.count ? x.amount / x.count : 0)}</div>`, pcell(x.amount, tot), m2(x.amount)] })), { total: ['Toplam', '', m2(tot)], limit: 0 })}</div></div>`;
}
function rSaatlikUrun(d, ctx) {
  const rows = d.rows || [];
  csv(ctx, 'Saatlik ürün', ['Saat', 'Ürün', 'Adet', 'Tutar'], [].concat(...rows.map(h => h.items.map(i => [pad2(h.hour) + ':00', i.name, i.quantity, i.amount]))));
  return rows.length ? `<div class="cols">${rows.map(h => card(`🕓 ${pad2(h.hour)}:00`, ranks(h.items, { name: i => i.name, val: 'quantity', fmt: v => num(v) + ' adet', right: i => mk(i.amount), drill: 'prod' }), `${num(h.quantity)} ürün · ${mk(h.amount)}`)).join('')}</div>` : '<p class="empty">Bu aralıkta satış yok.</p>';
}
function rPersonel(d, ctx) {
  const s = d.sales || [], o = d.orders || [], st = sum(s, 'amount'), p = ctx.prev, prevBy = {}; ((p && p.sales) || []).forEach(x => { prevBy[x.name] = +x.amount || 0; });
  csv(ctx, 'Personel ciro', ['Personel', 'Adisyon', 'Ciro', 'Ortalama'], s.map(x => [x.name, x.count, x.amount, x.average]));
  csv(ctx, 'Sipariş giren', ['Personel', 'Adet', 'Tutar', 'Kayıp satır', 'Kayıp tutar'], o.map(x => [x.name, x.quantity, x.amount, x.lostCount, x.lostAmount]));
  const bestAvg = s.filter(x => x.count >= 3).sort((a, b) => b.average - a.average)[0], mostLost = o.slice().sort((a, b) => b.lostAmount - a.lostAmount)[0];
  return insight([s[0] ? `Ciro lideri <b>${esc(s[0].name)}</b> · ${money(s[0].amount)} (%${pct1(s[0].amount, st)}).` : null, bestAvg ? `En yüksek ortalama fiş: <b>${esc(bestAvg.name)}</b> (${money(bestAvg.average)}) — satış becerisi.` : null, mostLost && mostLost.lostAmount > 0 ? `En çok ikram/iptal giren: <b>${esc(mostLost.name)}</b> (${money(mostLost.lostAmount)}, ${num(mostLost.lostCount)} satır).` : null]) +
    `<div class="cols">${card('Ciro sıralaması', ranks(s, { name: x => x.name, val: 'amount', right: x => `${num(x.count)} adisyon · ort. ${mk(x.average)}`, drill: 'user', limit: 20 }) + '<p class="note">Kişiye dokunun: günlük performansı, sattığı ürünler, ikram/iptalleri.</p>')}${card('Ciro payı', donut(s, 'amount', x => x.name))}</div>
    ${tbl('Adisyon açan personel', [{ l: 'Personel' }, { l: 'Pay', n: 1 }, { l: 'Ciro', n: 1 }], s.map(x => { const dd = p ? delta(x.amount, prevBy[x.name] || 0) : null; return { dr: 'user', dv: x.name, c: [`${esc(x.name)}<div class="sub">${num(x.count)} adisyon · ort. ${m2(x.average)}${dd ? ` · <span class="${dd.cls}">${dd.txt}</span>` : ''}</div>`, pcell(x.amount, st), m2(x.amount)] }; }), { total: ['Toplam', '', m2(st)] })}
    ${tbl('Sipariş giren personel — satış ve kayıp', [{ l: 'Personel' }, { l: 'Satış', n: 1 }, { l: 'İkram/iptal', n: 1 }], o.map(x => ({ dr: 'user', dv: x.name, c: [`${esc(x.name)}<div class="sub">${num(x.quantity)} ürün</div>`, m2(x.amount), x.lostCount ? `<span class="down">${m2(x.lostAmount)}</span><div class="sub">${num(x.lostCount)} satır</div>` : '—'] })))}`;
}
function rPersonelDetay(d, ctx) {
  const dl = d.daily || [], h = d.hourly || [], pr = d.products || [], lost = d.lost || [], pay = d.payments || [], tot = sum(dl, 'amount'), cnt = sum(dl, 'count');
  const pts = dailyPts(dl, ctx.r);
  return `<div class="kpis">${kpi('💰', '#4f8cff', 'Ciro', money(tot))}${kpi('🧾', '#22c55e', 'Adisyon', num(cnt), null, `ort. ${mk(cnt ? tot / cnt : 0)}`)}${kpi('💳', '#a78bfa', 'Aldığı ödeme', money(sum(pay, 'amount')))}${kpi('⚠️', '#ef4444', 'İkram / iptal', money(sum(lost, 'amount')), null, `${lost.length} satır`)}</div>
    ${pts.length > 1 ? card('Günlük ciro', lineChart(pts, null, { drill: 'day', id: 7 })) : ''}
    ${h.length ? card('Saatlere göre', vbars(h.map(x => ({ ...x, lbl: pad2(x.hour) })), 'amount', x => x.lbl, { labels: 12 })) : ''}
    <div class="cols">${card('Sattığı ürünler', ranks(pr, { name: x => x.name, val: 'amount', right: x => num(x.quantity) + ' adet', drill: 'prod', limit: 10 }))}${pay.length ? card('Aldığı ödemeler', donut(pay, 'amount', x => x.name)) : ''}</div>
    ${lost.length ? tbl('İkram / iptal / iade girdikleri', [{ l: 'Ürün' }, { l: 'Tür' }, { l: 'Tutar', n: 1 }], lost.map(x => ({ dr: 'ticket', dv: x.id, c: [`${num(x.quantity)} × ${esc(x.name)}<div class="sub">${esc(String(x.date).slice(5, 16))} · Fiş ${esc(x.number)}</div>`, tag(x.kind), m2(x.amount)] }))) : ''}`;
}
function rUrunDetay(d, ctx) {
  const dl = d.daily || [], h = d.hourly || [], po = d.portions || [], us = d.users || [], pa = d.pairs || [], lo = d.lost || [];
  const q = sum(dl, 'quantity'), a = sum(dl, 'amount'), pts = dailyPts(dl, ctx.r, 'quantity');
  const pk = h.reduce((x, y) => (+y.quantity > +x.quantity ? y : x), h[0] || {});
  return insight([pk.hour !== undefined ? `En çok <b>${pad2(pk.hour)}:00</b> civarı satılıyor.` : null, pa[0] ? `Genelde <b>${esc(pa[0].name)}</b> ile birlikte alınıyor (${num(pa[0].count)} adisyon) — menü/kombo önerisi.` : null, us[0] ? `En çok satan personel: <b>${esc(us[0].name)}</b>.` : null]) +
    `<div class="kpis">${kpi('📦', '#22c55e', 'Satılan adet', num(q))}${kpi('💰', '#4f8cff', 'Ciro', money(a))}${kpi('🏷', '#f59e0b', 'Ortalama fiyat', money(q ? a / q : 0))}${kpi('⚠️', '#ef4444', 'İkram / iptal', money(sum(lo, 'amount')), null, lo.map(x => `${num(x.quantity)} ${KIND[x.kind] || x.kind}`).join(', ') || 'yok')}</div>
    ${pts.length > 1 ? card('Günlük satış adedi', lineChart(pts, null, { fmt: v => num(v) + ' adet', id: 8, drill: 'day' })) : ''}
    ${h.length ? card('Saatlere göre adet', vbars(h.map(x => ({ ...x, lbl: pad2(x.hour) })), 'quantity', x => x.lbl, { fmt: v => num(v), labels: 12 })) : ''}
    <div class="cols">${card('Birlikte satıldığı ürünler', ranks(pa, { name: x => x.name, val: 'count', fmt: v => num(v) + ' adisyon', drill: 'prod' }))}${card('Satan personel', ranks(us, { name: x => x.name, val: 'quantity', fmt: v => num(v) + ' adet', right: x => mk(x.amount), drill: 'user' }))}</div>
    ${po.length > 1 ? tbl('Porsiyonlar', [{ l: 'Porsiyon' }, { l: 'Adet', n: 1 }, { l: 'Tutar', n: 1 }], po.map(x => ({ c: [`${esc(x.name)}<div class="sub">ort. ${m2(x.price)}</div>`, num(x.quantity), m2(x.amount)] })), { limit: 0 }) : ''}`;
}
function rTahsilat(d, ctx) {
  const rows = d.rows || [], types = [...new Set(rows.map(x => x.type))], users = [...new Set(rows.map(x => x.user))];
  const cell = (u, t) => { const x = rows.find(r => r.user === u && r.type === t); return x ? +x.amount : 0; }, ut = u => types.reduce((a, t) => a + cell(u, t), 0);
  csv(ctx, 'Kullanıcı tahsilat', ['Kullanıcı'].concat(types, ['Toplam']), users.map(u => [u].concat(types.map(t => cell(u, t)), [ut(u)])));
  const ul = users.map(u => ({ name: u, amount: ut(u), cnt: rows.filter(r => r.user === u).reduce((a, r) => a + (+r.count || 0), 0) })).sort((a, b) => b.amount - a.amount);
  return insight([ul[0] ? `En çok tahsilat yapan: <b>${esc(ul[0].name)}</b> · ${money(ul[0].amount)}.` : null, 'Gün sonunda her kasiyerin kasasını bu tabloyla karşılaştırabilirsiniz (nakit sayımı).']) +
    `<div class="cols">${card('Kullanıcı bazında', ranks(ul, { name: x => x.name, val: 'amount', right: x => num(x.cnt) + ' ödeme', drill: 'user', limit: 20 }))}${card('Ödeme türü', donut(d.payments || [], 'amount', x => x.name))}</div>` +
    tbl('Kullanıcı × ödeme türü', [{ l: 'Kullanıcı' }].concat(types.map(t => ({ l: t, n: 1 })), [{ l: 'Toplam', n: 1 }]), users.map(u => ({ dr: 'user', dv: u, c: [esc(u)].concat(types.map(t => cell(u, t) ? m2(cell(u, t)) : '<span class="mut">—</span>'), [`<b>${m2(ut(u))}</b>`]) })), { total: ['Toplam'].concat(types.map(t => m2(users.reduce((a, u) => a + cell(u, t), 0))), [m2(sum(rows, 'amount'))]), limit: 0 });
}
function rIkram(d, ctx) {
  const t = d.totals || [], u = d.byUser || [], it = d.items || [];
  csv(ctx, 'Toplamlar', ['Tür', 'Satır', 'Adet', 'Tutar'], t.map(x => [KIND[x.kind] || x.kind, x.count, x.quantity, x.amount]));
  csv(ctx, 'Kullanıcı', ['Tür', 'Kullanıcı', 'Satır', 'Adet', 'Tutar'], u.map(x => [KIND[x.kind] || x.kind, x.user, x.count, x.quantity, x.amount]));
  csv(ctx, 'Detay', ['Tür', 'Tarih', 'Fiş', 'Ürün', 'Adet', 'Tutar', 'Kullanıcı', 'Neden'], it.map(x => [KIND[x.kind] || x.kind, x.date, x.number, x.name, x.quantity, x.amount, x.user, x.reason]));
  const prodBy = {}; it.forEach(x => { const b = prodBy[x.name] || (prodBy[x.name] = { name: x.name, amount: 0, quantity: 0 }); b.amount += +x.amount || 0; b.quantity += +x.quantity || 0; });
  const topP = Object.values(prodBy).sort((a, b) => b.amount - a.amount), userBy = {}; u.forEach(x => { const b = userBy[x.user] || (userBy[x.user] = { name: x.user, amount: 0, k: [] }); b.amount += +x.amount || 0; b.k.push(`${KIND[x.kind] || x.kind} ${mk(x.amount)}`); });
  const ul = Object.values(userBy).sort((a, b) => b.amount - a.amount);
  if (!t.length) return '<div class="strip ok"><span class="e">✅</span><span class="x"><b>Bu aralıkta ikram / iade / zayi / iptal yok</b></span></div>';
  return insight([`Toplam <b>${money(sum(t, 'amount'))}</b> hesaba yansımadı (${t.map(x => `${KIND[x.kind] || x.kind} ${mk(x.amount)}`).join(', ')}).`, ul[0] ? `En çok giren: <b>${esc(ul[0].name)}</b> (${money(ul[0].amount)}).` : null, topP[0] ? `En çok etkilenen ürün: <b>${esc(topP[0].name)}</b> (${num(topP[0].quantity)} adet).` : null]) +
    `<div class="kpis">${t.map(x => kpi(KICON[x.kind] || '•', KCOL[x.kind] || '#94a3b8', KIND[x.kind] || x.kind, money(x.amount), null, `${num(x.quantity)} adet · ${num(x.count)} satır`)).join('')}</div>
    <div class="cols">${card('Türe göre', donut(t, 'amount', x => KIND[x.kind] || x.kind, { colors: x => KCOL[x.kind] || '#94a3b8', center: 'Kayıp' }))}${card('Personele göre', ranks(ul, { name: x => x.name, val: 'amount', right: x => x.k.join(' · '), drill: 'user', color: 'var(--bad)' }))}</div>
    ${card('En çok etkilenen ürünler', ranks(topP, { name: x => x.name, val: 'amount', right: x => num(x.quantity) + ' adet', drill: 'prod', color: 'var(--warn)' }))}
    ${filterBox('Ürün, personel ya da neden ara…')}${tbl('Satır satır — dokunun: adisyonun tam logu', [{ l: 'Ürün' }, { l: 'Tür' }, { l: 'Tutar', n: 1 }], it.map(x => ({ dr: 'ticket', dv: x.id, c: [`${num(x.quantity)} × ${esc(x.name)}<div class="sub">${esc(x.date.slice(5, 16))} · Fiş ${esc(x.number)} · ${esc(x.user)}${x.reason ? ' · ' + esc(x.reason) : ''}</div>`, tag(x.kind), m2(x.amount)] })), { total: ['Toplam', '', m2(sum(it, 'amount'))], limit: 15 })}`;
}
function rIskonto(d, ctx) {
  const t = d.totals || [], it = d.items || [], neg = t.filter(x => x.amount < 0), disc = Math.abs(sum(neg, 'amount'));
  csv(ctx, 'İskonto toplamları', ['Tür', 'Adisyon', 'Tutar'], t.map(x => [x.name, x.count, x.amount]));
  csv(ctx, 'İskonto detay', ['Tarih', 'Fiş', 'Masa', 'Tür', 'Tutar', 'Kullanıcı'], it.map(x => [x.date, x.number, x.table, x.name, x.amount, x.user]));
  const userBy = {}; it.filter(x => x.amount < 0).forEach(x => { const b = userBy[x.user] || (userBy[x.user] = { name: x.user || 'Bilinmeyen', amount: 0, n: 0 }); b.amount += Math.abs(+x.amount); b.n++; });
  const ul = Object.values(userBy).sort((a, b) => b.amount - a.amount), big = it.filter(x => x.amount < 0).sort((a, b) => a.amount - b.amount)[0];
  return insight([disc ? `Toplam indirim <b>${money(disc)}</b>, ${num(it.filter(x => x.amount < 0).length)} adisyonda.` : 'Bu aralıkta indirim yok.', ul[0] ? `En çok indirim yapan: <b>${esc(ul[0].name)}</b> (${money(ul[0].amount)}).` : null, big ? `En büyük tek indirim: <b>${money(Math.abs(big.amount))}</b> · Fiş ${esc(big.number)} (fişin %${pct1(Math.abs(big.amount), +big.total + Math.abs(big.amount))}'i).` : null]) +
    `<div class="kpis">${kpi('💸', '#4f8cff', 'Toplam indirim', money(disc))}${kpi('🧾', '#22c55e', 'İndirimli adisyon', num(it.filter(x => x.amount < 0).length))}${kpi('➕', '#f59e0b', 'Ek hesaplama (servis vb.)', money(sum(t.filter(x => x.amount > 0), 'amount')))}${kpi('📊', '#a78bfa', 'Ortalama indirim', money(it.length ? disc / Math.max(1, it.filter(x => x.amount < 0).length) : 0))}</div>
    <div class="cols">${card('Türe göre', donut(t, 'amount', x => x.name))}${card('Personele göre', ranks(ul, { name: x => x.name, val: 'amount', right: x => num(x.n) + ' adisyon', drill: 'user' }))}</div>
    ${tbl('Adisyon adisyon — dokunun: detay', [{ l: 'Tarih / Fiş' }, { l: 'Tür' }, { l: 'Tutar', n: 1 }], it.map(x => ({ dr: 'ticket', dv: x.id, c: [`${esc(x.date.slice(5, 16))}<div class="sub">Fiş ${esc(x.number)}${x.table ? ' · ' + esc(x.table) : ''} · ${esc(x.user)}</div>`, `${esc(x.name)}<div class="sub">fiş ${m2(x.total)}</div>`, m2(x.amount)] })), { limit: 15 })}`;
}
function rIptalAdisyon(d, ctx) {
  const t = d.tickets || [], rf = d.refunds || [];
  csv(ctx, 'İptal/iade adisyonlar', ['Tarih', 'Fiş', 'Masa', 'Kullanıcı', 'Fiş toplam', 'İptal/iade', 'Tür'], t.map(x => [x.date, x.number, x.table, x.user, x.total, x.lost, x.kinds]));
  csv(ctx, 'İade ödemeleri', ['Tarih', 'Fiş', 'Tür', 'Tutar'], rf.map(x => [x.date, x.number, x.name, x.amount]));
  return insight([t.length ? `${num(t.length)} adisyonda toplam <b>${money(sum(t, 'lost'))}</b> iptal/iade.` : 'Bu aralıkta iptal/iade içeren adisyon yok.', rf.length ? `${num(rf.length)} eksi (iade) ödeme: <b>${money(sum(rf, 'amount'))}</b>.` : null]) +
    `<div class="kpis">${kpi('🧾', '#ef4444', 'Adisyon', num(t.length))}${kpi('❌', '#ef4444', 'İptal / iade tutarı', money(sum(t, 'lost')))}${kpi('↩️', '#a78bfa', 'İade ödemesi', money(sum(rf, 'amount')))}${kpi('⏳', '#f59e0b', 'Hâlâ açık', num(t.filter(x => x.closed !== '1').length))}</div>` +
    tbl('Adisyonlar — dokunun: tam log', [{ l: 'Fiş' }, { l: 'Tür' }, { l: 'Tutar', n: 1 }], t.map(x => ({ dr: 'ticket', dv: x.id, c: [`${esc(x.date.slice(5, 16))} · Fiş ${esc(x.number)}<div class="sub">${esc(x.table)}${x.table ? ' · ' : ''}${esc(x.user)} · fiş ${m2(x.total)}${x.note ? ' · ' + esc(x.note) : ''}</div>`, String(x.kinds).split(',').map(tag).join(' ') + `<div class="sub">${num(x.count)} satır</div>`, m2(x.lost)] })), { total: ['Toplam', '', m2(sum(t, 'lost'))], limit: 15 }) +
    (rf.length ? tbl('Eksi (iade) ödemeler', [{ l: 'Tarih / Fiş' }, { l: 'Tür' }, { l: 'Tutar', n: 1 }], rf.map(x => ({ dr: 'ticket', dv: x.id, c: [`${esc(x.date.slice(5, 16))}<div class="sub">Fiş ${esc(x.number)}</div>`, esc(x.name), m2(x.amount)] }))) : '');
}
function rMusteri(d, ctx) {
  const c = d.customers || [], tot = sum(c, 'amount'), rep = c.filter(x => x.count > 1), today = parse(baseToday());
  csv(ctx, 'Müşteriler', ['Müşteri', 'Adisyon', 'Toplam', 'Ortalama', 'İlk', 'Son'], c.map(x => [x.name, x.count, x.amount, x.average, x.first, x.last]));
  if (!c.length) return '<p class="empty">Bu aralıkta müşteri atanmış adisyon yok. (SambaPOS\'ta adisyonlara müşteri seçildiğinde burada görünür — paket servis müşterileri gibi.)</p>';
  const top10 = sum(c.slice(0, Math.max(1, Math.ceil(c.length * 0.2))), 'amount');
  return insight([`${num(c.length)} müşteri · toplam ${money(tot)} · müşteri başı <b>${money(tot / c.length)}</b>.`, `Tekrar gelen müşteri oranı <b>%${pct1(rep.length, c.length)}</b> (${num(rep.length)} kişi).`, c.length >= 5 ? `En değerli %20'lik müşteri kitlesi cironun <b>%${pct1(top10, tot)}</b>'ini getiriyor.` : null]) +
    `<div class="kpis">${kpi('👥', '#f472b6', 'Müşteri', num(c.length))}${kpi('🔁', '#22c55e', 'Tekrar gelen', '%' + pct1(rep.length, c.length), null, num(rep.length) + ' kişi')}${kpi('💰', '#4f8cff', 'Müşteri başı', money(tot / c.length))}${kpi('🧾', '#f59e0b', 'Ortalama fiş', money(sum(c, 'count') ? tot / sum(c, 'count') : 0))}</div>
    ${card('En değerli müşteriler', ranks(c, { name: x => x.name, val: 'amount', right: x => `${num(x.count)} sipariş · son ${fmtDay(String(x.last).slice(0, 10))}`, limit: 10 }))}
    ${filterBox('Müşteri ara…')}${tbl('Tüm müşteriler', [{ l: 'Müşteri' }, { l: 'Sipariş', n: 1 }, { l: 'Toplam', n: 1 }], c.map(x => { const ago = Math.round((today - parse(x.last)) / 86400000); return { c: [`${esc(x.name)}<div class="sub">ort. ${m2(x.average)} · son ${ago <= 0 ? 'bugün' : ago + ' gün önce'}</div>`, num(x.count), m2(x.amount)] }; }), { limit: 20 })}`;
}
function rVeresiye(d, ctx) {
  const o = d.open || [], ac = d.accounts || [], types = [...new Set(ac.map(x => x.type))];
  csv(ctx, 'Açık adisyonlar (veresiye)', ['Müşteri', 'Adisyon', 'Kalan', 'Son'], o.map(x => [x.name, x.count, x.amount, x.last]));
  csv(ctx, 'Hesap bakiyeleri', ['Hesap', 'Tür', 'Bakiye', 'Son hareket'], ac.map(x => [x.name, x.type, x.balance, x.last]));
  const cust = ac.filter(x => /müşteri|musteri|customer|cari/i.test(x.type)), ct = sum(cust.filter(x => x.balance > 0), 'balance');
  return insight([o.length ? `Kapanmış ama tam ödenmemiş adisyonlarda <b>${money(sum(o, 'amount'))}</b> alacak (${num(sum(o, 'count'))} adisyon).` : 'Tahsil edilmemiş kapalı adisyon yok.', ct ? `Müşteri hesaplarında toplam <b>${money(ct)}</b> borç bakiyesi.` : null, 'Bu rapor tarih aralığından bağımsızdır — bugünkü bakiyeyi gösterir.']) +
    `<div class="kpis">${kpi('📒', '#ef4444', 'Ödenmemiş adisyon', money(sum(o, 'amount')), null, num(sum(o, 'count')) + ' adisyon')}${kpi('👥', '#f472b6', 'Borçlu müşteri hesabı', num(cust.filter(x => x.balance > 0).length), null, ct ? mk(ct) : '')}</div>
    ${tbl('Ödenmemiş (veresiye) adisyonlar', [{ l: 'Müşteri' }, { l: 'Adisyon', n: 1 }, { l: 'Kalan', n: 1 }], o.map(x => ({ c: [`${esc(x.name)}<div class="sub">son ${esc(String(x.last).slice(0, 10))}</div>`, num(x.count), `<b class="down">${m2(x.amount)}</b>`] })), { total: ['Toplam', num(sum(o, 'count')), m2(sum(o, 'amount'))] })}
    ${types.map(ty => { const l = ac.filter(x => x.type === ty); return tbl(`Hesaplar · ${ty || 'Diğer'}`, [{ l: 'Hesap' }, { l: 'Bakiye', n: 1 }], l.map(x => ({ c: [`${esc(x.name)}<div class="sub">son hareket ${esc(String(x.last).slice(0, 10))}</div>`, `<span class="${x.balance > 0 ? 'down' : 'up'}">${m2(x.balance)}</span>`] })), { total: ['Toplam', m2(sum(l, 'balance'))], limit: 8 }); }).join('')}
    <p class="note">Bakiye = borç − alacak (SambaPOS hesap hareketleri). Artı bakiye müşterinin size borcu demektir.</p>`;
}
function rPaketci(d, ctx) {
  const c = d.couriers || [], pk = (d.packages || [])[0] || {}, ct = sum(c, 'amount');
  csv(ctx, 'Paketçi', ['Kurye', 'Paket', 'Tutar', 'Ortalama', 'İlk', 'Son'], c.map(x => [x.name, x.count, x.amount, x.average, x.first, x.last]));
  return insight([c[0] ? `En çok paket götüren: <b>${esc(c[0].name)}</b> (${num(c[0].count)} paket, ${money(c[0].amount)}).` : null, pk.count ? `Paket satış ortalama fişi <b>${money(pk.average)}</b>.` : null]) +
    `<div class="kpis">${kpi('📦', '#2dd4bf', 'Paket adisyon', num(pk.count))}${kpi('💰', '#4f8cff', 'Paket cirosu', money(pk.amount))}${kpi('🛒', '#f59e0b', 'Ortalama paket', money(pk.average))}${kpi('🛵', '#a78bfa', 'Kurye', num(c.length))}</div>` +
    (c.length ? `<div class="cols">${card('Kurye sıralaması', ranks(c, { name: x => x.name, val: 'count', fmt: v => num(v) + ' paket', right: x => mk(x.amount) }))}${card('Tutar payı', donut(c, 'amount', x => x.name))}</div>` : '') +
    tbl('Kurye bazında', [{ l: 'Kurye' }, { l: 'Pay', n: 1 }, { l: 'Tutar', n: 1 }], c.map(x => ({ c: [`${esc(x.name)}<div class="sub">${num(x.count)} paket · ort. ${m2(x.average)} · ${esc(String(x.first).slice(11, 16))}–${esc(String(x.last).slice(11, 16))}</div>`, pcell(x.amount, ct), m2(x.amount)] })), { total: ['Toplam', '', m2(ct)] }) +
    (c.length ? '' : '<p class="note">SambaPOS\'ta "Paketçi" / "Kurye" varlık tipi bulunamadı ya da adisyonlara kurye atanmamış.</p>');
}
function rSepet(d, ctx) {
  const pa = d.pairs || [], sz = d.sizes || [], tc = sum(sz, 'count'), avg = tc ? sz.reduce((a, x) => a + x.items * x.count, 0) / tc : 0, one = (sz.find(x => x.items === 1) || {}).count || 0;
  csv(ctx, 'Birlikte satılanlar', ['Ürün A', 'Ürün B', 'Adisyon'], pa.map(x => [x.a, x.b, x.count])); csv(ctx, 'Sepet büyüklüğü', ['Ürün sayısı', 'Adisyon', 'Ciro'], sz.map(x => [x.items, x.count, x.amount]));
  return insight([`Adisyon başına ortalama <b>${nf1.format(avg)} ürün</b>.`, tc ? `Tek ürünlük adisyon oranı <b>%${pct1(one, tc)}</b> — ek ürün önerisi (içecek, tatlı) için fırsat.` : null, pa[0] ? `En güçlü ikili: <b>${esc(pa[0].a)} + ${esc(pa[0].b)}</b> (${num(pa[0].count)} adisyon) — kombo menü adayı.` : null]) +
    `<div class="kpis">${kpi('🛒', '#22c55e', 'Ortalama ürün / adisyon', nf1.format(avg))}${kpi('1️⃣', '#f59e0b', 'Tek ürünlük adisyon', '%' + pct1(one, tc), null, num(one) + ' adisyon')}</div>
    ${card('Sepet büyüklüğü', vbars(sz.map(x => ({ ...x, lbl: x.items >= 8 ? '8+' : String(x.items) })), 'count', x => x.lbl, { fmt: v => num(v) + ' adisyon', labels: 9 }), 'ürün sayısına göre adisyon')}
    ${tbl('En çok birlikte satılan ikililer', [{ l: 'Ürünler' }, { l: 'Adisyon', n: 1 }], pa.map(x => ({ dr: 'prod', dv: x.a, c: [`${esc(x.a)} <span class="mut">+</span> ${esc(x.b)}`, num(x.count)] })), { limit: 15 })}`;
}
function rMasa(d, ctx) {
  const t = d.tables || [], sp = d.speed || [], tt = sum(t, 'amount'), wAvg = sum(sp, 'count') ? sp.reduce((a, x) => a + x.minutes * x.count, 0) / sum(sp, 'count') : 0;
  csv(ctx, 'Masa', ['Masa', 'Adisyon', 'Ciro', 'Ortalama', 'Ort. süre (dk)'], t.map(x => [x.name, x.count, x.amount, x.average, x.minutes]));
  csv(ctx, 'Servis hızı', ['Saat', 'Adisyon', 'Ort. süre (dk)'], sp.map(x => [pad2(x.hour) + ':00', x.count, x.minutes]));
  t.forEach(x => { x.perHour = x.minutes ? x.amount / (x.count * x.minutes / 60) : 0; });
  const eff = t.filter(x => x.perHour > 0).sort((a, b) => b.perHour - a.perHour), slow = sp.slice().sort((a, b) => b.minutes - a.minutes)[0];
  return insight([wAvg ? `Adisyonlar ortalama <b>${dur(wAvg)}</b> açık kalıyor.` : null, slow ? `En uzun oturma <b>${pad2(slow.hour)}:00</b>'da açılan adisyonlarda (${dur(slow.minutes)}).` : null, eff[0] ? `En verimli masa <b>${esc(eff[0].name)}</b> (saatte ${money(eff[0].perHour)}), en verimsiz <b>${esc(eff[eff.length - 1].name)}</b>.` : null]) +
    `<div class="kpis">${kpi('⏱', '#a78bfa', 'Ortalama oturma', wAvg ? dur(wAvg) : '—')}${kpi('🪑', '#4f8cff', 'Masa sayısı', num(t.length))}${kpi('💰', '#22c55e', 'Masa başı ciro', money(t.length ? tt / t.length : 0))}${kpi('🔁', '#f59e0b', 'Masa başı adisyon', nf1.format(t.length ? sum(t, 'count') / t.length : 0))}</div>
    ${sp.length ? card('Açılış saatine göre oturma süresi', vbars(sp.map(x => ({ ...x, lbl: pad2(x.hour) })), 'minutes', x => x.lbl, { fmt: v => dur(v), color: 'var(--vio)', best: 'var(--bad)', labels: 12 })) : ''}
    ${tbl('Masa performansı', [{ l: 'Masa' }, { l: 'Saatte', n: 1 }, { l: 'Ciro', n: 1 }], t.map(x => ({ c: [`${esc(x.name)}<div class="sub">${num(x.count)} adisyon · ort. ${m2(x.average)}${x.minutes ? ' · ' + dur(x.minutes) : ''}</div>`, x.perHour ? mk(x.perHour) : '—', m2(x.amount)] })), { total: ['Toplam', '', m2(tt)], limit: 15 })}
    <p class="note">"Saatte" = masanın dolu olduğu her saat için ortalama ciro. Az ciro + uzun süre = verimsiz masa.</p>`;
}
function rAdisyonlar(d, ctx) {
  const t = d.tickets || [];
  csv(ctx, 'Adisyonlar', ['Tarih', 'Fiş', 'Masa', 'Kullanıcı', 'Toplam', 'Kalan', 'Kapalı'], t.map(x => [x.date, x.number, x.table, x.user, x.total, x.remaining, x.closed]));
  return `<div class="kpis">${kpi('🧾', '#4f8cff', 'Adisyon', num(t.length) + (t.length >= 500 ? '+' : ''))}${kpi('💰', '#22c55e', 'Toplam', money(sum(t, 'total')))}${kpi('⏳', '#f59e0b', 'Açık', num(t.filter(x => x.closed !== '1').length))}${kpi('📉', '#ef4444', 'Kalan bakiye', money(sum(t, 'remaining')))}</div>` +
    filterBox('Fiş no, masa ya da personel ara…') + tbl('Adisyonlar — dokunun: tam log', [{ l: 'Fiş' }, { l: 'Masa / personel' }, { l: 'Tutar', n: 1 }], t.map(x => ({ dr: 'ticket', dv: x.id, c: [`<b>${esc(x.number)}</b><div class="sub">${esc(x.date.slice(5, 16))}</div>`, `${esc(x.table || '—')}<div class="sub">${esc(x.user)}${x.closed === '1' ? '' : ' <span class="tag acik">açık</span>'}</div>`, m2(x.total)] })), { total: ['Toplam', '', m2(sum(t, 'total'))], limit: 25 });
}

/* ================================================================== FIYAT */
let menu = null, mGroup = '', pTab = 'list';
$('priceTabs').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (!b) return; pTab = b.dataset.p; document.querySelectorAll('#priceTabs button').forEach(x => x.classList.toggle('on', x === b)); ['list', 'bulk', 'hist'].forEach(k => $('p-' + k).classList.toggle('hide', k !== pTab)); if (pTab === 'hist') loadHist(); });
async function loadMenu(force) {
  if (menu && !force) return renderMenu();
  try { menu = await api('/api/menu-items'); renderMenu(); } catch (err) { $('mList').innerHTML = `<div class="errbox">${esc(err.message)}</div>`; }
}
function renderMenu() {
  const items = menu.items || [], groups = [...new Set(items.map(i => i.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  $('mGroups').innerHTML = `<button data-g="" class="${mGroup ? '' : 'on'}">Tümü ${items.length}</button>` + groups.map(g => `<button data-g="${esc(g)}" class="${mGroup === g ? 'on' : ''}">${esc(g)}</button>`).join('');
  const bg = $('bGroup'), bv = bg.value; bg.innerHTML = '<option value="*">Tüm menü</option>' + groups.map(g => `<option>${esc(g)}</option>`).join(''); if (bv) bg.value = bv;
  const tags = [...new Set(items.map(i => i.tagLabel))], tv = $('bTag').value; $('bTag').innerHTML = '<option value="">Hepsi</option>' + tags.map(t => `<option>${esc(t)}</option>`).join(''); $('bTag').value = tv;
  const q = $('mSearch').value.trim().toLocaleLowerCase('tr');
  const list = items.filter(i => (!mGroup || i.group === mGroup) && (!q || i.name.toLocaleLowerCase('tr').includes(q))).slice(0, 300);
  $('mList').innerHTML = list.length ? list.map(i => `<div class="pr" data-pid="${esc(i.priceId)}"><div>${esc(i.name)}<div class="m">${[i.portion !== 'Normal' ? i.portion : '', i.tagLabel !== 'Standart' ? i.tagLabel : '', i.group].filter(Boolean).map(esc).join(' · ')}</div></div><span class="p" data-price>${money(i.price)}</span><button class="btng" data-edit>Değiştir</button></div>`).join('') : '<p class="empty">Ürün bulunamadı.</p>';
}
$('mSearch').addEventListener('input', () => menu && renderMenu());
$('mGroups').addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (b) { mGroup = b.dataset.g; renderMenu(); } });
async function setPrice(item, price) { const r = await post('/api/menu-price', { priceId: item.priceId, price: String(price), name: item.name, portion: item.portion, tagLabel: item.tagLabel }); item.price = r.newPrice; return r; }
$('mList').addEventListener('click', async e => {
  const row = e.target.closest('.pr'); if (!row) return;
  const item = menu.items.find(i => String(i.priceId) === row.dataset.pid);
  if (e.target.closest('[data-edit]')) {
    const ex = row.querySelector('.ed'); if (ex) { ex.remove(); return; }
    const ed = document.createElement('div'); ed.className = 'ed';
    ed.innerHTML = `<input inputmode="decimal" placeholder="Yeni fiyat" value="${esc(String(item.price).replace('.', ','))}"><button class="btnp" data-save>Kaydet</button><span></span>`;
    row.appendChild(ed); const inp = ed.querySelector('input'); inp.focus(); inp.select(); return;
  }
  const sv = e.target.closest('[data-save]'); if (!sv) return;
  const ed = row.querySelector('.ed'), msg = ed.querySelector('span'), raw = ed.querySelector('input').value.trim(), v = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) { msg.className = 'bad'; msg.textContent = 'Geçerli bir fiyat yazın (ör. 125 ya da 12,50)'; return; }
  sv.disabled = true;
  try { const r = await setPrice(item, v); row.querySelector('[data-price]').textContent = money(r.newPrice); msg.className = 'ok'; msg.textContent = `✓ ${money(r.oldPrice)} → ${money(r.newPrice)}`; setTimeout(() => ed.remove(), 2500); }
  catch (err) { msg.className = 'bad'; msg.textContent = err.message; sv.disabled = false; }
});
let bulkPlan = [];
$('bPreview').onclick = async () => {
  await loadMenu(); const out = $('bOut'), g = $('bGroup').value, t = $('bTag').value, pc = Number(String($('bPct').value).replace(',', '.')), rd = Number($('bRound').value);
  if (!pc) { out.innerHTML = '<p class="bad">Yüzde yazın (ör. 10 ya da -5).</p>'; return; }
  const round = v => rd ? Math.max(rd, Math.round(v / rd) * rd) : Math.round(v * 100) / 100;
  bulkPlan = menu.items.filter(i => (g === '*' || i.group === g) && (!t || i.tagLabel === t) && +i.price > 0).map(i => ({ i, nv: round(i.price * (1 + pc / 100)) })).filter(x => x.nv !== +x.i.price);
  if (!bulkPlan.length) { out.innerHTML = '<p class="empty">Değişecek fiyat yok.</p>'; return; }
  const so = bulkPlan.reduce((a, x) => a + +x.i.price, 0), sn = bulkPlan.reduce((a, x) => a + x.nv, 0);
  out.innerHTML = `<div style="max-height:340px;overflow:auto;margin:10px 0">${bulkPlan.map(x => `<div class="li"><div>${esc(x.i.name)}<div class="m">${esc([x.i.portion !== 'Normal' ? x.i.portion : '', x.i.tagLabel].filter(Boolean).join(' · '))}</div></div><b class="r">${money(x.i.price)} → <span class="${x.nv > x.i.price ? 'up' : 'down'}">${money(x.nv)}</span></b></div>`).join('')}</div>
    <p class="note">${bulkPlan.length} fiyat değişecek · ortalama %${nf1.format((sn - so) / so * 100)}. Geri almak için ters yüzde uygulayabilirsiniz (fiyat geçmişine de yazılır).</p>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btnp" id="bApply">Onayla ve uygula (${bulkPlan.length})</button><button class="btng" id="bCancel">Vazgeç</button></div><p id="bProg" class="note"></p>`;
  $('bCancel').onclick = () => { out.innerHTML = ''; };
  $('bApply').onclick = async () => {
    $('bApply').disabled = true; let ok = 0, bad = 0;
    for (const x of bulkPlan) { try { await setPrice(x.i, x.nv.toFixed(2)); ok++; } catch { bad++; } $('bProg').textContent = `${ok + bad} / ${bulkPlan.length} işlendi${bad ? ` · ${bad} hata` : ''}`; }
    $('bProg').className = bad ? 'bad' : 'ok'; $('bProg').textContent = `${bad ? '⚠' : '✓'} ${ok} fiyat güncellendi${bad ? `, ${bad} hata` : ''}.`; renderMenu();
  };
};
async function loadHist() {
  const box = $('hBox'); box.innerHTML = skel(2);
  try {
    const [pc, mi] = await Promise.all([api('/api/price-changes?days=' + $('hDays').value), menu ? Promise.resolve(menu) : api('/api/menu-items')]);
    const log = (mi.recent || []).map(l => { const p = String(l).split(' | '); return `<div class="li"><div>${esc(p[1] || '')}<div class="m">${esc(String(p[0] || '').slice(0, 16).replace('T', ' '))} · panelden</div></div><b class="r">${esc(p[2] || '')}</b></div>`; }).join('');
    box.innerHTML = (log ? `<div class="ch">Panelden yapılan son değişiklikler</div>${log}<div class="ch" style="margin-top:16px">Siparişlere yansıyan fiyat değişimleri</div>` : '') +
      ((pc.changes || []).map(c => `<div class="li"><div>${esc(c.name)}<div class="m">${esc(c.date)}</div></div><b class="r">${money(c.oldPrice)} → <span class="${c.difference > 0 ? 'up' : 'down'}">${money(c.newPrice)}</span></b></div>`).join('') || '<p class="empty">Değişim yok.</p>');
  } catch (err) { box.innerHTML = `<div class="errbox">${esc(err.message)}</div>`; }
}
$('hDays').onchange = loadHist;

/* ================================================================== BILDIRIM */
let noteFilter = 'all';
const noteKey = n => `${n.kind}|${n.date}|${n.ticket}|${n.id || ''}`;
const noteKeyTop = () => { const l = (home && home.notifications) || []; return l.length ? noteKey(l[0]) : ''; };
function renderNoteCount() {
  const l = (home && home.notifications) || [], seen = store.get('p3-seen', ''), today = baseToday();
  let n = 0; for (const x of l) { if (noteKey(x) === seen) break; if (String(x.date) >= today) n++; }
  const c = $('noteCnt'); c.textContent = n > 99 ? '99+' : n; c.classList.toggle('hide', !n || view === 'bildirim');
}
function renderNotes() {
  const l = (home && home.notifications) || [], kinds = ['all'].concat(Object.keys(KIND).filter(k => l.some(x => x.kind === k)));
  $('noteTabs').innerHTML = kinds.map(k => `<button data-f="${k}" class="${noteFilter === k ? 'on' : ''}">${k === 'all' ? 'Tümü' : (KICON[k] + ' ' + KIND[k])} ${k === 'all' ? l.length : l.filter(x => x.kind === k).length}</button>`).join('');
  const list = l.filter(x => noteFilter === 'all' || x.kind === noteFilter), today = baseToday();
  let lastDay = '', html = '';
  list.forEach(n => {
    const day = String(n.date).slice(0, 10); if (day !== lastDay) { lastDay = day; html += `<div class="nday">${day === today ? 'Bugün' : day === addDays(today, -1) ? 'Dün' : fmtDay(day)}</div>`; }
    const g = PLAINK.includes(n.kind);
    html += `<div class="nt"${g || !n.ticket ? '' : dr('tno', n.ticket)}><span class="e" style="background:${(KCOL[n.kind] || '#2dd4bf')}22">${KICON[n.kind] || '•'}</span><div><div class="h">${esc(KIND[n.kind] || n.kind)}${g ? '' : ' · Fiş ' + esc(n.ticket)}<span>${esc(String(n.date).slice(11, 16))}</span></div><div class="b">${g ? '' : `<b>${money(Math.abs(n.amount))}</b> — `}${esc(n.detail || '')}</div></div></div>`;
  });
  $('noteBox').innerHTML = html || '<p class="empty">Son 2 günde kayıt yok.</p>';
}
$('noteTabs').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { noteFilter = b.dataset.f; renderNotes(); } });


/* ---- telefona anlik bildirim (Web Push) */
const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); };
async function pushSub() { if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null; const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); }
async function renderPush() {
  const box = $('pushBox');
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.isSecureContext) {
    box.innerHTML = `<div class="ch">📲 Telefona anlık bildirim</div><p class="note" style="margin:0">Bu tarayıcı/adres anlık bildirimi desteklemiyor. Telefonda <b>https://</b> ile açılan patron adresinden (Ayarlar'da yazar) açıp “Ana ekrana ekle” yapın; iPhone'da iOS 16.4+ gerekir.</p>`; return;
  }
  let sub = null, st = {}; try { sub = await pushSub(); st = await api('/api/push/status?endpoint=' + encodeURIComponent(sub ? sub.endpoint : '')); } catch { /* yok */ }
  const on = !!(sub && st.subscribed), kinds = on ? (st.kinds || []) : ['iptal', 'iade', 'ikram', 'zayi', 'gun-sonu', 'fiyat', 'eksi-stok'], min = on ? st.min || 0 : 0;
  box.innerHTML = `<div class="ch"><span>📲 Telefona anlık bildirim</span><small>${on ? '<span class="up">● açık</span>' : 'kapalı'}</small></div>
    <p class="note" style="margin:0">Uygulama kapalıyken de iptal, ikram, iskonto… anında telefonunuza düşer.</p>
    <div class="chk">${Object.keys(KIND).map(k => `<label><input type="checkbox" value="${k}" ${kinds.includes(k) ? 'checked' : ''}>${KICON[k]} ${KIND[k]}</label>`).join('')}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label class="note" style="margin:0">En az <input id="pMin" type="number" inputmode="decimal" value="${min}" style="width:90px;min-height:34px;padding:4px 8px"> ₺</label>
    <button class="btnp" id="pOn">${on ? 'Kaydet' : '🔔 Bildirimleri aç'}</button>${on ? '<button class="btng" id="pTest">Deneme gönder</button><button class="btnr" id="pOff">Kapat</button>' : ''}</div><p class="note" id="pMsg"></p>`;
  $('pOn').onclick = async () => {
    const msg = $('pMsg');
    try {
      if (!st.key) throw new Error('Sunucu bildirim anahtarı hazır değil.');
      if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') throw new Error('Bildirim izni verilmedi (tarayıcı ayarlarından açın).');
      const reg = await navigator.serviceWorker.ready;
      let s = await reg.pushManager.getSubscription();
      if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(st.key) });
      await post('/api/push/subscribe', { subscription: s.toJSON(), kinds: [...box.querySelectorAll('.chk input:checked')].map(i => i.value), min: Number($('pMin').value) || 0 });
      toast('Bildirimler açık ✓'); renderPush();
    } catch (err) { msg.className = 'bad'; msg.textContent = err.message; }
  };
  if (on) {
    $('pTest').onclick = async () => { try { const r = await post('/api/push/test', { endpoint: sub.endpoint }); toast(r.ok ? 'Gönderildi — birkaç saniye içinde gelir' : 'Gönderilemedi (' + r.status + ')'); } catch (err) { toast(err.message); } };
    $('pOff').onclick = async () => { try { await post('/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); } catch { /* yine de */ } renderPush(); };
  }
}

/* ================================================================== GORUNUM (2.3): tema + vurgu rengi + yerlesim - bu cihazda saklanir */
const ACCENTS = { mavi: ['Mavi', '#4f8cff'], zumrut: ['Zümrüt', '#10b981'], turuncu: ['Turuncu', '#f97316'], mor: ['Mor', '#8b5cf6'], kirmizi: ['Bordo', '#e11d48'] };
function look() { return { theme: store.get('p3-theme', null) || (localStorage.getItem('patron-theme') || 'dark'), accent: store.get('p3-accent', 'mavi'), density: store.get('p3-density', 'rahat') }; }
function applyLook() {
  const l = look(), el = document.documentElement, dark = l.theme === 'auto' ? !(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) : l.theme !== 'light';
  el.dataset.theme = dark ? 'dark' : 'light'; el.dataset.accent = l.accent; el.dataset.density = l.density;
  try { localStorage.setItem('patron-theme', dark ? 'dark' : 'light'); } catch { /* */ }
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#0b1220' : '#f2f5fa';
}
function setLook(k, v) { store.set('p3-' + k, v); applyLook(); if (home) renderHome(); }
if (window.matchMedia) matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (look().theme === 'auto') applyLook(); });
applyLook();
/* ================================================================== AYARLAR */
$('settings').onclick = async () => {
  const b = sheet('Ayarlar', 'kullanıcılar, şifre, görünüm');
  let users = [], tun = {}; try { [users, tun] = await Promise.all([api('/api/users').then(r => r.users || []), api('/api/tunnel')]); } catch { /* sessiz */ }
  const theme = document.documentElement.dataset.theme || 'dark';
  b.innerHTML = `
    <div class="card"><div class="ch">Görünüm</div>
      <div class="li"><div>Tema</div><div class="seg" id="sTheme">${[['dark', '🌙 Koyu'], ['light', '☀️ Açık'], ['auto', '🌓 Otomatik']].map(([k, l]) => `<button data-k="${k}" class="${look().theme === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="li"><div>Vurgu rengi</div><div class="sw" id="sAcc">${Object.keys(ACCENTS).map(k => `<button data-k="${k}" title="${ACCENTS[k][0]}" class="${look().accent === k ? 'on' : ''}" style="background:${ACCENTS[k][1]}"></button>`).join('')}</div></div>
      <div class="li"><div>Yerleşim</div><div class="seg" id="sDen">${[['rahat', 'Rahat'], ['sik', 'Sıkı']].map(([k, l]) => `<button data-k="${k}" class="${look().density === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="li"><div>Eski (klasik) panel</div><a class="btng" href="/klasik" style="text-decoration:none">Aç</a></div></div>
    <div class="card"><div class="ch">Uzaktan erişim adresi</div>${tun.stableUrl || tun.url ? `<div class="li"><div style="word-break:break-all">${esc(tun.stableUrl || tun.url)}</div><button class="btng" id="sCopy">Kopyala</button></div>` : '<p class="note">Adres yok.</p>'}<p class="note">Telefonda bu adresi açıp “Ana ekrana ekle” yapın — uygulama gibi çalışır, bildirim alır.</p></div>
    <div class="card"><div class="ch">Kullanıcılar</div>${users.map(u => `<div class="li"><div>👤 ${esc(u.name)}<div class="m">${esc(String(u.createdAt || '').slice(0, 10))}</div></div>${users.length > 1 ? `<button class="btnr" data-del="${esc(u.id)}">Sil</button>` : ''}</div>`).join('')}
      <div class="custom"><label>Kullanıcı adı<input id="nuName"></label><label>Şifre (en az 4)<input id="nuPass" type="password"></label><button class="btnp" id="nuAdd">Ekle</button></div><p class="note" id="nuMsg"></p></div>
    <div class="card"><div class="ch">Şifremi değiştir</div><div class="custom" style="margin-top:0"><label>Mevcut şifre<input id="cpCur" type="password"></label><label>Yeni şifre<input id="cpNew" type="password"></label><button class="btnp" id="cpGo">Değiştir</button></div><p class="note" id="cpMsg"></p></div>
    <button class="btnr" id="sOut" style="width:100%;padding:12px">Çıkış yap</button>
    <p class="note" style="text-align:center;margin-top:10px">Ensari POS Patron · C# sürüm ${esc((home && home.version) || '')}</p>`;
  [['sTheme', 'theme'], ['sAcc', 'accent'], ['sDen', 'density']].forEach(([id, key]) => { $(id).onclick = e => { const x = e.target.closest('[data-k]'); if (!x) return; setLook(key, x.dataset.k); $(id).querySelectorAll('button').forEach(y => y.classList.toggle('on', y === x)); }; });
  if ($('sCopy')) $('sCopy').onclick = () => navigator.clipboard.writeText(tun.stableUrl || tun.url).then(() => toast('Kopyalandı'), () => {});
  const reopen = () => { history.back(); setTimeout(() => $('settings').click(), 150); };
  b.querySelectorAll('[data-del]').forEach(x => { x.onclick = async () => { if (!confirm('Kullanıcı silinsin mi?')) return; try { await post('/api/users/remove', { id: x.dataset.del }); reopen(); } catch (err) { toast(err.message); } }; });
  $('nuAdd').onclick = async () => { const m = $('nuMsg'); try { await post('/api/users', { name: $('nuName').value, password: $('nuPass').value }); toast('Kullanıcı eklendi'); reopen(); } catch (err) { m.className = 'bad'; m.textContent = err.message; } };
  $('cpGo').onclick = async () => { const m = $('cpMsg'); try { await post('/api/change-password', { current: $('cpCur').value, next: $('cpNew').value }); m.className = 'ok'; m.textContent = '✓ Şifre değişti (diğer cihazlarda yeniden giriş gerekir).'; } catch (err) { m.className = 'bad'; m.textContent = err.message; } };
  $('sOut').onclick = async () => { if (!confirm('Çıkış yapılsın mı?')) return; try { await post('/api/logout'); } catch { /* */ } location.href = '/login'; };
};

/* ================================================================== baslat */
if (!location.hash) history.replaceState(null, '', '#' + store.get('p3-view', 'ana'));
window.addEventListener('hashchange', () => store.set('p3-view', view));
$('homeBox').innerHTML = skel(4);
route();
loadHome();
setInterval(() => { if (!document.hidden) loadHome(); }, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - homeAt > 10000) loadHome(); });
