import type { ParsedStatement } from '../model/canonical.ts';
import type { ParseOutcome } from './outcome.ts';

/**
 * Reconciliation — the data-quality gate (§1.2). A parser turns pixels into
 * numbers; this checks those numbers are internally consistent *before* anything
 * is trusted or persisted. It is the mechanism that catches silent parser drift:
 * a bank tweaks its layout, the parser keeps returning a `parsed` outcome, but the
 * figures no longer add up — and only a reconciliation check turns that into a
 * visible flag rather than a wrong number in the dashboard (planning doc §1.2, and
 * the Project Planner's "these checks are the detection mechanism, not polish").
 *
 * Every check is deterministic integer arithmetic on paise — money is exact, so a
 * correct statement reconciles with zero tolerance and any mismatch is real.
 *
 * The gate never *rewrites* data. A statement that fails is surfaced as
 * `needs_review` with its figures intact, so the user reviews rather than loses
 * them — the same "keep what parsed, flag the problem" contract as a partial parse.
 */

export interface ReconciliationResult {
  /** True when every applicable check passed. */
  readonly ok: boolean;
  /**
   * Human-readable descriptions of each failed check, safe to show and to attach
   * to a `needs_review` outcome. Per the same privacy rule as
   * `NeedsReviewOutcome.issues`, these **never** contain raw amounts or balances —
   * they describe *where* and *what*, referencing dates and row positions only.
   */
  readonly issues: readonly string[];
}

/** Run every reconciliation check over a parsed statement. */
export function reconcile(statement: ParsedStatement): ReconciliationResult {
  const issues: string[] = [];
  checkNonEmpty(statement, issues);
  checkClosingBalance(statement, issues);
  checkRunningBalance(statement, issues);
  checkDateRange(statement, issues);
  return { ok: issues.length === 0, issues };
}

/**
 * Apply the gate to a parse outcome. Outcomes that carry a statement (`parsed`,
 * `needs_review`) are reconciled: a clean `parsed` that fails is downgraded to
 * `needs_review`, and a `needs_review` accumulates the reconciliation issues after
 * its existing ones. Outcomes with no statement (`unsupported`, `unreadable`,
 * `encrypted`) pass through untouched. This is what `parseStatement` composes
 * after the registry, so its `parsed` result means "parsed *and* reconciled".
 */
export function reconcileOutcome(outcome: ParseOutcome): ParseOutcome {
  if (outcome.kind !== 'parsed' && outcome.kind !== 'needs_review') return outcome;

  const result = reconcile(outcome.statement);
  const priorIssues = outcome.kind === 'needs_review' ? outcome.issues : [];
  const issues = [...priorIssues, ...result.issues];
  if (issues.length === 0) return outcome; // clean parse, nothing to flag

  return { kind: 'needs_review', statement: outcome.statement, issues };
}

// ── Checks ──────────────────────────────────────────────────────────────────
//
// Each pushes a privacy-safe message on failure and is otherwise silent. A check
// that cannot run (e.g. no printed balances to compare) is skipped, not failed —
// absence of evidence is not a discrepancy.

/**
 * There is something to reconcile at all. Both current parsers already refuse an
 * empty statement upstream, so this is a defensive belt on the gate itself.
 *
 * Note on transaction *count*: verifying the row count against a total printed on
 * the statement belongs here too, but no parser extracts a stated count yet, so
 * there is nothing to check it against. This non-empty check is today's proxy; a
 * stated-count check slots in here the day a parser surfaces one.
 */
function checkNonEmpty(statement: ParsedStatement, issues: string[]): void {
  if (statement.transactions.length === 0) {
    issues.push('The statement reconciled to no transactions.');
  }
}

/**
 * Balance reconciliation: opening + Σcredits − Σdebits must equal the printed
 * closing balance. This is the headline check — if the transactions as a whole
 * don't bridge the two stated balances, something was missed, doubled, or misread.
 */
function checkClosingBalance(statement: ParsedStatement, issues: string[]): void {
  let net = statement.openingBalance;
  for (const txn of statement.transactions) {
    net += txn.type === 'credit' ? txn.amount : -txn.amount;
  }
  if (net !== statement.closingBalance) {
    issues.push(
      'The statement does not reconcile: the opening balance plus credits minus ' +
        'debits does not equal the printed closing balance.',
    );
  }
}

/**
 * Running-balance continuity: each printed running balance must follow from the
 * previous one and this row's signed amount. Anchoring on consecutive *printed*
 * balances (rather than an accumulated total) localises a break to the row where
 * it happens instead of cascading it through every later row. Rows without a
 * printed balance are skipped — the pair straddling them cannot be verified.
 */
function checkRunningBalance(statement: ParsedStatement, issues: string[]): void {
  const breaks: { index: number; date: string }[] = [];
  let prevBalance: number | null = statement.openingBalance;

  statement.transactions.forEach((txn, index) => {
    if (txn.balanceAfter === null) {
      prevBalance = null; // cannot chain across a missing balance
      return;
    }
    if (prevBalance !== null) {
      const expected = prevBalance + (txn.type === 'credit' ? txn.amount : -txn.amount);
      if (txn.balanceAfter !== expected) breaks.push({ index, date: txn.date });
    }
    prevBalance = txn.balanceAfter;
  });

  if (breaks.length > 0) {
    const first = breaks[0]!;
    const more = breaks.length > 1 ? ` (and ${breaks.length - 1} more)` : '';
    issues.push(
      `The running balance is discontinuous at the ${first.date} transaction ` +
        `(row ${first.index + 1})${more}: the printed balance does not follow from ` +
        'the previous row.',
    );
  }
}

/**
 * Date-range validation: every transaction date falls within the stated period.
 * A date outside the period usually means a misread date or a row grabbed from
 * outside the ledger. ISO dates compare correctly as strings.
 */
function checkDateRange(statement: ParsedStatement, issues: string[]): void {
  const outside = statement.transactions
    .map((txn, index) => ({ index, date: txn.date }))
    .filter(({ date }) => date < statement.periodStart || date > statement.periodEnd);

  if (outside.length > 0) {
    const first = outside[0]!;
    const more = outside.length > 1 ? ` (and ${outside.length - 1} more)` : '';
    issues.push(
      `A transaction falls outside the statement period: the ${first.date} row ` +
        `(row ${first.index + 1})${more}.`,
    );
  }
}
