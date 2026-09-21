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
  title:       ['#title', 'input[name="title"]', 'input[data-testid*="title"]', 'input[placeholder*="es. "]'],
  description: ['#description', 'textarea[name="description"]', 'textarea[data-testid*="description"]', 'textarea'],
  price:       ['#price', 'input[name="price"]', 'input[data-testid*="price"]', 'input[inputmode="decimal"]'],
};
const find = (cands) => { for (const c of cands) { const el = document.querySelector(c); if (el) return el; } return null; };

// The price input only appears after a category is chosen, and its name can
// vary, so also match an input whose label/nearby text says "Prezzo".
function findPrice() {
  // 1) direct selectors, incl. the 0,00 placeholder Vinted shows
  for (const sel of ['#price', 'input[name="price"]', 'input[data-testid*="price"]', 'input[placeholder*="0,00"]', 'input[placeholder*="0.00"]']) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  // 2) label / aria on the input itself
  for (const el of document.querySelectorAll('input')) {
    const lab = (el.labels?.[0]?.textContent || el.closest('label')?.textContent || el.getAttribute('aria-label') || el.placeholder || '').toLowerCase();
    if (/prezzo|price/.test(lab) && !/spedizione|shipping/.test(lab)) return el;
  }
  // 3) the "Prezzo" section heading, then the input in its container (not Spedizione)
  const heads = [...document.querySelectorAll('h1,h2,h3,h4,legend,label,span,div')].filter((e) => e.textContent.trim() === 'Prezzo');
  for (const h of heads) {
    let scope = h.parentElement;
    for (let up = 0; up < 4 && scope; up++, scope = scope.parentElement) {
      const inp = scope.querySelector('input:not([type="checkbox"]):not([type="radio"]):not([type="file"])');
      if (inp && !/spedizione|shipping/i.test(scope.textContent)) return inp;
    }
  }
  // 4) last resort: an input whose own row shows € but isn't shipping
  for (const el of document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="file"])')) {
    const row = (el.closest('div')?.textContent || '') + (el.parentElement?.parentElement?.textContent || '');
    if (/€/.test(row) && !/spedizione|shipping/i.test(row)) return el;
  }
  return null;
}

// Vinted's save button on the upload/edit form (from the live form: id
// upload-form-save-button, label "Carica"). Text match is the fallback.
function findSave() {
  return document.querySelector('#upload-form-save-button')
    || [...document.querySelectorAll('button')].find((el) => /^(salva|aggiorna|conferma|carica|pubblica|salva modifiche)$/i.test(el.textContent.trim()))
    || document.querySelector('button[type="submit"]');
}
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
    if (!document.getElementById('qs-fonts')) {
      const l = document.createElement('link'); l.id = 'qs-fonts'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,600,60&family=Inter:wght@400;500;600&display=swap';
      document.head.appendChild(l);
    }
    panel = document.createElement('div');
    panel.id = 'qs-panel';
    panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;width:330px;max-height:72vh;overflow:auto;background:#fff;color:#15191A;border-radius:16px;box-shadow:0 12px 40px -12px rgba(0,0,0,.4);font:14px/1.5 Inter,system-ui,sans-serif;padding:16px;border:1.5px solid #007782';
    document.body.appendChild(panel);
  }
  panel.innerHTML = html;
  return panel;
}
const MARK = `<svg viewBox="0 0 64 64" width="20" height="20" fill="none" stroke="#007782" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><circle cx="29" cy="31" r="16.5"/><path d="M40.5 43 L47.5 50 C 51.5 54, 57.5 52.5, 57.5 47.5 C 57.5 44, 54.5 42.5, 52.5 44"/></svg>`;
const head = (t) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">${MARK}<b style="color:#007782;font:600 16px Fraunces,Georgia,serif;font-variation-settings:'SOFT' 60">Quicksell</b><span style="color:#5A6566;font-size:12px">${t}</span></div>`;

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
  const t = find(FIELDS.title), d = find(FIELDS.description);
  if (t) type(t, it.title);
  if (d) type(d, it.description);
  autoFill(it);  // price + dropdowns appear after the category; fill them as they show
  // Title/description are the required ones; everything else can arrive later.
  return [['Titolo', t], ['Descrizione', d]].filter(([, el]) => !el).map(([n]) => n);
}

