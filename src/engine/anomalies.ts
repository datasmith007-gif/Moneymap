import type { Paise, Transaction } from '../model/canonical.ts';
import type { Store } from '../storage/store.ts';
import { classifyById, EMPTY_CONTEXT, type ClassifyContext } from '../enrichment/classify.ts';
import type { CategoryId } from '../enrichment/taxonomy.ts';
import type { Classification } from '../enrichment/types.ts';
import { meanPaise } from '../model/money.ts';
import { isSpendRow } from './aggregate.ts';

/**
 * Spending that does not look like the rest of your spending.
 *
 * One question, asked per category: is this payment far outside what this
 * category normally costs *you*? Not a budget, not a rule — a comparison against
 * the user's own history, which is the only baseline this app has any business
 * claiming to know.
 *
 * Three commitments hold the whole module together, and each of them exists to
 * stop a plausible-looking false alarm:
 *
 *  - **Robust statistics, not mean and σ.** The single large payment we are
 *    looking for is precisely the value that drags a mean toward itself and
 *    inflates σ, so a mean-based test hides the outlier it was built to find.
 *    Median and median absolute deviation do not move for one value.
 *  - **Silence beats a guess.** A category with too little history yields
 *    nothing at all rather than a finding resting on four rows. Same rule the
 *    classifier follows when it declines to label.
 *  - **Deterministic.** Integer paise, a fixed threshold, and a total order on
 *    the output. The same store always produces the same list, in the same
 *    sequence.
 *
 * The unit is **one transaction**, not one day's total. A per-day figure reads
 * well in a headline and has no row behind it; every other surface in this app
 * points at a row the reader can open, categorise, and check against their
 * statement, and a finding they cannot inspect is a finding they cannot trust.
 */

// ── Thresholds ──────────────────────────────────────────────────────────────

/**
 * Rows a category needs before it has a "usual" worth comparing against.
 *
 * Eight is the point where a median stops being an accident of which four
 * payments happened to land in the window. Below it the honest answer is that
 * there is no baseline yet, so the category is skipped entirely rather than
 * measured against a number nobody should rely on.
 */
const MIN_SAMPLE = 8;

/**
 * How far above the median a payment must sit, in absolute rupees, before it is
 * worth mentioning at all.
 *
 * Without this a ₹60 coffee against a ₹15 median is "four times your usual" —
 * arithmetically true and completely useless. A finding has to be about an
 * amount of money the reader would care to have flagged.
 */
const MIN_EXCESS: Paise = 1_000_00;

/**
 * Multiples of MAD above the median that count as unusual.
 *
 * For roughly normal data MAD ≈ 0.67σ, so four MADs is about 2.7σ — a bar low
 * enough to catch a genuinely odd month and high enough that ordinary variation
 * does not clear it.
 */
const MAD_MULTIPLE = 4;

/**
 * The fallback bar when MAD is zero.
 *
 * Zero dispersion is normal, not a degenerate case: a fixed ₹500 monthly
 * recharge repeated twelve times has a MAD of exactly 0, and `median + 4 × 0`
 * would flag every single rupee of variation. When the history says "this amount
 * never varies", the test becomes a plain multiple of it.
 */
const FLAT_MULTIPLE = 3;

// ── Types ───────────────────────────────────────────────────────────────────

export interface Anomaly {
  readonly transactionId: string;
  readonly date: string;
  /** The narration as printed, so the row can be found on the statement. */
  readonly description: string;
  /** The payee, when the classifier could name one. */
  readonly counterparty: string | null;
  readonly category: CategoryId;
  readonly amount: Paise;
  /** The median this is measured against — what this category usually costs. */
  readonly baseline: Paise;
  /** `amount − baseline`. The figure the list is ranked by. */
  readonly excess: Paise;
  /**
   * `amount ÷ baseline`, for the "4× your usual" wording.
   *
   * The one fractional number this module emits, and display-only: it is never
   * summed, compared against money, or fed into another figure.
   */
  readonly multiple: number;
  /** How many rows the baseline rests on, so the reader can judge its weight. */
  readonly sampleSize: number;
}

export interface AnomalyOptions {
  readonly classification?: ClassifyContext;
  /**
   * Inclusive ISO date bounds on which findings are *reported*.
   *
   * The baseline is always built from every transaction supplied, whatever these
   * say. That asymmetry is the point: what a category usually costs must not
   * change because the reader switched the dashboard from twelve months to
   * three. A three-month baseline would call an ordinary quarter unusual.
   */
  readonly from?: string;
  readonly to?: string;
}

// ── Detection ───────────────────────────────────────────────────────────────

/** What a category normally costs, and how much that figure can be trusted. */
interface Baseline {
  readonly median: Paise;
  /** Median absolute deviation. Zero means the amount never varies. */
  readonly mad: Paise;
  readonly sampleSize: number;
}

/**
 * Build the findings from transactions already in hand. Pure.
 *
 * Partial-coverage months are deliberately kept in the baseline, unlike the
 * dashboard's monthly averages. A monthly *total* is halved by a missing half
 * month and has to be excluded; a per-transaction median is not affected at all
 * — the payments that were imported are real payments whatever else is missing.
 */
