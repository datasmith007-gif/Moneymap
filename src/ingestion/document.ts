/**
 * StatementDocument — the bank-agnostic, positional representation of a PDF that
 * every parser consumes. It is produced once by the extraction layer (which owns
 * pdf.js) and hides pdf.js entirely, so swapping the PDF engine never touches a
 * parser, and no parser depends on pdf.js types.
 *
 * Why positional (x/y per word) and not plain text: bank statements are tables,
 * and their columns (Debit | Credit | Balance | …) are defined by horizontal
 * position, not by whitespace. Flowing the text to a string scrambles the
 * columns — proven on the real Axis fixture. So the IR keeps each word's
 * coordinates and lets each parser assign columns by x-range.
 */

/**
 * One text token with its position on the page.
 *
 * Coordinate convention: origin is the **top-left** of the page and `y` grows
 * **downward** (normal reading order). The extraction layer converts pdf.js's
 * bottom-left origin into this convention so parsers never deal with flipped
 * coordinates. All units are PDF points.
 */
export interface PositionedWord {
  readonly text: string;
  /** Left edge of the token. */
  readonly x: number;
  /** Top edge of the token (smaller = higher on the page). */
  readonly y: number;
  /** Rendered width; `x + width` is the right edge. */
  readonly width: number;
  /** Approximate glyph height, useful for grouping words into lines. */
  readonly height: number;
}

export interface Page {
  /** 1-based, matches the number a human sees and what provenance records. */
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  /** Tokens in pdf.js emission order; parsers sort by (y, x) as needed. */
  readonly words: readonly PositionedWord[];
}

export interface StatementDocument {
  readonly pages: readonly Page[];
}
