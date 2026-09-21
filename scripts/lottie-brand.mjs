// Recolour a Lottie animation onto the brand palette, keeping its shading.
//   node scripts/lottie-brand.mjs                 # public/lottie/src/*.json -> public/lottie/<name>.json + <name>-dark.json
//   node scripts/lottie-brand.mjs in.json out.json [--dark]
// Duotone treatment: cool hues become Calypso, warm hues become mint, neutrals
// stay neutral with a cool tint. Lightness is preserved, so the illustration's
// depth survives; only its identity changes.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';

const CALYPSO_H = 184 / 360, MINT_H = 156 / 360;

function rgb2hsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > .5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hsl2rgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1/6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2/3 ? p + (q - p) * (2/3 - t) * 6 : p; };
  return [f(h + 1/3), f(h), f(h - 1/3)];
}

function brand([r, g, b], dark) {
  let [h, s, l] = rgb2hsl(r, g, b);
  if (s < .12) {
    // A dark neutral is a black STROKE (icon sets like useAnimations draw in
    // black): that is the brand line, so it becomes Calypso — #007782 on light,
    // #2FC4CE on dark. Light neutrals (paper, highlights) stay neutral.
    if (l < .35) return dark ? hsl2rgb(CALYPSO_H, .62, .50) : hsl2rgb(CALYPSO_H, 1, .255);
    if (dark) l = 1 - l;
    return hsl2rgb(CALYPSO_H, .06, l);
  }
  const warm = h < 60/360 || h > 330/360;
  const hue = warm ? MINT_H : CALYPSO_H;
  s = Math.min(.9, Math.max(.45, s));
  if (dark) l = .3 + l * .55;          // brand colours lift on dark, as the tokens do
  return hsl2rgb(hue, s, l);
}

const isColorArr = (a) => Array.isArray(a) && (a.length === 3 || a.length === 4) && a.every((n) => typeof n === 'number' && n >= 0 && n <= 1);

function walk(node, dark, key) {
  if (Array.isArray(node)) return node.map((n) => walk(n, dark, key));
  if (node && typeof node === 'object') {
    // fill/stroke colour: {"c":{"a":0,"k":[r,g,b,a]}} or keyframed {"k":[{"s":[..],"e":[..]}]}
    if ((key === 'c' || key === 's' || key === 'e') && isColorArr(node.k ?? node)) { /* handled below */ }
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'k' && isColorArr(v) && (key === 'c')) { const [r, g, b] = brand(v, dark); out[k] = [r, g, b, v[3] ?? 1]; }
      else if ((k === 's' || k === 'e') && isColorArr(v) && key === 'c') { const [r, g, b] = brand(v, dark); out[k] = [r, g, b, v[3] ?? 1]; }
      else if (k === 'sc' && typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) {   // solid layer colour
        const [r, g, b] = brand([1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255), dark);
        out[k] = '#' + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
      }
      else if (k === 'g' && v && v.k && Array.isArray(v.k.k) && v.p) {                 // gradient: flat [pos,r,g,b,...]
        const arr = v.k.k.slice(); const n = v.p;
        for (let i = 0; i < n; i++) { const o = i * 4; const [r, g, b] = brand([arr[o+1], arr[o+2], arr[o+3]], dark); arr[o+1] = r; arr[o+2] = g; arr[o+3] = b; }
        out[k] = { ...v, k: { ...v.k, k: arr } };
      }
      else out[k] = walk(v, dark, k === 'c' || k === 'ks' ? k : (key === 'c' && k === 'k' ? 'c' : k));
    }
    return out;
  }
  return node;
}

// colour props inside keyframes live under c.k[i].s — carry the 'c' context down
function recolor(json, dark) {
  const s = JSON.stringify(json);
  const j = JSON.parse(s);
  const visit = (n, inColor) => {
    if (Array.isArray(n)) return n.map((x) => visit(x, inColor));
    if (n && typeof n === 'object') {
      const o = {};
      for (const [k, v] of Object.entries(n)) {
        if (k === 'c' && v && typeof v === 'object') o[k] = visit(v, true);
        else if (inColor && k === 'k' && isColorArr(v)) { const [r, g, b] = brand(v, dark); o[k] = [r, g, b, v[3] ?? 1]; }
        else if (inColor && (k === 's' || k === 'e') && isColorArr(v)) { const [r, g, b] = brand(v, dark); o[k] = [r, g, b, v[3] ?? 1]; }
        else if (k === 'sc' && typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) {
          const [r, g, b] = brand([1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255), dark);
          o[k] = '#' + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
        }
        else if (k === 'g' && v && v.k && Array.isArray(v.k.k) && v.p) {
          const arr = v.k.k.slice();
          for (let i = 0; i < v.p; i++) { const t = i * 4; const [r, g, b] = brand([arr[t+1], arr[t+2], arr[t+3]], dark); arr[t+1] = r; arr[t+2] = g; arr[t+3] = b; }
          o[k] = { ...v, k: { ...v.k, k: arr } };
        }
        else o[k] = visit(v, inColor && k === 'k');
      }
      return o;
    }
    return n;
  };
  return visit(j, false);
}

const args = process.argv.slice(2);
if (args.length >= 2) {
  const dark = args.includes('--dark');
  writeFileSync(args[1], JSON.stringify(recolor(JSON.parse(readFileSync(args[0], 'utf8')), dark)));
  console.log(`${args[1]} written${dark ? ' (dark)' : ''}`);
} else {
  const src = 'public/lottie/src', out = 'public/lottie';
  if (!existsSync(src)) { console.error(`put the downloaded .json files in ${src}/`); process.exit(1); }
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(src).filter((f) => f.endsWith('.json'))) {
    const json = JSON.parse(readFileSync(join(src, f), 'utf8'));
    const name = basename(f, '.json');
    writeFileSync(join(out, `${name}.json`), JSON.stringify(recolor(json, false)));
    writeFileSync(join(out, `${name}-dark.json`), JSON.stringify(recolor(json, true)));
    console.log(`${name}: light + dark`);
  }
}
