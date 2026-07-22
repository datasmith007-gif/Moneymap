import type { Paise } from '../model/canonical.ts';

/**
 * Field parsers shared by bank parsers. These encode conventions common to Indian
 * statements (rupee amounts with lakh/crore grouping, DD-MM-YYYY dates). They live
 * here rather than in one parser because the second parser (ICICI) needed exactly
 * the same rules the first (Axis) did — the moment to generalise, not before.
 */

/**
 * "1,23,481.00" (Indian digit grouping) → 12348100 paise. Built with integer
 * arithmetic so no floating-point rounding is introduced — money must be exact
 * for reconciliation. Requires two decimal places (which is how statements print
 * money), so integers like page numbers and branch codes are correctly rejected.
 */
export function parseIndianAmount(text: string): Paise | null {
  const cleaned = text.replace(/,/g, '').trim();
  const m = /^(\d+)\.(\d{2})$/.exec(cleaned);
  if (!m) return null;
  return Number(m[1]) * 100 + Number(m[2]);
}

/** "DD-MM-YYYY" → ISO "YYYY-MM-DD"; null if it isn't such a date. */
export function parseDmyDate(text: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

const MONTHS: Readonly<Record<string, string>> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

/** "April 01, 2025" → ISO "2025-04-01"; null if it isn't such a date. Used for the
 *  ICICI period line, which spells months out. */
export function parseMonthNameDate(text: string): string | null {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(text);
  if (!m) return null;
  const mm = MONTHS[m[1]!.toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[2]!.padStart(2, '0')}`;
}