// ---- auto-fill the fields Vinted renders only after a category is chosen ----
const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));

// The detail fields are <input type=text> with clean ids (from the live form):
// #size #condition #color #material #brand #price. Focusing one opens its menu.
// Vinted options are <div role="checkbox|radio"> (or role=option) carrying an
// exact aria-label ("L", "Ottime", "Cotone"…). Prefer those; the aria-label is
// the clean value to match and harvest.
// Value of an option: aria-label (size/color grids) or the Cell title
// (condition: aria-label is null, title holds "Ottime"/"Nuovo con cartellino").
const optLabel = (o) => (o.getAttribute && o.getAttribute('aria-label'))
  || (o.querySelector && (o.querySelector('[class*="Cell__title"], [data-testid$="--title"]')?.textContent || '').trim())
  || o.textContent.trim();
function optionEls(scope) {
  let els = [...scope.querySelectorAll('[role="option"], [role="checkbox"], [role="radio"]')];
  if (!els.length) els = [...scope.querySelectorAll('li, label, button, [data-testid*="option"], [class*="option"]')];
  return els.filter((o) => o.offsetParent !== null && optLabel(o) && optLabel(o).length < 60);
}
const seq = (t) => { for (const ev of ['pointerover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) t.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window })); };
// Click the interactive option (role=checkbox/radio div). For radios also nudge
// the inner label + keyboard — safe because a radio never un-selects; checkboxes
// get only the single click (a second toggle would UNcheck them).
function selectOption(o) {
  const el = (o.matches && o.matches('[role="checkbox"], [role="radio"], [role="option"]')) ? o
    : (o.querySelector('[role="checkbox"], [role="radio"], [role="option"]') || o);
  el.focus && el.focus();
  // A native .click() is what provably registers with Vinted's React handlers
  // (verified on the size grid: sets the field; a synthetic pointer/mouse
  // sequence did not reliably). Use it for every option — it's a real click.
  el.click();
  if (el.getAttribute && el.getAttribute('role') === 'radio') {
    const lbl = el.querySelector('label'); if (lbl) lbl.click();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  }
}
const menuSel = '[role="listbox"], [role="dialog"], [role="menu"], [class*="dropdown"], [class*="menu"], [class*="popover"], ul';
// A menu that appeared after we focused the input (not one already open).
async function waitMenu(before) {
  for (let i = 0; i < 16; i++) {
    await sleep2(90);
    const cands = [...document.querySelectorAll(menuSel)]
      .filter((e) => !before.has(e) && e.offsetParent !== null && e.getBoundingClientRect().height > 20 && optionEls(e).length >= 1);
    if (cands.length) return cands[cands.length - 1];   // topmost/portal
  }
  return null;
}
// Collapse the flyout so the next field's menu doesn't stack on top: Escape,
// plus an outside pointer/click that Vinted's outside-click handler catches.
function closeMenu() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
    document.body.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }));
  }
}
function matchOpt(text, want, mode) {
  const w = norm(want);
  if (mode === 'token') return text.split(/[^a-z0-9]+/).includes(w);           // "L" ≠ "XL"
  if (mode === 'first') { const f = w.split(' ')[0]; return text.split(/[^a-z0-9]+/).includes(f) || text.startsWith(f); }
  if (mode === 'brand') return text.includes(w);
  // phrase (condition): each option starts with its short title then a long
  // description. Ignore a trailing "condizioni" so a stored "Buone condizioni"
  // still matches Vinted's "Buone".
  const ww = w.replace(/ condizioni$/, '');
  return text === w || text.startsWith(ww) || ww.startsWith(text) || text.includes(' ' + ww + ' ');
}
// Vinted's global option lists, captured as we open the menus, sent to the app
// so the AI can be constrained to them (1:1 fill). Only the category-independent
// lists — brand is a search box, size depends on the category.
const HARVEST = {};
// Open the input's menu and click the option matching `want`. Returns
// 'ok' | 'nomatch' (menu opened, no option fit) | 'nomenu' (couldn't open).
async function pickInput(input, want, mode, harvestKey) {
  // Non-brand: if the trigger already shows a real value, it's set — leave it.
  // (Brand's trigger can show typed-but-unselected text, so don't trust it there.)
  if (mode !== 'brand' && input.value.trim() && !/seleziona|scegli/i.test(input.value)) return 'ok';
  const before = new Set(document.querySelectorAll(menuSel));
  input.focus(); input.click();
  let menu = await waitMenu(before);
  if (!menu) return 'retry';
  if (harvestKey) {                                    // full list, before any type-filter
    const all = optionEls(menu).map((o) => optLabel(o)).filter((t) => t && t.length <= 28);
    if (all.length > (HARVEST[harvestKey]?.length || 0)) HARVEST[harvestKey] = all;
  }
  if (!optionEls(menu).some((o) => matchOpt(norm(optLabel(o)), want, mode))) {
    type(input, want.split(' ')[0]);                   // type-to-filter fields
    menu = (await waitMenu(before)) || menu; await sleep2(200);
  }
  // Already selected (this or a prior tick)? Don't click — a 2nd click unchecks a box.
  if (optChosen(menu, want, mode)) { closeMenu(); return 'ok'; }
  // Size: the flyout lists the value twice ("Consigliato" shortcut + the grid).
  // The grid button has a stable data-testid (…grid-option…) — target it
  // directly by exact aria-label so we never hit the wrong twin.
  let hit = mode === 'token'
    ? [...document.querySelectorAll('[data-testid*="grid-option"]')].find((o) => o.offsetParent && norm(optLabel(o)) === norm(want))
    : null;
  if (!hit) hit = optionEls(menu).find((o) => matchOpt(norm(optLabel(o)), want, mode));
  if (!hit) { closeMenu(); return 'retry'; }           // options still loading
  const fieldSet = () => !!(input.value.trim() && !/seleziona|scegli/i.test(input.value));
  const closedNow = () => !menu.isConnected || menu.offsetParent === null;
  const registered = () => hit.getAttribute?.('aria-checked') === 'true' || optChosen(menu, want, mode) || closedNow() || fieldSet();
  selectOption(hit);
  await sleep2(400);
  let ok = registered();
  // FilterGrid buttons (size) sometimes ignore a synthetic click but take the
  // keyboard: only if the click clearly did NOT register (aria-checked still
  // false, nothing closed, field empty) press Space on the focused button.
  if (!ok && mode === 'token') {
    hit.focus && hit.focus();
    for (const t of ['keydown', 'keyup']) hit.dispatchEvent(new KeyboardEvent(t, { key: ' ', code: 'Space', bubbles: true }));
    await sleep2(400);
    ok = registered();
  }
  if (!ok && mode === 'token') {                       // report exactly what we saw, once
    send({ type: 'api', path: '/api/learn', method: 'POST', body: { url: location.pathname, sizeProbe: {
      want, hitTestid: hit.getAttribute?.('data-testid'), hitAria: hit.getAttribute?.('aria-label'),
      ariaCheckedAfter: hit.getAttribute?.('aria-checked'), fieldValue: input.value, menuClosed: closedNow(),
      hitHtml: (hit.outerHTML || '').slice(0, 500) } } });
  }
  closeMenu();
  return ok ? 'ok' : 'retry';
}

