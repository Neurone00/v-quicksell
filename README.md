# V Quicksell

Photograph a garment on your phone. The app writes the Italian listing, prices it
against what's actually on Vinted, and asks you once. On your computer, a Chrome
extension carries the photos into Vinted's own form and fills it in. You click
the dropdowns and **Pubblica**. Every three days it tells you which price to
lower — you lower it.

**The app never touches your Vinted account.** No login, no session, no
automated writes. It reads public pages only. There is nothing for Vinted to
ban, and nothing to expire.

## The flow

| where | what |
|---|---|
| phone | select photos → Share → **Quicksell** (or add them in the app) |
| app | Gemini reads the photos; comparables come from Vinted's public catalog; a fair price and a floor are set |
| phone | approve, or fix brand/size, one tap |
| computer | open vinted.it → Vendi. The extension lists your approved drafts; **Compila** drops the photos into Vinted's uploader and types title, description and price |
| you | pick category, brand, size, condition in Vinted's menus; click Pubblica |
| app | sees the new listing and tracks it: views, favourites, sold |
| every 3 days | a notification: "*Vestito Zara*: scendi a 8,59 €" — **Ribassa tutti** does every due listing in a minimized window, one every 5–15 s, and tells you the count. Or open each one yourself: the price is pre-filled, you press Salva |

Listed at fair value **+50%**, dropped **−5% every 3 days**, never below the floor. Every price ends in **,X9** (8,59 not 8,55; 8,99 not 9).

No computer nearby? Every approved draft has **Copia titolo / descrizione /
prezzo**. Paste into Vinted's app, publish, share the listing back to Quicksell.

## Setup

### 1. Cloudflare (once)

```bash
npm install
npx wrangler d1 create quicksell          # -> database_id into wrangler.jsonc
npx wrangler kv namespace create KV        # -> id into wrangler.jsonc
npm run db:init
npm run vapid                              # prints the VAPID pair
npx wrangler secret put VAPID_JWK          # paste the JSON it printed
npx wrangler secret put GEMINI_API_KEY     # free key: aistudio.google.com/apikey
npx wrangler secret put APP_SECRET         # any long random string — your login
npm run deploy
```

Set `VAPID_PUBLIC` and `PUBLIC_URL` in `wrangler.jsonc`. Open
`https://<worker>.workers.dev/?k=<APP_SECRET>` once per device; it sets a cookie.
On Android: menu → Add to home screen. That also registers the share target.

### 2. Phone

Tap **Attiva** on notifications. That is the entire onboarding.

### 3. Computer — the extension

Chrome (Edge and Brave work too) → `chrome://extensions` → **Developer mode** →
**Load unpacked** → pick the `extension/` folder. Click its icon, enter the app
URL and your `APP_SECRET`, save.

The first time it opens `vinted.it/items/new` it reports Vinted's live form to
the app (`GET /api/learned`). Vinted's form is React-rendered and undocumented,
so if a field is not found the panel says which one; the selector table at the
top of `extension/content.js` is where to fix it.

## Tuning

`wrangler.jsonc` vars: `BUMP_PCT` (50), `DROP_PCT` (5), `DROP_EVERY_DAYS` (3).
At the defaults an item takes **~54 days** from list price to floor.
`node test.mjs` checks any combination.

## When Gemini breaks

Google retires model ids without warning. `GET /api/models?k=...` lists what
your key can use; `&test=1` times the candidates. Set the healthy one as
`GEMINI_MODEL`. The code falls back to a lite model when the primary is overloaded.

## The one automated write

Batch price drops press Salva for you. It runs in your own Chrome with your own
session, so Vinted sees a person editing their own prices — but it *is* the
extension pressing the button, with random 5–15 s gaps so it never looks like a
script. Very low risk, not zero; the user chose it. Publishing a listing is never
automated: that click is always yours.

## Known limits

- **Category, brand, size, condition are yours to click.** They are custom
  pickers in Vinted's form; the extension shows you the AI's suggestion next to
  each. Title, description, price and photos are filled for you.
- **Comparables are active asks, not sales.** Vinted no longer exposes sold
  prices; the pricing prompt treats active listings as an upper bound and weights
  your own past sales highest.
- **Same item twice is against Vinted's rules.** A/B-test titles sequentially on
  one listing (the app tracks view velocity), never with a duplicate.
- Free Workers: 10ms CPU per request. Both scrapes stream and stop early to fit.
