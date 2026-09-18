// Payload-free push: we get woken up, then ask the API what's pending.
self.addEventListener('push', (e) => {
  e.waitUntil(
    fetch('/api/items')
      .then((r) => r.json())
      .then((d) => {
        const n = (d.items || []).filter((i) => i.status === 'pending' || i.status === 'needs_input').length;
        return self.registration.showNotification('V Quicksell', {
          body: n === 1 ? '1 articolo pronto da approvare' : `${n} articoli pronti da approvare`,
          icon: '/icon.svg',
          tag: 'pending',
          data: { url: '/' },
        });
      })
      .catch(() => self.registration.showNotification('V Quicksell', { body: 'Un articolo è pronto', icon: '/icon.svg' }))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then((cs) => {
      for (const c of cs) if ('focus' in c) return c.focus();
      return clients.openWindow('/');
    })
  );
});

// ponytail: no offline caching. The app is useless offline anyway — every
// screen needs the API. A cache here would only serve you stale prices.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