// Brand is a search flyout ("Cerca marche" box + list). Idempotent: if the box
// is already showing (flyout open from a prior tick) don't re-click the
// trigger — that would close it. Find the box as "a visible text input that
// isn't one of the form's own fields", so its placeholder text doesn't matter.
const FORM_INPUTS = new Set(['title', 'description', 'category', 'brand', 'size', 'condition', 'color', 'material', 'price', 'shoulder_width', 'height', 'photos']);
async function pickBrand(input, brand) {
  // Candidate search boxes: visible text inputs that aren't the form's own
  // fields AND aren't Vinted's site-wide "Cerca articoli" header search — that
  // one comes first in the DOM and was swallowing the brand text.
  const vis = () => [...document.querySelectorAll('input')].filter((i) => i !== input && i.offsetParent
    && !FORM_INPUTS.has(i.id) && !FORM_INPUTS.has(i.name) && !/checkbox|radio|file|hidden/.test(i.type || '')
    && !/cerca articoli/i.test(i.placeholder || ''));
  const byPh = (arr) => arr.find((i) => /march|brand/i.test((i.placeholder || '') + (i.getAttribute('aria-label') || '')));
  let search = byPh(vis());                            // flyout already open from a prior tick
  if (!search) {
    const before = new Set(vis());
    input.focus(); input.click(); await sleep2(550);
    const now = vis();
    search = byPh(now) || now.find((i) => !before.has(i));   // the box that just appeared
  }
  if (!search) return 'retry';
  if (norm(search.value) !== norm(brand)) { type(search, brand); await sleep2(900); }
  // Don't guess a results container ("last visible list" was the page FOOTER,
  // whose links became the "options"). The results are role=radio rows — scan
  // those directly, anywhere visible. Exact name first, then a containing match.
  const opts = () => [...document.querySelectorAll('[role="radio"], [role="option"], [role="checkbox"]')].filter((o) => o.offsetParent);
  const isSel = (o) => o.getAttribute('aria-checked') === 'true' || !!o.querySelector('input:checked');
  const findHit = () => opts().find((o) => norm(optLabel(o)) === norm(brand)) || opts().find((o) => matchOpt(norm(optLabel(o)), brand, 'brand'));
  const chosen = () => norm(input.value) === norm(brand) || opts().some((o) => matchOpt(norm(optLabel(o)), brand, 'brand') && isSel(o));
  if (chosen()) { closeMenu(); return 'ok'; }
  const hit = findHit();
  if (!hit) {
    send({ type: 'api', path: '/api/learn', method: 'POST', body: { url: location.pathname, brandProbe: {
      brand, searchPlaceholder: search.placeholder, searchValue: search.value,
      radiosSeen: opts().slice(0, 8).map(optLabel) } } });
    return 'retry';
  }
  selectOption(hit);
  await sleep2(350);
  const ok = chosen() || !hit.isConnected || hit.offsetParent === null;   // selected, or the flyout closed on pick
  closeMenu();
  return ok ? 'ok' : 'retry';
}
// Re-scan the (live) menu for the matching option and whether it's now checked.
// ANY matching option checked counts — size lists "L" twice (Consigliato + grid);
// clicking one ticks the shared state, so checking only the first match read
// the other one as unticked, retried, and the 2nd click un-ticked it.
function optChosen(menu, want, mode) {
  return !!menu && optionEls(menu).some((o) => matchOpt(norm(optLabel(o)), want, mode)
    && (o.getAttribute?.('aria-checked') === 'true' || !!o.querySelector?.('input:checked')));
}
// Snapshot what a field's menu looks like, so a failure is debuggable without guessing.
async function probe(input) {
  const before = new Set(document.querySelectorAll(menuSel));
  input.focus(); input.click();
  await sleep2(400);
  const menus = [...document.querySelectorAll(menuSel)].filter((e) => !before.has(e) && e.offsetParent !== null).slice(0, 2);
  const snap = menus.map((m) => ({ tag: m.tagName, cls: (m.className || '').toString().slice(0, 60), role: m.getAttribute('role'), opts: optionEls(m).slice(0, 8).map((o) => optLabel(o)) }));
  closeMenu();
  return { readonly: input.readOnly, appeared: snap };
}

