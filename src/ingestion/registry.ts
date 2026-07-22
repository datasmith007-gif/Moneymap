import type { StatementDocument } from './document.ts';
import type { ParseOutcome } from './outcome.ts';
import type { BankParser, ParseContext } from './parser.ts';
import { fingerprint } from './fingerprint.ts';

/**
 * Minimum confidence a parser must report to be trusted with a document. Below
 * this, the document is treated as an unrecognised format rather than risk a
 * wrong parse — silent wrong parses are the failure mode this whole feature
 * exists to prevent (§1.4).
 */
const CONFIDENCE_THRESHOLD = 0.5;

/**
 * Holds the registered bank parsers and routes a document to the right one.
 *
 * This is the seam that keeps bank count from multiplying core complexity: the
 * registry knows *how to choose*, and nothing about any specific bank. Each
 * parser knows its own bank and nothing about the others. Adding a bank is
 * `register(new XyzParser())` and no edit here.
 */
export class ParserRegistry {
  private readonly parsers: BankParser[] = [];

  /** Register a parser. Throws on duplicate id — a mistake worth failing on
   *  loudly, since a shadowed parser would silently never run. */
  register(parser: BankParser): this {
    if (this.parsers.some((p) => p.id === parser.id)) {
      throw new Error(`Parser id "${parser.id}" is already registered`);
    }
    this.parsers.push(parser);
    return this;
  }

  /** Registered parsers, in registration order. */
  list(): readonly BankParser[] {
    return this.parsers;
  }

  /**
   * Route `doc` to the highest-confidence parser above the threshold and return
   * its outcome; if none clears the threshold, return `unsupported` with a
   * privacy-safe fingerprint. Ties (equal confidence) go to the earlier-
   * registered parser, so dispatch is deterministic.
   *
   * Assumes `doc` is text-bearing — the extraction layer has already handled
   * scanned/encrypted/corrupt files upstream.
   */
  dispatch(doc: StatementDocument, ctx: ParseContext): ParseOutcome {
    let best: { parser: BankParser; confidence: number } | null = null;
    for (const parser of this.parsers) {
      const { confidence } = parser.detect(doc);
      if (best === null || confidence > best.confidence) {
        best = { parser, confidence };
      }
    }

    if (best === null || best.confidence < CONFIDENCE_THRESHOLD) {
      return {
        kind: 'unsupported',
        message:
          "This statement's format isn't recognised yet. Nothing was imported. " +
          'You can report its layout to help us add support — no account data leaves your device.',
        fingerprint: fingerprint(doc),
      };
    }

    return best.parser.parse(doc, ctx);
  }
}
