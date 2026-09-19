// Everything that touches Vinted. All of it is anonymous reads of public pages:
// no session, no writes, nothing for Vinted to ban. Writes are the human's.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const HEADERS = { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'it-IT,it;q=0.9' };

// ---------------------------------------------------------------------------
// Comparables. The catalog page renders each item's data into a title
// attribute: "Felpa nike, Brand: Nike, Condizioni: Ottime, Taglia: M, 38.00 €, 40.60 €".
// ~7MB and Free Workers get 10ms CPU, so stream and stop early.
// ---------------------------------------------------------------------------
const TITLE_RE = /title="([^"]*Brand:[^"]*)"/g;

function parseTitle(t) {
  const txt = t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  // Two prices: the ask, then ask plus buyer protection. Take the ask.
  const prices = [...txt.matchAll(/(\d+[.,]\d{2})\s*€/g)].map((m) => parseFloat(m[1].replace(',', '.')));
  if (!prices.length) return null;
  return {
    title: txt.split(/,\s*(?:Brand|Condizioni|Taglia):/)[0].trim(),
    brand: (/,\s*Brand:\s*([^,]+)/.exec(txt) || [])[1]?.trim() || null,
    condition: (/,\s*Condizioni:\s*([^,]+)/.exec(txt) || [])[1]?.trim() || null,
    size: (/,\s*Taglia:\s*([^,]+)/.exec(txt) || [])[1]?.trim() || null,
    price: prices[0],
    sold: false, // search excludes sold items; these are all active asks
  };
}

async function streamFind(url, re, onMatch, want) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`vinted ${r.status}`);
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let tail = '', found = 0;
  try {
    while (found < want) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = tail + value;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(chunk)) && found < want) if (onMatch(m)) found++;
      tail = chunk.slice(-2000);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return found;
}

export async function searchComparables(env, query, want = 60) {
  const out = [], seen = new Set();
  await streamFind(
    `https://${env.VINTED_HOST}/catalog?search_text=${encodeURIComponent(query)}`,
    TITLE_RE,
    (m) => { if (seen.has(m[1])) return false; seen.add(m[1]); const c = parseTitle(m[1]); if (c) out.push(c); return !!c; },
    want
  );
  return out;
}

// ---------------------------------------------------------------------------
// Tracking a listing the human published: its public page carries favourites,
// views, price and a Venduto badge. No login involved.
// ---------------------------------------------------------------------------
export async function trackItem(env, vintedUrl) {
  const r = await fetch(vintedUrl, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (r.status === 404 || r.status === 410) return { gone: true };
  if (!r.ok) throw new Error(`vinted ${r.status}`);
  const html = await r.text();
  const num = (re) => { const m = re.exec(html); return m ? Number(m[1]) : null; };
  return {
    gone: false,
    favourites: num(/favourite_count\\?"?\s*:\s*\\?"?(\d+)/) ?? num(/(\d+)\s*preferit/i),
    views: num(/view_count\\?"?\s*:\s*\\?"?(\d+)/) ?? num(/(\d+)\s*visualizzazion/i),
    sold: />Venduto</.test(html) || /is_closed\\?"?\s*:\s*\\?"?true/.test(html),
    price: (() => { const m = /"price"\\?\s*:\s*\\?"?\{?\\?"?amount\\?"?\s*:\s*\\?"?([\d.]+)/.exec(html); return m ? parseFloat(m[1]) : null; })(),
  };
}

export const vintedIdFromUrl = (u) => (/\/items\/(\d+)/.exec(u || '') || [])[1] || null;
