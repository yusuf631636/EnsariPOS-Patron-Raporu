/* Ensari POS Patron - telefon modulu. Mevcut /api/* uclarini kullanir, sunucuyu degistirmez. */
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tl0 = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 });
const tl2 = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });
const nf = new Intl.NumberFormat('tr-TR');
const money = value => tl0.format(Number(value) || 0);
const moneyFull = value => tl2.format(Number(value) || 0);
const count = value => nf.format(Number(value) || 0);
const setText = (id, value) => { const node = $(id); if (node) node.textContent = value; };
const setHtml = (id, value) => { const node = $(id); if (node) node.innerHTML = value; };

/* Tarihler yerel saate gore uretilir; toISOString UTC'ye kaydigi icin gece yarisi
   ile 03:00 arasinda yanlis gun secilmesine yol acar. */
const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseIso = value => { const [y, m, d] = String(value).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (date, days) => { const copy = new Date(date); copy.setDate(copy.getDate() + days); return copy; };
const dayCount = (start, end) => Math.round((parseIso(end) - parseIso(start)) / 86400000) + 1;
const trDate = value => parseIso(value).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
/* SQL "2026-09-06 22:21:09" -> "06.09 22:21" */
const stamp = value => { const parts = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/); return parts ? `${parts[3]}.${parts[2]} ${parts[4]}:${parts[5]}` : String(value); };
const clock = value => { const at = new Date(String(value).replace(' ', 'T')); return isNaN(at) ? null : at; };

const state = { start: iso(new Date()), end: iso(new Date()), hourStart: null, hourEnd: null, preset: 'today', report: null, live: null, notes: [], menu: null, busy: false, lastUpdated: 0 };
/* Saat filtresi query string'i: ikisi de bos ise (varsayilan) hicbir sey eklenmez,
   mevcut "tum saatler karisik" davranisi degismeden kalir. */
function hourQuery() { return (state.hourStart !== null && state.hourEnd !== null) ? `&hourStart=${state.hourStart}&hourEnd=${state.hourEnd}` : ''; }

/* ---------------------------------------------------------------- veri ---- */
async function api(path) {
  const response = await fetch(path, { cache: 'no-store' });
  const data = await response.json().catch(() => ({ error: 'Sunucu yaniti okunamadi.' }));
  if (!response.ok) throw new Error(data.error || `Sunucu hatasi (${response.status})`);
  return data;
}
function fail(message) { const box = $('err'); box.textContent = message; box.hidden = false; $('conn').className = 'dot off'; $('conn').setAttribute('aria-label', 'Baglanti yok'); }
function ok() { $('err').hidden = true; $('conn').className = 'dot'; $('conn').setAttribute('aria-label', 'SambaPOS bagli'); }

/* ------------------------------------------------------------- grafikler ---- */
/* Tek serili sutun grafigi: tek renk, 4px yuvarlatilmis tepe, 2px yuzey bosluğu,
   ince izgara. Deger okumasi hem tepe etiketinde hem tablo goruntusunde var. */
function columnChart(host, readout, points, format) {
  if (!points.length) { host.innerHTML = '<p class="empty">Bu aralıkta kayıt yok.</p>'; readout.textContent = ''; return; }
  const max = Math.max(...points.map(p => p.value), 0);
  const scale = max > 0 ? max : 1;
  const peak = points.reduce((best, p) => (p.value > best.value ? p : best), points[0]);
  const step = Math.max(1, Math.ceil(points.length / 6));
  const tick = (value, top) => `<div class="gridline" style="top:${top}%"><span>${esc(shortAxis(value))}</span></div>`;
  host.innerHTML =
    `<div class="plot"><div class="cols">${tick(max, 0)}${tick(max / 2, 50)}` +
    points.map((p, i) => `<button class="col${p.value ? '' : ' zero'}${p === peak && max > 0 ? ' peak' : ''}" data-i="${i}" type="button" aria-label="${esc(p.label)}: ${esc(format(p))}"><i style="height:${p.value ? Math.max(p.value / scale * 100, 2) : 1}%"></i></button>`).join('') +
    `</div><div class="ticks">${points.map((p, i) => `<span>${i % step === 0 ? esc(p.tick) : ''}</span>`).join('')}</div></div>`;
  const show = p => { readout.innerHTML = `<i class="key"></i><span>${p === peak ? 'En yüksek' : 'Seçili'}: <b>${esc(p.label)}</b> · ${esc(format(p))}</span>`; };
  show(peak);
  host.querySelectorAll('.col').forEach(node => node.addEventListener('click', () => {
    const picked = points[+node.dataset.i];
    const already = node.classList.contains('sel');
    host.querySelectorAll('.col').forEach(other => other.classList.remove('sel'));
    if (already) return show(peak);
    node.classList.add('sel');
    show(picked);
  }));
}
function shortAxis(value) {
  const n = Math.round(Number(value) || 0);
  if (n >= 1000000) return `${nf.format(Math.round(n / 100000) / 10)}M`;
  if (n >= 1000) return `${nf.format(Math.round(n / 100) / 10)}B`;
  return nf.format(n);
}

