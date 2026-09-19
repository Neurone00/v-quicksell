// Runs on vinted.it/items/new and /items/*/edit. Three jobs:
//  1. bridge: list the drafts approved on the phone, and on a click pull their
//     photos from the app, drop them into Vinted's uploader, and type the text.
//     The human clicks the dropdowns and Pubblica. Nothing here writes to Vinted.
//  2. learn: report the live form's controls to the app, so the selector table
//     can be corrected from what Vinted actually renders (client-side React;
//     nothing useful is in the server HTML).
//  3. drops: on an edit page whose item has a drop due, set the new price.
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Candidate selectors per field, first match wins. Corrected via learn mode.
const FIELDS = {
  title:       ['input[name="title"]', 'input[data-testid*="title"]', 'input[placeholder*="es. "]'],
  description: ['textarea[name="description"]', 'textarea[data-testid*="description"]', 'textarea'],
  price:       ['input[name="price"]', 'input[data-testid*="price"]', 'input[inputmode="decimal"]'],
};
const find = (cands) => { for (const c of cands) { const el = document.querySelector(c); if (el) return el; } return null; };
const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// React ignores el.value = x; it needs the native setter plus an input event.
function type(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

let panel;
function show(html) {
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'qs-panel';
    panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;width:330px;max-height:72vh;overflow:auto;background:#fff;color:#15191A;border-radius:16px;box-shadow:0 12px 40px -12px rgba(0,0,0,.4);font:14px/1.5 Inter,system-ui,sans-serif;padding:16px;border:1.5px solid #007782';
    document.body.appendChild(panel);
  }
  panel.innerHTML = html;
  return panel;
}
const head = (t) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><b style="color:#007782">Quicksell</b><span style="color:#5A6566;font-size:12px">${t}</span></div>`;

function learn() {
  const controls = [...document.querySelectorAll('input,textarea,select,button,[role="combobox"],[role="button"]')]
    .map((el) => ({
      tag: el.tagName.toLowerCase(), type: el.type || null, name: el.name || null, id: el.id || null,
      ph: el.placeholder || null, aria: el.getAttribute('aria-label'), testid: el.dataset.testid || null,
      label: (el.labels?.[0]?.textContent || el.closest('label')?.textContent || '').trim().slice(0, 40) || null,
      text: el.tagName === 'BUTTON' ? el.textContent.trim().slice(0, 30) : null,
    }))
    .filter((c) => c.name || c.id || c.ph || c.aria || c.testid || c.label)
    .slice(0, 120);
  send({ type: 'api', path: '/api/learn', method: 'POST', body: { url: location.pathname, controls } });
}

// --- photos: app -> extension -> Vinted's own file input ---------------------
let injecting = false;

async function photoFiles(keys) {
  const files = [];
  for (const [i, key] of keys.entries()) {
    const r = await send({ type: 'photo', key });
    if (!r?.ok) continue;
    const blob = await (await fetch(r.data)).blob();
    files.push(new File([blob], `foto${i + 1}.jpg`, { type: 'image/jpeg' }));
  }
  return files;
}

function injectPhotos(files) {
  const input = document.querySelector('input[type="file"]');
  if (!input || !files.length) return false;
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  injecting = true;
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  setTimeout(() => { injecting = false; }, 3000);
  return true;
}

function fillText(it) {
  const t = find(FIELDS.title), d = find(FIELDS.description), p = find(FIELDS.price);
  if (t) type(t, it.title);
  if (d) type(d, it.description);
  if (p) type(p, String(it.list_price).replace('.', ','));
  return [['Titolo', t], ['Descrizione', d], ['Prezzo', p]].filter(([, el]) => !el).map(([n]) => n);
}

function hints(it, missing, photosOk) {
  return `${head('compilato')}
    ${photosOk === false ? `<div style="color:#B4690E;font-size:12px;margin-bottom:6px">Non ho trovato il caricatore foto: aggiungile tu dal telefono o dal computer.</div>` : ''}
    ${missing.length ? `<div style="color:#B4690E;font-size:12px;margin-bottom:6px">Campo non trovato: ${missing.join(', ')} — ho segnalato il modulo all'app.</div>` : ''}
    <div style="font-size:13px">Scegli tu nei menu di Vinted:</div>
    <div style="font-size:13px;margin-top:4px;line-height:1.7">
      <b>Categoria</b>: ${esc(it.category_path || '—')}<br>
      <b>Marca</b>: ${esc(it.brand || 'nessuna')}${it.brand_source === 'inferred' ? ' <small>(dedotta)</small>' : ''}<br>
      <b>Taglia</b>: ${esc(it.size || '—')} &nbsp; <b>Condizioni</b>: ${esc(it.condition || '—')}<br>
      <b>Colore</b>: ${esc(it.color || '—')} &nbsp; <b>Materiale</b>: ${esc(it.material || '—')}
    </div>
    <div style="margin-top:10px;font-size:12px;color:#5A6566">Prezzo ${esc(it.list_price)} € · stima ${esc(it.est_price)} € · minimo ${esc(it.floor_price)} €.<br>
    Quando pubblichi, l'app collega l'annuncio da sola e da lì segue il prezzo.</div>`;
}

async function fillDraft(it) {
  show(head('porto le foto dal telefono…'));
  const files = await photoFiles(it.photos || []);
  const photosOk = injectPhotos(files);
  await sleep(1500);
  const missing = fillText(it);
  await send({ type: 'pending', id: it.id });   // background links the listing on publish
  show(hints(it, missing, photosOk));
  if (missing.length) learn();
}

async function offerDrafts() {
  const r = await send({ type: 'api', path: '/api/ready', method: 'GET' });
  if (!r?.ok) return show(`${head('')}Non raggiungo l'app: ${esc(r?.error)}.<br><small>Apri l'icona dell'estensione e controlla indirizzo e chiave.</small>`);
  const items = r.data.items || [];
  if (!items.length) return show(`${head('')}Nessuna bozza pronta.<br><small>Approva un capo dal telefono, poi ricarica questa pagina.</small>`);
  const el = show(`${head(`${items.length} pront${items.length === 1 ? 'a' : 'e'} dal telefono`)}` +
    items.map((i) => `<div style="display:flex;gap:8px;align-items:center;padding:8px 0;border-top:1px solid #EDF2F2">
      <img src="" data-key="${esc(i.photos[0])}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;background:#EDF2F2">
      <div style="flex:1;font-size:13px"><b>${esc(i.title)}</b><br><span style="color:#5A6566">${esc(i.list_price)} €</span></div>
      <button data-id="${i.id}" style="background:#007782;color:#fff;border:0;border-radius:99px;padding:8px 12px;font:600 13px Inter,system-ui;cursor:pointer">Compila</button>
    </div>`).join(''));
  el.querySelectorAll('button[data-id]').forEach((b) => { b.onclick = () => fillDraft(items.find((x) => String(x.id) === b.dataset.id)); });
  el.querySelectorAll('img[data-key]').forEach(async (img) => { const r = await send({ type: 'photo', key: img.dataset.key }); if (r?.ok) img.src = r.data; });
}

