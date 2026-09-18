// Web push, payload-free.
// ponytail: a push with no body needs only a VAPID JWT — it skips the whole
// aes128gcm payload-encryption dance (~100 lines of crypto). The service worker
// just fetches /api/items when it's woken up. Same result, a tenth of the code.

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function vapidJwt(env, audience) {
  const jwk = JSON.parse(env.VAPID_JWK); // { d, x, y }
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', ...jwk, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned =
    enc({ typ: 'JWT', alg: 'ES256' }) +
    '.' +
    enc({ aud: audience, exp: Math.floor(Date.now() / 1000) + 43200, sub: env.VAPID_SUBJECT || 'mailto:me@example.com' });
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  );
  return unsigned + '.' + b64url(sig);
}

export async function notify(env) {
  const sub = JSON.parse((await env.KV.get('push_sub')) || 'null');
  if (!sub || !env.VAPID_JWK) return false;
  const jwt = await vapidJwt(env, new URL(sub.endpoint).origin);
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: '86400',
      Urgency: 'normal',
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`,
    },
  });
  if (r.status === 404 || r.status === 410) await env.KV.delete('push_sub'); // subscription dead
  return r.ok;
}
