// Everything that touches Vinted. One file on purpose: when Vinted changes
// something, or Cloudflare's IPs get blocked and this has to move to a local
// runner on your Mac, this is the only file that changes.
//
// Strategy: drive a REAL browser (Browser Rendering) for the fingerprint and
// the Datadome cookie, but make the actual calls against Vinted's own JSON API
// from inside the page. Browser = credibility, API = no brittle DOM selectors.
import puppeteer from '@cloudflare/puppeteer';

const SESSION_KEY = 'vinted_session';

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

// You paste your cookie string once (see README). We never see your password.
export async function saveSession(env, cookieString) {
  const cookies = parseCookieString(cookieString, env.VINTED_HOST);
  if (!cookies.find((c) => /session|access_token/.test(c.name))) {
    throw new Error('Nessun cookie di sessione trovato. Serve almeno _vinted_fr_session o access_token_web.');
  }
  await env.KV.put(SESSION_KEY, JSON.stringify(cookies));
  return cookies.length;
}

export async function hasSession(env) {
  return !!(await env.KV.get(SESSION_KEY));
}

function parseCookieString(s, host) {
  const domain = '.' + host.replace(/^www\./, '');
  return s
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf('=');
      return { name: p.slice(0, i).trim(), value: p.slice(i + 1).trim(), domain, path: '/' };
    })
    .filter((c) => c.name && c.value);
}

// ---------------------------------------------------------------------------
// Browser session. Free plan gives ~10 browser-minutes/day, so every caller
// gets ONE browser and does all its work inside a single open().
// ---------------------------------------------------------------------------

export async function withVinted(env, fn) {
  const cookies = JSON.parse((await env.KV.get(SESSION_KEY)) || 'null');
  if (!cookies) throw new Error('NO_SESSION');

  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setCookie(...cookies);
    await page.goto(`https://${env.VINTED_HOST}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });

    if (await isLoggedOut(page)) {
      await env.KV.delete(SESSION_KEY);
      throw new Error('SESSION_EXPIRED');
    }

    // Persist refreshed cookies (incl. the Datadome token) for next time.
    await env.KV.put(SESSION_KEY, JSON.stringify(await page.cookies()));

    return await fn(makeApi(page, env), page);
  } finally {
    await browser.close();
  }
}

async function isLoggedOut(page) {
  return page.evaluate(() => {
    const t = document.body?.innerText || '';
    return /accedi|iscriviti/i.test(t) && !/il mio armadio|vendi ora/i.test(t);
  });
}

// Calls Vinted's JSON API from inside the page, so it carries the session,
// the Datadome cookie and a genuine browser fingerprint.
function makeApi(page, env) {
  return async function api(path, init = {}) {
    const res = await page.evaluate(
      async (path, init) => {
        const csrf =
          document.querySelector('meta[name="csrf-token"]')?.content ||
          document.cookie.match(/(?:^|;\s*)v_sid=([^;]+)/)?.[1] ||
          '';
        const r = await fetch(path, {
          method: init.method || 'GET',
          credentials: 'include',
          headers: {
            accept: 'application/json, text/plain, */*',
            'x-csrf-token': csrf,
            ...(init.json ? { 'content-type': 'application/json' } : {}),
            ...(init.headers || {}),
          },
          body: init.json ? JSON.stringify(init.json) : undefined,
        });
        const text = await r.text();
        let body;
        try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
        return { ok: r.ok, status: r.status, body };
      },
      path,
      init
    );
    if (!res.ok) throw new Error(`vinted ${init.method || 'GET'} ${path} -> ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
    return res.body;
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

// Comparable listings for pricing. Captures the sold flag where Vinted exposes
// it — sold comparables are worth far more than active ones.
export async function searchComparables(api, query) {
  const q = encodeURIComponent(query);
  const r = await api(`/api/v2/catalog/items?search_text=${q}&per_page=40&order=relevance`);
  return (r.items || []).map((it) => ({
    title: it.title,
    brand: it.brand_title || it.brand?.title,
    size: it.size_title,
    condition: it.status,
    price: Number(it.price?.amount ?? it.price ?? 0),
    // ponytail: Vinted has renamed this flag more than once. Check every
    // plausible spelling rather than guess; false just means "treat as active".
    sold: Boolean(it.is_sold ?? it.is_closed ?? it.item_closing_action ?? false),
    url: it.url,
  })).filter((c) => c.price > 0);
}

export async function findCategory(api, query) {
  const r = await api(`/api/v2/catalog/items?search_text=${encodeURIComponent(query)}&per_page=5`);
  const hit = (r.items || []).find((i) => i.catalog_id);
  return hit ? { id: hit.catalog_id, path: hit.title } : null;
}

// Uploads photos then creates the listing. Photos are fetched into the page
// from our own Worker so the upload comes from the browser, not from a Worker IP.
export async function createListing(api, page, item, photoUrls) {
  const uploaded = [];
  for (const url of photoUrls) {
    const id = await page.evaluate(async (url) => {
      const blob = await (await fetch(url)).blob();
      const fd = new FormData();
      fd.append('photo[type]', 'item');
      fd.append('photo[file]', blob, 'photo.jpg');
      const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
      const r = await fetch('/api/v2/photos', {
        method: 'POST', credentials: 'include', headers: { 'x-csrf-token': csrf }, body: fd,
      });
      if (!r.ok) throw new Error('photo upload ' + r.status + ' ' + (await r.text()).slice(0, 200));
      return (await r.json()).id;
    }, url);
    uploaded.push(id);
  }

  const created = await api('/api/v2/items', {
    method: 'POST',
    json: {
      item: {
        title: item.title,
        description: item.description,
        catalog_id: item.category_id,
        price: String(item.list_price),
        currency: 'EUR',
        brand: item.brand || undefined,
        size_id: item.size_id || undefined,
        status_id: item.status_id || undefined,
        assigned_photos: uploaded.map((id, i) => ({ id, orientation: 0, position: i })),
      },
      feedback_id: null,
      push_up: false,
    },
  });
  return String(created.item?.id ?? created.id);
}

export async function updatePrice(api, vintedId, price) {
  await api(`/api/v2/items/${vintedId}`, { method: 'PUT', json: { item: { price: String(price) } } });
}

// Views/favourites/sold status for items we've listed.
export async function fetchStats(api, vintedId) {
  const r = await api(`/api/v2/items/${vintedId}`);
  const it = r.item || r;
  return {
    views: it.view_count ?? 0,
    favourites: it.favourite_count ?? 0,
    sold: Boolean(it.is_sold ?? it.is_closed ?? false),
    price: Number(it.price?.amount ?? it.price ?? 0),
  };
}

// Setup helper: confirms the session works and the API shapes above still match.
export async function probe(env) {
  return withVinted(env, async (api) => {
    const me = await api('/api/v2/users/current');
    const search = await api('/api/v2/catalog/items?search_text=nike&per_page=3');
    const sample = (search.items || [])[0] || {};
    return {
      user: me.user?.login || me.login || '(sconosciuto)',
      search_ok: (search.items || []).length > 0,
      sold_flag_present: ['is_sold', 'is_closed', 'item_closing_action'].filter((k) => k in sample),
      sample_keys: Object.keys(sample).slice(0, 30),
    };
  });
}
