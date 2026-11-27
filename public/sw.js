// Tutorise HQ service worker: receives push notifications, sets the app badge
// and opens the right page when a notification is tapped. No offline caching.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const setBadge = async (n) => {
  try {
    if (!('setAppBadge' in self.navigator)) return;
    if (n > 0) await self.navigator.setAppBadge(n); else await self.navigator.clearAppBadge();
  } catch { /* not supported here */ }
};

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'Tutorise HQ', body: event.data?.text() || '' }; }
  event.waitUntil((async () => {
    // iOS requires every push to show a notification.
    await self.registration.showNotification(d.title || 'Tutorise HQ', {
      body: d.body || '',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: d.url || '/' },
    });
    if (typeof d.badge === 'number') await setBadge(d.badge);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) { await w.focus(); try { await w.navigate(url); } catch {} return; }
    }
    await self.clients.openWindow(url);
  })());
});

// The page asks the worker to update the badge when the app is open.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'badge') event.waitUntil(setBadge(Number(event.data.count) || 0));
});
