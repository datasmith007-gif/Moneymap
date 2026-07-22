import type { PositionedWord, StatementDocument } from './document.ts';

/**
 * Groups the loose positioned words of a document back into visual lines, in
 * reading order. Statement parsers reason line-by-line (a transaction is a run
 * of lines), so this turns the flat word soup from extraction into that shape.
 *
 * Shared because every tabular bank statement needs it; the per-bank column
 * geometry stays in each parser, but "which words share a line" is universal.
 */

export interface Line {
  /** 1-based source page — carried through to provenance. */
  readonly page: number;
  /** Representative top-y of the line (the smallest y among its words). */
  readonly y: number;
  /** The line's words, left to right. */
  readonly words: readonly PositionedWord[];
}

/**
 * Cluster words into lines and return them top-to-bottom across all pages.
 *
 * `yTolerance` is how far apart (in points) two words' y may be and still count
 * as the same line — set a little below the statement's line height so adjacent
 * rows don't merge. Words are considered on the same line when their vertical
 * midpoints are within tolerance, which tolerates the small baseline jitter pdf.js
 * reports for differently-sized glyphs on one row.
 */
export function documentLines(doc: StatementDocument, yTolerance = 4): Line[] {
  const lines: Line[] = [];
  for (const page of doc.pages) {
    const byMidY = [...page.words].sort((a, b) => midY(a) - midY(b) || a.x - b.x);
    let current: PositionedWord[] = [];
    let anchorY = Number.NaN;
    for (const word of byMidY) {
      if (current.length === 0 || Math.abs(midY(word) - anchorY) <= yTolerance) {
        if (current.length === 0) anchorY = midY(word);
        current.push(word);
      } else {
        lines.push(finishLine(page.pageNumber, current));
        current = [word];
        anchorY = midY(word);
      }
    }
    if (current.length > 0) lines.push(finishLine(page.pageNumber, current));
  }
  return lines;
}

function midY(w: PositionedWord): number {
  return w.y + w.height / 2;
}

function finishLine(page: number, words: PositionedWord[]): Line {
  const sorted = [...words].sort((a, b) => a.x - b.x);
  const y = Math.min(...sorted.map((w) => w.y));
  return { page, y, words: sorted };
}
