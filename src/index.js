import * as V from './vinted.js';
import { analysePhotos, priceFromComparables } from './ai.js';
import { notify } from './push.js';
import { listPrice, nextPrice } from './price.js';

// ponytail: photos live in KV, not R2. R2 needs a card on file just to enable;
// KV is already bound, free, and 1GB holds far more than this app will store.
const PHOTO = 'photo:';

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

// ---------------------------------------------------------------------------
// Auth. One shared secret in a cookie or ?k=. There is exactly one user.
// ---------------------------------------------------------------------------
function authed(req, env) {
  if (!env.APP_SECRET) return true;
  const url = new URL(req.url);
  if (url.searchParams.get('k') === env.APP_SECRET) return true;
  return (req.headers.get('cookie') || '').includes(`qs=${env.APP_SECRET}`);
}

async function photoToken(env, key) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key + (env.APP_SECRET || '')));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (!p.startsWith('/api/')) {
      const res = await env.ASSETS.fetch(req);
      const k = url.searchParams.get('k');
      if (k && k === env.APP_SECRET) {
        const r = new Response(res.body, res);
        r.headers.append('set-cookie', `qs=${k}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
        return r;
      }
      return res;
    }

    if (p.startsWith('/api/photo/')) {
      const key = decodeURIComponent(p.slice('/api/photo/'.length));
      const ok = authed(req, env) || url.searchParams.get('t') === (await photoToken(env, key));
      if (!ok) return new Response('no', { status: 403 });
      const buf = await env.KV.get(PHOTO + key, 'arrayBuffer');
      if (!buf) return new Response('not found', { status: 404 });
      return new Response(buf, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' } });
    }

    if (p === '/api/version') return json({ version: env.APP_VERSION });
    if (!authed(req, env)) return json({ error: 'unauthorized' }, 401);

    try {
      return await route(p, req, env, ctx, url);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(event.cron === '0 9 * * *' ? dailyRound(env) : drainQueue(env));
  },
};

const parseItem = (r) => ({
  ...r,
  photos: JSON.parse(r.photos),
  needs: JSON.parse(r.needs || '[]'),
  comparables: r.comparables ? JSON.parse(r.comparables) : null,
});

async function route(p, req, env, ctx, url) {
  const db = env.DB;

  if (p === '/api/status') {
    const counts = await db.prepare('SELECT status, COUNT(*) n FROM items GROUP BY status').all();
    return json({
      ai: !!env.GEMINI_API_KEY,
      push: !!(await env.KV.get('push_sub')),
      version: env.APP_VERSION,
      apk_version: env.APK_VERSION,
      vapid_public: env.VAPID_PUBLIC,
      counts: Object.fromEntries((counts.results || []).map((r) => [r.status, r.n])),
    });
  }

  if (p === '/api/push/subscribe' && req.method === 'POST') {
    await env.KV.put('push_sub', JSON.stringify(await req.json()));
    return json({ ok: true });
  }

  if (p === '/api/items' && req.method === 'GET') {
    // A background task can die without writing a status. Sweep stale work.
    await db.prepare(
      `UPDATE items SET status='error', note='Analisi interrotta. Tocca Riprova.'
       WHERE status='analyzing' AND (started_at IS NULL OR (julianday('now') - julianday(started_at)) * 1440 > 3)`
    ).run();
    const { results } = await db
      .prepare("SELECT * FROM items WHERE status != 'archived' ORDER BY id DESC LIMIT 100").all();
    return json({ items: results.map(parseItem) });
  }

  // Photos in — from the app or from the phone's share sheet. Only required action.
  if ((p === '/api/items' || p === '/api/share') && req.method === 'POST') {
    const form = await req.formData();
    const files = form.getAll('photos').filter((f) => typeof f !== 'string');
    const sharedUrl = String(form.get('url') || form.get('text') || '');
    let id = null;
    if (files.length) {
      const keys = [];
      for (const [i, f] of files.entries()) {
        const key = `${Date.now()}-${i}.jpg`;
        await env.KV.put(PHOTO + key, await processPhoto(env, f));
        keys.push(key);
      }
      ({ id } = await db.prepare("INSERT INTO items (status, photos) VALUES ('queued', ?) RETURNING id")
        .bind(JSON.stringify(keys)).first());
    } else if (V.vintedIdFromUrl(sharedUrl)) {
      // Sharing a published listing back from the Vinted app links it to the newest ready draft.
      const ready = await db.prepare("SELECT id FROM items WHERE status='ready' ORDER BY id DESC LIMIT 1").first();
      if (ready) await markPublished(env, ready.id, sharedUrl);
    }
    if (p === '/api/share') return Response.redirect(new URL('/?shared=1', req.url).toString(), 303);
    if (!files.length) return json({ error: 'nessuna foto' }, 400);
    return json({ id });
  }

  if (p === '/api/drain' && req.method === 'POST') return json({ processed: await drainQueue(env) });

  // What the extension fills on the computer: approved drafts, photos included.
  if (p === '/api/ready') {
    const { results } = await db.prepare("SELECT * FROM items WHERE status='ready' ORDER BY id DESC").all();
    return json({ items: results.map(parseItem) });
  }

  // Drops due now. The app never changes a price itself: it says what to set.
  if (p === '/api/due') {
    const { results } = await db
      .prepare("SELECT * FROM items WHERE status='live' AND due_price IS NOT NULL ORDER BY next_drop_at").all();
    return json({ items: results.map(parseItem) });
  }

  // The extension reports Vinted's live form so the filler can be corrected
  // from what is actually rendered; nothing useful is in the server HTML.
  if (p === '/api/learn' && req.method === 'POST') {
    const body = await req.json();
    const prev = JSON.parse((await env.KV.get('learned')) || '[]');
    await env.KV.put('learned', JSON.stringify([...prev, { at: new Date().toISOString(), ...body }].slice(-10)));
    return json({ ok: true });
  }
  if (p === '/api/learned') return json(JSON.parse((await env.KV.get('learned')) || '[]'));

  // Escape hatch for when Google retires a model again.
  if (p === '/api/models') {
    if (url.searchParams.get('test')) {
      const out = [];
      for (const m of ['gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-flash-latest']) {
        const t0 = Date.now();
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ok' }] }] }),
            signal: AbortSignal.timeout(12000),
          });
          out.push({ model: m, status: r.status, ms: Date.now() - t0 });
        } catch (e) { out.push({ model: m, error: String(e.message).slice(0, 60), ms: Date.now() - t0 }); }
      }
      return json(out);
    }
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
    });
    const j = await r.json();
    return json((j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace('models/', '')));
  }

  if (p === '/api/probe') {
    const comps = await V.searchComparables(env, url.searchParams.get('q') || 'nike felpa', 10);
    return json({ comparables_found: comps.length, comparables_sample: comps.slice(0, 3) });
  }

  const m = p.match(/^\/api\/items\/(\d+)\/(\w+)$/);
  if (m) {
    const id = Number(m[1]);
    const item = await db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
    if (!item) return json({ error: 'not found' }, 404);

    if (m[2] === 'approve') return json(await approve(env, item, await req.json().catch(() => ({}))));
    if (m[2] === 'published') {
      const { url: u } = await req.json().catch(() => ({}));
      if (!V.vintedIdFromUrl(u)) return json({ error: 'Serve il link dell\'annuncio Vinted.' }, 400);
      await markPublished(env, id, u);
      return json({ ok: true });
    }
    if (m[2] === 'dropped') {
      if (item.due_price == null) return json({ ok: true });
      await db.prepare(
        `UPDATE items SET current_price=due_price, due_price=NULL, last_drop_at=datetime('now'),
         next_drop_at=datetime('now', '+' || ? || ' days') WHERE id=?`
      ).bind(Number(env.DROP_EVERY_DAYS), id).run();
      return json({ ok: true });
    }
    if (m[2] === 'reject') {
      await db.prepare("UPDATE items SET status='archived' WHERE id=?").bind(id).run();
      return json({ ok: true });
    }
    if (m[2] === 'retry') {
      await db.prepare("UPDATE items SET status='queued', note=NULL WHERE id=?").bind(id).run();
      return json({ ok: true });
    }
  }

  return json({ error: 'not found' }, 404);
}

// One item per tick; the queue keeps the order. Claim atomically: two
// overlapping drains must not analyse the same item twice.
async function drainQueue(env) {
  const next = await env.DB.prepare(
    `UPDATE items SET status='analyzing', started_at=datetime('now')
     WHERE id = (SELECT id FROM items WHERE status='queued' ORDER BY id LIMIT 1) RETURNING id`
  ).first();
  if (!next) return null;
  await analyse(env, next.id);
  return next.id;
}

// Basic post-production via the Images binding; raw photo if it caps out.
async function processPhoto(env, file) {
  const buf = (b) => new Response(b).arrayBuffer();
  if (!env.IMAGES) return buf(file.stream());
  try {
    const out = await env.IMAGES.input(file.stream())
      .transform({ width: 1200, height: 1200, fit: 'contain', background: '#ffffff' })
      .transform({ sharpen: 1 })
      .output({ format: 'image/jpeg', quality: 88 });
    return buf(out.image());
  } catch { return buf(file.stream()); }
}

// ---------------------------------------------------------------------------
// Photos -> listing + price. Runs from the queue.
// ---------------------------------------------------------------------------
async function analyse(env, id) {
  const db = env.DB;
  const fail = (msg) => db.prepare("UPDATE items SET status='error', note=? WHERE id=?").bind(msg, id).run();
  try {
    const item = await db.prepare('SELECT * FROM items WHERE id=?').bind(id).first();
    const b64 = [];
    for (const k of JSON.parse(item.photos).slice(0, 4)) {
      const buf = await env.KV.get(PHOTO + k, 'arrayBuffer');
      if (buf) b64.push(bufToB64(buf));
    }
    const a = await analysePhotos(env, b64);

    // Our own sales are the only true settled prices we have.
    const { results: mine } = await db
      .prepare("SELECT title, brand, size, condition, current_price FROM items WHERE status='sold' LIMIT 20").all();
    const ownSold = mine.map((r) => ({ title: r.title, brand: r.brand, size: r.size, condition: r.condition, price: r.current_price, sold: true }));

    let comparables = [], compsError = null;
    try { comparables = await V.searchComparables(env, a.search_query); }
    catch (e) { compsError = String(e.message).slice(0, 160); }

    const price = await priceFromComparables(env, a, [...comparables, ...ownSold]);
    const list = listPrice(price.est_price, Number(env.BUMP_PCT));
    const floor = Math.max(3, Math.round(price.floor_price * 2) / 2);

    await db.prepare(
      `UPDATE items SET status=?, title=?, description=?, brand=?, brand_source=?, size=?, size_source=?,
       category_path=?, condition=?, color=?, material=?, est_price=?, list_price=?, floor_price=?, current_price=?,
       comparables=?, needs=?, note=? WHERE id=?`
    ).bind(
      a.missing.length ? 'needs_input' : 'pending',
      a.title, a.description, a.brand || null, a.brand_source || null, a.size || null, a.size_source || null,
      a.category_query || null, a.condition, a.color || null, a.material || null,
      price.est_price, list, floor, list,
      JSON.stringify({ reasoning: price.reasoning, sold: comparables.filter((c) => c.sold).length,
        active: comparables.filter((c) => !c.sold).length, sample: comparables.slice(0, 8) }),
      JSON.stringify(a.missing),
      compsError ? `Nessun comparabile: ${compsError}` : comparables.length === 0 ? `Nessun comparabile trovato per "${a.search_query}".` : null,
      id
    ).run();
    await notify(env);
  } catch (e) {
    await fail(String(e.message || e).slice(0, 400));
  }
}

// Approve = "ready for me to publish". Nothing is written to Vinted, ever.
async function approve(env, item, edits) {
  const merged = { ...item, ...edits };
  if (merged.brand && merged.brand_source === 'inferred' && !edits.brand_confirmed) {
    return { error: 'Conferma la marca o lascia il campo vuoto.' };
  }
  if (!merged.size) return { error: 'Manca la taglia.' };
  await env.DB.prepare(
    `UPDATE items SET status='ready', title=?, description=?, brand=?, size=?, list_price=?, floor_price=?, current_price=? WHERE id=?`
  ).bind(merged.title, merged.description, merged.brand || null, merged.size, merged.list_price, merged.floor_price, merged.list_price, item.id).run();
  return { ok: true };
}

async function markPublished(env, id, vintedUrl) {
  await env.DB.prepare(
    `UPDATE items SET status='live', vinted_url=?, vinted_id=?, posted_at=datetime('now'), last_drop_at=datetime('now'),
     next_drop_at=datetime('now', '+' || ? || ' days'), due_price=NULL WHERE id=?`
  ).bind(vintedUrl.split('?')[0], V.vintedIdFromUrl(vintedUrl), Number(env.DROP_EVERY_DAYS), id).run();
}

// ---------------------------------------------------------------------------
// Daily: read each live listing's public page, mark sold ones, and compute
// which drops are due. Then tell the human. A price cut also pings everyone
// who favourited the item — which is the point.
// ---------------------------------------------------------------------------
async function dailyRound(env) {
  const db = env.DB;
  const { results } = await db.prepare("SELECT * FROM items WHERE status='live' AND vinted_url IS NOT NULL").all();
  let due = 0;
  for (const it of results) {
    try {
      const t = await V.trackItem(env, it.vinted_url);
      if (t.gone || t.sold) {
        await db.prepare("UPDATE items SET status='sold', due_price=NULL WHERE id=?").bind(it.id).run();
        continue;
      }
      const isDue = it.due_price == null && it.next_drop_at && new Date(it.next_drop_at + 'Z') <= new Date();
      const next = isDue ? nextPrice(it.current_price, it.floor_price, Number(env.DROP_PCT)) : null;
      if (next) due++;
      await db.prepare('UPDATE items SET views=COALESCE(?,views), favourites=COALESCE(?,favourites), due_price=COALESCE(?,due_price) WHERE id=?')
        .bind(t.views, t.favourites, next, it.id).run();
    } catch (e) {
      await db.prepare('UPDATE items SET note=? WHERE id=?').bind(String(e.message).slice(0, 200), it.id).run();
    }
  }
  if (due) await notify(env);
}

function bufToB64(buf) {
  let s = '';
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
