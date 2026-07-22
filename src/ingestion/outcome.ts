import type { ParsedStatement } from '../model/canonical.ts';

/**
 * The single result type of parsing a statement (§1.1 module promise, §1.4
 * fallbacks). Every expected outcome — success *and* every anticipated failure —
 * is a value in this union, not a thrown exception. Callers switch on `kind`
 * exhaustively. Only genuinely unexpected faults (bugs, broken invariants) throw.
 *
 * Rationale: a scanned PDF or an unknown bank is a *normal* thing a user will
 * upload, not an error condition. Modelling it as data forces the UI to handle
 * every case and gives each one an actionable message rather than a stack trace.
 */
export type ParseOutcome =
  | ParsedOutcome
  | NeedsReviewOutcome
  | UnsupportedOutcome
  | UnreadableOutcome
  | EncryptedOutcome;

/** Fully parsed and internally consistent enough to hand on. Reconciliation
 *  (§1.2) still runs downstream before anything is persisted. */
export interface ParsedOutcome {
  readonly kind: 'parsed';
  readonly statement: ParsedStatement;
}

/**
 * Parsed in part: some rows were extracted, others could not be. We keep what
 * passed and describe what did not, so the user can review rather than lose data
 * (§1.4: "import what passes, flag the rest").
 */
export interface NeedsReviewOutcome {
  readonly kind: 'needs_review';
  readonly statement: ParsedStatement;
  /** Human-readable descriptions of what could not be parsed. Never contains raw
   *  financial values — describes the problem, e.g. "3 rows on page 5 had no
   *  recognisable amount column". */
  readonly issues: readonly string[];
}

/**
 * The document is readable text, but no registered parser recognised its format.
 * Carries a fingerprint the user may *choose* to report to help us prioritise a
 * new parser. The fingerprint is layout identity only — bank name guess plus a
 * structural signature — and **never** transaction data. The statement itself
 * never leaves the device.
 */
export interface UnsupportedOutcome {
  readonly kind: 'unsupported';
  readonly message: string;
  readonly fingerprint: FormatFingerprint;
}

export interface FormatFingerprint {
  /** Best guess at the institution from header text, or null if none stood out. */
  readonly bankGuess: string | null;
  /** A short, stable signature of the layout (e.g. hashed header tokens). Safe to
   *  transmit: contains no names, amounts, or account numbers. */
  readonly signature: string;
}

/**
 * The file cannot yield text to parse at all. `no_text_layer` is the scanned/
 * image case, which is deliberately out of scope for V1 (planning doc §3.3 —
 * OCR deferred); the user is told to upload a CSV or a text PDF instead.
 */
export interface UnreadableOutcome {
  readonly kind: 'unreadable';
  readonly reason: UnreadableReason;
  readonly message: string;
}

export type UnreadableReason =
  | 'no_text_layer' // scanned/image PDF: pages render but carry no selectable text
  | 'corrupt' // pdf.js could not open or decode the file
  | 'empty' // opened, but zero pages / zero text
  | 'too_large'; // exceeds the upload size guard before we even open it

/**
 * The PDF is password-protected. We only *detect* this here and ask for the
 * password; actual in-memory decryption is Feature §1.5, a later ticket. No
 * password is ever stored or logged.
 */
export interface EncryptedOutcome {
  readonly kind: 'encrypted';
  readonly message: string;
}