// --- photos added on this computer: analyse them too ------------------------
async function fileToDataUrl(f) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
}
async function onLocalPhotos(files) {
  if (injecting) return;
  show(head(`leggo ${files.length} foto e cerco capi simili…`));
  const photos = await Promise.all([...files].slice(0, 6).map(fileToDataUrl));
  const up = await send({ type: 'upload', photos });
  if (!up?.ok) return show(`${head('')}${esc(up?.error)}`);
  send({ type: 'api', path: '/api/drain', method: 'POST', body: {} });
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const r = await send({ type: 'api', path: '/api/items', method: 'GET' });
    const it = r?.ok && (r.data.items || []).find((x) => x.id === up.data.id);
    if (it && !['queued', 'analyzing'].includes(it.status)) {
      const missing = fillText(it);
      await send({ type: 'pending', id: it.id });
      return show(hints(it, missing, true));
    }
  }
  show(`${head('')}L'analisi sta prendendo più del solito. La bozza arriverà nell'app.`);
}

// --- boot --------------------------------------------------------------------
(async () => {
  await sleep(1500);
  learn();
  const seen = new WeakSet();
  const hook = () => {
    for (const input of document.querySelectorAll('input[type="file"]')) {
      if (seen.has(input)) continue;
      seen.add(input);
      input.addEventListener('change', () => input.files?.length && onLocalPhotos(input.files));
    }
  };
  hook();
  new MutationObserver(hook).observe(document.body, { childList: true, subtree: true });

  if (/\/items\/\d+\/edit/.test(location.pathname)) {
    const id = location.pathname.match(/\/items\/(\d+)/)[1];
    const r = await send({ type: 'api', path: '/api/due', method: 'GET' });
    const due = r?.ok && (r.data.items || []).find((x) => String(x.vinted_id) === id);
    if (due) {
      const p = find(FIELDS.price);
      if (p) type(p, String(due.due_price).replace('.', ','));
      show(`${head('ribasso')}Prezzo impostato a <b>${due.due_price} €</b> (era ${due.current_price} €, minimo ${due.floor_price} €).<br><small>Salva su Vinted e segno il ribasso come fatto.</small>`);
      document.addEventListener('submit', () => send({ type: 'api', path: `/api/items/${due.id}/dropped`, method: 'POST', body: {} }), true);
    }
  } else {
    offerDrafts();
  }
})();
