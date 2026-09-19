const $ = (s) => document.querySelector(s);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

chrome.storage.sync.get({ appUrl: '', secret: '' }, (c) => { $('#appUrl').value = c.appUrl; $('#secret').value = c.secret; if (c.appUrl) load(); });
$('#save').onclick = () => chrome.storage.sync.set({ appUrl: $('#appUrl').value.trim().replace(/\/$/, ''), secret: $('#secret').value.trim() }, () => { $('#st').textContent = 'Salvato'; load(); });

async function load() {
  const r = await send({ type: 'api', path: '/api/due', method: 'GET' });
  const box = $('#due');
  if (!r.ok) { box.innerHTML = `<div class="card">Non raggiungo l'app: ${r.error}</div>`; return; }
  const items = r.data.items || [];
  box.innerHTML = `<h1 style="font-size:14px;margin-top:14px">Ribassi da fare (${items.length})</h1>` +
    (items.length ? `<button id="batch" style="width:100%;margin:4px 0 10px">Ribassa adesso</button>
      <small>Parte da solo ogni giorno; questo lo fa subito. Finestra ridotta a icona, un annuncio ogni 5–15 secondi, avviso alla fine.</small>` : '') +
    (items.map((i) => `<div class="card"><a href="${i.vinted_url}/edit" target="_blank">${i.title}</a><br>
      ${i.current_price} € → <b>${i.due_price} €</b> <small>· minimo ${i.floor_price} €</small></div>`).join('')
     || '<div class="card"><small>Niente da ribassare oggi.</small></div>');
  const b = $('#batch');
  if (b) b.onclick = () => { send({ type: 'batch' }); b.textContent = 'Avviato — ti avviso alla fine'; b.disabled = true; };
}
