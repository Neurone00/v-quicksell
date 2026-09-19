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
    // Almost always means document.cookie was used: Vinted's session cookies are
    // HttpOnly, so JS cannot read them and the paste arrives without the only
    // part that matters. Say that, rather than a generic failure.
    throw new Error(
      `Ricevuti ${cookies.length} cookie, ma nessuno di sessione. ` +
      'Probabilmente hai usato document.cookie nella Console: i cookie di sessione ' +
      'di Vinted sono HttpOnly e Javascript non li vede. Prendili dalla scheda Rete: ' +
      'ricarica vinted.it, clicca la prima richiesta e copia l\'intestazione "Cookie:".'
    );
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
// Decline non-essential cookies on the user's behalf. Otherwise the consent
// wall is the first thing they have to fight through by hand, and re-navigating
// brings it straight back — which is what produced the "cookie loop".
async function dismissConsent(page) {
  const clicked = await page.evaluate(() => {
    const reject = /accetta solo necessari|solo necessari|rifiuta tutt|reject all/i;
    const b = [...document.querySelectorAll('button,a')]
      .find((e) => reject.test((e.textContent || '').trim()));
    if (b) { b.click(); return true; }
    return false;
  }).catch(() => false);
  if (clicked) await new Promise((r) => setTimeout(r, 900));
  return clicked;
}

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

