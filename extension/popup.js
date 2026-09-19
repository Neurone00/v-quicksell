const DEFAULT_APP_URL = 'https://v-quicksell.neurone00.workers.dev';
const $ = (s) => document.querySelector(s);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

chrome.storage.local.get('update', ({ update }) => {
  if (!update) return;
  $('#upd').innerHTML = `<div class="card upd"><b>Versione ${update.version} in arrivo</b><br>
    <small>Chrome la installa da solo entro qualche ora. Per subito: chrome://extensions → Aggiorna.</small>
    <a href="${update.page}" target="_blank">Cosa c'è di nuovo</a></div>`;
});
chrome.storage.sync.get({ appUrl: 'https://v-quicksell.neurone00.workers.dev', secret: '' }, (c) => { $('#appUrl').value = c.appUrl; $('#secret').value = c.secret; load(); });

async function connection() {
  const r = await send({ type: 'api', path: '/api/status', method: 'GET' });
  const box = $('#conn');
  if (r.ok) { box.innerHTML = `<small>Account attivo: <b>${r.data.user}</b>.</small>`; connectPhone(); return true; }
  // No account on this device yet: create one right here, one click.
  box.innerHTML = `<b>Crea il tuo account</b><br>
    <small>Un click. Niente email, niente password: l'account vive in questa estensione e sul telefono che colleghi.</small><br>
    <button id="enroll" class="big" style="width:100%;margin-top:8px">Crea account</button>
    <details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px;color:var(--muted)">Ho già un account</summary>
      <small>Apri l'app in questo Chrome col tuo link di accesso, oppure incolla la chiave in Avanzate.</small></details>`;
  const btn = document.getElementById('enroll');
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Creo…';
    const e = await send({ type: 'enroll' });
    if (!e.ok || !e.data?.key) { btn.disabled = false; btn.textContent = 'Riprova'; box.insertAdjacentHTML('beforeend', `<div class="card" style="margin-top:8px">Non riuscito: ${e.error || e.data?.error || 'errore'}</div>`); return; }
    load();
  };
  return false;
}

// Show a QR + link so the phone joins the same account.
async function connectPhone() {
  const { appUrl, secret } = await chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL, secret: '' });
  const box = document.getElementById('phone');
  if (!box) return;
  if (!secret) { box.innerHTML = ''; return; }   // owner-key instance: nothing to hand out
  const link = `${appUrl}/?k=${secret}`;
  let img = '';
  try { const q = qrcode(0, 'M'); q.addData(link); q.make(); img = `<div class="qr"><img src="${q.createDataURL(4, 0)}" alt="QR"></div>`; } catch {}
  box.innerHTML = `<div class="card"><b>Collega il telefono</b><br>
    <small>Inquadra il QR col telefono (o apri il link): entra nello stesso account.</small><br>
    ${img}
    <button class="big" id="cpl" style="width:100%">Copia link</button>
    <div style="margin-top:12px;border-top:1px solid rgba(0,0,0,.08);padding-top:10px">
      <b>La tua chiave d'accesso</b><br>
      <small>È il tuo account. Salvala: con questa rientri sempre, anche da un altro computer.</small>
      <div style="font:12px ui-monospace,Menlo,monospace;word-break:break-all;background:#14201e;color:#d7e4e1;border-radius:8px;padding:8px;margin-top:6px">${secret}</div>
      <button class="big" id="ckey" style="width:100%;margin-top:6px">Copia chiave</button>
    </div></div>`;
  document.getElementById('cpl').onclick = () => navigator.clipboard.writeText(link).then(() => { document.getElementById('cpl').textContent = 'Copiato ✓'; });
  document.getElementById('ckey').onclick = () => navigator.clipboard.writeText(secret).then(() => { document.getElementById('ckey').textContent = 'Copiata ✓'; });
}
$('#save').onclick = () => chrome.storage.sync.set({ appUrl: $('#appUrl').value.trim().replace(/\/$/, ''), secret: $('#secret').value.trim() }, () => { $('#st').textContent = 'Salvato'; load(); });

async function load() {
  if (!(await connection())) { $('#due').innerHTML = ''; return; }
  const r = await send({ type: 'api', path: '/api/due', method: 'GET' });
  const box = $('#due');
  if (!r.ok) { box.innerHTML = `<div class="card">Non raggiungo l'app: ${r.error}</div>`; return; }
  const items = r.data.items || [];
  box.innerHTML = `<h2>Ribassi da fare (${items.length})</h2>` +
    (items.length ? `<button id="batch" style="width:100%;margin:4px 0 10px">Ribassa adesso</button>
      <small>Parte da solo ogni giorno; questo lo fa subito. Finestra ridotta a icona, un annuncio ogni 5–15 secondi, avviso alla fine.</small>` : '') +
    (items.map((i) => `<div class="card"><a href="${i.vinted_url}/edit" target="_blank">${i.title}</a><br>
      ${i.current_price} € → <b>${i.due_price} €</b> <small>· minimo ${i.floor_price} €</small></div>`).join('')
     || '<div class="card"><small>Niente da ribassare oggi.</small></div>');
  const b = $('#batch');
  if (b) b.onclick = () => { send({ type: 'batch' }); b.textContent = 'Avviato — ti avviso alla fine'; b.disabled = true; };
}

// Diagnostics: ask the content script on the active Vinted tab what it sees.
$('#diag').onclick = async () => {
  const out = $('#diagout');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/vinted\.it\/items\/(new|\d+\/edit)/.test(tab.url || '')) {
    out.innerHTML = '<div class="card">Apri prima vinted.it → <b>Vendi</b> (o la modifica di un annuncio) in questa scheda, poi riprova.</div>'; return;
  }
  let r; try { r = await chrome.tabs.sendMessage(tab.id, { type: 'diagnose' }); } catch { r = null; }
  if (!r) { out.innerHTML = '<div class="card">Non riesco a parlare con la pagina. Ricarica la scheda di Vinted e riprova.</div>'; return; }
  const ok = (v) => v ? '✓' : '✗';
  const text = `Quicksell diagnostica — ${r.url}
foto: ${ok(r.photos)}  titolo: ${ok(r.title)}  descrizione: ${ok(r.description)}  prezzo: ${ok(r.price)}  salva: ${r.save || '✗'}
controlli:
${r.controls.join('\n')}`;
  out.innerHTML = `<div class="card"><b>${r.url}</b><br>
    foto ${ok(r.photos)} · titolo ${ok(r.title)} · descrizione ${ok(r.description)} · prezzo ${ok(r.price)} · pulsante ${r.save ? '"' + r.save + '"' : '✗'}<br>
    <small>${r.controls.length} controlli visti. Il rapporto è anche nell'app (/api/learned).</small><br>
    <button id="copyd" style="margin-top:8px">Copia rapporto</button></div>`;
  $('#copyd').onclick = () => navigator.clipboard.writeText(text).then(() => { $('#copyd').textContent = 'Copiato ✓'; });
};
