import type { Paise } from './canonical.ts';

/**
 * Rendering money. Paise are the storage form (`canonical.ts`); rupees are a
 * display-edge concern, and this is that edge — the one place integer paise
 * become a human string, so no component ever divides by 100 on its own and
 * re-introduces the float error the integer model exists to avoid.
 */

/** Groups whole rupees the Indian way (1,23,481). Fractions are handled
 *  separately below, so this formatter deliberately emits none. */
const WHOLE_RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/**
 * 12348100 → "1,23,481.00" (Indian digit grouping, no currency symbol — the
 * column header carries the unit, so repeating ₹ on every row is noise).
 *
 * Split into whole rupees and remainder with integer arithmetic rather than
 * dividing: formatting `paise / 100` would round a float, and this is the exact
 * number a user checks against their statement.
 */
export function formatPaise(paise: Paise): string {
  const abs = Math.abs(paise);
  const whole = WHOLE_RUPEES.format(Math.trunc(abs / 100));
  const fraction = String(abs % 100).padStart(2, '0');
  // U+2212 minus, not a hyphen: it aligns with digit width in tabular figures.
  return `${paise < 0 ? '−' : ''}${whole}.${fraction}`;
}

/** Same, with an explicit sign — for deltas, where the reader needs the
 *  direction at a glance and an unsigned "0.00" would read as "no problem". */
export function formatSignedPaise(paise: Paise): string {
  return paise < 0 ? formatPaise(paise) : `+${formatPaise(paise)}`;
}

/**
 * The mean of `total` over `n` months, in whole paise.
 *
 * **This is the only place in the codebase where a money figure is divided.**
 * Every other aggregate is integer addition, min, or max, and therefore exact;
 * an average cannot be, so the rounding rule is pinned to one function that can
 * be tested rather than repeated at each call site.
 *
 * Rounds half **away from zero**, not `Math.round`. `Math.round` breaks ties
 * toward +∞, so it turns −2.5 into −2 but +2.5 into +3 — an average monthly
 * saving of −₹0.005 and one of +₹0.005 would round to different magnitudes.
 * Money rounding has to be symmetric about zero, or a month of small losses and
 * a month of small gains stop being mirror images.
 *
 * Computed as `floor((2·|total| + n) / 2n)` on integers, so no float is ever
 * involved and no precision is lost for large totals.
 */
export function meanPaise(total: Paise, n: number): Paise {
  if (n <= 0) throw new Error(`meanPaise: n must be positive, got ${n}`);
  const magnitude = Math.floor((2 * Math.abs(total) + n) / (2 * n));
  return total < 0 ? -magnitude : magnitude;
}

const COMPACT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

/**
 * Abbreviated rupees for chart axis ticks: 12000000 → "₹1.2L", 250000000 → "₹2.5Cr".
 *
 * Lossy by design, and therefore **only for axis ticks** — never for a figure a
 * user might check against their statement. Those use `formatPaise`, which is
 * exact. Uses the Indian lakh/crore scale rather than K/M because the reader is
 * reading a rupee amount.
 */
export function formatPaiseCompact(paise: Paise): string {
  const sign = paise < 0 ? '−' : '';
  const rupees = Math.abs(paise) / 100;
  if (rupees >= 1_00_00_000) return `${sign}₹${COMPACT.format(rupees / 1_00_00_000)}Cr`;
  if (rupees >= 1_00_000) return `${sign}₹${COMPACT.format(rupees / 1_00_000)}L`;
  if (rupees >= 1_000) return `${sign}₹${COMPACT.format(rupees / 1_000)}K`;
  return `${sign}₹${COMPACT.format(rupees)}`;
}
