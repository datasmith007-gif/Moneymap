import type { CategoryId } from './taxonomy.ts';
import type { Classification } from './types.ts';

/**
 * Reading a set of classifications: how sure are we, and how much is left to do.
 *
 * Both questions are asked per import ("94% sorted itself out") and per screen
 * ("4 need a word from you"), and both are answered here rather than in a
 * component, so the same arithmetic cannot drift between the two places that
 * show it.
 */

/**
 * How sure we are, in the three steps a reader can act on.
 *
 * Banded rather than shown as a raw score because 0.85 means nothing to anyone.
 * The bands map to a display rule: **a mark appears only where we are unsure.**
 * Decorating every confident row with a green tick trains the reader to ignore
 * the marks entirely, so `certain` is deliberately the silent case.
 */
export type ConfidenceBand =
  /** The user said so, or two statements agreed. Show nothing. */
  | 'certain'
  /** A clean keyword match. Worth a quiet mark. */
  | 'fair'
  /** Matched only inside a longer word. Worth a second look. */
  | 'low'
  /** Nothing matched. This is the review queue. */
  | 'none';

/** The bar above which a match is as good as a clean keyword hit. Below it, a
 *  match was found only as an infix and deserves a visible mark. */
const FAIR_FLOOR = 0.8;

export function confidenceBand(classification: Classification): ConfidenceBand {
  if (classification.category === 'unclassified') return 'none';
  if (classification.source === 'user' || classification.source === 'transfer') return 'certain';
  return classification.confidence >= FAIR_FLOOR ? 'fair' : 'low';
}

export interface ClassificationStats {
  readonly total: number;
  /** Labelled without the user having to do anything. */
  readonly auto: number;
  /** Labelled because the user said so, directly or through their own rule. */
  readonly byUser: number;
  readonly unclassified: number;
  /** Rows whose label came from a weak match and deserve a second look. */
  readonly lowConfidence: number;
  /**
   * Share of rows carrying any label, 0..1.
   *
   * Counted by **rows, not amount** — deliberately different from the
   * dashboard's `ClassificationCoverage`, which is amount-weighted. They answer
   * different questions and would be wrong swapped: a rate by count says how
   * much work is left in the queue, a rate by amount says how much of the money
   * is explained. One ₹80,000 rent payment is 1% of the work and 40% of the
   * money.
   */
  readonly rate: number;
}

export function classificationStats(
  classifications: readonly Classification[],
): ClassificationStats {
  let auto = 0;
  let byUser = 0;
  let unclassified = 0;
  let lowConfidence = 0;

  for (const classification of classifications) {
    const band = confidenceBand(classification);
    if (band === 'none') {
      unclassified++;
      continue;
    }
    if (band === 'low') lowConfidence++;
    if (classification.source === 'user' || classification.source === 'user_rule') byUser++;
    else auto++;
  }

  const total = classifications.length;
  // An empty set is fully classified, not zero-percent classified. Nothing is
  // outstanding, and reporting 0% would read as total failure.
  return {
    total,
    auto,
    byUser,
    unclassified,
    lowConfidence,
    rate: total === 0 ? 1 : (total - unclassified) / total,
  };
}

/** Row counts per category, largest first. The register's filter chips. */
export function countByCategory(
  classifications: readonly Classification[],
): readonly { readonly category: CategoryId; readonly count: number }[] {
  const counts = new Map<CategoryId, number>();
  for (const classification of classifications) {
    counts.set(classification.category, (counts.get(classification.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    // Ties broken by id so the chip order never changes between renders.
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
