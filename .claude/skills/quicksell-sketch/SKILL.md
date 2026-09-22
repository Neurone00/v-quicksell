---
name: quicksell-sketch
description: Restyle, tune or test the worn-look illustration Quicksell appends to each draft (FLUX.2 klein on Workers AI). Use when the user wants the sketches to look different, more faithful, or wants to see examples.
---

# Quicksell worn-look sketch — prompt recipe

One prompt, one file: `src/sketch.js`. Everything else reads from it. The
illustration must always read as a **drawing**, never as a photo of the item
(Vinted's real-photo rule; the description already says "illustrazione
indicativa (AI)").

## The recipe (order matters, keep all six)

```
STYLE : SUBJECT wearing the garment from the reference image (TITLE).
Garment spec: SPEC.
CROP, three-quarter view, relaxed confident pose.
BACKGROUND.
RULES
```

| Block | Lives in | Who writes it | Change it when |
|---|---|---|---|
| STYLE | `src/sketch.js` `STYLE` | you | the user wants a different look (pop anime, watercolour, flat vector…) |
| SUBJECT | `sketchPrompt()` | code, from `gender` | never — uomo/donna come from the analysis |
| SPEC | `sketch_spec` from `analysePhotos` (`src/ai.js` PROMPT_ANALYSE) | Gemini, in English, only what it sees | fidelity problems (wrong sleeves/buttons/pattern) → sharpen the *analysis* rule, not the style |
| CROP | `src/sketch.js` `CROP` + `sketch_crop` from the analysis | Gemini picks the key | a garment type frames badly → adjust the mapping in PROMPT_ANALYSE |
| BACKGROUND | `src/sketch.js` `BACKGROUND` | you | the user wants a different scene; must contrast with the garment |
| RULES | `src/sketch.js` `RULES` | you | never weaken: "exactly the garment", "no invented details", "no photorealism", "no text" |

Rules of thumb that held in testing:
- FLUX.2 klein treats the reference image as *mood*, not spec. Fidelity comes from SPEC in words ("small white plus-sign print on dark navy, short sleeves, brown wooden buttons, no pockets"). Never leave SPEC generic.
- Don't add "no long sleeves"-style negatives — the model ignores negatives; state the positive ("short sleeves").
- Keep the style block first: the model weighs the opening clause most.
- Reference image must be < 512 px on each side (`small512()` does it) and go in as `input_image_0`. Output is base64 JPEG in `out.image`, 768×1024.
- Gemini's image models are **not free** on this key (`limit: 0`) — don't switch back.

## The judge loop (built in, don't bypass)

`sketchWithJudge()` in `src/ai.js`: generate → `judgeSketch()` (Gemini, free)
compares the reference photo with the sketch on garment only (colour,
pattern, sleeves, collar, buttons, pockets, length) → score 0-10 + a
rewritten positive-language spec → regenerate with that spec → up to **3**
tries, best score kept, 8+ stops early. Both the pipeline and the preview
route use it; the route returns `x-sketch-score`, `x-sketch-tries`,
`x-sketch-problems` headers. Tuning fidelity = tuning the judge prompt
(`JUDGE_SCHEMA` text), not adding tries: each try is ~30 s + a Gemini call.

## How to test a change (≈30–100 s per image, free)

The preview route uses the same prompt builder but takes the spec by hand:

```bash
K=$(grep '^APP_SECRET' .dev.vars | cut -d= -f2 | tr -d '"'); S=scratch
# 1. a draft you own (the pipeline will also sketch it in the background — fine, delete after)
ID=$(curl -s -F "photos=@$S/shirt.jpg;type=image/jpeg" "https://v-quicksell.neurone00.workers.dev/api/items?k=$K" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
# 2. one image, hand-written spec, chosen crop
curl -s -D - -o "$S/test.jpg" "https://v-quicksell.neurone00.workers.dev/api/mockup?id=$ID&who=uomo&crop=busto&k=$K&spec=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("dark navy shirt with small white plus-sign print, short sleeves, brown wooden buttons, button-down collar, plain front"))')" | grep -i x-sketch
# 3. look at it, then clean up
npx wrangler d1 execute quicksell --remote --command "DELETE FROM items WHERE id=$ID AND user_id='owner'"
```

Judge every test on, in this order: garment colour → pattern → sleeve length → buttons/closure → crop (does the garment fill the frame?) → style → background. Fix the earliest thing that's wrong. Send the user the image before shipping a style change: they decide on taste.

Ship = `npm run deploy` (no extension release needed; the prompt is server-side). Commit `src/sketch.js` with a one-line message naming the style.
