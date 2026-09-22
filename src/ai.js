// Gemini Flash: reads the photos, writes the listing, prices it.
// ponytail: one model for vision + text + pricing. Workers AI vision was the
// alternative but is worse at small care-label text and burns the free neurons.

// Measured, not guessed: gemini-flash-latest and 3.8-flash were returning 503
// or hanging; 3.5-flash answers in ~1.5s. The lite model is the fallback for
// when the primary is overloaded — which is a thing that actually happens.
const MODELS = (env) => [env.GEMINI_MODEL || 'gemini-3.5-flash', 'gemini-flash-lite-latest'];
const OVERLOADED = (s) => s === 503 || s === 429 || s === 500;

async function callModel(env, model, parts, schemaHint) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
          responseSchema: schemaHint,
        },
      }),
      // Without this, one stalled call hung the whole analysis indefinitely.
      signal: AbortSignal.timeout(45000),
    }
  );
  if (!r.ok) {
    const e = new Error(`gemini ${model} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    e.status = r.status;
    throw e;
  }
  const j = await r.json();
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('gemini returned no content: ' + JSON.stringify(j).slice(0, 200));
  return JSON.parse(text);
}

async function gemini(env, parts, schemaHint) {
  let last;
  for (const model of MODELS(env)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await callModel(env, model, parts, schemaHint);
      } catch (e) {
        last = e;
        // A hard error (bad key, bad request) will not fix itself — fail fast.
        if (e.status && !OVERLOADED(e.status)) throw e;
        if (attempt < 2) await new Promise((f) => setTimeout(f, 800 * 2 ** attempt));
      }
    }
  }
  throw last;
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    brand: { type: 'string' },
    brand_from_label: { type: 'boolean' },
    size: { type: 'string' },
    size_from_label: { type: 'boolean' },
    material: { type: 'string' },
    color: { type: 'string' },
    condition: { type: 'string' },
    cover_index: { type: 'integer' },
    category_query: { type: 'string' },
    search_query: { type: 'string' },
    missing: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'description', 'condition', 'category_query', 'search_query', 'missing'],
};

// Vinted's real option titles (short — the long text on the form is a description).
const CONDITIONS = ['Nuovo con cartellino', 'Nuovo senza cartellino', 'Ottime', 'Buone', 'Discrete'];

// Force the AI to answer only with values Vinted's own menus accept, so the
// extension fills each dropdown with an exact match and nothing is left to you.
// color/material lists are harvested from the live Vinted form (env-provided);
// condition is fixed. size stays free — its options depend on the category.
function schemaWith(enums) {
  const s = JSON.parse(JSON.stringify(ANALYSIS_SCHEMA));
  s.properties.condition.enum = CONDITIONS;
  if (enums?.color?.length) s.properties.color.enum = enums.color;
  if (enums?.material?.length) s.properties.material.enum = enums.material;
  return s;
}

// Self-heal for the form filler. When the extension's deterministic filler
// can't set a field, it sends a compact accessibility snapshot of the open
// flyout (index, role, name, state) and the target value; the model answers
// with the one minimal action. Runs only on failure, so a Vinted redesign
// costs a model call instead of a code release.
const HEAL_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['click', 'type_then_click', 'none'] },
    index: { type: 'integer' },
    text: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['action', 'confidence'],
};
export async function healChoice(env, field, want, snapshot) {
  const rows = snapshot.map((s) => `[${s.i}] ${s.role || s.tag} "${s.name}"${s.checked ? ` (checked=${s.checked})` : ''}${s.isInput ? ' (casella di testo)' : ''}`).join('\n');
  const text = `Stai compilando il modulo "Vendi" di Vinted. Campo: ${field}. Valore da impostare: "${want}".
Controlli visibili nel menu aperto, uno per riga come [indice] ruolo "nome" (stato):
${rows}

Rispondi con l'azione MINIMA:
- "click" con index = l'opzione che corrisponde al valore (stesso significato, anche se scritto diversamente: maiuscole, "Ottime" per "Ottime condizioni", "Bianco" per "bianco panna").
- "type_then_click" se il valore non e' tra le opzioni ma c'e' una casella di ricerca: index = la casella, text = cosa scrivere; l'opzione verra' cliccata dopo.
- "none" se nessun controllo corrisponde. Mai scegliere link del pie' di pagina, cookie, o pulsanti Salva/Carica.
confidence tra 0 e 1.`;
  return gemini(env, [{ text }], HEAL_SCHEMA);
}

// On-model mockup: the item photo in, the same garment worn by a model out.
// Workers AI FLUX.2 [klein] (free daily allowance) with the photo as the
// reference image. Gemini's image models have a zero free-tier quota, so they
// are not an option here. `jpeg` must be under 512x512. Returns base64 PNG.
export async function mockupImage(env, jpeg, who, title) {
  const person = who === 'donna' ? 'a woman model' : 'a man model';
  const form = new FormData();
  form.append('input_image_0', new Blob([jpeg], { type: 'image/jpeg' }));
  form.append('prompt', `E-commerce catalog photo of ${person}, adult, average build, wearing exactly the garment from the reference image (${title || 'garment'}): identical colour, pattern, buttons and proportions, no invented logos or text. Three-quarter shot, standing, relaxed natural pose, plain light neutral studio background, soft studio light, photorealistic.`);
  form.append('width', '768');
  form.append('height', '1024');
  const body = new Response(form);
  const out = await env.AI.run('@cf/black-forest-labs/flux-2-klein-4b', {
    multipart: { body: body.body, contentType: body.headers.get('content-type') },
  });
  if (!out?.image) throw new Error('flux: no image ' + JSON.stringify(out).slice(0, 200));
  return { mimeType: 'image/jpeg', data: out.image };   // measured: the model hands back JPEG
}

// Photos in, a full Italian Vinted listing out. `enums` = Vinted's real option
// lists (from KV), when the extension has harvested them yet.
export async function analysePhotos(env, images, enums) {
  const parts = [
    { text: PROMPT_ANALYSE },
    ...images.map((b64) => ({ inlineData: { mimeType: 'image/jpeg', data: b64 } })),
  ];
  return applyBrandRule(await gemini(env, parts, schemaWith(enums)));
}

// The user's rule, kept pure so it can be tested: a brand claim must be backed
// by a label photo, or it is downgraded to "needs your confirmation". An
// unbacked brand claim is what gets listings pulled for counterfeit.
export function applyBrandRule(a) {
  a.missing = a.missing || [];
  const need = (f) => { if (!a.missing.includes(f)) a.missing.push(f); };

  if (a.brand) {
    a.brand_source = a.brand_from_label ? 'label' : 'inferred';
    if (!a.brand_from_label) need('brand');
  } else {
    a.brand_source = null;
  }

  a.size_source = a.size ? (a.size_from_label ? 'label' : 'inferred') : null;
  if (!a.size || !a.size_from_label) need('size');
  return a;
}

const PRICE_SCHEMA = {
  type: 'object',
  properties: {
    est_price: { type: 'number' },
    floor_price: { type: 'number' },
    reasoning: { type: 'string' },
  },
  required: ['est_price', 'floor_price', 'reasoning'],
};

// Comparable live listings in, fair price + hard floor out.
export async function priceFromComparables(env, item, comparables) {
  // Sold comparables are the signal; active ones are survivorship-biased upward.
  const fmt = (c) =>
    `- ${c.title} | ${c.brand || '?'} | ${c.size || '?'} | ${c.condition || '?'} | ${c.price} ${env.CURRENCY}`;
  const sold = comparables.filter((c) => c.sold);
  const active = comparables.filter((c) => !c.sold);
  const rows =
    `VENDUTI (${sold.length}):\n${sold.slice(0, 30).map(fmt).join('\n') || '(nessuno)'}\n\n` +
    `ANCORA IN VENDITA (${active.length}):\n${active.slice(0, 25).map(fmt).join('\n') || '(nessuno)'}`;

  const parts = [
    {
      text: `${PROMPT_PRICE}

ARTICOLO DA VALUTARE:
Titolo: ${item.title}
Marca: ${item.brand || 'sconosciuta'}
Taglia: ${item.size || '?'}
Materiale: ${item.material || '?'}
Condizione: ${item.condition}

COMPARABILI SU VINTED:
${rows}`,
    },
  ];
  return gemini(env, parts, PRICE_SCHEMA);
}

const PROMPT_ANALYSE = `Sei un venditore esperto su Vinted Italia. Analizza le foto di UN SOLO capo/oggetto e produci un annuncio in ITALIANO che massimizzi le vendite.

REGOLE:
- title: max 60 caratteri. Formato che vende su Vinted: Tipo + Marca + colore/materiale + taglia. Maiuscole SOLO: la prima lettera, i nomi di marca scritti come si scrivono (Tom Tailor, Zara, H&M) e la taglia (S, M, L, 42). Tutto il resto minuscolo. Esempio: "Camicia Tom Tailor denim blu fantasia S". Niente emoji, niente TUTTO MAIUSCOLO, niente "vendo".
- description: 3-6 righe in italiano. Cosa e, materiale, vestibilita, condizioni reali e oneste (dichiara ogni difetto visibile), misure se deducibili. Chiudi con una riga tipo "Spedizione rapida, fumo/animali assenti" solo se plausibile. Niente hashtag.
- brand: SOLO se leggi il nome su un'etichetta, un cartellino o un logo stampato nelle foto. Metti brand_from_label=true solo in quel caso. Se deduci la marca dallo stile senza vederla scritta, scrivila comunque ma brand_from_label=false.
- size: SOLO dall'etichetta taglia. size_from_label=true solo se la leggi. Usa la notazione dell'etichetta (XS/S/M/L, o 38/40/42).
- material: dall'etichetta di composizione se visibile.
- condition: ESATTAMENTE uno tra "Nuovo con cartellino", "Nuovo senza cartellino", "Ottime", "Buone", "Discrete" (sono le etichette esatte di Vinted). Sii onesto: i resi e le recensioni negative costano piu di qualche euro.
- cover_index: l'indice (0-based) della foto MIGLIORE da usare come copertina, tra quelle fornite nell'ordine ricevuto. La copertina ideale mostra il capo intero, a fuoco, ben illuminato, su sfondo pulito, dritto. Se la prima e' gia' la migliore, rispondi 0.
- category_query: 2-4 parole per trovare la categoria Vinted, es "felpa donna cappuccio".
- search_query: la query con cui cercare su Vinted articoli identici per confrontare i prezzi. Marca + tipo + taglia se noti.
- missing: elenca i campi che NON riesci a determinare con certezza dalle foto (es "size", "brand", "material"). Se manca la foto dell'etichetta, dillo.`;

const PROMPT_PRICE = `Sei un esperto di pricing sul mercato dell'usato italiano (Vinted).

Devi restituire:
- est_price: il prezzo di mercato in EUR, posizionato nella FASCIA ALTA dei comparabili: punta al 75 percentile circa dei venduti, NON alla mediana. L'articolo va valutato al massimo che il mercato sostiene realisticamente, correggendo per marca, condizione e taglia. In caso di dubbio tra due valori, scegli il piu alto. NON e il prezzo di pubblicazione.
- floor_price: il prezzo MINIMO sotto il quale non ha senso vendere: in genere il 25-35 percentile dei comparabili (non svendere), mai sotto 3 EUR (minimo Vinted, e sotto i 5 EUR la spedizione ammazza il margine). Per articoli di marca premium il floor resta alto: meglio invenduto che svenduto.
- reasoning: 1-2 frasi in italiano sul perche.

COME PESARE I COMPARABILI:
1. I VENDUTI sono il segnale principale. Basa est_price soprattutto su quelli.
2. Gli ANCORA IN VENDITA sono distorti verso l'alto: quelli prezzati bene sono gia stati venduti, resta invenduto cio che costa troppo. Usali solo come tetto massimo.
3. Il prezzo mostrato su un venduto e l'ultimo prezzo RICHIESTO, non quello incassato: su Vinted l'acquirente puo fare un'offerta privata accettata piu in basso. Scala i venduti solo del 3-5% per stimare l'incasso reale: non esagerare lo sconto.
4. Se non ci sono venduti, usa gli in-vendita come riferimento e posizionati nella loro fascia medio-alta, senza abbassare per prudenza.`;
