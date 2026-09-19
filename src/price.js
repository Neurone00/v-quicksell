// Pure price maths. Separate file only so it can be tested without bindings.

// Every price ends in 9 cents: 8,59 not 8,55, 8,99 not 9. Integer-cent
// arithmetic, because 8.6 - 0.01 is 8.590000000000001 in floating point.
export const MIN = 2.99;
export const round9 = (n) => Math.max(MIN, (Math.round((n + 0.01) * 10) * 10 - 1) / 100);

export const listPrice = (est, bumpPct) => round9(est * (1 + bumpPct / 100));

// The next price at a scheduled drop, or null once the floor is reached.
export function nextPrice(current, floor, dropPct) {
  let next = round9(current * (1 - dropPct / 100));
  if (next >= current) next = round9(current - 0.1);   // rounding must never stall the decay
  if (next >= current) return null;                    // nothing lower exists: at the minimum
  return Math.round(next * 100) < Math.round(floor * 100) ? null : next;
}

export function daysToFloor(est, floor, bumpPct, dropPct, everyDays) {
  let p = listPrice(est, bumpPct), d = 0;
  for (let i = 0; i < 500; i++) {
    const n = nextPrice(p, floor, dropPct);
    if (n === null) break;
    p = n; d += everyDays;
  }
  return { days: d, final: p };
}
