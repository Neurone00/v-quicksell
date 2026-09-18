// Generates the VAPID keypair for web push. Run once: npm run vapid
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
const b64 = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

console.log('\n--- Metti questo in public/app.js (VAPID_PUBLIC) e nelle vars ---');
console.log('VAPID_PUBLIC =', b64(pubRaw));
console.log('\n--- Salvalo come secret: npx wrangler secret put VAPID_JWK ---');
console.log(JSON.stringify({ d: priv.d, x: priv.x, y: priv.y }));
console.log();
