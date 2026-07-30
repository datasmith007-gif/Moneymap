import type { PositionedWord } from './document.ts';
import type { Line } from './layout.ts';

/**
 * Shared column mechanics for tabular bank-statement parsers (§5.4 decision).
 *
 * The §5.4 open question was how raw the representation parsers consume should be:
 * lean positioned words + shared column helpers, or pre-extracted rows. The answer
 * is **positioned words + shared column helpers**, and this module is that shared
 * layer. Pre-extracting rows would force a central layer to know each bank's column
 * geometry — but column geometry is a *per-bank* fact (Axis' Debit|Credit|Balance
 * vs ICICI's reversed Deposits|Withdrawals, different narration wrapping), and
 * pushing it into the core is exactly the information leakage the parser design
 * exists to avoid. So each parser keeps its own geometry (which labels, which
 * column means debit) and the *mechanics* — centre-x, header-label lookup, and
 * bucketing words into columns — live here, shared, because they are identical.
 *
 * Before this module, `axis.ts` and `icici.ts` each hand-wrote the same centre-x
 * classification loop and header helpers; only the column names differed.
 */

/**
 * The horizontal point used to decide which column a word belongs to. Amount
 * columns are right-aligned, so a word's left edge (`x`) drifts with its width
 * while its centre stays put — both parsers classified by centre-x for this
 * reason, so it is the shared rule.
 */
export function centreX(word: PositionedWord): number {
  return word.x + word.width / 2;
}

/**
 * The left-x of the first header token whose text starts with `labelPrefix`
 * (compared case-insensitively), or null if no such token is present. Column
 * boundaries are read from header labels, so this is every parser's `deriveBands`
 * primitive; which labels are the dividers stays with each parser.
 */
export function headerX(header: Line, labelPrefix: string): number | null {
  const prefix = labelPrefix.toUpperCase();
  const word = header.words.find((w) => w.text.toUpperCase().startsWith(prefix));
  return word ? word.x : null;
}

/**
 * True when `line` contains a token for every one of `labelPrefixes`. This is the
 * shared shape of each parser's column-header detection and of the column checks
 * in `detect`.
 */
export function hasLabels(line: Line, labelPrefixes: readonly string[]): boolean {
  const text = line.words
    .map((w) => w.text)
    .join(' ')
    .toUpperCase();
  return labelPrefixes.every((label) => text.includes(label.toUpperCase()));
}

/**
 * Bucket a line's words into named columns by centre-x.
 *
 * `boundaries` are the ascending x-dividers between columns (must be sorted
 * left→right). `names` names the resulting regions: `names[i]` covers the words
 * whose centre-x falls in `[boundaries[i-1], boundaries[i])`, and the final name
 * covers everything at or past the last boundary — so `names.length` must be
 * `boundaries.length + 1`. A word left of the first boundary joins `names[0]`.
 *
 * This is the classification loop both parsers wrote by hand; only `boundaries`
 * and `names` differ, and those are the per-bank geometry each parser owns.
 */
export function splitColumns(
  line: Line,
  boundaries: readonly number[],
  names: readonly string[],
): Record<string, PositionedWord[]> {
  if (names.length !== boundaries.length + 1) {
    throw new Error(
      `splitColumns: expected ${boundaries.length + 1} names for ${boundaries.length} boundaries, got ${names.length}`,
    );
  }
  const columns: Record<string, PositionedWord[]> = {};
  for (const name of names) columns[name] = [];
  for (const word of line.words) {
    const centre = centreX(word);
    let region = boundaries.findIndex((b) => centre < b);
    if (region === -1) region = boundaries.length;
    columns[names[region]!]!.push(word);
  }
  return columns;
}

/** The words' text joined left-to-right — the shared way both parsers built a
 *  column's narration string. Words within a column are already in x order. */
export function joinText(words: readonly PositionedWord[]): string {
  return words.map((w) => w.text).join(' ');
}

/** The first word in a column that `parse` interprets as non-null — the shared
 *  "take the first token that reads as a date / an amount" both parsers did with
 *  `date ??= parseDmyDate(word.text)`. Keeps the field grammar in `fields.ts`. */
export function firstParsed<T>(
  words: readonly PositionedWord[],
  parse: (text: string) => T | null,
): T | null {
  for (const word of words) {
    const value = parse(word.text);
    if (value !== null) return value;
  }
  return null;
}
