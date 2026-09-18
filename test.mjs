// Run: node test.mjs   — fails loudly if the money logic breaks.
import assert from 'node:assert';
import { round50, listPrice, nextPrice, daysToFloor } from './src/price.js';
import { applyBrandRule } from './src/ai.js';

// --- pricing -------------------------------------------------------------
assert.equal(round50(12.34), 12.5);
assert.equal(round50(0.4), 3, 'never below Vinted minimum');
assert.equal(listPrice(20, 50), 30, '+50% bump');

// Decay stops at the floor, never below it.
let p = listPrice(20, 50); // 30
const seen = [];
for (;;) { const n = nextPrice(p, 12, 5); if (n === null) break; p = n; seen.push(n); }
assert.ok(p >= 12, `stopped at ${p}, floor 12`);
assert.ok(seen.every((v, i) => i === 0 || v < seen[i - 1]), 'strictly decreasing');

// A floor above the list price must not trigger a single drop.
assert.equal(nextPrice(10, 20, 5), null, 'no drop when already under floor');
// Rounding must never stall the decay into an infinite loop.
assert.equal(nextPrice(3, 3, 5), null, 'at Vinted minimum, stop');

const { days, final } = daysToFloor(20, 12, 50, 5, 3);
assert.ok(days > 0 && final >= 12);

// --- the brand rule: an unbacked brand claim must never auto-post ---------
let a = applyBrandRule({ brand: 'Nike', brand_from_label: false, size: 'M', size_from_label: true, missing: [] });
assert.equal(a.brand_source, 'inferred');
assert.ok(a.missing.includes('brand'), 'inferred brand must ask for confirmation');

a = applyBrandRule({ brand: 'Nike', brand_from_label: true, size: 'M', size_from_label: true, missing: [] });
assert.equal(a.brand_source, 'label');
assert.ok(!a.missing.includes('brand'), 'label-backed brand needs no confirmation');

a = applyBrandRule({ brand: null, size: null, missing: [] });
assert.ok(a.missing.includes('size'), 'missing size always asked');

// A field must never be queued twice.
a = applyBrandRule({ brand: 'Nike', brand_from_label: false, size: null, missing: ['brand', 'size'] });
assert.equal(a.missing.filter((m) => m === 'brand').length, 1);
assert.equal(a.missing.filter((m) => m === 'size').length, 1);

console.log(`ok — ${days}gg dal prezzo di lancio al minimo (${final}€)`);
