/* Patron service worker - "uygulama olarak yukle" + 2.2: telefona anlik bildirim (Web Push).
   Rapor verisi canli olmali, bu yuzden onbellekleme yapilmiyor; istekler dogrudan aga gecirilir. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* pass-through, custom caching yok */ });

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Patron', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Patron', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    data: { url: d.url || '/patron#bildirim' }, vibrate: d.kind === 'iptal' || d.kind === 'iade' ? [200, 100, 200] : [120]
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/patron';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
