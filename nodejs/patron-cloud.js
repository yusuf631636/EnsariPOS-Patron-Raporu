/* Patron Raporu'nun buluta ASAGI YONLU komut kanali (fiyat guncelleme) -
   C:\kurye-bulut-ajan\agent.js'deki WebSocket baglanti/yeniden-deneme
   deseninin AYNISI, sadece amac farkli: kurye siparis/konum gonderir, burasi
   SADECE cloud'dan gelen "fiyat degistir" komutunu dinler ve uygular.
   Yukari yonlu veri (satis/masa/bildirim/menu) zaten cloudPush() ile HTTP
   uzerinden akiyor - buraya HIC dokunulmaz.

   TASARIM ILKESI: bu modul TAMAMEN izole. Burada olabilecek HERHANGI bir
   hata (baglanti kopmasi, bozuk mesaj, SQL hatasi) restoranin kendi yerel
   panelini/cloudPush()'unu ASLA etkilememeli - agent.js'deki "tek bir hata
   tum sureci coktermez" disiplininin birebir ayni uygulamasi. */
const WebSocket = require('ws');

function log(...args) { console.log(new Date().toISOString(), '[patron-cloud]', ...args); }

let ws = null;
let reconnectDelay = 2000;

function start({ activationKey, cloudServerUrl, menuItems, updateMenuPrice, logPriceChange, openTicketDetail, report }) {
  if (!activationKey) { log('cloudActivationKey yok - Patron bulut canli baglantisi pasif.'); return; }
  const wsUrl = `${String(cloudServerUrl || '').replace(/^http/, 'ws')}/patron-ws?activationKey=${encodeURIComponent(activationKey)}`;

  function sendAck(payload) {
    try { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); }
    catch (e) { log('ack gonderilemedi (yoksayildi):', e.message); }
  }

  async function handleSetPrice(msg) {
    let result = null, error = null;
    try {
      result = await updateMenuPrice(msg.priceId, msg.price);
      log(`fiyat guncellendi: kayit ${msg.priceId} ${result.oldPrice} -> ${result.newPrice}`);
      try { logPriceChange({ name: '(bulut)', portion: '', tagLabel: `kayit ${msg.priceId}`, oldPrice: result.oldPrice, newPrice: result.newPrice }); } catch { /* log yazilamazsa komutu iptal etme */ }
    } catch (e) { error = e.message; log(`fiyat guncellenemedi (kayit ${msg.priceId}):`, error); }
    sendAck({ type: 'ack', id: msg.id, ok: !error, oldPrice: result ? result.oldPrice : null, newPrice: result ? result.newPrice : null, error });
  }

  /* Bulut paneli "acik adisyon" satirina tiklaninca ANLIK icerik ister -
     tum acik adisyonlarin satirlarini her 15 saniyede cloudPush() ile onceden
     gondermek gereksiz trafik olurdu, sadece kullanici GERCEKTEN baktiginda
     sorulur (set-price ile AYNI istek/cevap deseni). */
  async function handleGetTicketItems(msg) {
    let items = null, error = null;
    try { items = await openTicketDetail(msg.ticketId); }
    catch (e) { error = e.message; log(`adisyon detayi okunamadi (${msg.ticketId}):`, error); }
    sendAck({ type: 'ack', id: msg.id, ok: !error, items, error });
  }

  /* Bulut paneli "saatlik satis" sekmesinde tarih/saat araligi secince -
     ayni istek/cevap deseni, bu sefer report()'un TAMAMINI (ozet+gunluk+
     saatlik) doner. Buluttaki gunluk push zaten SADECE bugunu tasidigi icin
     gecmis tarih/saat sorgulari buradan CANLI istenmek zorunda. */
  async function handleGetReport(msg) {
    let data = null, error = null;
    try { data = await report(msg.start, msg.end, msg.hourStart, msg.hourEnd); }
    catch (e) { error = e.message; log(`rapor okunamadi (${msg.start}..${msg.end}):`, error); }
    sendAck({ type: 'ack', id: msg.id, ok: !error, data, error });
  }

  async function handleAction(msg) {
    if (msg.action === 'set-price') return handleSetPrice(msg);
    if (msg.action === 'get-ticket-items' && openTicketDetail) return handleGetTicketItems(msg);
    if (msg.action === 'get-report' && report) return handleGetReport(msg);
    // Bilinmeyen/desteklenmeyen eylem turleri sessizce yoksayilir (ileride eklenebilir).
  }

  function connect() {
    try { ws = new WebSocket(wsUrl); }
    catch (e) { log('baglanti kurulamadi (yoksayildi):', e.message); setTimeout(connect, reconnectDelay); return; }

    ws.on('open', () => { reconnectDelay = 2000; log('buluta baglandi (canli komut kanali).'); });
    ws.on('message', raw => {
      try {
        let msg; try { msg = JSON.parse(raw); } catch { return; }
        if (msg.type === 'action') handleAction(msg).catch(e => log('komut islenemedi (yoksayildi):', e.message));
      } catch (e) { log('mesaj islenemedi (yoksayildi):', e.message); }
    });
    ws.on('close', () => {
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
    });
    ws.on('error', error => log('baglanti hatasi (yoksayildi):', error.message));
  }
  connect();
}

module.exports = { start };
