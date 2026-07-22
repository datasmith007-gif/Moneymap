import type { StatementDocument } from './document.ts';
import type { FormatFingerprint } from './outcome.ts';

/**
 * Builds a privacy-safe fingerprint of an unrecognised statement's layout, for
 * the `unsupported` outcome. The hard rule (planning doc §8, feature §1.4): this
 * may contain layout identity only — a bank *name* guessed from a fixed marker
 * list, and a structural signature over a fixed vocabulary of label words. It
 * must never contain a value copied from the statement (name, amount, account
 * number), so it is always safe for the user to report if they choose.
 */

/**
 * Institutions we can name safely, each with the fixed tokens that identify it
 * (brand words and IFSC prefixes). Because we only ever emit these constant
 * strings, the guess can never leak user data.
 */
const BANK_MARKERS: ReadonlyArray<{ name: string; tokens: readonly string[] }> = [
  { name: 'Axis Bank', tokens: ['AXIS', 'UTIB'] },
  { name: 'HDFC Bank', tokens: ['HDFC'] },
  { name: 'ICICI Bank', tokens: ['ICICI', 'ICIC0'] },
  { name: 'State Bank of India', tokens: ['STATE BANK OF INDIA', 'SBIN'] },
  { name: 'Kotak Mahindra Bank', tokens: ['KOTAK', 'KKBK'] },
];

/**
 * A fixed set of structural/label words. The signature records only which of
 * these are present — never any value from the statement — so it characterises
 * the layout without carrying data.
 */
const LAYOUT_VOCAB = [
  'STATEMENT', 'ACCOUNT', 'IFSC', 'MICR', 'TRAN', 'DATE', 'PARTICULARS',
  'NARRATION', 'DESCRIPTION', 'CHEQUE', 'CHQ', 'DEBIT', 'CREDIT', 'WITHDRAWAL',
  'DEPOSIT', 'BALANCE', 'OPENING', 'CLOSING', 'BRANCH', 'NEFT', 'RTGS', 'IMPS',
  'UPI',
] as const;

/** Uppercased text of the first page — where headers and labels live. */
function headerText(doc: StatementDocument): string {
  const firstPage = doc.pages[0];
  if (!firstPage) return '';
  return firstPage.words.map((w) => w.text).join(' ').toUpperCase();
}

function guessBank(header: string): string | null {
  for (const { name, tokens } of BANK_MARKERS) {
    if (tokens.some((t) => header.includes(t))) return name;
  }
  return null;
}

/** FNV-1a 32-bit hash → 8-char hex. Stable across runs; not cryptographic. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function fingerprint(doc: StatementDocument): FormatFingerprint {
  const header = headerText(doc);
  // Presence bitmask over the fixed vocabulary — a value-free layout shape.
  const present = LAYOUT_VOCAB.map((word) => (header.includes(word) ? '1' : '0')).join('');
  return {
    bankGuess: guessBank(header),
    signature: hash(`${present}|pages:${doc.pages.length}`),
  };
}
