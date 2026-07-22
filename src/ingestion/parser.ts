import type { StatementDocument } from './document.ts';
import type { ParseOutcome } from './outcome.ts';

/**
 * The extension seam of the whole feature. A bank is supported by implementing
 * this interface and registering it — no core changes (§1.1: registry pattern).
 *
 * Crucially, a parser owns BOTH how its statements are *recognised* (`detect`)
 * and how they are *read* (`parse`). A bank's layout is one fact; keeping
 * detection and parsing together stops that fact from leaking across a central
 * detector and a separate parser, where a layout change would have to be edited
 * in two places (and forgetting the second gives a silent wrong parse).
 *
 * Format drift is handled by registering another parser: `axis` and `axis-v2`
 * are two `BankParser`s with different `formatVersion`, and `detect` tells them
 * apart. No versioning logic in the core.
 */
export interface BankParser {
  /** Stable machine id, e.g. "axis". Unique within the registry. */
  readonly id: string;
  /** Display name, e.g. "Axis Bank". */
  readonly bankName: string;
  /** Distinguishes layout versions of the same bank, e.g. "2025-08". */
  readonly formatVersion: string;

  /**
   * Decide whether this parser recognises `doc`, from header/fingerprint text
   * only — must be cheap and must not attempt a full parse. Returns a confidence
   * the registry uses to pick a winner among parsers.
   */
  detect(doc: StatementDocument): DetectionResult;

  /**
   * Read a document this parser has recognised into canonical entities, or return
   * a `needs_review` outcome for a partial parse. Only called by the registry
   * after `detect` won. May assume the document is text-bearing (extraction has
   * already ruled out scanned/encrypted/corrupt files).
   */
  parse(doc: StatementDocument, ctx: ParseContext): ParseOutcome;
}

export interface DetectionResult {
  /**
   * 0 = definitely not this bank; 1 = certain. Scores only need to be comparable
   * across parsers, not calibrated — the registry dispatches to the highest
   * scorer above its threshold. Below the threshold, the document is Unsupported.
   */
  readonly confidence: number;
}

/**
 * Everything a parse needs beyond the document, injected so parsers stay pure and
 * deterministic — no `Date.now()` or random ids reached for inside a parser,
 * which would make output untestable.
 */
export interface ParseContext {
  /** Id of this import; used in provenance and to derive stable entity ids. */
  readonly statementId: string;
  /** ISO 8601 timestamp for this import, used for `Account.lastUpdated`. */
  readonly importedAt: string;
}