// Category is a drill-down tree (Donna/Uomo → … → leaf), each level a
// div[role=button].web_ui__Cell with a title; a leaf lacks the chevron/
// "navigating" class and selects on click. Walk it greedily by the AI's
// category words. Returns 'ok' (leaf picked), 'stopped' (no path — left for
// you), 'retry' (menu not open).
const catTitle = (cell) => norm(cell.querySelector('.web_ui__Cell__title')?.textContent || cell.textContent || '');
function bestCategoryCell(cells, words) {
  let best = null, score = 0;
  for (const c of cells) {
    const tt = catTitle(c);
    if (!tt || tt.length > 40) continue;
    const tw = tt.split(/[^a-z0-9]+/).filter(Boolean);
    let s = 0;
    for (const w of words) for (const t of tw) {
      if (t === w) s += 3;
      else if (t.length >= 4 && w.length >= 4 && (t.startsWith(w.slice(0, 4)) || w.startsWith(t.slice(0, 4)))) s += 1;
    }
    if (s > score) { score = s; best = c; }
  }
  return score > 0 ? best : null;
}
async function pickCategory(input, query) {
  if (!input.value.trim() || /seleziona|scegli/i.test(input.value)) { /* not chosen yet */ } else return 'ok';
  let pool = (Array.isArray(query) ? query.join(' ') : norm(query)).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  if (!pool.length) return 'stopped';
  input.focus(); input.click();
  await sleep2(450);
  const stem = (t, w) => t === w || (t.length >= 4 && w.length >= 4 && (t.startsWith(w.slice(0, 4)) || w.startsWith(t.slice(0, 4))));
  const trace = [];   // what each level looked like — reported if we stop short
  const stop = (why) => { send({ type: 'api', path: '/api/learn', method: 'POST', body: { url: location.pathname, categoryTrace: { query, why, trace } } }); return 'stopped'; };
  for (let depth = 0; depth < 8; depth++) {
    // Below the root there's a "Cerca una categoria" box that flattens the tree —
    // type the garment word so nested leaves (Camicie under Vestiti) show directly.
    const search = [...document.querySelectorAll('input')].find((i) => /cerca.*categor/i.test(i.placeholder || '') && i.offsetParent);
    if (search && pool[0] && norm(search.value) !== norm(pool[0])) { type(search, pool[0]); await sleep2(750); }
    const lists = [...document.querySelectorAll('[class*="List__list"], [role="listbox"], [role="menu"]')].filter((l) => l.offsetParent);
    const list = lists[lists.length - 1];
    if (!list) return 'retry';
    const cells = [...list.querySelectorAll('[role="button"]')].filter((c) => c.offsetParent && c.querySelector('.web_ui__Cell__title'));
    const best = bestCategoryCell(cells, pool);
    trace.push({ depth, search: !!search, pool: [...pool], seen: cells.slice(0, 10).map(catTitle), picked: best ? catTitle(best) : null });
    if (!best) return depth === 0 ? 'retry' : stop('no cell matched the remaining words');   // leave the rest to the user
    const bt = catTitle(best).split(/[^a-z0-9]+/).filter(Boolean);
    pool = pool.filter((w) => !bt.some((t) => stem(t, w)));  // consume matched words as we descend
    const navigating = /navigating|with-chevron/.test(best.className) || !!best.querySelector('[class*="chevron"]');
    seq(best);
    await sleep2(500);
    if (!navigating) { closeMenu(); return 'ok'; }   // leaf → category selected
    if (!pool.length) return stop('ran out of words mid-tree');   // user picks the leaf
  }
  return stop('too deep');
}

