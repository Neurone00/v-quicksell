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
    (items.length ? `<button id="batch" style="width:100%;margin:4px 0 10px">Ribassa tutt${items.length === 1 ? 'o' : 'i'} in background</button>
      <small>Si apre una finestra ridotta a icona, fa un annuncio ogni 5–15 secondi e ti avvisa alla fine.</small>` : '') +
    (items.map((i) => `<div class="card"><a href="${i.vinted_url}/edit" target="_blank">${i.title}</a><br>
      ${i.current_price} € → <b>${i.due_price} €</b> <small>· minimo ${i.floor_price} €</small></div>`).join('')
     || '<div class="card"><small>Niente da ribassare oggi.</small></div>');
  const b = $('#batch');
  if (b) b.onclick = () => { send({ type: 'batch' }); b.textContent = 'Avviato — ti avviso alla fine'; b.disabled = true; };
}