/* Siralanmis yatay cubuklar. Buyukluk siralamasi kimlik degildir; hepsi tek renk. */
function rankList(host, rows, options = {}) {
  if (!rows.length) { host.innerHTML = '<p class="empty">Kayıt bulunamadı.</p>'; return; }
  const max = Math.max(...rows.map(r => r.value), 1);
  host.innerHTML = rows.map(row => `<div class="rank">
    <div class="top"><span class="nm">${options.color ? `<i class="key" style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${esc(row.color)};margin-right:7px"></i>` : ''}${esc(row.name)}</span><span class="amt">${esc(money(row.value))}</span></div>
    <div class="track"><i style="width:${Math.max(row.value / max * 100, 2)}%;background:${esc(row.color || 'var(--s1)')}"></i></div>
    <div class="note">${esc(row.note)}</div>
  </div>`).join('');
}
function tableView(id, headers, rows) {
  setHtml(id, `<table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
}

/* Odeme turleri kimliktir: renk isme baglanir, siraya degil. Filtre degisince
   ayni odeme turu ayni rengi korur. */
const paletteSlots = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
const assigned = new Map();
function hueFor(name) {
  if (!assigned.has(name)) assigned.set(name, assigned.size < paletteSlots.length ? paletteSlots[assigned.size] : 'var(--muted)');
  return assigned.get(name);
}
function paymentSeries(payments) {
  const head = payments.slice(0, 6).map(row => ({ name: row.name, value: row.amount, note: `${count(row.count)} ödeme`, color: hueFor(row.name) }));
  const tail = payments.slice(6);
  if (tail.length) head.push({ name: `Diğer (${tail.length})`, value: tail.reduce((sum, r) => sum + r.amount, 0), note: `${count(tail.reduce((sum, r) => sum + r.count, 0))} ödeme`, color: 'var(--muted)' });
  return head;
}
const legendHtml = series => series.map(row => `<span><i style="background:${esc(row.color)}"></i>${esc(row.name)}</span>`).join('');

/* ---------------------------------------------------------------- rapor ---- */
function rangeText() {
  const base = state.start === state.end ? `${trDate(state.start)} ${parseIso(state.start).getFullYear()}` : `${trDate(state.start)} – ${trDate(state.end)} (${dayCount(state.start, state.end)} gün)`;
  if (state.hourStart === null || state.hourEnd === null) return base;
  const hourLabel = state.hourStart === state.hourEnd ? `saat ${String(state.hourStart).padStart(2, '0')}:00` : `saat ${String(state.hourStart).padStart(2, '0')}:00–${String(state.hourEnd).padStart(2, '0')}:00`;
  return `${base} · ${hourLabel}`;
}
async function loadReport(quiet) {
  if (!quiet) setBusy(true);
  setText('rangeLabel', rangeText());
  syncHourChip();
  try {
    const data = await api(`/api/report?start=${state.start}&end=${state.end}${hourQuery()}`);
    state.report = data;
    state.lastUpdated = Date.now();
    ok();
    renderReport(data);
    loadPrevious();
    tickLiveUpdated();
  } catch (error) { if (!quiet) fail(error.message); }
  finally { if (!quiet) setBusy(false); }
}
/* "Bugun" seciliyken ozet sessizce (spinner/soluklastirma olmadan) tazelenir;
   canli ciro hissi verir ama kullaniciyi rahatsiz etmez. */
function tickLiveUpdated() {
  const node = $('heroUpdated'); if (!node || !state.lastUpdated) return;
  node.hidden = false;
  const seconds = Math.max(0, Math.round((Date.now() - state.lastUpdated) / 1000));
  const label = seconds < 5 ? 'az önce güncellendi' : seconds < 60 ? `${seconds} sn önce güncellendi` : `${Math.floor(seconds / 60)} dk önce güncellendi`;
  node.innerHTML = `<i class="livedot"></i>${esc(label)}`;
}
function renderReport(data) {
  const collected = data.payments.reduce((sum, row) => sum + row.amount, 0);
  setText('heroSales', money(data.summary.sales));
  setText('kpiCollected', money(collected));
  setText('kpiTickets', count(data.summary.tickets));
  setText('kpiAverage', money(data.summary.average));
  setText('kpiRemaining', money(data.summary.remaining));
  setText('cashSales', money(data.summary.sales));
  setText('cashCollected', money(collected));
  setText('cashTickets', count(data.summary.tickets));
  setText('cashRemaining', money(data.summary.remaining));

  const heroPay = paymentSeries(data.payments).slice(0, 4);
  setHtml('heroPayments', heroPay.length ? heroPay.map(row => `<span><i style="background:${esc(row.color)}"></i>${esc(row.name)} <b>${esc(money(row.value))}</b></span>`).join('') : '');

  const hours = fillHours(data.hourly);
  columnChart($('hourlyChart'), $('hourlyReadout'), hours, p => `${money(p.value)} · ${count(p.count)} fiş`);
  tableView('tblHourly', ['Saat', 'Fiş', 'Ciro'], hours.map(p => [p.label, count(p.count), moneyFull(p.value)]));

  const days = fillDays(data.daily);
  $('dailyCard').hidden = days.length < 2;
  if (days.length >= 2) {
    columnChart($('dailyChart'), $('dailyReadout'), days, p => `${money(p.value)} · ${count(p.count)} fiş`);
    tableView('tblDaily', ['Gün', 'Fiş', 'Ciro'], days.map(p => [p.label, count(p.count), moneyFull(p.value)]));
  }

  const products = data.products.map(row => ({ name: row.name, value: row.amount, note: `${count(row.quantity)} adet` }));
  rankList($('topProducts'), products.slice(0, 5));
  rankList($('productRanks'), products);
  tableView('tblProducts', ['Ürün', 'Adet', 'Tutar'], data.products.map(row => [row.name, count(row.quantity), moneyFull(row.amount)]));

  rankList($('userRanks'), data.users.map(row => ({ name: row.name, value: row.amount, note: `${count(row.count)} fiş` })));
  tableView('tblUsers', ['Personel', 'Fiş', 'Tutar'], data.users.map(row => [row.name, count(row.count), moneyFull(row.amount)]));

  rankList($('deptRanks'), data.departments.map(row => ({ name: row.name, value: row.amount, note: `${count(row.count)} adisyon` })));
  tableView('tblDepts', ['Departman', 'Adisyon', 'Tutar'], data.departments.map(row => [row.name, count(row.count), moneyFull(row.amount)]));

  const pay = paymentSeries(data.payments);
  setHtml('payLegend', legendHtml(pay));
  setHtml('payLegend2', legendHtml(pay));
  rankList($('payMix'), pay, { color: true });
  rankList($('paymentRanks'), pay, { color: true });
  tableView('tblPayMix', ['Ödeme türü', 'Adet', 'Tutar'], data.payments.map(row => [row.name, count(row.count), moneyFull(row.amount)]));
  tableView('tblPayments', ['Ödeme türü', 'Adet', 'Tutar'], data.payments.map(row => [row.name, count(row.count), moneyFull(row.amount)]));

  /* Sunucu adisyonlari TOP 100 ile sinirlar; sayiyi oldugundan cok gostermeyelim. */
  setText('ticketCount', data.tickets.length >= 100 ? 'En son 100 adisyon' : `${count(data.tickets.length)} adisyon`);
  setHtml('ticketRows', data.tickets.length ? data.tickets.map(row => `<div class="row">
    <span class="t1">${esc(row.table || 'Adisyon')} · ${esc(row.number)}</span>
    <span class="t2">${esc(stamp(row.date))} · ${esc(row.user || '—')} · ${esc(row.department)}</span>
    <span class="v1">${esc(money(row.amount))}</span>
    <span class="v2${row.remaining > 0 ? ' due' : ''}">${row.remaining > 0 ? `${esc(money(row.remaining))} kalan` : 'Kapandı'}</span>
  </div>`).join('') : '<p class="empty">Bu aralıkta adisyon yok.</p>');
}
function fillHours(hourly) {
  if (!hourly.length) return [];
  const map = new Map(hourly.map(row => [row.hour, row]));
  const from = Math.min(...hourly.map(r => r.hour)), to = Math.max(...hourly.map(r => r.hour));
  const out = [];
  for (let h = from; h <= to; h++) { const row = map.get(h) || { amount: 0, count: 0 }; out.push({ label: `${String(h).padStart(2, '0')}:00`, tick: String(h).padStart(2, '0'), value: row.amount, count: row.count }); }
  return out;
}
function fillDays(daily) {
  const map = new Map(daily.map(row => [row.date, row]));
  const out = [];
  const total = dayCount(state.start, state.end);
  if (total > 120) return daily.map(row => ({ label: trDate(row.date), tick: row.date.slice(8), value: row.amount, count: row.count }));
  for (let i = 0; i < total; i++) {
    const key = iso(addDays(parseIso(state.start), i));
    const row = map.get(key) || { amount: 0, count: 0 };
    out.push({ label: trDate(key), tick: key.slice(8), value: row.amount, count: row.count });
  }
  return out;
}
/* Onceki esit uzunluktaki donem, ana rapor cizildikten sonra arka planda gelir. */
async function loadPrevious() {
  const box = $('heroDelta');
  const length = dayCount(state.start, state.end);
  const prevEnd = addDays(parseIso(state.start), -1);
  const prevStart = addDays(prevEnd, -(length - 1));
  const label = length === 1 ? 'önceki güne göre' : `önceki ${length} güne göre`;
  try {
    const past = await api(`/api/report?start=${iso(prevStart)}&end=${iso(prevEnd)}${hourQuery()}`);
    const before = past.summary.sales, now = state.report.summary.sales;
    if (!before) { box.className = 'delta flat'; box.innerHTML = `<span>Önceki dönem verisi yok · <em>${esc(money(before))}</em></span>`; return; }
    const change = (now - before) / before * 100;
    const up = change >= 0;
    box.className = `delta ${Math.abs(change) < 0.05 ? 'flat' : up ? 'up' : 'down'}`;
    box.innerHTML = `<span class="arrow">${up ? '▲' : '▼'}</span><span>%${esc(nf.format(Math.abs(change).toFixed(1)))} <em>${esc(label)} · ${esc(money(before))}</em></span>`;
  } catch { box.className = 'delta flat'; box.innerHTML = '<span>Karşılaştırma yüklenemedi</span>'; }
}

/* ------------------------------------------------------------ acik masa ---- */
async function loadLive() {
  try {
    const data = await api('/api/open-tables');
    state.live = data;
    const sum = list => list.reduce((total, row) => total + row.remaining, 0);
    const pending = data.packages.pending || [], enroute = data.packages.enroute || [];
    setText('openTableCount', count(data.tables.length));
    setText('openTableAmount', `${money(sum(data.tables))} açık`);
    setText('pendingPackCount', count(pending.length));
    setText('pendingPackAmount', `${money(sum(pending))} açık`);
    setText('enroutePackCount', count(enroute.length));
    setText('enroutePackAmount', `${money(sum(enroute))} açık`);
    const packCount = pending.length + enroute.length;
    setText('liveNote', `${count(data.tables.length)} masa · ${count(pending.length)} bekleyen · ${count(enroute.length)} yolda`);
    setText('liveAmount', money(sum(data.tables) + sum(pending) + sum(enroute)));
    setHtml('tableRows', openRows(data.tables, 'Açık masa yok.'));
    setHtml('pendingRows', openRows(pending, 'Bekleyen paket yok.'));
    setHtml('enrouteRows', openRows(enroute, 'Yolda paket yok.'));
  } catch (error) { setText('liveNote', 'Açık adisyonlar okunamadı'); }
}
function openRows(rows, emptyText) {
  if (!rows.length) return `<p class="empty">${esc(emptyText)}</p>`;
  return rows.map(row => `<button class="row" type="button" data-ticket="${esc(row.id)}" data-label="${esc(row.table)}">
    <span class="t1">${esc(row.table)}</span>
    <span class="t2">${esc(openFor(row.date))} · ${esc(row.user || '—')} · Fiş ${esc(row.number || '-')}</span>
    <span class="v1">${esc(money(row.total))}</span>
    <span class="v2${row.remaining > 0 ? ' due' : ''}">${row.remaining > 0 ? `${esc(money(row.remaining))} kalan` : 'ödendi'}</span>
  </button>`).join('');
}
function openFor(value) {
  const opened = clock(value);
  if (!opened) return String(value);
  const minutes = Math.max(0, Math.round((Date.now() - opened) / 60000));
  const at = opened.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (minutes < 60) return `${at} · ${minutes} dk açık`;
  return `${at} · ${Math.floor(minutes / 60)} sa ${minutes % 60} dk açık`;
}
async function showTicket(id, label) {
  openSheet(`<div class="head"><h2 id="sheetTitle">${esc(label || 'Adisyon')}</h2><span class="sub">Yükleniyor…</span></div>`);
  try {
    const data = await api(`/api/open-ticket?id=${encodeURIComponent(id)}`);
    const total = data.items.reduce((sum, row) => sum + row.total, 0);
    openSheet(`<div class="head"><h2 id="sheetTitle">${esc(label || 'Adisyon')}</h2><span class="sub">${count(data.items.length)} satır</span></div>
      ${data.items.length ? `<div class="tableview" style="border:0;margin:0;padding:0"><table><thead><tr><th>Ürün</th><th>Adet</th><th>Tutar</th></tr></thead><tbody>${data.items.map(row => `<tr><td>${esc(row.name)}${row.portion ? ` <span style="color:var(--muted)">${esc(row.portion)}</span>` : ''}</td><td>${esc(count(row.quantity))}</td><td>${esc(moneyFull(row.total))}</td></tr>`).join('')}</tbody></table></div>
      <div class="total"><span>Toplam</span><span>${esc(moneyFull(total))}</span></div>` : '<p class="empty">Bu adisyonda ürün yok.</p>'}
      <button class="ghost" data-close>Kapat</button>`);
  } catch (error) { openSheet(`<div class="head"><h2 id="sheetTitle">Adisyon</h2></div><p class="empty">${esc(error.message)}</p><button class="ghost" data-close>Kapat</button>`); }
}

/* ------------------------------------------------------------- bildirim ---- */
let known = new Set(), notifyReady = false;
/* Gun basi/sonu satirlarinda ticket alani calisma donemi numarasidir, fis degil. */
const noteMeta = {
  iptal: { label: 'İptal', tone: 'critical', icon: '⟲', ref: 'Fiş' },
  iade: { label: 'İade', tone: 'critical', icon: '↩', ref: 'Fiş' },
  'gun-basi': { label: 'Gün başı', tone: 'good', icon: '▶', ref: 'Dönem' },
  'gun-sonu': { label: 'Gün sonu', tone: 'info', icon: '■', ref: 'Dönem' }
};
const alertKinds = ['iptal', 'iade'];
async function loadNotes() {
  try {
    const data = await api('/api/notifications');
    state.notes = data.items || [];
    /* Rozet son 24 saatteki iptal/iade sayisidir; gecmisin tamami degil. */
    const fresh = Date.now() - 86400000;
    const badge = state.notes.filter(item => alertKinds.includes(item.kind) && (clock(item.date) || 0) >= fresh).length;
    ['bellCount', 'tabBadge'].forEach(id => { const node = $(id); node.textContent = count(badge); node.hidden = badge === 0; });
    renderNotes();
    const current = new Set(state.notes.map(item => item.id));
    if (notifyReady) state.notes.filter(item => !known.has(item.id) && alertKinds.includes(item.kind)).slice(0, 3).forEach(toast);
    known = current; notifyReady = true;
  } catch { /* Bildirimler tekrar denenecek. */ }
}
let noteFilter = 'all';
function renderNotes() {
  const items = state.notes.filter(item => noteFilter === 'all' || (noteFilter === 'gun' ? !alertKinds.includes(item.kind) : item.kind === noteFilter));
  setHtml('noteRows', items.length ? items.map(item => {
    const meta = noteMeta[item.kind] || { label: item.kind, tone: 'info', icon: '■', ref: '' };
    return `<div class="row">
      <span class="t1"><span class="badge ${meta.tone}">${meta.icon} ${esc(meta.label)}</span> ${item.ticket && item.ticket !== '0' ? `${esc(meta.ref)} ${esc(item.ticket)}` : ''}</span>
      <span class="t2">${esc(stamp(item.date))}${item.detail ? ` · ${esc(item.detail)}` : ''}</span>
      <span class="v1">${item.amount ? esc(money(item.amount)) : ''}</span>
    </div>`;
  }).join('') : '<p class="empty">Kayıt yok.</p>');
}
function toast(item) {
  const meta = noteMeta[item.kind] || { label: item.kind, ref: '' };
  const node = document.createElement('div');
  node.className = 'toast';
  node.innerHTML = `<b>${esc(meta.label)}${item.ticket && item.ticket !== '0' ? ` · ${esc(meta.ref)} ${esc(item.ticket)}` : ''}</b><small>${esc(stamp(item.date))} · ${esc(money(item.amount))}</small>`;
  $('toasts').appendChild(node);
  setTimeout(() => node.remove(), 6000);
}

/* ---------------------------------------------------------------- fiyat ---- */
async function loadPrices() {
  const host = $('priceRows');
  host.innerHTML = '<p class="empty">Yükleniyor…</p>';
  try {
    const data = await api(`/api/price-changes?days=${$('priceDays').value}`);
    host.innerHTML = data.changes.length ? data.changes.map(row => `<div class="row">
      <span class="t1">${esc(row.name)}</span>
      <span class="t2">${esc(stamp(row.date))} · ${esc(money(row.oldPrice))} → ${esc(money(row.newPrice))}</span>
      <span class="v1" style="color:${row.difference >= 0 ? 'var(--good)' : 'var(--critical)'}">${row.difference >= 0 ? '▲' : '▼'} ${esc(moneyFull(Math.abs(row.difference)))}</span>
    </div>`).join('') : '<p class="empty">Bu dönemde fiyat değişimi yok.</p>';
  } catch (error) { host.innerHTML = `<p class="empty">${esc(error.message)}</p>`; }
}

/* ----------------------------------------------------------- fiyat guncelle ---- */
let menuLoaded = false;
async function loadMenuItems() {
  const host = $('menuRows');
  host.innerHTML = '<p class="empty">Yükleniyor…</p>';
  try {
    const data = await api('/api/menu-items');
    state.menu = data.items;
    menuLoaded = true;
    renderMenuRows();
  } catch (error) { host.innerHTML = `<p class="empty">${esc(error.message)}</p>`; }
}
function menuRowLabel(row) {
  const bits = [row.name];
  if (row.portion && row.portion !== 'Normal') bits.push(row.portion);
  if (row.tagLabel && row.tagLabel !== 'Standart') bits.push(row.tagLabel);
  return bits.join(' · ');
}
function renderMenuRows() {
  const host = $('menuRows'); if (!host || !state.menu) return;
  const query = ($('menuSearch').value || '').trim().toLocaleLowerCase('tr-TR');
  const list = query ? state.menu.filter(row => row.name.toLocaleLowerCase('tr-TR').includes(query)) : state.menu.slice(0, 80);
  if (!query && state.menu.length > 80) {
    host.innerHTML = '<p class="empty">545 üründen ilk 80’i gösteriliyor. Aramak için ürün adı yazın.</p>' +
      list.map(menuRowHtml).join('');
  } else {
    host.innerHTML = list.length ? list.map(menuRowHtml).join('') : '<p class="empty">Ürün bulunamadı.</p>';
  }
  host.querySelectorAll('[data-price-id]').forEach(node => node.addEventListener('click', () => openPriceSheet(node.dataset.priceId)));
}
function menuRowHtml(row) {
  return `<button class="row" type="button" data-price-id="${esc(row.priceId)}">
    <span class="t1">${esc(row.name)}</span>
    <span class="t2">${esc(row.portion !== 'Normal' ? row.portion : '')}${row.tagLabel !== 'Standart' ? (row.portion !== 'Normal' ? ' · ' : '') + row.tagLabel : ''}</span>
    <span class="v1">${esc(money(row.price))}</span>
    <span class="v2 linkbtn">Düzenle</span>
  </button>`;
}
function openPriceSheet(priceId) {
  const row = state.menu.find(item => String(item.priceId) === String(priceId));
  if (!row) return;
  openSheet(`<div class="head"><h2 id="sheetTitle">${esc(menuRowLabel(row))}</h2></div>
    <p class="muted" style="margin:0 0 14px">Mevcut fiyat: <b style="color:var(--ink)">${esc(moneyFull(row.price))}</b></p>
    <div class="fields" style="grid-template-columns:1fr">
      <label>Yeni fiyat (₺)<input id="newPrice" type="number" inputmode="decimal" step="0.01" min="0" value="${row.price}"></label>
    </div>
    <p id="priceErr" class="empty" style="display:none;color:var(--critical);padding:0 0 10px;text-align:left"></p>
    <button class="primary" id="priceSubmit" type="button">Kaydet</button>
    <button class="ghost" data-close type="button">Vazgeç</button>`);
  $('newPrice').focus(); $('newPrice').select();
  $('priceSubmit').onclick = () => submitPriceChange(row);
}
async function submitPriceChange(row) {
  const input = $('newPrice'), errBox = $('priceErr'), button = $('priceSubmit');
  const showErr = message => { errBox.textContent = message; errBox.style.display = 'block'; };
  errBox.style.display = 'none';
  const value = Number(input.value);
  if (!input.value || !Number.isFinite(value) || value < 0) return showErr('Geçerli bir fiyat girin.');
  if (value === row.price) return closeSheet();
  button.disabled = true; button.textContent = 'Kaydediliyor…';
  try {
    const response = await fetch('/api/menu-price', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceId: row.priceId, price: value, name: row.name, portion: row.portion, tagLabel: row.tagLabel })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Fiyat güncellenemedi.');
    row.price = data.newPrice;
    renderMenuRows();
    button.textContent = 'Kaydedildi ✓';
    toast({ kind: 'gun-sonu', ticket: '0', date: `${row.name} fiyatı güncellendi`, amount: data.newPrice });
    setTimeout(closeSheet, 700);
  } catch (error) { showErr(error.message); button.disabled = false; button.textContent = 'Kaydet'; }
}

