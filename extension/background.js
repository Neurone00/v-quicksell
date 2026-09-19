// The only piece that talks to the app. host_permissions lets it call the
// Worker without CORS; content scripts and the popup go through here.
const cfg = () => chrome.storage.sync.get({ appUrl: '', secret: '' });

async function appUrl(path) {
  const { appUrl, secret } = await cfg();
  if (!appUrl || !secret) throw new Error('NOT_CONFIGURED');
  const u = new URL(path, appUrl);
  u.searchParams.set('k', secret);
  return u;
}
async function api(path, init = {}) {
  const r = await fetch(await appUrl(path), init);
  return r.json();
}

// Service workers have no FileReader; build the data URL by hand, in chunks.
async function toDataUrl(blob) {
  const u = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(s)}`;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    try {
      if (msg.type === 'api') {
        const init = msg.method === 'GET' ? {} : {
          method: msg.method || 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg.body ?? {}),
        };
        reply({ ok: true, data: await api(msg.path, init) });
      } else if (msg.type === 'upload') {
        const fd = new FormData();
        for (const [i, d] of msg.photos.entries()) fd.append('photos', await (await fetch(d)).blob(), `photo${i}.jpg`);
        reply({ ok: true, data: await api('/api/items', { method: 'POST', body: fd }) });
      } else if (msg.type === 'photo') {
        // A photo taken on the phone, pulled back so it can be dropped into Vinted's uploader.
        const r = await fetch(await appUrl(`/api/photo/${encodeURIComponent(msg.key)}`));
        if (!r.ok) throw new Error(`photo ${r.status}`);
        reply({ ok: true, data: await toDataUrl(await r.blob()) });
      } else if (msg.type === 'pending') {
        // Remember which draft is being filled in which tab, so the publish can be linked.
        await chrome.storage.session.set({ pendingDraft: msg.id, pendingTab: sender.tab?.id ?? null });
        reply({ ok: true });
      }
    } catch (e) { reply({ ok: false, error: String(e.message) }); }
  })();
  return true;
});

// When the tab that was filling a draft lands on a listing page, Vinted has
// published it. Link it to the draft: from here the app tracks its price.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  const m = /vinted\.it\/items\/(\d+)(?:-|$|\?)/.exec(info.url);
  if (!m) return;
  const { pendingDraft, pendingTab } = await chrome.storage.session.get(['pendingDraft', 'pendingTab']);
  if (!pendingDraft || (pendingTab != null && pendingTab !== tabId)) return;
  try {
    await api(`/api/items/${pendingDraft}/published`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: info.url.split('?')[0] }),
    });
    await chrome.storage.session.remove(['pendingDraft', 'pendingTab']);
    chrome.notifications.create({ type: 'basic', iconUrl: 'icon.png', title: 'Quicksell', message: 'Annuncio collegato: da ora ne seguo il prezzo.' });
  } catch {}
});

// Once a day, ask the app what is due and nudge.
chrome.alarms.create('due', { periodInMinutes: 60 * 24 });
chrome.alarms.onAlarm.addListener(async () => {
  try {
    const { items } = await api('/api/due');
    if (!items?.length) return;
    chrome.notifications.create({
      type: 'basic', iconUrl: 'icon.png', title: 'Quicksell',
      message: items.length === 1 ? `${items[0].title}: scendi a €${items[0].due_price}` : `${items.length} articoli da ribassare`,
    });
  } catch {}
});
