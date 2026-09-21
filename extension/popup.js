const DEFAULT_APP_URL = 'https://v-quicksell.neurone00.workers.dev';
const $ = (s) => document.querySelector(s);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));
const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

chrome.storage.local.get('update', ({ update }) => {
  if (!update) return;
  $('#upd').innerHTML = `<div class="card upd"><b>Versione ${update.version} in arrivo</b><br>
    <small>Chrome la installa da solo entro qualche ora. Per subito: chrome://extensions → Aggiorna.</small>
    <a href="${update.page}" target="_blank">Cosa c'è di nuovo</a></div>`;
});
chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL, secret: '' }, (c) => { $('#appUrl').value = c.appUrl; $('#secret').value = c.secret; load(); });

// gear <-> settings
$('#gear').onclick = () => { $('#main').hidden = true; $('#settings').hidden = false; };
$('#back').onclick = () => { $('#settings').hidden = true; $('#main').hidden = false; };

async function connection() {
  const r = await send({ type: 'api', path: '/api/status', method: 'GET' });
  if (r.ok) {
    $('#accStatus').innerHTML = `<small>Account attivo: <b>${esc(r.data.user)}</b>.</small>`;
    $('#conn').innerHTML = '';
    connectPhone();
    return true;
  }
  // No account yet: create one right here (essential, so it stays in the main view).
  $('#accStatus').innerHTML = `<small>Nessun account su questo Chrome.</small>`;
  $('#conn').innerHTML = `<div class="card"><b>Crea il tuo account</b><br>
    <small>Un click. Niente email, niente password: l'account vive in questa estensione e sul telefono che colleghi.</small>
    <button id="enroll" class="big">Crea account</button></div>`;
  const btn = document.getElementById('enroll');
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Creo…';
    const e = await send({ type: 'enroll' });
    if (!e.ok || !e.data?.key) { btn.disabled = false; btn.textContent = 'Riprova'; return; }
    load();
  };
  return false;
}

// QR + key backup, in Settings.
async function connectPhone() {
  const { appUrl, secret } = await chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL, secret: '' });
  const box = $('#phone');
  if (!box) return;
  if (!secret) { box.innerHTML = ''; return; }
  const link = `${appUrl}/?k=${secret}`;
  let img = '';
  try { const q = qrcode(0, 'M'); q.addData(link); q.make(); img = `<div class="qr"><img src="${q.createDataURL(4, 0)}" alt="QR"></div>`; } catch {}
  box.innerHTML = `<div class="card"><b>Collega il telefono</b><br>
    <small>Inquadra il QR col telefono (o apri il link): entra nello stesso account.</small><br>
    ${img}
    <button class="big" id="cpl">Copia link</button>
    <div style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px">
      <b>La tua chiave d'accesso</b><br>
      <small>È il tuo account. Salvala: con questa rientri sempre, anche da un altro computer.</small>
      <div style="font:12px ui-monospace,Menlo,monospace;word-break:break-all;background:#14201e;color:#d7e4e1;border-radius:8px;padding:8px;margin-top:6px">${esc(secret)}</div>
      <button class="big" id="ckey">Copia chiave</button>
    </div></div>`;
  document.getElementById('cpl').onclick = () => navigator.clipboard.writeText(link).then(() => { document.getElementById('cpl').textContent = 'Copiato ✓'; });
  document.getElementById('ckey').onclick = () => navigator.clipboard.writeText(secret).then(() => { document.getElementById('ckey').textContent = 'Copiata ✓'; });
}
$('#save').onclick = () => chrome.storage.sync.set({ appUrl: $('#appUrl').value.trim().replace(/\/$/, ''), secret: $('#secret').value.trim() }, () => { $('#st').textContent = 'Salvato'; load(); });

async function load() {
  const due = $('#due'), listings = $('#listings'), listhead = $('#listhead');
  if (!(await connection())) { due.innerHTML = ''; listings.innerHTML = ''; listhead.hidden = true; return; }

  const r = await send({ type: 'api', path: '/api/items', method: 'GET' });
  if (!r.ok) { listings.innerHTML = `<div class="card">Non raggiungo l'app: ${esc(r.error)}</div>`; return; }
  const items = r.data.items || [];
  const live = items.filter((i) => i.status === 'live');
  const dropDue = live.filter((i) => i.due_price);

  // Price drops due — the one action, kept up top.
  due.innerHTML = dropDue.length
    ? `<h2>Ribassi da fare (${dropDue.length})</h2>
       <button id="batch" style="width:100%">Ribassa adesso</button>
       <small>Parte da solo ogni giorno; questo lo fa subito. Un annuncio ogni 5–15 secondi, avviso alla fine.</small>
       ${dropDue.map((i) => `<div class="card"><a href="${i.vinted_url}/edit" target="_blank">${esc(i.title)}</a><br>
         <span class="price">${i.current_price} €</span> <span class="due">→ ${i.due_price} €</span> <small>· min ${i.floor_price} €</small></div>`).join('')}`
    : '';
  const b = $('#batch');
  if (b) b.onclick = () => { send({ type: 'batch' }); b.textContent = 'Avviato — ti avviso alla fine'; b.disabled = true; };

  // Active listings.
  listhead.hidden = false;
  listings.innerHTML = live.length
    ? live.map((i) => `<div class="card"><a href="${i.vinted_url}" target="_blank">${esc(i.title)}</a><br>
        <span class="price">${i.current_price} €</span> <small>· min ${i.floor_price} €${i.due_price ? ' · <span class="due">ribasso oggi</span>' : ''}</small></div>`).join('')
    : `<div class="card"><small>Nessun annuncio attivo. Pubblica un capo, poi collega l'annuncio: comparirà qui e da lì l'app segue il prezzo.</small></div>`;
}

// Diagnostics: ask the content script on the active Vinted tab what it sees.
$('#diag').onclick = async () => {
  const out = $('#diagout');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/vinted\.it\/items\/(new|\d+\/edit)/.test(tab.url || '')) {
    out.innerHTML = '<div class="card">Apri prima vinted.it → <b>Vendi</b> (o la modifica di un annuncio) in questa scheda, poi riprova.</div>'; return;
  }
  out.innerHTML = '<div class="card"><small>Leggo la pagina…</small></div>';
  let r; try { r = await chrome.tabs.sendMessage(tab.id, { type: 'diagnose' }); } catch { r = null; }
  if (!r) { out.innerHTML = '<div class="card">Non riesco a parlare con la pagina. Ricarica la scheda di Vinted e riprova.</div>'; return; }
  const ok = (v) => v ? '✓' : '✗';
  const text = `Quicksell diagnostica — ${r.url}\nfoto: ${ok(r.photos)}  titolo: ${ok(r.title)}  descrizione: ${ok(r.description)}  prezzo: ${ok(r.price)}  salva: ${r.save || '✗'}\ncontrolli:\n${(r.controls || []).join('\n')}`;
  out.innerHTML = `<div class="card"><b>${esc(r.url)}</b><br>
    foto ${ok(r.photos)} · titolo ${ok(r.title)} · descrizione ${ok(r.description)} · prezzo ${ok(r.price)} · pulsante ${r.save ? '"' + esc(r.save) + '"' : '✗'}<br>
    <small>${(r.controls || []).length} controlli visti. Il rapporto è anche nell'app (/api/learned).</small><br>
    <button id="copyd">Copia rapporto</button></div>`;
  $('#copyd').onclick = () => navigator.clipboard.writeText(text).then(() => { $('#copyd').textContent = 'Copiato ✓'; });
};