let autoStop = 0;
function autoFill(it) {
  autoStop = Date.now() + 180000;
  const jobs = [
    { key: 'Categoria', id: 'category', category: true, val: it.category_path || it.category_query },
    { key: 'Prezzo', id: 'price', price: true, val: it.list_price },
    { key: 'Taglia', id: 'size', val: it.size, mode: 'token' },
    { key: 'Condizioni', id: 'condition', val: it.condition, mode: 'phrase', harvest: 'condition' },
    { key: 'Colore', id: 'color', val: it.color, mode: 'first', harvest: 'color' },
    { key: 'Materiale', id: 'material', val: it.material, mode: 'first', harvest: 'material' },
    { key: 'Marca', id: 'brand', val: it.brand, mode: 'brand' },
  ].map((j) => ({ ...j, done: !j.val }));   // nothing to set → already "done"
  let running = false;
  const finish = async () => {
    obs.disconnect(); clearInterval(iv);
    const left = jobs.filter((j) => !j.done && j.val);
    setAutoStatus(left.map((j) => j.key));
    // send Vinted's real option lists so the AI can be constrained to them 1:1
    if (Object.keys(HARVEST).length) send({ type: 'api', path: '/api/enums', method: 'POST', body: { enums: HARVEST } });
    // report the menu DOM of whatever we couldn't fill, so it can be fixed precisely
    if (left.length) {
      const fields = {};
      for (const j of left) { const el = document.getElementById(j.id); if (el) fields[j.key] = await probe(el); }
      send({ type: 'api', path: '/api/learn', method: 'POST', body: { url: location.pathname, dropdownProbe: fields } });
    }
  };
  const tick = async () => {
    if (running) return; running = true;
    try {
      for (const j of jobs) {
        if (j.done) continue;
        const el = document.getElementById(j.id);
        if (!el) continue;                     // field not rendered yet (before category)
        if (j.price) { if (!el.value) type(el, String(j.val)); j.done = true; continue; }
        if (j.category) {
          const r = await pickCategory(el, j.val);
          if (r === 'ok' || r === 'stopped' || (j.tries = (j.tries || 0) + 1) >= 8) j.done = true;
          continue;
        }
        const r = j.mode === 'brand' ? await pickBrand(el, j.val) : await pickInput(el, j.val, j.mode, j.harvest);
        // 'ok' = selected (or already set) → done. 'retry' = menu/options not
        // ready; try a few ticks, then give up and leave it for manual.
        if (r === 'ok' || (j.tries = (j.tries || 0) + 1) >= 8) j.done = true;
      }
    } finally { running = false; }
    if (jobs.every((j) => j.done) || Date.now() > autoStop) finish();
  };
  const obs = new MutationObserver(() => tick());
  obs.observe(document.body, { childList: true, subtree: true });
  const iv = setInterval(tick, 1200);
  tick();
}
function setAutoStatus(left) {
  const box = document.getElementById('qs-auto');
  if (!box) return;
  box.innerHTML = left.length
    ? `<span style="color:#B4690E">Da mettere a mano: <b>${left.join(', ')}</b> — i valori sono qui sotto.</span>`
    : `<span style="color:#1F6F6B">Compilato tutto ✓ — controlla e pubblica.</span>`;
}

