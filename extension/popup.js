const $ = (s) => document.querySelector(s);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

chrome.storage.local.get('update', ({ update }) => {
  if (!update) return;
  $('#upd').innerHTML = `<div class="card upd"><b>Versione ${update.version} disponibile</b><br>
    <small>Scarica lo zip, sostituisci la cartella dell'estensione, poi in chrome://extensions premi ↻.</small><br>
    <a href="${update.zip}" target="_blank">Scarica</a> · <a href="${update.page}" target="_blank">Cosa c'è di nuovo</a></div>`;
});
chrome.storage.sync.get({ appUrl: '', secret: '' }, (c) => { $('#appUrl').value = c.appUrl; $('#secret').value = c.secret; if (c.appUrl) load(); });
$('#save').onclick = () => chrome.storage.sync.set({ appUrl: $('#appUrl').value.trim().replace(/\/$/, ''), secret: $('#secret').value.trim() }, () => { $('#st').textContent = 'Salvato'; load(); });

async function load() {
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