/* ------------------------------------------------------------ gezinme ---- */
function showView(name) {
  document.querySelectorAll('.view').forEach(node => node.classList.toggle('active', node.id === `view-${name}`));
  document.querySelectorAll('.tabbar button').forEach(node => node.classList.toggle('active', node.dataset.view === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'acik') loadLive();
}
function showPane(id) {
  const pane = $(id); if (!pane) return;
  pane.parentElement.querySelectorAll('.pane').forEach(node => node.classList.toggle('active', node === pane));
  pane.closest('.view').querySelectorAll('.seg[data-pane]').forEach(node => node.classList.toggle('active', node.dataset.pane === id));
  if (id === 'pane-fiyat-guncelle' && !menuLoaded) loadMenuItems();
  if (id === 'pane-fiyat-gecmis' && !$('priceRows').childElementCount) loadPrices();
}
function setBusy(busy) {
  state.busy = busy;
  $('refresh').querySelector('svg').classList.toggle('spin', busy);
  document.querySelectorAll('.view').forEach(node => node.classList.toggle('stale', busy && !!state.report));
}
function setRange(preset) {
  const today = new Date();
  if (preset === 'today') { state.start = state.end = iso(today); }
  if (preset === 'yesterday') { state.start = state.end = iso(addDays(today, -1)); }
  if (preset === 'week') { state.start = iso(addDays(today, -6)); state.end = iso(today); }
  if (preset === 'month') { state.start = iso(new Date(today.getFullYear(), today.getMonth(), 1)); state.end = iso(today); }
  state.preset = preset;
  document.querySelectorAll('.chip').forEach(node => node.classList.toggle('active', node.dataset.range === preset));
  loadReport();
}

/* ---------------------------------------------------------------- ayarlar ---- */
function currentTheme() { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('themeToggleBtn');
  if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
  try { localStorage.setItem('patron-theme', theme); } catch { /* gizli gezinti modu olabilir */ }
}
async function openSettings() {
  let tunnelLine = '<p class="empty">Yükleniyor…</p>';
  openSheet(`<div class="head"><h2 id="sheetTitle">Ayarlar</h2></div>
    <div class="card" style="margin:0 0 12px"><div class="head"><h2 style="font-size:13px">Dışarıdan erişim linki</h2></div><div id="tunnelBox">${tunnelLine}</div></div>
    <div class="card" style="margin:0 0 12px">
      <div class="head"><h2 style="font-size:13px">Şifre değiştir</h2></div>
      <div class="fields" style="grid-template-columns:1fr">
        <label>Mevcut şifre<input id="pwCurrent" type="password" autocomplete="current-password"></label>
        <label>Yeni şifre<input id="pwNext" type="password" autocomplete="new-password"></label>
        <label>Yeni şifre (tekrar)<input id="pwConfirm" type="password" autocomplete="new-password"></label>
      </div>
      <p id="pwErr" class="empty" style="display:none;color:var(--critical);padding:0 0 10px;text-align:left"></p>
      <button class="primary" id="pwSubmit" type="button">Şifreyi güncelle</button>
    </div>
    <div class="card" style="margin:0 0 12px">
      <div class="head"><h2 style="font-size:13px">Kullanıcılar</h2></div>
      <div id="userList"><p class="empty">Yükleniyor…</p></div>
      <div class="fields" style="grid-template-columns:1fr;margin-top:10px">
        <label>Yeni kullanıcı adı<input id="userName" type="text" autocomplete="off"></label>
        <label>Şifre<input id="userPassword" type="password" autocomplete="new-password"></label>
      </div>
      <p id="userErr" class="empty" style="display:none;color:var(--critical);padding:0 0 10px;text-align:left"></p>
      <button class="ghost" id="userAddBtn" type="button">Kullanıcı ekle</button>
    </div>
    <button class="ghost" id="logoutBtn" type="button">Çıkış yap</button>`);
  loadTunnelBox();
  loadUserList();
  $('pwSubmit').onclick = submitPasswordChange;
  $('userAddBtn').onclick = submitAddUser;
  $('logoutBtn').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login'; };
}
async function loadUserList() {
  const box = $('userList'); if (!box) return;
  try {
    const { users } = await api('/api/users');
    box.innerHTML = users.map(u => `
      <div class="row" style="background:var(--surface-2)">
        <span class="t1">${esc(u.name)}</span>
        ${users.length > 1 ? `<button class="ghost" data-remove-user="${esc(u.id)}" type="button" style="width:auto;padding:6px 10px">Sil</button>` : ''}
      </div>`).join('');
    box.querySelectorAll('[data-remove-user]').forEach(button => button.onclick = () => removeUser(button.dataset.removeUser, button));
  } catch { box.innerHTML = '<p class="empty">Kullanıcılar okunamadı.</p>'; }
}
async function submitAddUser() {
  const name = $('userName').value.trim(), password = $('userPassword').value;
  const errBox = $('userErr');
  const showErr = message => { errBox.textContent = message; errBox.style.display = 'block'; };
  errBox.style.display = 'none';
  if (!name) return showErr('Kullanıcı adı gir.');
  if (password.length < 4) return showErr('Şifre en az 4 karakter olmalı.');
  const button = $('userAddBtn'); button.disabled = true; button.textContent = 'Ekleniyor…';
  try {
    const response = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Kullanıcı eklenemedi.');
    $('userName').value = ''; $('userPassword').value = '';
    await loadUserList();
  } catch (error) { showErr(error.message); }
  finally { button.disabled = false; button.textContent = 'Kullanıcı ekle'; }
}
async function removeUser(id, button) {
  if (!confirm('Bu kullanıcı silinsin mi?')) return;
  button.disabled = true;
  try {
    const response = await fetch('/api/users/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Kullanıcı silinemedi.');
    await loadUserList();
  } catch (error) { alert(error.message); button.disabled = false; }
}
function linkRow(url, note) {
  return `<div class="row" style="background:var(--surface-2)"><span class="t1">${esc(url)}</span><span class="t2">${esc(note)}</span><span class="v1"></span></div><button class="ghost" data-copy="${esc(url)}" type="button" style="margin:8px 0 12px">Linki kopyala</button>`;
}
async function loadTunnelBox() {
  const box = $('tunnelBox'); if (!box) return;
  try {
    const data = await api('/api/tunnel');
    if (!data.url && !data.stableUrl) { box.innerHTML = '<p class="empty">Henüz link yok. Bilgisayardaki "Ensari POS Patron" kısayolunu çalıştırın.</p>'; return; }
    box.innerHTML =
      (data.stableUrl ? linkRow(data.stableUrl, 'Kalıcı link · her zaman aynı kalır') : '') +
      (data.url ? linkRow(data.url, data.stableUrl ? 'Yedek/değişken link · her başlatmada değişir' : 'Değişken link · her başlatmada değişir') : '');
    box.querySelectorAll('[data-copy]').forEach(button => button.onclick = async () => {
      try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = 'Kopyalandı ✓'; setTimeout(() => { button.textContent = 'Linki kopyala'; }, 1800); } catch { /* pano izni yok */ }
    });
  } catch { box.innerHTML = '<p class="empty">Link okunamadı.</p>'; }
}
async function submitPasswordChange() {
  const current = $('pwCurrent').value, next = $('pwNext').value, confirm = $('pwConfirm').value;
  const errBox = $('pwErr');
  const showErr = message => { errBox.textContent = message; errBox.style.display = 'block'; };
  errBox.style.display = 'none';
  if (!current) return showErr('Mevcut şifreni gir.');
  if (next.length < 4) return showErr('Yeni şifre en az 4 karakter olmalı.');
  if (next !== confirm) return showErr('Yeni şifreler eşleşmiyor.');
  const button = $('pwSubmit'); button.disabled = true; button.textContent = 'Güncelleniyor…';
  try {
    const response = await fetch('/api/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current, next }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Şifre güncellenemedi.');
    button.textContent = 'Güncellendi ✓';
    setTimeout(closeSheet, 900);
  } catch (error) { showErr(error.message); button.disabled = false; button.textContent = 'Şifreyi güncelle'; }
}

