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
npx wrangler r2 bucket create quicksell-photos
npm run db:init
```

### 2. Secrets

```bash
npm run vapid                              # prints both VAPID values
npx wrangler secret put VAPID_JWK          # paste the JSON it printed
npx wrangler secret put GEMINI_API_KEY     # free key from aistudio.google.com
npx wrangler secret put APP_SECRET         # any long random string — this is your login
```

Then in `wrangler.jsonc` set `VAPID_PUBLIC` and `PUBLIC_URL` (your workers.dev URL).

### 3. Deploy

```bash
npm run deploy
```

Open `https://<your-worker>.workers.dev/?k=<APP_SECRET>` once — it sets a cookie
and you won't need the key again on that device. On Android: menu → Add to home screen.

### 4. Connect Vinted

In the app, tap **Configura → Collega Vinted**. It asks for your cookies:
open vinted.it logged in, console, type `document.cookie`, copy, paste.

**Your password never touches this app.** The session expires every few weeks —
the app will tell you when to re-paste.

### 5. Verify the Vinted API shapes — do this before your first real listing

```bash
curl "https://<your-worker>.workers.dev/api/probe?k=<APP_SECRET>"
```

This confirms the session works and reports which sold-flag Vinted currently
exposes. **Vinted has no public API and renames internal fields without notice** —
if `search_ok` is false or `sold_flag_present` is empty, the field names in
`src/vinted.js` need updating against `sample_keys`. That file is the only one
that ever needs to change.

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

## Known limits

- **Free plan gives ~10 browser-minutes/day.** Each analysis and each daily price
  round opens a browser. Fine for <20 items; upgrade to Workers Paid if you scale.
- **Cloudflare IPs are datacenter IPs.** Vinted may throw a captcha or invalidate
  the session more often than it would from your home connection. If it becomes
  constant, `src/vinted.js` is the only file that moves to a local runner.
- **Automating Vinted is against their ToS.** Worst case is account suspension.
- Sold *transaction* prices aren't public — Vinted shows the last asking price
  even when an item sold via an accepted private offer. The pricing prompt
  discounts sold comparables 5–10% for this, and weights your own sale history
  highest, since that's the only true settled price it has.
