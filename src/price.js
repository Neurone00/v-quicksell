// Pure price maths. Separate file only so it can be tested without a browser binding.
export const round50 = (n) => Math.max(3, Math.round(n * 2) / 2);

export const listPrice = (est, bumpPct) => round50(est * (1 + bumpPct / 100));

// The next price at a scheduled drop, or null when we've reached the floor.
export function nextPrice(current, floor, dropPct) {
  const next = round50(current * (1 - dropPct / 100));
  return next < floor + 0.01 || next >= current ? null : next;
}

// How long from listing to floor, for the UI and for sanity-checking the plan.
export function daysToFloor(est, floor, bumpPct, dropPct, everyDays) {
  let p = listPrice(est, bumpPct), d = 0;
  for (let i = 0; i < 500; i++) {
    const n = nextPrice(p, floor, dropPct);
    if (n === null) break;
    p = n; d += everyDays;
  }
  return { days: d, final: p };
}
