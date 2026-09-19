# Quicksell — brand & design system

Quicksell lives next to Vinted, so it borrows Vinted's ground — the cool grey
page, the darkened Calypso — and then speaks in its own voice: a hanger-hook Q,
a warm serif wordmark, and one continuous line that runs through everything.

## Mark

`brand/mark.svg` — a **Q whose tail is a hanger hook**, one stroke weight.
The letter is the name; the hook is the wardrobe.

- Colour: Calypso on light, `--qs-calypso` (dark variant) on dark, white on the tile.
- Tile (`brand/icon.svg`): Calypso square, 22% radius, mark at 80% for maskable safety.
- Minimum: 16px. Below 24px the hook reads as a tail — that is fine, it is still a Q.
- Clear space: half the ring's diameter on every side. Never rotate, outline, or add a gradient.

## Wordmark

**Quicksell** in Fraunces 600, `font-variation-settings: 'SOFT' 60`, letter-spacing −.01em,
Calypso. Lockup: mark at the cap height, gap of ¼ the mark's width. The word alone is fine in
headers; the mark alone is fine as an icon; together only on the banner and the release page.

## Colour

| token | light | dark | use |
|---|---|---|---|
| `--qs-calypso` | #007782 | #2FC4CE | actions, wordmark, the line, links |
| `--qs-mint` | #32AE88 | #4FD6A8 | online, sold, done |
| `--qs-page` | #EDF2F2 | #0E1212 | ground |
| `--qs-surface` | #FFFFFF | #171D1E | cards |
| `--qs-ink` / `--qs-muted` | #15191A / #5A6566 | #F2F5F5 / #9BA7A8 | text |
| `--qs-warn` | #B4690E | #E8A33D | needs you: confirm a brand, a drop is due |
| `--qs-bad` | #D4351C | #F2796B | errors |

Semantic colours are not the accent. Calypso says "Quicksell"; mint says "good"; amber says
"your turn". Never use Calypso for a warning or amber for a button that isn't one.

## Type

Fraunces for identity (wordmark, empty-state titles) — used with restraint, never for UI.
Inter for everything you operate. Scale: 11 label · 13 secondary · 15 body · 17 card title ·
19 price · 25 wordmark. Prices in `font-variant-numeric: tabular-nums`. Uppercase labels get
`.08em` tracking.

## The line

Vinted's rebrand unravelled its logo into a flowing line. Ours: a 2px vertical rail down the
item list, Calypso fading to mint, with a status dot per card. It is the journey — queued,
approved, online, sold — drawn once. Do not add a second decorative line anywhere.

## Illustration

Continuous-line, one 64-unit grid, stroke 2.1, round caps and joins, `currentColor`. Set:
hanger (empty), bell (notifications), check (done), plus the mark. **Motion:** every path
carries `pathLength="100"`; it draws itself once (1.15s), then loops a gesture that means
something — the bell swings, the hanger sways, the check pulses. `prefers-reduced-motion`
turns all of it off. New illustrations join the set only if they obey all of the above.

## Motion

One easing, `--qs-overshoot`. Cards rise in (.4s). Buttons scale .96 on press. Nothing else
moves unless it carries information. No parallax, no confetti.

## Shape & surface

Radii: 8 inputs · 12 chips and thumbnails · 16 cards · 20 sheets · pill for buttons and badges.
One shadow, soft and low. A card is for a thing you act on; not everything is a card.

## Voice

In-product Italian: second person, short, direct, no exclamation marks, no emoji. Say what
happens ("Approva", "Ribassa a 8,59 €"), not what the system is doing. Warnings explain what
to do, not what went wrong. Docs and release notes in English, same plainness.

Do: "Non ho letto la marca su un'etichetta. Puoi lasciare vuoto il campo."
Don't: "Attenzione! Errore di validazione brand ⚠️"
