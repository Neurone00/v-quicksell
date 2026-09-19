// Run: node test.mjs   — fails loudly if the money logic breaks.
import assert from 'node:assert';
import { round9, listPrice, nextPrice, daysToFloor, MIN } from './src/price.js';
import { applyBrandRule } from './src/ai.js';

// --- every price ends in 9 cents -------------------------------------------
assert.equal(round9(8.55), 8.59);
assert.equal(round9(9), 8.99);
assert.equal(round9(4), 3.99);
assert.equal(round9(12.34), 12.39);
assert.equal(round9(0.4), MIN, 'never below the minimum');
assert.equal(listPrice(20, 50), 29.99, '+50% bump, then ,99');
for (const v of [round9(8.55), round9(9), listPrice(6, 50), round9(5.001)])
  assert.equal(Math.round(v * 100) % 10, 9, `${v} must end in 9`);

// --- decay: strictly decreasing, never below floor, never stalls -------------
let p = listPrice(20, 50);
const seen = [];
for (;;) { const n = nextPrice(p, round9(12), 5); if (n === null) break; p = n; seen.push(n); }
assert.ok(p >= 11.99, `stopped at ${p}, floor 11.99`);
assert.ok(seen.every((v, i) => i === 0 || v < seen[i - 1]), 'strictly decreasing');
assert.ok(seen.every((v) => Math.round(v * 100) % 10 === 9), 'every step ends in 9');
assert.equal(nextPrice(10, 20, 5), null, 'no drop when already under floor');
assert.equal(nextPrice(MIN, MIN, 5), null, 'at the minimum, stop');
assert.equal(nextPrice(3.09, 2.99, 1), 2.99, 'a tiny percentage still steps down one notch');

const { days, final } = daysToFloor(20, 12, 50, 5, 3);
assert.ok(days > 0 && final >= 11.99);

// --- brand rule: an unbacked brand claim never auto-approves -----------------
let a = applyBrandRule({ brand: 'Nike', brand_from_label: false, size: 'M', size_from_label: true, missing: [] });
assert.equal(a.brand_source, 'inferred'); assert.ok(a.missing.includes('brand'));
a = applyBrandRule({ brand: 'Nike', brand_from_label: true, size: 'M', size_from_label: true, missing: [] });
assert.equal(a.brand_source, 'label'); assert.ok(!a.missing.includes('brand'));
a = applyBrandRule({ brand: null, size: null, missing: [] });
assert.ok(a.missing.includes('size'));
a = applyBrandRule({ brand: 'Nike', brand_from_label: false, size: null, missing: ['brand', 'size'] });
assert.equal(a.missing.filter((m) => m === 'brand').length, 1);

console.log(`ok — ${days}gg dal prezzo di lancio al minimo (${final}€)`);