export function detectAnomalies(
  transactions: readonly Transaction[],
  options: AnomalyOptions = {},
): readonly Anomaly[] {
  const labels = classifyById(transactions, options.classification ?? EMPTY_CONTEXT);
  const baselines = buildBaselines(transactions, labels);

  const findings: Anomaly[] = [];
  for (const txn of transactions) {
    if (options.from !== undefined && txn.date < options.from) continue;
    if (options.to !== undefined && txn.date > options.to) continue;

    const label = labels.get(txn.id);
    const category = categoryToMeasure(txn, label);
    if (category === null) continue;

    const baseline = baselines.get(category);
    if (baseline === undefined) continue;

    const excess = txn.amount - baseline.median;
    if (excess < MIN_EXCESS) continue;
    if (txn.amount < unusualAbove(baseline)) continue;

    findings.push({
      transactionId: txn.id,
      date: txn.date,
      description: txn.description,
      counterparty: label?.counterparty ?? null,
      category,
      amount: txn.amount,
      baseline: baseline.median,
      excess,
      multiple: txn.amount / baseline.median,
      sampleSize: baseline.sampleSize,
    });
  }

  // Money first, newest next, id last. Ranked by rupees over the usual rather
  // than by multiple, for the same reason the review queue ranks by value: a
  // ₹40,000 surprise matters more than a 12× surprise worth ₹1,200. The trailing
  // keys make the order total, so the list never reshuffles between reads.
  findings.sort(
    (a, b) =>
      b.excess - a.excess ||
      b.date.localeCompare(a.date) ||
      a.transactionId.localeCompare(b.transactionId),
  );
  return findings;
}

/** The amount at or above which a payment in this category is unusual. */
function unusualAbove(baseline: Baseline): Paise {
  return baseline.mad === 0
    ? baseline.median * FLAT_MULTIPLE
    : baseline.median + MAD_MULTIPLE * baseline.mad;
}

/**
 * The category a row should be measured in, or `null` when it should not be
 * measured at all.
 *
 * Three exclusions, each for its own reason. Credits and internal transfers are
 * not spending — the same decision `isSpendRow` makes for every other spend
 * figure, borrowed rather than restated. `unclassified` is excluded on top of
 * that: there is no such thing as a usual unknown payment, and a pile of
 * unrelated rows sharing only the fact that nothing matched them would produce a
 * median that describes nothing.
 */
function categoryToMeasure(txn: Transaction, label: Classification | undefined): CategoryId | null {
  if (!isSpendRow(txn, label)) return null;
  const category = label?.category ?? 'unclassified';
  return category === 'unclassified' ? null : category;
}

/** Median and MAD per category, over every row supplied. */
function buildBaselines(
  transactions: readonly Transaction[],
  labels: ReadonlyMap<string, Classification>,
): ReadonlyMap<CategoryId, Baseline> {
  const amounts = new Map<CategoryId, Paise[]>();
  for (const txn of transactions) {
    const category = categoryToMeasure(txn, labels.get(txn.id));
    if (category === null) continue;
    const held = amounts.get(category);
    if (held) held.push(txn.amount);
    else amounts.set(category, [txn.amount]);
  }

  const baselines = new Map<CategoryId, Baseline>();
  for (const [category, values] of amounts) {
    if (values.length < MIN_SAMPLE) continue;
    const median = medianPaise(values);
    baselines.set(category, {
      median,
      mad: medianPaise(values.map((value) => Math.abs(value - median))),
      sampleSize: values.length,
    });
  }
  return baselines;
}

/**
 * The middle value, in whole paise. Local to this module — it is the one place
 * that needs it, and generalising it before there is a second caller would be
 * inventing a shared abstraction out of one use.
 *
 * Even-length lists go through `meanPaise`, so this introduces no second money
 * rounding rule. Does not mutate the caller's array.
 */
function medianPaise(values: readonly Paise[]): Paise {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return meanPaise(sorted[middle - 1]! + sorted[middle]!, 2);
}

// ── Store reader ────────────────────────────────────────────────────────────

/**
 * Read the store, then detect. Mirrors `loadReviewQueue` and `loadDashboard`.
 *
 * Reads **every** transaction rather than bounding the query by `from`/`to`, and
 * that is deliberate: the bounds select which findings are reported, while the
 * baseline behind them is the user's whole history. A range-bounded read would
 * silently make "usual" mean "usual within the window you happen to be looking
 * at", which is the one thing this module promises it does not mean.
 */
export async function loadAnomalies(
  store: Store,
  options: AnomalyOptions = {},
): Promise<readonly Anomaly[]> {
  const [transactions, rules, overrides] = await Promise.all([
    store.listTransactions({}),
    store.listRules(),
    store.listOverrides(),
  ]);

  return detectAnomalies(transactions, {
    ...options,
    classification: options.classification ?? { rules, overrides },
  });
}
