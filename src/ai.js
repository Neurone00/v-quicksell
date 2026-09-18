// Gemini Flash: reads the photos, writes the listing, prices it.
// ponytail: one model for vision + text + pricing. Workers AI vision was the
// alternative but is worse at small care-label text and burns the free neurons.

const MODEL = 'gemini-3.6-flash';

async function gemini(env, parts, schemaHint, attempt = 0) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
          responseSchema: schemaHint,
        },
      }),
    }
  );

  // 503/429 are routine on the free tier. Retrying beats parking a real item
  // in an error state that needs a manual tap to clear.
  // ponytail: short backoff on purpose. This runs inside waitUntil, and a long
  // sleep there gets the whole background task evicted — which strands the item.
  if ((r.status === 503 || r.status === 429) && attempt < 3) {
    await new Promise((f) => setTimeout(f, 1200 * 2 ** attempt));
    return gemini(env, parts, schemaHint, attempt + 1);
  }
  if (!r.ok) throw new Error(`gemini ${r.status}: ${await r.text()}`);

  const j = await r.json();
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('gemini returned no content: ' + JSON.stringify(j).slice(0, 300));
  return JSON.parse(text);
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
    category_query: { type: 'string' },
    search_query: { type: 'string' },
    missing: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'description', 'condition', 'category_query', 'search_query', 'missing'],
};

// Photos in, a full Italian Vinted listing out.
export async function analysePhotos(env, images) {
  const parts = [
    { text: PROMPT_ANALYSE },
    ...images.map((b64) => ({ inlineData: { mimeType: 'image/jpeg', data: b64 } })),
  ];
  return applyBrandRule(await gemini(env, parts, ANALYSIS_SCHEMA));
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
- title: max 60 caratteri. Formato che vende su Vinted: Tipo + Marca + colore/materiale + taglia. Niente emoji, niente MAIUSCOLO, niente "vendo".
- description: 3-6 righe in italiano. Cosa e, materiale, vestibilita, condizioni reali e oneste (dichiara ogni difetto visibile), misure se deducibili. Chiudi con una riga tipo "Spedizione rapida, fumo/animali assenti" solo se plausibile. Niente hashtag.
- brand: SOLO se leggi il nome su un'etichetta, un cartellino o un logo stampato nelle foto. Metti brand_from_label=true solo in quel caso. Se deduci la marca dallo stile senza vederla scritta, scrivila comunque ma brand_from_label=false.
- size: SOLO dall'etichetta taglia. size_from_label=true solo se la leggi. Usa la notazione dell'etichetta (XS/S/M/L, o 38/40/42).
- material: dall'etichetta di composizione se visibile.
- condition: uno tra "Nuovo con cartellino", "Nuovo senza cartellino", "Ottime condizioni", "Buone condizioni", "Discrete condizioni". Sii onesto: i resi e le recensioni negative costano piu di qualche euro.
- category_query: 2-4 parole per trovare la categoria Vinted, es "felpa donna cappuccio".
- search_query: la query con cui cercare su Vinted articoli identici per confrontare i prezzi. Marca + tipo + taglia se noti.
- missing: elenca i campi che NON riesci a determinare con certezza dalle foto (es "size", "brand", "material"). Se manca la foto dell'etichetta, dillo.`;

const PROMPT_PRICE = `Sei un esperto di pricing sul mercato dell'usato italiano (Vinted).

Devi restituire:
- est_price: il prezzo di mercato EQUO in EUR. Questo e il prezzo a cui l'articolo si vende in tempi ragionevoli. Basati sui comparabili, correggendo per marca, condizione e taglia. NON e il prezzo di pubblicazione.
- floor_price: il prezzo MINIMO sotto il quale non ha senso vendere: in genere il 5-15 percentile dei comparabili, mai sotto 3 EUR (minimo Vinted, e sotto i 5 EUR la spedizione ammazza il margine). Per articoli di marca premium il floor resta alto: meglio invenduto che svenduto.
- reasoning: 1-2 frasi in italiano sul perche.

COME PESARE I COMPARABILI:
1. I VENDUTI sono il segnale principale. Basa est_price soprattutto su quelli.
2. Gli ANCORA IN VENDITA sono distorti verso l'alto: quelli prezzati bene sono gia stati venduti, resta invenduto cio che costa troppo. Usali solo come tetto massimo.
3. Il prezzo mostrato su un venduto e l'ultimo prezzo RICHIESTO, non quello incassato: su Vinted l'acquirente puo fare un'offerta privata accettata piu in basso. Scala i venduti del 5-10% per stimare l'incasso reale.
4. Se non ci sono venduti, sii piu prudente e abbassa la stima.`;
