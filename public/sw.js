// Payload-free push: we get woken up, then ask the API what needs a human.
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    try {
      const [due, all] = await Promise.all([
        fetch('/api/due').then((r) => r.json()), fetch('/api/items').then((r) => r.json()),
      ]);
      const drops = due.items || [];
      if (drops.length) {
        const d = drops[0];
        return self.registration.showNotification('Quicksell — ribasso', {
          body: drops.length === 1 ? `${d.title}: scendi a €${d.due_price}` : `${drops.length} articoli da ribassare`,
          icon: '/icon-192.png', badge: '/icon-192.png', tag: 'due', data: { url: drops.length === 1 ? d.vinted_url + '/edit' : '/' },
        });
      }
      const n = (all.items || []).filter((i) => i.status === 'pending' || i.status === 'needs_input').length;
      if (n) return self.registration.showNotification('Quicksell', {
        body: n === 1 ? '1 articolo pronto da approvare' : `${n} articoli pronti da approvare`,
        icon: '/icon-192.png', badge: '/icon-192.png', tag: 'pending', data: { url: '/' },
      });
    } catch {}
    return self.registration.showNotification('Quicksell', { body: 'Hai qualcosa da guardare', icon: '/icon-192.png', badge: '/icon-192.png', data: { url: '/' } });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(clients.matchAll({ type: 'window' }).then((cs) => {
    if (url.startsWith('/')) { for (const c of cs) if ('focus' in c) { c.navigate?.(url); return c.focus(); } }
    return clients.openWindow(url);
  }));
});
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