/* ------------------------------------------------------------- cekmece ---- */
function openSheet(html) {
  setHtml('sheetBody', html);
  $('scrim').hidden = false; $('sheet').hidden = false;
  requestAnimationFrame(() => { $('scrim').classList.add('open'); $('sheet').classList.add('open'); });
}
function closeSheet() {
  $('scrim').classList.remove('open'); $('sheet').classList.remove('open');
  setTimeout(() => { $('scrim').hidden = true; $('sheet').hidden = true; }, 220);
}
function hourOptions(selected) {
  return `<option value="">—</option>` + Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === selected ? ' selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('');
}
/* Saat filtresi cubuktaki (rangebar) ayri bir "Saat" chip'i - secili tarih
   araligindan BAGIMSIZ calisir (Bugun/Bu hafta/Bu ay/Ozel hangisi aktifse
   onun uzerine eklenir), boylece "son bir hafta saat 1'de olan satislar"
   gibi bir istek iki ayri chip'e tiklamakla kurulabilir. */
function syncHourChip() {
  const chip = $('hourChip'); if (!chip) return;
  const active = state.hourStart !== null && state.hourEnd !== null;
  chip.classList.toggle('active', active);
  chip.textContent = !active ? 'Saat: tümü' : state.hourStart === state.hourEnd ? `Saat: ${String(state.hourStart).padStart(2, '0')}:00` : `Saat: ${String(state.hourStart).padStart(2, '0')}–${String(state.hourEnd).padStart(2, '0')}`;
}
function hourSheet() {
  openSheet(`<div class="head"><h2 id="sheetTitle">Saat filtresi</h2></div>
    <p class="sub" style="margin:0 0 12px">Sadece belirli bir saatte olan satışları göster (seçili tarih aralığı ne olursa olsun geçerli olur). Boş bırakırsanız tüm saatler karışık gelir.</p>
    <div class="fields"><label>Saat başlangıç<select id="hourFromSel">${hourOptions(state.hourStart)}</select></label><label>Saat bitiş<select id="hourToSel">${hourOptions(state.hourEnd)}</select></label></div>
    <button class="primary" id="hourApply">Uygula</button><button class="ghost" id="hourClear">Filtreyi temizle</button><button class="ghost" data-close>Vazgeç</button>`);
  $('hourApply').onclick = () => {
    const hs = $('hourFromSel').value, he = $('hourToSel').value;
    if (hs === '') { state.hourStart = null; state.hourEnd = null; }
    else { state.hourStart = +hs; state.hourEnd = he !== '' ? Math.max(+hs, +he) : +hs; }
    syncHourChip();
    closeSheet(); loadReport();
  };
  $('hourClear').onclick = () => {
    state.hourStart = null; state.hourEnd = null;
    syncHourChip();
    closeSheet(); loadReport();
  };
}
function customRange() {
  openSheet(`<div class="head"><h2 id="sheetTitle">Özel tarih aralığı</h2></div>
    <div class="fields"><label>Başlangıç<input id="customStart" type="date" value="${esc(state.start)}" max="${esc(iso(new Date()))}"></label><label>Bitiş<input id="customEnd" type="date" value="${esc(state.end)}" max="${esc(iso(new Date()))}"></label></div>
    <button class="primary" id="customApply">Uygula</button><button class="ghost" data-close>Vazgeç</button>`);
  $('customApply').onclick = () => {
    const start = $('customStart').value, end = $('customEnd').value;
    if (!start || !end) return;
    state.start = start <= end ? start : end;
    state.end = start <= end ? end : start;
    state.preset = 'custom';
    document.querySelectorAll('.chip').forEach(node => node.classList.toggle('active', node.dataset.range === 'custom'));
    closeSheet(); loadReport();
  };
}

