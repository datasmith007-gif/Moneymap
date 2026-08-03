import { normalise } from './narration.ts';

/**
 * Who the money moved to or from, read out of the narration.
 *
 * A best-effort display value, never a figure. Nothing with financial
 * consequence is derived from it — it exists so the review queue can say
 * "UPI to RAHUL SHARMA" instead of reprinting the raw string, and so the
 * register has something to group by.
 *
 * The strongest signal is not handled here at all: when a rule matched, the
 * matched pattern already names the merchant, and `classify` uses that. This
 * module is the fallback for rows nothing matched — which is exactly the set
 * that lands in the review queue, and exactly where a human needs the most help
 * reading the row.
 *
 * Case is preserved as UPPERCASE rather than title-cased. Title-casing turns
 * `HDFC` into `Hdfc`, and there is no way to tell an acronym from a name without
 * a dictionary; bank narration is overwhelmingly uppercase already, so the
 * honest thing is to leave casing to whatever renders it.
 */

/**
 * Payment-rail and instrument codes. These identify *how* money moved, never
 * *who* it moved to, so a segment made only of these carries no counterparty.
 */
const RAIL_CODES = new Set([
  'UPI', 'IMPS', 'NEFT', 'RTGS', 'ATM', 'POS', 'ACH', 'NACH', 'MMT', 'TPT', 'INF', 'INFT',
  'BIL', 'ECS', 'CHQ', 'CLG', 'EAW', 'NWD', 'CWDR', 'VPS', 'ONL', 'PCD', 'MPS', 'SI',
  'P2M', 'P2A', 'CMS', 'FT', 'DC', 'CC', 'MB', 'IB', 'WDL',
]);

/**
 * Words that appear in narration but never identify a party. `BANK` is here on
 * purpose: `HDFC BANK` should read as `HDFC`.
 */
const NOISE_WORDS = new Set([
  'PAYMENT', 'PAY', 'PAID', 'FROM', 'TO', 'TRANSFER', 'TRF', 'CR', 'DR', 'CREDIT', 'DEBIT',
  'REF', 'TXN', 'TRAN', 'PURCHASE', 'VIA', 'BY', 'NA', 'OTHERS', 'SELF', 'COLLECT', 'REQUEST',
  'SENT', 'RECEIVED', 'MONEY', 'FUND', 'FUNDS', 'ACCOUNT', 'AC', 'ACCT', 'BANK', 'THE', 'AND',
  'FOR', 'WITH',
]);

/** A counterparty is a name, not a sentence. Anything longer is narration that
 *  happened to survive the filters. */
const MAX_TOKENS = 4;

/**
 * A token can only be part of a name if it is **all letters and at least three
 * of them**.
 *
 * That one rule retires a whole family of special cases at once: IFSC codes
 * (`HDFC0001234`), masked card numbers (`4471XXXXXX1234`), UPI reference
 * numbers, phone numbers and amounts all carry digits, and initials and stray
 * letters carry no information alone. The cost is that a genuine merchant with a
 * digit in its name (`1MG`, `ZEE5`) is not extracted here — but those are named
 * by shipped rules, and `classify` prefers a rule's merchant over this fallback
 * whenever one matched.
 */
function isNameToken(token: string): boolean {
  if (token.length < 3) return false;
  if (!/^[A-Z]+$/.test(token)) return false;
  return !RAIL_CODES.has(token) && !NOISE_WORDS.has(token);
}

/**
 * Extract a counterparty, or `null` when the narration names nobody.
 *
 * Segments first, tokens second. Banks separate the meaningful parts of a
 * narration with `/`, `-` or `|` (`UPI/RAHUL SHARMA/9876543210/PAY`), so the
 * segment is the unit that holds a name — splitting straight to tokens would
 * scatter `RAHUL SHARMA` across the same list as the reference number.
 *
 * The **earliest** surviving segment wins, not the longest. Banks put the party
 * before the location and the trailing metadata, so `POS 4471XXXX1234 SWIGGY
 * BANGALORE` should answer `SWIGGY`, which "longest" would get wrong.
 */
export function extractCounterparty(narration: string): string | null {
  // Split on the structural delimiters only — spaces are inside segments.
  const segments = narration.split(/[/\-|,;]+/);

  for (const segment of segments) {
    const kept = normalise(segment).split(' ').filter(isNameToken);

    if (kept.length === 0) continue;
    return kept.slice(0, MAX_TOKENS).join(' ');
  }
  return null;
}
