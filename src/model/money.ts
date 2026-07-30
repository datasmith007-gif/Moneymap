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