/* ------------------------------------------------------------- paylas ---- */
function summaryText() {
  const data = state.report; if (!data) return '';
  const collected = data.payments.reduce((sum, row) => sum + row.amount, 0);
  const lines = [
    `${document.title} · ${rangeText()}`,
    `Ciro: ${moneyFull(data.summary.sales)}`,
    `Tahsilat: ${moneyFull(collected)}`,
    `Adisyon: ${count(data.summary.tickets)} · Ortalama: ${moneyFull(data.summary.average)}`,
    `Açık bakiye: ${moneyFull(data.summary.remaining)}`
  ];
  if (data.products[0]) lines.push(`En çok satan: ${data.products[0].name} (${count(data.products[0].quantity)} adet)`);
  return lines.join('\n');
}
async function share() {
  const text = summaryText(); if (!text) return;
  if (navigator.share) { try { await navigator.share({ title: document.title, text }); return; } catch { return; } }
  try { await navigator.clipboard.writeText(text); toast({ kind: 'gun-sonu', ticket: '0', date: 'Özet panoya kopyalandı', amount: 0 }); }
  catch { openSheet(`<div class="head"><h2 id="sheetTitle">Özet</h2></div><pre style="white-space:pre-wrap;font:inherit;color:var(--ink-2)">${esc(text)}</pre><button class="ghost" data-close>Kapat</button>`); }
}
function downloadCsv() {
  const data = state.report; if (!data) return;
  const rows = [['Bolum', 'Ad', 'Adet', 'Tutar']];
  data.products.forEach(row => rows.push(['Urun', row.name, row.quantity, row.amount]));
  data.payments.forEach(row => rows.push(['Odeme', row.name, row.count, row.amount]));
  data.users.forEach(row => rows.push(['Personel', row.name, row.count, row.amount]));
  data.departments.forEach(row => rows.push(['Departman', row.name, row.count, row.amount]));
  data.daily.forEach(row => rows.push(['Gunluk', row.date, row.count, row.amount]));
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  link.download = `patron-${state.start}-${state.end}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/* ---------------------------------------------------------------- baglar ---- */
document.addEventListener('click', event => {
  const target = event.target;
  const chip = target.closest('.chip'); if (chip) { if (chip.id === 'hourChip') return hourSheet(); return chip.dataset.range === 'custom' ? customRange() : setRange(chip.dataset.range); }
  const tab = target.closest('.tabbar button'); if (tab) return showView(tab.dataset.view);
  const seg = target.closest('.seg[data-pane]'); if (seg) return showPane(seg.dataset.pane);
  const filter = target.closest('.seg[data-filter]');
  if (filter) { noteFilter = filter.dataset.filter; filter.parentElement.querySelectorAll('.seg').forEach(node => node.classList.toggle('active', node === filter)); return renderNotes(); }
  const table = target.closest('[data-table]'); if (table) { const view = $(table.dataset.table); view.hidden = !view.hidden; table.textContent = view.hidden ? 'Tablo' : 'Gizle'; return; }
  const goto = target.closest('[data-goto]'); if (goto) { const [view, pane] = goto.dataset.goto.split(':'); showView(view); return showPane(`pane-${pane}`); }
  const ticket = target.closest('[data-ticket]'); if (ticket) return showTicket(ticket.dataset.ticket, ticket.dataset.label);
  if (target.closest('[data-close]') || target.id === 'scrim') return closeSheet();
});
$('refresh').onclick = () => { if (!state.busy) { loadReport(); loadLive(); loadNotes(); if ($('priceRows').childElementCount) loadPrices(); } };
$('bell').onclick = () => showView('bildirim');
$('settingsBtn').onclick = openSettings;
setTheme(currentTheme());
$('themeToggleBtn').onclick = () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
$('openLive').onclick = () => showView('acik');
$('share').onclick = share;
$('csv').onclick = downloadCsv;
$('priceDays').onchange = loadPrices;
$('menuSearch').oninput = renderMenuRows;
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('sheet').hidden) closeSheet(); });

/* Sekmeler arka plandayken sorgu atmayiz; patronun telefonunda pil yakmasin. */
let timers = [];
function startTimers() {
  stopTimers();
  timers = [
    setInterval(loadNotes, 20000),
    setInterval(() => { if ($('view-acik').classList.contains('active')) loadLive(); }, 30000),
    /* "Bugun" seciliyken Ozet ekranindaki ciro sessizce tazelenir - canli hissi. */
    setInterval(() => { if (state.preset === 'today' && $('view-ozet').classList.contains('active')) loadReport(true); }, 45000),
    setInterval(tickLiveUpdated, 1000)
  ];
}
function stopTimers() { timers.forEach(clearInterval); timers = []; }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return stopTimers();
  startTimers();
  if (state.preset !== 'custom') setRange(state.preset); else loadReport();
  loadNotes();
});

(async function start() {
  try { const config = await api('/api/config'); if (config.appName) { document.title = config.appName; setText('appName', config.appName); } } catch { /* HTML'deki ad kalir. */ }
  setRange('today');
  loadLive();
  loadNotes();
  startTimers();
})();
