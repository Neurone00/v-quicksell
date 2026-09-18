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

// Interactive login: we drive a real browser, stream it to the phone as
// screenshots, and relay taps and typing back. The user signs in however they
// normally do — Google, Apple, password — and we keep only the resulting
// cookies. This exists because most Vinted accounts are social logins with no
// password at all, and because a human can answer a captcha or an emailed code
// where automation cannot (and should not).
//
// Costs real browser minutes: the Free plan allows ~10/day, and a login takes
// two or three. It is a one-time action.

// Installed before any page script and re-installed on every navigation, so it
// records what the real site calls — the only reliable way to learn endpoints
// that are not documented anywhere and that we have already seen move.
const SNIFFER = () => {
  window.__vqLog = window.__vqLog || [];
  const keep = (e) => { if (window.__vqLog.length < 200) window.__vqLog.push(e); };
  const body = (b) => {
    try {
      if (!b) return null;
      if (typeof b === 'string') return b.slice(0, 400);
      if (b instanceof FormData) return '[FormData ' + [...b.keys()].join(',') + ']';
      return '[' + (b.constructor && b.constructor.name) + ']';
    } catch { return null; }
  };
  const of = window.fetch;
  window.fetch = async function (...a) {
    const url = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || '';
    const method = (a[1] && a[1].method) || (a[0] && a[0].method) || 'GET';
    const r = await of.apply(this, a);
    try { if (/\/api\//.test(url)) keep({ method, url, status: r.status, body: body(a[1] && a[1].body) }); } catch {}
    return r;
  };
  const oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { this.__vq = { m, u }; return oo.apply(this, arguments); };
  const os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (b) {
    const self = this;
    this.addEventListener('load', () => {
      try { if (self.__vq && /\/api\//.test(self.__vq.u))
        keep({ method: self.__vq.m, url: self.__vq.u, status: self.status, body: body(b) }); } catch {}
    });
    return os.apply(this, arguments);
  };
};

// On reconnect, pages()[0] can be a leftover about:blank — pick the real one.
async function livePage(browser) {
  const pages = await browser.pages();
  return pages.find((p) => p.url() && p.url() !== 'about:blank') || pages[0];
}

async function snap(page) {
  const raw = await page.screenshot({ type: 'jpeg', quality: 55 });
  const vp = page.viewport() || { width: 400, height: 780 };
  let b64;
  if (typeof raw === 'string') b64 = raw;
  else {
    const u = new Uint8Array(raw);
    let str = '';
    for (let i = 0; i < u.length; i += 0x8000) str += String.fromCharCode(...u.subarray(i, i + 0x8000));
    b64 = btoa(str);
  }
  return { shot: b64, w: vp.width, h: vp.height };
}

// Ask the server, do not read the page. Two false positives made the earlier
// text check useless: the "Iscriviti | Accedi" label is behind a hamburger on
// mobile, and Vinted hands anonymous visitors a _vinted_fr_session cookie too —
// so "has a session cookie" is not "is logged in". /api/v2/users/current
// answers 200 authenticated and 403 anonymous, which is the real signal.
async function loggedIn(page) {
  return page.evaluate(async () => {
    try {
      const r = await fetch('/api/v2/users/current', {
        credentials: 'include', headers: { accept: 'application/json' },
      });
      return r.status === 200;
    } catch { return false; }
  });
}

export async function browserStart(env) {
  const browser = await puppeteer.launch(env.BROWSER, { keep_alive: 300000 });
  const sessionId = browser.sessionId();
  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.setViewport({ width: 400, height: 760, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(SNIFFER);
  await page.goto(`https://${env.VINTED_HOST}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const out = { sessionId, ...(await snap(page)) };
  await browser.disconnect();   // disconnect, not close — the session stays warm
  return out;
}

export async function browserAct(env, sessionId, act) {
  const browser = await puppeteer.connect(env.BROWSER, sessionId);
  try {
    const page = await livePage(browser);
    if (!page) throw new Error('SESSION_GONE');
    await page.setViewport({ width: 400, height: 760, deviceScaleFactor: 1 });

    if (act.type === 'click') await page.mouse.click(act.x, act.y);
    else if (act.type === 'text') await page.keyboard.type(String(act.text), { delay: 25 });
    else if (act.type === 'key') await page.keyboard.press(act.key || 'Enter');
    else if (act.type === 'scroll') await page.evaluate((d) => window.scrollBy(0, d), act.dy || 400);
    else if (act.type === 'back') await page.goBack({ timeout: 15000 }).catch(() => {});

    // Give the page a beat to react; clicks may navigate.
    await new Promise((r) => setTimeout(r, act.type === 'click' || act.type === 'key' ? 1600 : 500));

    if (await loggedIn(page)) {
      const cookies = await page.cookies();
      if (cookies.find((c) => /session|access_token/.test(c.name))) {
        await env.KV.put(SESSION_KEY, JSON.stringify(cookies));
        const log = await page.evaluate(() => window.__vqLog || []).catch(() => []);
        await browser.close();          // done with it — free the minutes
        return { done: true, cookies: cookies.length, log };
      }
    }
    const log = await page.evaluate(() => {
      const l = window.__vqLog || [];
      window.__vqLog = [];
      return l;
    }).catch(() => []);
    return { done: false, log, ...(await snap(page)) };
  } finally {
    await browser.disconnect().catch(() => {});
  }
}

export async function browserStop(env, sessionId) {
  const browser = await puppeteer.connect(env.BROWSER, sessionId).catch(() => null);
  if (browser) await browser.close().catch(() => {});
  return { ok: true };
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

    page._vqHost = env.VINTED_HOST;
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

// Comparable listings for pricing.
//
// VERIFIED 2026-09-18 against the live site: /api/v2/catalog/items answers 403
// anonymously (and 404 under some bot-detection states — Vinted hides protected
// routes that way). So the JSON API exists but needs a logged-in session, while
// this scrape works with no session at all and no API rate limit. Once a real
// session is connected, compare the two and keep whichever is steadier.
// The catalog page is server-rendered and
// every item link carries its data in the title attribute:
//   "Felpa nike, Brand: Nike, Condizioni: Ottime, Taglia: M, 38.00 €, 40.60 €"
// So we read the rendered page. Labels are Italian because this app is fixed
// to vinted.it; a different market needs its own labels.
export async function searchComparables(api, query, page) {
  await page.goto(`https://${page._vqHost}/catalog?search_text=${encodeURIComponent(query)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForSelector('a[href*="/items/"]', { timeout: 20000 }).catch(() => {});

  return page.evaluate(() => {
    const out = [];
    for (const a of document.querySelectorAll('a[href*="/items/"]')) {
      const t = a.getAttribute('title') || '';
      if (!t) continue;
      // Two prices are shown: the seller's ask, then the same plus buyer
      // protection. We want the ask — the second would inflate every estimate.
      const prices = [...t.matchAll(/(\d+[.,]\d{2})\s*€/g)].map((m) => parseFloat(m[1].replace(',', '.')));
      if (!prices.length) continue;
      out.push({
        title: t.split(/,\s*(?:Brand|Condizioni|Taglia):/)[0].trim(),
        brand: (/,\s*Brand:\s*([^,]+)/.exec(t) || [])[1]?.trim() || null,
        condition: (/,\s*Condizioni:\s*([^,]+)/.exec(t) || [])[1]?.trim() || null,
        size: (/,\s*Taglia:\s*([^,]+)/.exec(t) || [])[1]?.trim() || null,
        price: prices[0],
        // Search excludes sold items, so these are all active asks. The pricing
        // prompt is told to treat active listings as an upper bound.
        sold: false,
        url: a.getAttribute('href'),
      });
    }
    // De-duplicate: each card exposes more than one link to the same item.
    const seen = new Set();
    return out.filter((c) => !seen.has(c.url) && seen.add(c.url));
  });
}

// ponytail: returns null for now. The endpoint it used is gone, and the
// category is only needed at posting time — which is itself unverified. The
// approval card shows the gap rather than guessing a wrong category.
export async function findCategory() {
  return null;
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
// /api/v2/items/{id} is deprecated — /details is the current one.
export async function fetchStats(api, vintedId) {
  const r = await api(`/api/v2/items/${vintedId}/details`);
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
  return withVinted(env, async (api, page) => {
    const me = await api('/api/v2/users/current').catch((e) => ({ error: String(e.message).slice(0, 120) }));
    const comps = await searchComparables(api, 'nike felpa', page);
    return {
      user: me.user?.login || me.login || me.error || '(sconosciuto)',
      comparables_found: comps.length,
      comparables_sample: comps.slice(0, 3),
      // Posting has never been executed. Until one listing goes up for real,
      // treat createListing/updatePrice as unverified.
      posting_verified: false,
    };
  });
}