function hints(it, missing, photosOk) {
  return `${head('compilato')}
    ${photosOk === false ? `<div style="color:#B4690E;font-size:12px;margin-bottom:6px">Non ho trovato il caricatore foto: aggiungile tu dal telefono o dal computer.</div>` : ''}
    ${missing.length ? `<div style="color:#B4690E;font-size:12px;margin-bottom:6px">Campo non trovato: ${missing.join(', ')} — ho segnalato il modulo all'app.</div>` : ''}
    <div id="qs-auto" style="font-size:13px;margin:2px 0 8px">Compilo tutto: categoria, prezzo, taglia, condizioni, colore, materiale, marca. Controlla e pubblica.</div>
    <div style="font-size:13px;line-height:1.7">
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
  if (!r?.ok) return show(/NOT_LOGGED_IN/.test(r?.error || '')
    ? `${head('')}Non sei ancora entrato nell'app in questo Chrome.<br><small>Apri l'app col tuo link di accesso (una volta), poi ricarica questa pagina.</small>`
    : `${head('')}Non raggiungo l'app: ${esc(r?.error)}.<br><small>Apri l'icona dell'estensione → Avanzate e controlla l'indirizzo.</small>`);
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

// --- diagnostics: the popup asks what this page looks like ------------------
// The first real run is the only way to learn Vinted's form. This makes that
// run tell us everything at once instead of one missing field at a time.
// Open each detail dropdown and capture how its flyout + options are built,
// so the picker can target the exact element Vinted's React listens on.
async function captureDropdowns() {
  const out = {};
  for (const id of ['size', 'condition', 'color', 'material']) {
    const input = document.getElementById(id);
    if (!input) continue;
    const before = new Set(document.querySelectorAll(menuSel));
    input.focus(); input.click();
    const menu = await waitMenu(before);
    if (!menu) { out[id] = { opened: false }; closeMenu(); continue; }
    const opts = optionEls(menu).slice(0, 6).map((o) => {
      const row = o.closest('label, li, [role="option"]') || o;
      const inp = row.querySelector('input');
      return { tag: o.tagName, cls: (o.className || '').toString().slice(0, 50), text: o.textContent.trim().slice(0, 40), input: inp ? inp.type : null, hasLabel: !!row.querySelector('label') };
    });
    out[id] = { opened: true, menuTag: menu.tagName, menuCls: (menu.className || '').toString().slice(0, 60), optionCount: optionEls(menu).length, sample: opts, html: menu.outerHTML.slice(0, 3500) };
    closeMenu(); document.body.click(); await sleep2(250);
  }
  return out;
}
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg?.type !== 'diagnose') return;
  (async () => {
    const save = [...document.querySelectorAll('button')].find((el) => /^(salva|aggiorna|conferma|carica|pubblica|salva modifiche)$/i.test(el.textContent.trim()));
    const dropdowns = await captureDropdowns();
    const report = {
      url: location.pathname,
      photos: !!document.querySelector('input[type="file"]'),
      title: !!find(FIELDS.title), description: !!find(FIELDS.description), price: !!findPrice(),
      save: save ? save.textContent.trim() : null,
      controls: [...document.querySelectorAll('input,textarea,select,[role="combobox"]')]
        .map((el) => [el.tagName.toLowerCase(), el.type || '', el.name || el.id || el.dataset.testid || '', el.placeholder || '', (el.labels?.[0]?.textContent || el.closest('label')?.textContent || '').trim().slice(0, 20)].map((x) => x.replace(/\s+/g, ' ')).join(' | '))
        .filter((c) => !/ot-|onetrust|search_text|vendor/i.test(c)).slice(0, 40),
    };
    send({ type: 'api', path: '/api/learn', method: 'POST', body: { url: location.pathname, controls: report.controls, dropdowns } });
    reply({ ...report, dropdownsSeen: Object.keys(dropdowns).filter((k) => dropdowns[k].opened) });
  })();
  return true;   // async reply
});

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
    const fmt = (n) => String(n);  // dot decimal: Vinted parses with Number()

    // In a batch? The background holds which listing it opened and at what price.
    const b = await send({ type: 'batchInfo' });
    const batch = b?.ok && b.data && b.data.vintedId === id ? b.data : null;

    if (batch) {
      const p = findPrice();
      const save = findSave();
      if (!p || !save) {
        show(`${head('ribasso')}Prezzo da impostare: <b>${fmt(batch.price)} €</b>.<div class="pw" style="color:#B4690E;font-size:12px;margin-top:8px">Non ho trovato ${!p ? 'il campo prezzo' : 'il pulsante Salva'}: finisci tu questo.</div>`);
        learn();
        send({ type: 'batchResult', id: batch.id, ok: false, reason: !p ? 'campo prezzo' : 'pulsante Salva' });
        return;
      }
      type(p, fmt(batch.price));
      show(`${head('ribasso automatico')}Salvo <b>${fmt(batch.price)} €</b>…`);
      await sleep(700);
      save.click();
      await sleep(2500);
      const err = /errore|non valido|riprova/i.test(document.body.innerText);
      send({ type: 'batchResult', id: batch.id, ok: !err, reason: err ? 'Vinted ha segnalato un errore' : null });
      return;
    }

    const r = await send({ type: 'api', path: '/api/due', method: 'GET' });
    const due = r?.ok && (r.data.items || []).find((x) => String(x.vinted_id) === id);
    if (due) {
      const p = find(FIELDS.price);
      if (p) type(p, fmt(due.due_price));
      show(`${head('ribasso')}Prezzo impostato a <b>${fmt(due.due_price)} €</b> (era ${fmt(due.current_price)} €, minimo ${fmt(due.floor_price)} €).<br><small>Salva su Vinted e segno il ribasso come fatto.</small>`);
      document.addEventListener('submit', () => send({ type: 'api', path: `/api/items/${due.id}/dropped`, method: 'POST', body: {} }), true);
    }
  } else {
    offerDrafts();
  }
})();
