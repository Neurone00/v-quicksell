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
      } else if (msg.type === 'batchInfo') {
        reply({ ok: true, data: (await chrome.storage.session.get('batch')).batch || null });
      } else if (msg.type === 'batchResult') {
        for (const w of waiters.splice(0)) w(msg);
        reply({ ok: true });
      } else if (msg.type === 'batch') {
        runBatch();
        reply({ ok: true });
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
    chrome.notifications.create({ type: 'basic', iconUrl: 'icons/128.png', title: 'Quicksell', message: 'Annuncio collegato: da ora ne seguo il prezzo.' });
  } catch {}
});

// ---------------------------------------------------------------------------
// Batch drops. One confirmation, then every due listing is opened in a
// minimized window, its price typed, Salva pressed, and the tab closed — with
// a random 5–15 s pause between items, because a person does not edit ten
// prices in ten seconds. This is the user's own browser and session: Vinted
// sees a person editing their own prices. Chosen by the user, eyes open.
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const waiters = [];
const waitResult = (id, ms) => new Promise((res) => {
  const t = setTimeout(() => res(null), ms);
  waiters.push((m) => { if (m.id === id) { clearTimeout(t); res(m); } });
});
const say = (message) => chrome.notifications.create({ type: 'basic', iconUrl: 'icons/128.png', title: 'Quicksell', message });

let running = false;
async function runBatch({ quiet = false } = {}) {
  if (running) return;
  running = true;
  let win = null;
  try {
    const { items } = await api('/api/due');
    if (!items?.length) { if (!quiet) say('Niente da ribassare.'); return; }
    win = await chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized' });
    let done = 0; const failed = [];
    for (const it of items) {
      await chrome.storage.session.set({ batch: { id: it.id, vintedId: String(it.vinted_id), price: it.due_price } });
      const tab = await chrome.tabs.create({ windowId: win.id, url: it.vinted_url + '/edit', active: true });
      // Success is either the content script reporting, or the tab leaving /edit
      // after Salva (which kills the content script before it can report).
      const left = new Promise((res) => {
        const h = (tid, info) => { if (tid === tab.id && info.url && !/\/edit/.test(info.url)) { chrome.tabs.onUpdated.removeListener(h); res({ ok: true }); } };
        chrome.tabs.onUpdated.addListener(h);
        setTimeout(() => chrome.tabs.onUpdated.removeListener(h), 90000);
      });
      const res = await Promise.race([waitResult(it.id, 90000), left]);
      if (res?.ok) {
        await api(`/api/items/${it.id}/dropped`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        done++;
        await chrome.tabs.remove(tab.id).catch(() => {});
      } else {
        // Leave it open and bring it forward: the human finishes this one.
        failed.push(it.title);
        await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      }
      await sleep(rnd(5000, 15000));
    }
    await chrome.storage.session.remove('batch');
    if (failed.length) {
      await chrome.windows.update(win.id, { state: 'normal', focused: true }).catch(() => {});
      say(`${done} ribassi fatti. Da finire a mano: ${failed.join(', ')}.`);
    } else {
      await chrome.windows.remove(win.id).catch(() => {});
      say(`${done} ribass${done === 1 ? 'o fatto' : 'i fatti'}.`);
    }
  } catch (e) {
    say('Ribassi interrotti: ' + String(e.message));
    if (win) chrome.windows.update(win.id, { state: 'normal' }).catch(() => {});
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------------------
// Updates. A sideloaded extension cannot update itself — Chrome only honours
// update_url for Web Store installs — so this does the next best thing: check
// the latest GitHub Release daily and put the new version one click away.
// ---------------------------------------------------------------------------
const REPO = 'Neurone00/v-quicksell';
const cmpVer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

async function checkUpdate() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const rel = await r.json();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    const mine = chrome.runtime.getManifest().version;
    if (latest && cmpVer(latest, mine) > 0) {
      const asset = (rel.assets || []).find((a) => /\.zip$/.test(a.name));
      await chrome.storage.local.set({ update: { version: latest, zip: asset?.browser_download_url || rel.html_url, page: rel.html_url } });
      chrome.action.setBadgeText({ text: '1' });
      chrome.action.setBadgeBackgroundColor({ color: '#B4690E' });
    } else {
      await chrome.storage.local.remove('update');
      chrome.action.setBadgeText({ text: '' });
    }
  } catch {}
}
chrome.alarms.create('update', { periodInMinutes: 60 * 24 });
chrome.runtime.onInstalled.addListener(checkUpdate);

// Once a day, and whenever Chrome starts (a day missed while it was closed gets
// done then): if anything is due, just do it. The user asked not to be asked.
// runBatch says nothing unless there is something to report at the end.
chrome.alarms.create('due', { periodInMinutes: 60 * 24 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'due') runBatch({ quiet: true }); if (a.name === 'update') checkUpdate(); });
chrome.runtime.onStartup.addListener(() => { runBatch({ quiet: true }); checkUpdate(); });
