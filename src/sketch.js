// The one place the worn-look illustration prompt is written. Recipe (see
// .claude/skills/quicksell-sketch/SKILL.md): STYLE + SUBJECT + SPEC + CROP +
// BACKGROUND + RULES. Change STYLE to restyle every sketch; never bake garment
// details in here — they come from the analysis (`sketch_spec`).

export const STYLE =
  'Bold pop anime illustration: clean confident line art, flat cel shading with two-tone shadows, ' +
  'vivid saturated colours, glossy highlights, slight halftone texture, expressive but realistic adult face, ' +
  'modern streetwear-magazine anime look';

export const CROP = {
  busto: 'framed from the head to the hips, the garment fills the frame',
  gambe: 'framed from the waist to the shoes, the garment fills the frame',
  'figura-intera': 'full-length standing figure',
  dettaglio: 'close crop on the item itself, the wearer mostly out of frame',
};

export const BACKGROUND =
  'Background: a bright stylised city street at golden hour, soft-focus buildings and a pastel sky with a few ' +
  'graphic clouds, a subtle radial pop burst behind the figure, colours chosen to contrast with the garment';

export const RULES =
  'Wear EXACTLY the garment from the reference image; follow the spec precisely (colour, pattern, sleeve length, ' +
  'buttons, collar, pockets). No invented logos, text, pockets or extra details. No photorealism. No text in the image.';

export function sketchPrompt({ who, title, spec, crop }) {
  const person = who === 'donna' ? 'a young adult woman' : 'a young adult man';
  return [
    `${STYLE}: ${person} wearing the garment from the reference image (${title || 'garment'}).`,
    `Garment spec: ${spec || 'same colour, pattern, sleeve length, buttons and details as the reference'}.`,
    `${CROP[crop] || CROP.busto}, three-quarter view, relaxed confident pose.`,
    BACKGROUND + '.',
    RULES,
  ].join(' ');
}
