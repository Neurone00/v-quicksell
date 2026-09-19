# V Quicksell

Drop photos in. It writes the Italian listing, prices it against Vinted comparables,
asks you once, posts it, then drops the price 5% every 3 days until its floor.

Runs on Cloudflare Workers. Web + installable PWA + sideloadable Android APK.

## What it actually does

1. You upload photos of one item. **This is the only required action.**
2. Background: Gemini reads brand, size, material, condition and writes an Italian
   title + description; a real browser session searches Vinted for comparable
   listings; Gemini prices it into a fair value and a hard floor.
3. Push notification → you approve (or fix the brand/size) in one tap.
4. Posted at fair value **+50%**.
5. Daily cron: −5% every 3 days, never below the floor. Marks items sold automatically.

## Setup

### 1. Cloudflare resources

```bash
npm install
npx wrangler d1 create quicksell          # -> copy database_id into wrangler.jsonc
npx wrangler kv namespace create KV        # -> copy id into wrangler.jsonc
npm run db:init
```

### 2. Secrets

```bash
npm run vapid                              # prints both VAPID values
npx wrangler secret put VAPID_JWK          # paste the JSON it printed
npx wrangler secret put APP_SECRET         # any long random string — this is your login
```

Then in `wrangler.jsonc` set `VAPID_PUBLIC` and `PUBLIC_URL` (your workers.dev URL).

### 3. Deploy

```bash
npm run deploy
```

Open `https://<your-worker>.workers.dev/?k=<APP_SECRET>` once — it sets a cookie
and you won't need the key again on that device. On Android: menu → Add to home screen.

### 4. Connect Vinted — once, ever

The session refreshes itself: Vinted's access token lasts 2 hours and its
refresh token 7 days, but every refresh issues a new 7-day one. The daily cron
(and every app open) touches it, so **you connect once and never again**.

Three ways to connect, pick one:

- **In the app** (phone only): Collega → Vinted opens inside the app → sign in
  with **e-mail and password**. Google/Apple/Facebook are blocked there — Google
  refuses automated browsers. If your account was created with Google, set a
  password once via "Password dimenticata" on vinted.it.
- **As a secret** (never touches a chat): on a computer signed into vinted.it,
  F12 → Network → reload → click the first `vinted.it` row → Request Headers →
  copy the whole `Cookie:` value. Then:
  ```bash
  npx wrangler secret put VINTED_COOKIE
  ```
  Paste at the hidden prompt. The app seeds its session from it on first use.
  (`document.cookie` in the Console does NOT work — the session cookies are
  HttpOnly and invisible to JavaScript.)
- **Paste in the app**: same Network-tab string, via the link under Collega.

### 5. Notifications

One tap in the onboarding. That's the whole setup.

### Plan B — publish from the Vinted app yourself

Every approved listing has **Copia titolo / descrizione / prezzo** buttons. And
Quicksell registers as an Android **share target**: select photos in your
gallery → Share → Quicksell, and the draft is ready when you open the app.
Paste into Vinted's own app and publish. No session, no bot detection, nothing
to break — you lose only the automatic price decay, which needs the API.

### 6. Android APK (optional — the PWA already works)

```bash
./scripts/build-apk.sh https://<your-worker>.workers.dev
```

Then paste the signing fingerprint into `public/.well-known/assetlinks.json`,
bump `APK_VERSION`, redeploy. The APK is a thin shell: **web content auto-updates
on every deploy**, and the app shows a download banner when the shell itself
is outdated.

## Tuning

All in `wrangler.jsonc` `vars`:

| var | default | effect |
|---|---|---|
| `BUMP_PCT` | 50 | how far above fair value it lists |
| `DROP_PCT` | 5 | size of each cut |
| `DROP_EVERY_DAYS` | 3 | how often |

At the defaults an item takes **~54 days** to walk from list price to floor,
~25 of them just getting back to fair value. `BUMP_PCT: 25` makes that ~10 days.
Check any combination with `node test.mjs`.

## Tests

```bash
node test.mjs
```

Covers the price decay (never below floor, never stalls, never inverts) and the
brand rule (an AI-inferred brand can never auto-post without your confirmation).

## When Gemini breaks

Google retires model ids without warning, and aliases can point at overloaded
models. `GET /api/models?k=...` lists what your key can use; add `&test=1` to
time the candidates. Set the healthy one as `GEMINI_MODEL` in `wrangler.jsonc`.
The code already falls back to a lite model when the primary is overloaded.

## Known limits

- **Free plan gives ~10 browser-minutes/day.** Each analysis and each daily price
  round opens a browser. Fine for <20 items; upgrade to Workers Paid if you scale.
- **Datadome challenges writes from plain fetch.** Reads (comparables, stats)
  pass from Cloudflare's IPs; creating or repricing a listing gets a captcha
  interstitial. Writes therefore fall back to a real browser page, which
  Datadome accepts — at ~15-20s of Browser Rendering per write. On the Free
  plan (~10 min/day) that is roughly 30 writes a day. Workers Paid removes the
  ceiling. If a write is still blocked, the app says so and points at Plan B.
- **Automating Vinted is against their ToS.** Worst case is account suspension.
- Sold *transaction* prices aren't public — Vinted shows the last asking price
  even when an item sold via an accepted private offer. The pricing prompt
  discounts sold comparables 5–10% for this, and weights your own sale history
  highest, since that's the only true settled price it has.