// Free plan: ~3 concurrent browsers and ~10 minutes a day. Launching a fresh
// one per attempt while leaving the old alive on keep_alive burns the quota in
// a handful of tries, which is exactly what happened. Reuse an idle session.
export async function browserStart(env) {
  let browser = null;
  for (const sess of await puppeteer.sessions(env.BROWSER).catch(() => [])) {
    if (sess.connectionId) continue;                 // in use by another request
    browser = await puppeteer.connect(env.BROWSER, sess.sessionId).catch(() => null);
    if (browser) break;
  }
  if (!browser) {
    try {
      browser = await puppeteer.launch(env.BROWSER, { keep_alive: 180000 });
    } catch (e) {
      if (/429|rate limit/i.test(String(e.message))) {
        const lim = await puppeteer.limits(env.BROWSER).catch(() => null);
        throw new Error(`BROWSER_LIMIT:${lim?.timeUntilNextAllowedBrowserAcquisition ?? 0}`);
      }
      throw e;
    }
  }
  const sessionId = browser.sessionId();
  const page = (await livePage(browser)) || (await browser.newPage());
  await page.setViewport({ width: 400, height: 760, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(SNIFFER).catch(() => {});

  // Land on the sign-in screen, not the homepage — there is nothing to do on
  // the homepage but hunt for the login button. ref_url sends Vinted to the
  // new-listing page afterwards, which is also where we want the session proved.
  //
  // Always navigate here: "Collega" means start the sign-in, and a reused
  // session would otherwise strand the user wherever it was left. The cookie
  // loop this once caused is gone now that consent is declined automatically
  // rather than re-asked on every load.
  await page.goto(`https://${env.VINTED_HOST}${env.LOGIN_PATH}`,
    { waitUntil: 'domcontentloaded', timeout: 45000 });
  await dismissConsent(page);

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
    await dismissConsent(page);   // it can reappear after a navigation

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

// Writes from plain fetch get a Datadome captcha; the same request from inside
// a real browser page does not. This runs one API call in a browser session so
// we can tell the two apart before committing the architecture either way.
export async function apiInBrowser(env, path, init = {}) {
  const cookies = JSON.parse((await env.KV.get(SESSION_KEY)) || 'null');
  if (!cookies) throw new Error('NO_SESSION');
  const browser = await puppeteer.launch(env.BROWSER, { keep_alive: 60000 });
  try {
    const page = await browser.newPage();
    await page.setCookie(...cookies);
    await page.goto(`https://${env.VINTED_HOST}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    return await page.evaluate(async (path, init) => {
      const token = /CSRF_TOKEN[\\"\s:]+([0-9a-f-]{36})/.exec(document.documentElement.innerHTML || '');
      const r = await fetch(path, {
        method: init.method || 'GET',
        credentials: 'include',
        headers: {
          accept: 'application/json, text/plain, */*',
          ...(token ? { 'x-csrf-token': token[1] } : {}),
          ...(init.json ? { 'content-type': 'application/json' } : {}),
        },
        body: init.json ? JSON.stringify(init.json) : undefined,
      });
      const text = await r.text();
      let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
      return { status: r.status, body, csrf: Boolean(token) };
    }, path, init);
  } finally {
    await browser.close();
  }
}

export async function browserStop(env, sessionId) {
  const browser = await puppeteer.connect(env.BROWSER, sessionId).catch(() => null);
  if (browser) await browser.close().catch(() => {});
  return { ok: true };
}

// Diagnostics and recovery: see what is holding the quota, and hand it back.
export async function browserStatus(env) {
  const [sessions, limits] = await Promise.all([
    puppeteer.sessions(env.BROWSER).catch((e) => ({ error: String(e.message).slice(0, 120) })),
    puppeteer.limits(env.BROWSER).catch((e) => ({ error: String(e.message).slice(0, 120) })),
  ]);
  return { sessions, limits };
}

export async function browserReap(env) {
  let closed = 0;
  for (const sess of await puppeteer.sessions(env.BROWSER).catch(() => [])) {
    if (sess.connectionId) continue;
    const b = await puppeteer.connect(env.BROWSER, sess.sessionId).catch(() => null);
    if (b) { await b.close().catch(() => {}); closed++; }
  }
  return { closed };
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

// ---------------------------------------------------------------------------
// The API, over plain fetch, using the cookies the login captured.
//
// The browser is for LOGGING IN. Once we hold a session, Vinted is reachable
// from the Worker directly — the catalog page already proved a Worker IP is not
// blocked — so posting and price updates should cost no browser time either.
// ---------------------------------------------------------------------------

async function cookieHeader(env) {
  const jar = JSON.parse((await env.KV.get(SESSION_KEY)) || 'null');
  if (!jar) throw new Error('NO_SESSION');
  return jar.map((c) => `${c.name}=${c.value}`).join('; ');
}

// Vinted wants a CSRF token on writes. It is NOT a <meta> tag — it lives in the
// Next.js config blob as "CSRF_TOKEN":"<uuid>", about 300KB into a 2MB page.
// Both of those caught me out: the meta selector never matched, and the first
// 200KB I used to read would have missed it anyway. Every write was going out
// with an empty token, which is what Vinted answered 403 to.
const CSRF_RE = /CSRF_TOKEN[\\"\s:]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;

async function csrf(env, cookie) {
  const cached = await env.KV.get('csrf');
  if (cached) return cached;

  const r = await fetch(`https://${env.VINTED_HOST}/`, {
    headers: { cookie, 'user-agent': UA, accept: 'text/html', 'accept-language': 'it-IT,it;q=0.9' },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) return '';

  // Stream and stop at the token: buffering 2MB would blow the CPU budget.
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let tail = '', token = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = tail + value;
      const m = CSRF_RE.exec(chunk);
      if (m) { token = m[1]; break; }
      tail = chunk.slice(-200);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (token) await env.KV.put('csrf', token, { expirationTtl: 3600 });
  return token;
}

// Vinted's access token lasts two hours; the refresh token seven days. Without
// this the app works for one sitting and is dead by the next daily cron.
// /web/api/auth/refresh is the endpoint that returns a fresh Set-Cookie.
async function refreshSession(env) {
  const cookie = await cookieHeader(env);
  const r = await fetch(`https://${env.VINTED_HOST}/web/api/auth/refresh`, {
    method: 'POST',
    headers: {
      cookie, 'user-agent': UA, accept: 'application/json, text/plain, */*',
      referer: `https://${env.VINTED_HOST}/`, 'x-csrf-token': await csrf(env, cookie),
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error('SESSION_EXPIRED');

  const jar = JSON.parse((await env.KV.get(SESSION_KEY)) || '[]');
  const domain = '.' + env.VINTED_HOST.replace(/^www\./, '');
  const setCookies = typeof r.headers.getSetCookie === 'function'
    ? r.headers.getSetCookie()
    : [r.headers.get('set-cookie')].filter(Boolean);
  for (const sc of setCookies) {
    const pair = sc.split(';')[0];
    const i = pair.indexOf('=');
    if (i < 1) continue;
    const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
    const found = jar.find((c) => c.name === name);
    if (found) found.value = value;
    else jar.push({ name, value, domain, path: '/' });
  }
  await env.KV.put(SESSION_KEY, JSON.stringify(jar));
  await env.KV.delete('csrf');   // a new session deserves a fresh token
  return true;
}

// Cheap pre-flight: the JWT carries its own expiry, so a doomed call can be
// avoided rather than spent discovering it is doomed.
function accessExpired(cookie) {
  const jwt = /access_token_web=([^;]+)/.exec(cookie)?.[1];
  if (!jwt) return true;
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return !payload.exp || payload.exp - 60 < Math.floor(Date.now() / 1000);
  } catch { return false; }
}

export async function vapi(env, path, init = {}, retried = false) {
  let cookie = await cookieHeader(env);
  if (!retried && accessExpired(cookie)) {
    await refreshSession(env).catch(() => {});
    cookie = await cookieHeader(env);
  }
  const write = init.method && init.method !== 'GET';
  const r = await fetch(`https://${env.VINTED_HOST}${path}`, {
    method: init.method || 'GET',
    headers: {
      cookie,
      'user-agent': UA,
      accept: 'application/json, text/plain, */*',
      'accept-language': 'it-IT,it;q=0.9',
      referer: `https://${env.VINTED_HOST}/`,
      ...(write ? { 'x-csrf-token': await csrf(env, cookie) } : {}),
      ...(init.json ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
    body: init.json ? JSON.stringify(init.json) : init.body,
    signal: AbortSignal.timeout(30000),
  });
  // A 401 we did not predict: refresh once and try again before giving up.
  if (r.status === 401 && !retried) {
    await refreshSession(env);
    return vapi(env, path, init, true);
  }

  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  if (!r.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    const e = new Error(`vinted ${init.method || 'GET'} ${path} -> ${r.status}: ${detail.slice(0, 220)}`);
    e.status = r.status; e.body = body;
    throw e;
  }
  return body;
}

// Is the API reachable from the Worker at all, with and without a session?
// Answers the question the browser cost hangs on.
export async function reachability(env) {
  const probe = async (path, withCookie) => {
    const t0 = Date.now();
    try {
      const headers = { 'user-agent': UA, accept: 'application/json, text/plain, */*',
        referer: `https://${env.VINTED_HOST}/` };
      if (withCookie) headers.cookie = await cookieHeader(env).catch(() => '');
      const r = await fetch(`https://${env.VINTED_HOST}${path}`, {
        headers, signal: AbortSignal.timeout(20000),
      });
      const body = (await r.text()).slice(0, 120);
      return { path, auth: !!withCookie, status: r.status, ms: Date.now() - t0,
        challenged: /challenge-platform|cf-mitigated|Just a moment/i.test(body) };
    } catch (e) {
      return { path, auth: !!withCookie, error: String(e.message).slice(0, 80), ms: Date.now() - t0 };
    }
  };
  const hasSess = await hasSession(env);
  const paths = ['/api/v2/users/current', '/api/v2/catalog/items?search_text=nike&per_page=3'];
  const out = [];
  for (const p of paths) {
    out.push(await probe(p, false));
    if (hasSess) out.push(await probe(p, true));
  }
  return { session: hasSess, results: out };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

// Comparables without a browser at all.
//
// The catalog page answers a plain fetch with 200 and renders every item's data
// into a title attribute. Browser Rendering is the scarce resource here — the
// Free plan allows ~10 minutes a DAY — so spending two seconds of it per
// analysis was the wrong trade. This costs none.
//
// The page is ~7MB and Free Workers get 10ms of CPU, so we stream it and stop
// as soon as we have enough, instead of buffering and scanning the lot.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const TITLE_RE = /title="([^"]*Brand:[^"]*)"/g;

function parseTitle(t) {
  const txt = t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  // Two prices are shown: the ask, then the ask plus buyer protection. The
  // second would inflate every estimate, so take the first.
  const prices = [...txt.matchAll(/(\d+[.,]\d{2})\s*€/g)].map((m) => parseFloat(m[1].replace(',', '.')));
  if (!prices.length) return null;
  return {
    title: txt.split(/,\s*(?:Brand|Condizioni|Taglia):/)[0].trim(),
    brand: (/,\s*Brand:\s*([^,]+)/.exec(txt) || [])[1]?.trim() || null,
    condition: (/,\s*Condizioni:\s*([^,]+)/.exec(txt) || [])[1]?.trim() || null,
    size: (/,\s*Taglia:\s*([^,]+)/.exec(txt) || [])[1]?.trim() || null,
    price: prices[0],
    sold: false,   // search excludes sold items; all of these are active asks
  };
}

export async function searchComparables(env, query, want = 60) {
  const r = await fetch(
    `https://${env.VINTED_HOST}/catalog?search_text=${encodeURIComponent(query)}`,
    {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'it-IT,it;q=0.9',
      },
      signal: AbortSignal.timeout(25000),
    }
  );
  if (!r.ok) throw new Error(`catalog ${r.status}`);

  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  const out = [];
  const seen = new Set();
  let tail = '';
  try {
    while (out.length < want) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = tail + value;
      TITLE_RE.lastIndex = 0;
      let m;
      while ((m = TITLE_RE.exec(chunk))) {
        const c = parseTitle(m[1]);
        if (c && !seen.has(m[1])) { seen.add(m[1]); out.push(c); }
      }
      // keep a small overlap so a title split across chunks still matches
      tail = chunk.slice(-2000);
    }
  } finally {
    await reader.cancel().catch(() => {});   // stop the download early
  }
  return out;
}

// ponytail: returns null for now. The endpoint it used is gone, and the
// category is only needed at posting time — which is itself unverified. The
// approval card shows the gap rather than guessing a wrong category.
export async function findCategory() {
  return null;
}

// Uploads photos, then creates the listing — all over plain fetch. No browser:
// a Worker can POST multipart straight from KV, which is simpler than pulling
// the images back into a browser page just to upload them again.
export async function createListing(env, item, photos) {
  const uploaded = [];
  for (const [i, buf] of photos.entries()) {
    const fd = new FormData();
    fd.append('photo[type]', 'item');
    fd.append('photo[file]', new Blob([buf], { type: 'image/jpeg' }), `photo${i}.jpg`);
    const res = await vapi(env, '/api/v2/photos', { method: 'POST', body: fd });
    uploaded.push(res.id ?? res.photo?.id);
  }

  const created = await vapi(env, '/api/v2/items', {
    method: 'POST',
    json: {
      item: {
        title: item.title,
        description: item.description,
        catalog_id: item.category_id,
        price: String(item.list_price),
        currency: env.CURRENCY,
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

export async function updatePrice(env, vintedId, price) {
  await vapi(env, `/api/v2/items/${vintedId}`, {
    method: 'PUT',
    json: { item: { price: String(price) } },
  });
}

// Views/favourites/sold status for items we've listed.
// /api/v2/items/{id} is deprecated — /details is the current one.
export async function fetchStats(env, vintedId) {
  const r = await vapi(env, `/api/v2/items/${vintedId}/details`);
  const it = r.item || r;
  return {
    views: it.view_count ?? 0,
    favourites: it.favourite_count ?? 0,
    sold: Boolean(it.is_sold ?? it.is_closed ?? false),
    price: Number(it.price?.amount ?? it.price ?? 0),
  };
}

// Setup helper: confirms the session works and the API shapes above still match.
// The access token lasts two hours; the refresh token seven days. Without a
// refresh the app is dead between one session and the next daily cron, so this
// finds the endpoint that mints a new one.
export async function findRefresh(env) {
  const cookie = await cookieHeader(env);
  const token = /refresh_token_web=([^;]+)/.exec(cookie)?.[1] || '';
  const candidates = [
    ['POST', '/api/v2/token_refresh', null],
    ['POST', '/oauth/token', { grant_type: 'refresh_token', refresh_token: token, client_id: 'web' }],
    ['POST', '/web/api/auth/refresh', null],
    ['POST', '/api/v2/sessions/refresh', null],
    ['POST', '/api/v2/tokens/refresh', null],
    ['POST', '/api/v2/users/refresh_token', null],
  ];
  const out = [];
  for (const [method, path, body] of candidates) {
    try {
      const r = await fetch(`https://${env.VINTED_HOST}${path}`, {
        method,
        headers: {
          cookie, 'user-agent': UA, accept: 'application/json, text/plain, */*',
          referer: `https://${env.VINTED_HOST}/`,
          'x-csrf-token': await csrf(env, cookie),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
      const setCookie = r.headers.get('set-cookie') || '';
      out.push({
        path, status: r.status,
        sets_access_token: /access_token_web=/.test(setCookie),
        body: (await r.text()).slice(0, 120),
      });
    } catch (e) { out.push({ path, error: String(e.message).slice(0, 80) }); }
  }
  return out;
}

export async function probe(env, query, testPhoto) {
  let photoTest = null;
  if (testPhoto) {
    try {
      // Use a real stored photo: a 1x1 pixel is rejected by Vinted on its own
      // merits and tells us nothing about whether the write path works.
      const key = typeof testPhoto === 'string' && testPhoto.length > 4 ? testPhoto : null;
      const buf = key ? await env.KV.get('photo:' + key, 'arrayBuffer') : null;
      if (!buf) throw new Error('nessuna foto reale disponibile per il test');
      const fd = new FormData();
      fd.append('photo[type]', 'item');
      fd.append('photo[file]', new Blob([buf], { type: 'image/jpeg' }), 'probe.jpg');
      const res = await vapi(env, '/api/v2/photos', { method: 'POST', body: fd });
      photoTest = { ok: true, id: res.id ?? res.photo?.id ?? null };
    } catch (e) {
      photoTest = { ok: false, error: String(e.message).slice(0, 220) };
    }
  }
  return (async () => {
    const me = await vapi(env, '/api/v2/users/current').catch((e) => ({ error: String(e.message).slice(0, 120) }));
    const comps = await searchComparables(env, query || 'nike felpa', 10);
    return {
      user: me.user?.login || me.login || me.error || '(sconosciuto)',
      comparables_found: comps.length,
      comparables_sample: comps.slice(0, 3),
      // Posting has never been executed. Until one listing goes up for real,
      // treat createListing/updatePrice as unverified.
      posting_verified: false,
      csrf_found: Boolean(await csrf(env, await cookieHeader(env)).catch(() => '')),
      // Uploading to Vinted's temp photo store creates no listing, so this is a
      // safe way to prove the write path works before publishing anything real.
      photo_upload: photoTest === null ? 'non testato' : photoTest,
    };
  })();
}
