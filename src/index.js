import * as V from './vinted.js';
import { analysePhotos, priceFromComparables } from './ai.js';
import { notify } from './push.js';
import { round50, listPrice, nextPrice } from './price.js';

// ponytail: photos live in KV, not R2. R2 needs a card on file just to enable;
// KV is already bound, free, and 1GB holds far more than this app will ever
// store. Move to R2 if this ever becomes a real photo library.
const PHOTO = 'photo:';

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

// ---------------------------------------------------------------------------
// Auth. This app holds a live Vinted session, so it is not open to the world.
// ponytail: one shared secret in a cookie. Not OAuth — there is exactly one user.
// ---------------------------------------------------------------------------
function authed(req, env) {
  if (!env.APP_SECRET) return true; // local dev
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
      // Set the auth cookie when you open the app with ?k=...
      const res = await env.ASSETS.fetch(req);
      const k = url.searchParams.get('k');
      if (k && k === env.APP_SECRET) {
        const r = new Response(res.body, res);
        r.headers.append('set-cookie', `qs=${k}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
        return r;
      }
      return res;
    }

    // Photos are fetched by the Vinted page itself, which has no app cookie.
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
      return await route(p, req, env, ctx);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },

  // The analysis runs here, not in waitUntil: a scheduled invocation gets a real
  // time budget, waitUntil-after-response does not and silently strands the item.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(event.cron === '0 9 * * *' ? priceRound(env) : drainQueue(env));
  },
};

async function route(p, req, env, ctx) {
  const db = env.DB;

  if (p === '/api/status') {
    const counts = await db.prepare('SELECT status, COUNT(*) n FROM items GROUP BY status').all();
    return json({
      session: await V.hasSession(env),
      ai: !!env.GEMINI_API_KEY,
      push: !!(await env.KV.get('push_sub')),
      version: env.APP_VERSION,
      apk_version: env.APK_VERSION,
      vapid_public: env.VAPID_PUBLIC,
      counts: Object.fromEntries((counts.results || []).map((r) => [r.status, r.n])),
    });
  }

  if (p === '/api/session' && req.method === 'POST') {
    const { cookie } = await req.json();
    const n = await V.saveSession(env, cookie);
    return json({ ok: true, cookies: n });
  }

  // Relayed login: the Worker drives a real browser, the phone sees screenshots
  // and sends back taps. The user signs in however they normally do.
  if (p === '/api/session/browser/start' && req.method === 'POST') {
    try {
      return json(await V.browserStart(env));
    } catch (e) {
      const m = /^BROWSER_LIMIT:(\d+)/.exec(String(e.message));
      if (m) {
        const mins = Math.ceil(Number(m[1]) / 60) || 1;
        return json({ error: `Limite browser di Cloudflare raggiunto. Riprova tra circa ${mins} min, oppure tocca "Libera sessioni".` }, 429);
      }
      return json({ error: String(e.message).slice(0, 180) }, 500);
    }
  }
  if (p === '/api/browser/status') return json(await V.browserStatus(env));
  if (p === '/api/browser/reap' && req.method === 'POST') return json(await V.browserReap(env));
  if (p === '/api/session/browser/act' && req.method === 'POST') {
    const { sessionId, act } = await req.json();
    if (!sessionId || !act) return json({ error: 'sessione mancante' }, 400);
    try {
      const out = await V.browserAct(env, sessionId, act);
      if (out.log?.length) {
        const prev = JSON.parse((await env.KV.get('api_log')) || '[]');
        await env.KV.put('api_log', JSON.stringify([...prev, ...out.log].slice(-300)));
      }
      return json(out);
    } catch (e) {
      const m = String(e.message);
      return json({ error: /SESSION_GONE|Session|closed/i.test(m)
        ? 'La sessione del browser è scaduta. Riapri e riprova.'
        : m.slice(0, 160) }, 400);
    }
  }
  if (p === '/api/session/browser/stop' && req.method === 'POST') {
    const { sessionId } = await req.json();
    return json(await V.browserStop(env, sessionId));
  }

  // Everything the real Vinted site called while you were driving it.
  if (p === '/api/observed') {
    const log = JSON.parse((await env.KV.get('api_log')) || '[]');
    const byPath = {};
    for (const e of log) {
      const u = e.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      const k = `${e.method} ${u}`;
      byPath[k] = (byPath[k] || 0) + 1;
    }
    return json({ total: log.length, endpoints: byPath, recent: log.slice(-40) });
  }

  if (p === '/api/reach') return json(await V.reachability(env));

  if (p === '/api/probe') return json(await V.probe(env));

  // Escape hatch for when Google retires a model again: lists what this key can
  // use, and with ?test=1 times each candidate so you can see which are healthy.
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
    return json(
      (j.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => m.name.replace('models/', ''))
    );
  }

  // The open app drains its own queue. A normal request has a real time budget;
  // waitUntil-after-response does not, and the cron is best-effort.
  if (p === '/api/drain' && req.method === 'POST') {
    const did = await drainQueue(env);
    return json({ processed: did });
  }

  if (p === '/api/push/subscribe' && req.method === 'POST') {
    await env.KV.put('push_sub', JSON.stringify(await req.json()));
    return json({ ok: true });
  }

  if (p === '/api/items' && req.method === 'GET') {
    // A background task can die without ever writing a status (eviction, limits).
    // Nothing else would ever clear it, so sweep stale work into a retryable error.
    await db
      .prepare(
        `UPDATE items SET status='error', note='Analisi interrotta. Tocca Riprova.'
         WHERE status='analyzing' AND (started_at IS NULL OR (julianday('now') - julianday(started_at)) * 1440 > 3)`
      )
      .run();
    const { results } = await db
      .prepare("SELECT * FROM items WHERE status != 'archived' ORDER BY id DESC LIMIT 100")
      .all();
    for (const r of results) {
      r.photos = JSON.parse(r.photos);
      r.needs = JSON.parse(r.needs || '[]');
      r.comparables = r.comparables ? JSON.parse(r.comparables) : null;
    }
    return json({ items: results });
  }

  // Drop photos in. This is the only required action per item.
  if (p === '/api/items' && req.method === 'POST') {
    const form = await req.formData();
    const files = form.getAll('photos').filter((f) => typeof f !== 'string');
    if (!files.length) return json({ error: 'nessuna foto' }, 400);

    const keys = [];
    for (const [i, f] of files.entries()) {
      const key = `${Date.now()}-${i}.jpg`;
      await env.KV.put(PHOTO + key, await processPhoto(env, f));
      keys.push(key);
    }
    const r = await db
      .prepare("INSERT INTO items (status, photos) VALUES ('queued', ?) RETURNING id")
      .bind(JSON.stringify(keys))
      .first();
    return json({ id: r.id });
  }

  const m = p.match(/^\/api\/items\/(\d+)\/(\w+)$/);
  if (m) {
    const id = Number(m[1]);
    const item = await db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
    if (!item) return json({ error: 'not found' }, 404);

    if (m[2] === 'approve') {
      const edits = await req.json().catch(() => ({}));
      return json(await approve(env, item, edits));
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

// One item per tick. Free-plan browser minutes are the scarce resource, and
// nobody uploading a jumper cares about 60 seconds.
async function drainQueue(env) {
  const next = await env.DB
    .prepare("SELECT id FROM items WHERE status='queued' ORDER BY id LIMIT 1")
    .first();
  if (!next) return null;
  await env.DB
    .prepare("UPDATE items SET status='analyzing', started_at=datetime('now') WHERE id=?")
    .bind(next.id)
    .run();
  await analyse(env, next.id);
  return next.id;
}

// ---------------------------------------------------------------------------
// Photo post-production. Basic pass, via the Images binding.
// ---------------------------------------------------------------------------
async function processPhoto(env, file) {
  const buf = (b) => new Response(b).arrayBuffer(); // KV wants bytes, not a stream
  if (!env.IMAGES) return buf(file.stream());
  try {
    const out = await env.IMAGES.input(file.stream())
      .transform({ width: 1200, height: 1200, fit: 'contain', background: '#ffffff' })
      .transform({ sharpen: 1 })
      .output({ format: 'image/jpeg', quality: 88 });
    return buf(out.image());
  } catch {
    // Images has a free-tier cap. A raw photo beats a failed upload.
    return buf(file.stream());
  }
}

// ---------------------------------------------------------------------------
// The whole pipeline: photos -> listing + price. Runs in the background.
// ---------------------------------------------------------------------------
async function analyse(env, id) {
  const db = env.DB;
  const fail = (msg) =>
    db.prepare("UPDATE items SET status='error', note=? WHERE id=?").bind(msg, id).run();

  try {
    const item = await db.prepare('SELECT * FROM items WHERE id=?').bind(id).first();
    const keys = JSON.parse(item.photos);

    const b64 = [];
    for (const k of keys.slice(0, 4)) {
      const buf = await env.KV.get(PHOTO + k, 'arrayBuffer');
      if (buf) b64.push(bufToB64(buf));
    }

    const a = await analysePhotos(env, b64);

    // Our own sold items are the only true transaction prices we have —
    // we know what was actually paid, offers included.
    const { results: mine } = await db
      .prepare("SELECT title, brand, size, condition, current_price FROM items WHERE status='sold' LIMIT 20")
      .all();
    const ownSold = mine.map((r) => ({
      title: r.title, brand: r.brand, size: r.size, condition: r.condition,
      price: r.current_price, sold: true,
    }));

    let comparables = [];
    let category = null;
    try {
      // No browser: this is a plain fetch, and browser minutes are precious.
      comparables = await V.searchComparables(env, a.search_query);
    } catch (e) {
      // No session just means no market data. The vision work already succeeded —
      // throwing it away would waste it and leave you with nothing to look at.
      comparables = [];
      if (/SESSION/.test(String(e.message))) a.missing.push('vinted');
    }

    const price = await priceFromComparables(env, a, [...comparables, ...ownSold]);

    const list = listPrice(price.est_price, Number(env.BUMP_PCT));
    const floor = Math.max(3, round50(price.floor_price));

    await db
      .prepare(
        `UPDATE items SET status=?, title=?, description=?, brand=?, brand_source=?, size=?, size_source=?,
         category_id=?, category_path=?, condition=?, color=?, material=?,
         est_price=?, list_price=?, floor_price=?, current_price=?, comparables=?, needs=?, note=? WHERE id=?`
      )
      .bind(
        a.missing.length ? 'needs_input' : 'pending',
        a.title, a.description, a.brand || null, a.brand_source || null, a.size || null, a.size_source || null,
        category?.id || null, category?.path || null, a.condition, a.color || null, a.material || null,
        price.est_price, list, floor, list,
        JSON.stringify({ reasoning: price.reasoning, sold: comparables.filter((c) => c.sold).length, active: comparables.filter((c) => !c.sold).length, sample: comparables.slice(0, 8) }),
        JSON.stringify(a.missing),
        a.missing.includes('vinted') ? 'Prezzo stimato senza comparabili: collega Vinted e tocca Riprova.' : null,
        id
      )
      .run();

    await notify(env);
  } catch (e) {
    await fail(String(e.message || e).slice(0, 400));
  }
}

// ---------------------------------------------------------------------------
// Approve -> post to Vinted at the bumped price.
// ---------------------------------------------------------------------------
async function approve(env, item, edits) {
  const db = env.DB;
  const merged = { ...item, ...edits };

  // The brand rule: an inferred brand must be confirmed by you or backed by a label.
  if (merged.brand && merged.brand_source === 'inferred' && !edits.brand_confirmed) {
    return { error: 'Conferma la marca o aggiungi una foto dell etichetta.' };
  }
  if (!merged.size) return { error: 'Manca la taglia.' };

  const photos = [];
  for (const k of JSON.parse(item.photos)) {
    const buf = await env.KV.get(PHOTO + k, 'arrayBuffer');
    if (buf) photos.push(buf);
  }
  const vintedId = await V.createListing(env, merged, photos);

  await db
    .prepare(
      `UPDATE items SET status='live', vinted_id=?, title=?, description=?, brand=?, size=?,
       list_price=?, floor_price=?, current_price=?, posted_at=datetime('now'), last_drop_at=datetime('now') WHERE id=?`
    )
    .bind(
      vintedId, merged.title, merged.description, merged.brand || null, merged.size,
      merged.list_price, merged.floor_price, merged.list_price, item.id
    )
    .run();

  return { ok: true, vinted_id: vintedId };
}

// ---------------------------------------------------------------------------
// Daily cron: -DROP_PCT% every DROP_EVERY_DAYS, never below the floor.
// A price cut also pings everyone who favourited the item, which is the point.
// ---------------------------------------------------------------------------
async function priceRound(env) {
  const db = env.DB;
  const { results } = await db
    .prepare(
      `SELECT * FROM items WHERE status='live'
       AND (last_drop_at IS NULL OR julianday('now') - julianday(last_drop_at) >= ?)`
    )
    .bind(Number(env.DROP_EVERY_DAYS))
    .all();
  if (!results.length) return;

  for (const it of results) {
      try {
        const stats = await V.fetchStats(env, it.vinted_id);
        if (stats.sold) {
          await db.prepare("UPDATE items SET status='sold', current_price=? WHERE id=?")
            .bind(stats.price, it.id).run();
          continue;
        }
        const next = nextPrice(it.current_price, it.floor_price, Number(env.DROP_PCT));
        if (next === null) {
          // At the floor. Stop dropping; record the stats and leave it listed.
          await db.prepare('UPDATE items SET views=?, favourites=? WHERE id=?')
            .bind(stats.views, stats.favourites, it.id).run();
          continue;
        }
        await V.updatePrice(env, it.vinted_id, next);
        await db
          .prepare("UPDATE items SET current_price=?, views=?, favourites=?, last_drop_at=datetime('now') WHERE id=?")
          .bind(next, stats.views, stats.favourites, it.id)
          .run();
      } catch (e) {
        await db.prepare('UPDATE items SET note=? WHERE id=?').bind(String(e.message).slice(0, 200), it.id).run();
      }
  }
}

function bufToB64(buf) {
  let s = '';
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
