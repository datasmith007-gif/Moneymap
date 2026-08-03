import type { Transaction } from '../model/canonical.ts';
import { daysBetween } from '../model/date.ts';

/**
 * Finding the same rupee twice — money moved between two accounts the user owns.
 *
 * This is the correction that matters most on the dashboard. A ₹50,000 transfer
 * from savings to a salary account is not ₹50,000 of income *and* ₹50,000 of
 * spend; it is one rupee amount appearing on two statements. Left undetected it
 * inflates both sides of every monthly figure, which is why the engine has
 * carried a standing caveat saying so.
 *
 * Every transaction in the store belongs to the user by construction — the store
 * only ever holds statements they imported — so "an account the user owns" is
 * simply "a different `accountId`". There is no ownership question to answer.
 *
 * What this deliberately does NOT do: match a debit against a credit on the
 * *same* account. Those exist (a reversal, a failed transfer refunded) but they
 * are not transfers, and pairing them would erase real movements.
 */

/**
 * How far apart the two legs may land.
 *
 * A NEFT sent on a Friday evening credits on Monday, and a bank's value date can
 * differ from the date the receiving bank prints — one day misses both. A week
 * starts pairing genuinely unrelated movements that happen to share an amount,
 * and a wrong pair is worse than a missed one: it silently deletes a real
 * transaction from income and spend, where a missed one merely leaves the old
 * overstatement in place.
 */
const MAX_DAYS_APART = 3;

/**
 * Pair transfer legs across accounts.
 *
 * Returns a map from each paired transaction's id to its peer's id, in both
 * directions, so a caller can ask about any row without knowing which leg it
 * holds.
 *
 * **Order-independence is the property that matters here.** The input is sorted
 * into a total order before anything is matched, so the result depends only on
 * the set of transactions, never on the order they were imported, parsed, or
 * returned by the store. Without that, re-importing the same statements in a
 * different order would pair different rows and move every figure on the
 * dashboard — the exact nondeterminism the money constraint forbids.
 *
 * Matching is greedy over that order: each debit takes the earliest unmatched
 * credit that fits. Greedy is not optimal in general — a debit can consume a
 * credit that a later debit needed more — but the alternative is a maximum
 * bipartite matching whose result no user could predict or explain, and the
 * disagreement only arises when several identical amounts cluster inside the
 * same three days. Predictable beats optimal for a number someone has to trust.
 */
export function detectTransfers(
  transactions: readonly Transaction[],
): ReadonlyMap<string, string> {
  const ordered = [...transactions].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.accountId.localeCompare(b.accountId) ||
      a.id.localeCompare(b.id),
  );

  const credits = ordered.filter((txn) => txn.type === 'credit');
  const matched = new Set<string>();
  const peers = new Map<string, string>();

  for (const debit of ordered) {
    if (debit.type !== 'debit') continue;

    for (const credit of credits) {
      if (matched.has(credit.id)) continue;
      if (credit.accountId === debit.accountId) continue;
      if (credit.amount !== debit.amount) continue;
      if (Math.abs(daysBetween(debit.date, credit.date)) > MAX_DAYS_APART) continue;

      matched.add(credit.id);
      matched.add(debit.id);
      peers.set(debit.id, credit.id);
      peers.set(credit.id, debit.id);
      break;
    }
  }

  return peers;
}
