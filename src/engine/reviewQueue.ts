import type { Paise, Transaction } from '../model/canonical.ts';
import type { Store } from '../storage/store.ts';
import { classifyById, type ClassifyContext } from '../enrichment/classify.ts';
import { extractCounterparty } from '../enrichment/counterparty.ts';
import { classificationStats, type ClassificationStats } from '../enrichment/stats.ts';

/**
 * The work left to do: every transaction the classifier could not label.
 *
 * Grouped, not listed. A flat list of 60 unlabelled rows is 60 decisions; the
 * same rows grouped by who was paid are usually six, because the unexplained
 * ones cluster — the same tuition transfer every month, the same friend, the
 * same cash machine. Feature §2.3 asks for exactly this ("you have 14 similar
 * payments to 'XYZ TUITION' — create a label?"), and it is also what makes a
 * single click able to clear a dozen rows.
 *
 * Ranked by the money the group represents, not by date. The queue's purpose is
 * to make the category breakdown trustworthy, and a ₹32,000 unexplained group
 * distorts it far more than fifteen ₹40 ones. Sorting by date would put the most
 * consequential decision anywhere.
 */

export interface ReviewGroup {
  /** Stable identity — the counterparty, or the transaction id when the
   *  narration named nobody and the row stands alone. */
  readonly key: string;
  /** What to call the group. The counterparty, or the raw narration for a
   *  singleton, which is all there is to show. */
  readonly label: string;
  readonly count: number;
  /** Combined value. Debits and credits are summed as magnitudes — this ranks
   *  attention, it is not a balance. */
  readonly total: Paise;
  /** Oldest and newest dates in the group, so a recurring payment is visible
   *  as one. */
  readonly firstDate: string;
  readonly lastDate: string;
  readonly transactions: readonly Transaction[];
}

export interface ReviewQueue {
  readonly groups: readonly ReviewGroup[];
  /** Counts across every transaction considered, not just the unlabelled ones —
   *  the queue has to be able to say "4 left of 62". */
  readonly stats: ClassificationStats;
}

export interface ReviewQueueOptions {
  readonly classification?: ClassifyContext;
  /** Inclusive ISO date bounds. Omitted means everything in the store. */
  readonly from?: string;
  readonly to?: string;
}

/**
 * Build the queue from transactions already in hand. Pure.
 *
 * Grouping key is the extracted counterparty. That is the same function the
 * classifier uses to name a payee, so a group is exactly the set of rows a rule
 * written against that payee would go on to claim — which is what makes the
 * "make a rule from this" action honest about its reach.
 */
export function buildReviewQueue(
  transactions: readonly Transaction[],
  ctx?: ClassifyContext,
): ReviewQueue {
  const labels = classifyById(transactions, ctx);
  const unlabelled = transactions.filter(
    (txn) => labels.get(txn.id)?.category === 'unclassified',
  );

  const groups = new Map<string, Transaction[]>();
  for (const txn of unlabelled) {
    // A row whose narration names nobody cannot be grouped with anything — it
    // gets its own group rather than being lumped into a meaningless "unknown"
    // bucket that no single rule could ever clear.
    const counterparty = extractCounterparty(txn.description);
    const key = counterparty === null ? `txn:${txn.id}` : `party:${counterparty}`;
    const held = groups.get(key);
    if (held) held.push(txn);
    else groups.set(key, [txn]);
  }

  const built = [...groups.entries()].map(([key, rows]) => {
    const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    return {
      key,
      label: key.startsWith('party:') ? key.slice(6) : (ordered[0]?.description ?? ''),
      count: ordered.length,
      total: ordered.reduce((sum, txn) => sum + txn.amount, 0),
      firstDate: ordered[0]?.date ?? '',
      lastDate: ordered[ordered.length - 1]?.date ?? '',
      transactions: ordered,
    } satisfies ReviewGroup;
  });

  // Money first, then count, then key — a total order, so the queue never
  // reshuffles between reads.
  built.sort((a, b) => b.total - a.total || b.count - a.count || a.key.localeCompare(b.key));

  return {
    groups: built,
    stats: classificationStats([...labels.values()]),
  };
}

/** Read the store, then build. Mirrors `loadDashboard`. */
export async function loadReviewQueue(
  store: Store,
  options: ReviewQueueOptions = {},
): Promise<ReviewQueue> {
  const [transactions, rules, overrides] = await Promise.all([
    store.listTransactions({
      ...(options.from !== undefined ? { from: options.from } : {}),
      ...(options.to !== undefined ? { to: options.to } : {}),
    }),
    store.listRules(),
    store.listOverrides(),
  ]);

  return buildReviewQueue(
    transactions,
    options.classification ?? { rules, overrides },
  );
}
