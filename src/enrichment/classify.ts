import type { Transaction, TransactionType } from '../model/canonical.ts';
import { extractCounterparty } from './counterparty.ts';
import { firstMatch, SHIPPED_RULES, type RuleMatch } from './rules.ts';
import { detectTransfers } from './transfers.ts';
import type { CategoryId } from './taxonomy.ts';
import { CONFIDENCE_THRESHOLD, type Classification, type Rule } from './types.ts';
import { containsPattern, normalise, type MatchStrength } from './narration.ts';

/**
 * The enrichment layer's one entry point: transactions in, labels out.
 *
 * Everything else in this directory is internal machinery. A caller needs this
 * function and the `Classification` type, and nothing else — the same shape
 * `parseStatement` has over the ingestion modules, and for the same reason: the
 * interface is what the rest of the system pays for, so it should be far smaller
 * than the implementation behind it.
 *
 * **Batch, not per-transaction.** A `classifyOne(txn)` signature would be
 * simpler to call and could not express the most valuable rule in the module:
 * an internal transfer is a *relationship between two rows on different
 * accounts*, invisible from either one alone. Taking the batch is what lets a
 * single function own the whole answer.
 *
 * Pure and synchronous, like `BankParser.parse` — no clock, no randomness, no
 * I/O. The same transactions and the same context always produce the same
 * labels, which is what makes every downstream figure reproducible.
 */

export interface ClassifyContext {
  /** User-written rules. Shipped rules are appended internally; a caller never
   *  passes them and cannot accidentally drop them. */
  readonly rules: readonly Rule[];
  /** Transaction id → the label the user chose. Beats everything else. */
  readonly overrides: ReadonlyMap<string, CategoryId>;
}

/** An empty context: shipped rules only, no user input. */
export const EMPTY_CONTEXT: ClassifyContext = { rules: [], overrides: new Map() };

/**
 * How much to trust a rule match.
 *
 * Two inputs: who wrote the rule, and whether the pattern matched a whole token
 * or was found inside a longer word. A user's own rule beats a shipped one on
 * equal footing — they know their statements — but neither reaches 1.0, which is
 * reserved for a label the user applied to that exact row.
 *
 * The infix values sit just above `CONFIDENCE_THRESHOLD` on purpose. They are
 * good enough to show a label rather than an empty cell, and low enough that the
 * review queue marks them for a second look.
 */
function confidenceOf(origin: Rule['origin'], strength: MatchStrength): number {
  if (origin === 'user') return strength === 'token' ? 0.95 : 0.75;
  return strength === 'token' ? 0.85 : 0.6;
}

/**
 * Build a classification, holding the invariant that ties the transfer flag to
 * the category.
 *
 * `isInternalTransfer` and `category === 'self_transfer'` are two views of one
 * fact, and this is the only function that constructs a `Classification`, so
 * they cannot drift apart. The engine reads the flag on every row and must not
 * have to consult the taxonomy to do it.
 */
function build(
  transactionId: string,
  category: CategoryId,
  confidence: number,
  source: Classification['source'],
  ruleId: string | null,
  counterparty: string | null,
  transferPeerId: string | null,
): Classification {
  const isInternalTransfer = category === 'self_transfer';
  return {
    transactionId,
    category,
    confidence,
    source,
    ruleId,
    counterparty,
    isInternalTransfer,
    transferPeerId: isInternalTransfer ? transferPeerId : null,
  };
}

/**
 * Name the merchant from the rule that matched, falling back to the narration.
 *
 * A matched pattern is a better counterparty than anything extraction can
 * recover: it is already canonical (`SWIGGY`, not `SWIGGYINSTAMART BLR`) and it
 * was written by a human. Extraction only has to carry the rows nothing matched.
 */
function counterpartyFor(txn: Transaction, match: RuleMatch | null): string | null {
  if (match !== null) {
    // Which of the rule's patterns actually hit — asked through the same matcher
    // the rule was evaluated with, so the answer cannot disagree with it.
    for (const pattern of match.rule.patterns) {
      if (containsPattern(txn.description, pattern) !== null) return normalise(pattern);
    }
  }
  return extractCounterparty(txn.description);
}

/**
 * Label every transaction, in precedence order.
 *
 * The chain runs cheapest and most authoritative first, and stops at the first
 * answer:
 *
 *  1. **The user's own label** on this exact row. Never overturned by anything —
 *     the module promise is that a manual label is never silently reverted.
 *  2. **A transfer pair.** Placed above rules because it is evidence rather than
 *     a guess: two statements agree that this rupee amount moved between two of
 *     the user's accounts. A `SWIGGY` rule should never win over that.
 *  3. **A user rule**, then a **shipped rule**, in `order`. Hand-written rules
 *     beat shipped ones regardless of position — the ordering is within each
 *     origin, not across them.
 *  4. **`unclassified`**, when nothing matched or the best match fell below the
 *     threshold. Unclassified is honest, and it is what feeds the review queue.
 */
export function classify(
  transactions: readonly Transaction[],
  ctx: ClassifyContext = EMPTY_CONTEXT,
): readonly Classification[] {
  const peers = detectTransfers(transactions);

  // Split by origin rather than concatenating: a user rule with order 99 must
  // still beat a shipped rule with order 0, so the two sets are consulted in
  // sequence and only ordered within themselves.
  const userRules = ctx.rules.filter((rule) => rule.origin === 'user');

  return transactions.map((txn) => {
    const type: TransactionType = txn.type;

    const override = ctx.overrides.get(txn.id);
    if (override !== undefined) {
      return build(txn.id, override, 1, 'user', null, counterpartyFor(txn, null), peers.get(txn.id) ?? null);
    }

    const peerId = peers.get(txn.id);
    if (peerId !== undefined) {
      return build(txn.id, 'self_transfer', 1, 'transfer', null, counterpartyFor(txn, null), peerId);
    }

    const match = firstMatch(userRules, txn.description, type) ??
      firstMatch(SHIPPED_RULES, txn.description, type);

    if (match !== null) {
      const confidence = confidenceOf(match.rule.origin, match.strength);
      if (confidence >= CONFIDENCE_THRESHOLD) {
        return build(
          txn.id,
          match.rule.category,
          confidence,
          match.rule.origin === 'user' ? 'user_rule' : 'shipped_rule',
          match.rule.id,
          counterpartyFor(txn, match),
          null,
        );
      }
    }

    return build(txn.id, 'unclassified', 0, 'none', null, counterpartyFor(txn, null), null);
  });
}

/** Classifications keyed by transaction id — the form every consumer wants. */
export function classifyById(
  transactions: readonly Transaction[],
  ctx: ClassifyContext = EMPTY_CONTEXT,
): ReadonlyMap<string, Classification> {
  return new Map(classify(transactions, ctx).map((c) => [c.transactionId, c]));
}
