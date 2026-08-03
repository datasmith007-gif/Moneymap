import type { Paise, Transaction } from '../model/canonical.ts';
import { classifyById, EMPTY_CONTEXT, type ClassifyContext } from './classify.ts';
import type { CategoryId } from './taxonomy.ts';
import type { Rule } from './types.ts';

/**
 * What a rule would do, before it is saved.
 *
 * The mock's Rules screen promises "would have matched 3 past entries", and that
 * promise is doing more work than it looks. Rules in this system are **always
 * retroactive**: classification is computed from the current rule set every time
 * it is read, never stored per row, so saving a rule silently re-labels history.
 * That is a good property — there is no migration, no stale label, no second
 * source of truth — but it means the user has to be able to see the consequence
 * *before* committing to it. This function is that visibility.
 *
 * (The mock offers a "new rules only touch future entries" default with an
 * opt-in backfill. That option does not exist here, because it cannot: with
 * classification derived rather than stored, "future only" would require every
 * rule to carry an effective-from date and every past figure to be computed
 * against a different rule set than the present one. The honest trade is a
 * preview instead of a toggle — and a user override always outranks a rule, so
 * a backfill can never overwrite a decision someone actually made.)
 *
 * Implemented by running the real classifier twice rather than by matching the
 * candidate rule directly. A bespoke matcher here would be a second answer to
 * "what does this rule do", and the two would drift — the preview would promise
 * one thing and saving would deliver another. Running the actual chain means the
 * preview is correct by construction, including precedence: a row already
 * claimed by an earlier rule, or pinned by a user override, correctly shows as
 * unaffected.
 */

export interface PreviewedChange {
  readonly transaction: Transaction;
  /** What the row is labelled now. */
  readonly from: CategoryId;
  /** What it would become. Always the candidate rule's category. */
  readonly to: CategoryId;
}

export interface RulePreview {
  /** Rows the candidate rule would claim — the headline count. */
  readonly matchCount: number;
  /** Total value of those rows, so a rule's reach is legible in money too. */
  readonly matchTotal: Paise;
  /**
   * Rows that would move from one *label* to another, as opposed to being
   * labelled for the first time. Separated because they are the ones worth
   * hesitating over: relabelling a row the app already understood is a
   * different act from filling a blank.
   */
  readonly relabelled: readonly PreviewedChange[];
  /** Rows that are unclassified today and would gain a label. */
  readonly newlyLabelled: readonly PreviewedChange[];
}

/**
 * Run `candidate` against the transactions it would apply to.
 *
 * The candidate is evaluated **at its own `order`**, alongside the rules already
 * saved — array position means nothing, because `firstMatch` sorts. A caller
 * previewing a brand-new rule should therefore give it `nextRuleOrder(rules)`,
 * which is where saving would put it: last. Previewing it anywhere else would
 * overstate its reach, since a rule earlier in the order claims a row first and
 * the candidate never sees it.
 */
export function previewRule(
  candidate: Rule,
  transactions: readonly Transaction[],
  ctx: ClassifyContext = EMPTY_CONTEXT,
): RulePreview {
  const before = classifyById(transactions, ctx);
  const after = classifyById(transactions, {
    ...ctx,
    rules: [candidate, ...ctx.rules],
  });

  const relabelled: PreviewedChange[] = [];
  const newlyLabelled: PreviewedChange[] = [];
  let matchCount = 0;
  let matchTotal = 0;

  for (const transaction of transactions) {
    const next = after.get(transaction.id);
    // Only rows the candidate itself claimed count as matches. A row whose
    // label is unchanged, or which changed for some other reason, is not this
    // rule's doing.
    if (next?.ruleId !== candidate.id) continue;

    matchCount++;
    matchTotal += transaction.amount;

    const from = before.get(transaction.id)?.category ?? 'unclassified';
    if (from === next.category) continue;

    const change: PreviewedChange = { transaction, from, to: next.category };
    if (from === 'unclassified') newlyLabelled.push(change);
    else relabelled.push(change);
  }

  return { matchCount, matchTotal, relabelled, newlyLabelled };
}

/**
 * The next free `order` value, so a new rule lands at the end of the list.
 *
 * Sparse by ten. Rules are reordered by dragging, and consecutive integers force
 * a renumber of everything below the insertion point on every move; leaving gaps
 * means an insert is usually a single write.
 */
export function nextRuleOrder(rules: readonly Rule[]): number {
  if (rules.length === 0) return 0;
  return Math.max(...rules.map((rule) => rule.order)) + 10;
}

/**
 * Move `ruleId` to sit immediately before `beforeId` (or last, when null).
 *
 * Returns the rules whose `order` changed, so a caller writes only those. The
 * whole list is renumbered sparsely rather than trying to find a gap: a list of
 * classification rules is tens of items, not thousands, and one predictable
 * rewrite is easier to reason about than a gap search that occasionally fails
 * and needs the rewrite anyway.
 */
export function reorderRules(
  rules: readonly Rule[],
  ruleId: string,
  beforeId: string | null,
): readonly Rule[] {
  const ordered = [...rules].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const moving = ordered.find((rule) => rule.id === ruleId);
  if (moving === undefined) return [];

  const without = ordered.filter((rule) => rule.id !== ruleId);
  const at = beforeId === null ? without.length : without.findIndex((rule) => rule.id === beforeId);
  if (at === -1) return [];

  const previous = new Map(rules.map((rule) => [rule.id, rule.order]));
  return [...without.slice(0, at), moving, ...without.slice(at)]
    .map((rule, index) => ({ ...rule, order: index * 10 }))
    .filter((rule) => previous.get(rule.id) !== rule.order);
}
