import type { ParsedStatement, Transaction } from './canonical.ts';

/**
 * When are two canonical records the same record?
 *
 * This is the one place that answers it, because two very different callers both
 * need the answer and must never disagree: the parsers (which stamp `Account.id`)
 * and the store (which decides what to skip on write). Split across both, a change
 * to the rule in one place would silently start double-counting in the other.
 *
 * All three keys are *content* identity, deliberately distinct from the storage
 * ids the parsers generate. `Transaction.id` stays positional and import-scoped —
 * two genuinely distinct rows can be byte-identical, so a content-derived storage
 * id would collide on exactly the data `transactionKey` exists to handle.
 */

/** Lowercase, drop everything that isn't alphanumeric. Bank names and masked
 *  identifiers vary in spacing and punctuation between statement layouts; the
 *  letters and digits are what actually identify them. */
function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The identity of an account across imports — e.g. `axisbank:xxxxxxxx3458`.
 *
 * Parsers stamp this as `Account.id`. It has to be content-derived: the obvious
 * alternative, an id built from the import's `statementId`, makes the same bank
 * account a *different* account on every upload, which would both double the net
 * position and stop transaction dedup from ever firing.
 *
 * Institution plus masked identifier is the pair a human uses to say "same
 * account", and it is the only stable pair a parser can produce synchronously
 * (`BankParser.parse` is sync, so no async hashing is available). `maskAccount`
 * preserves the original length as X's, so the mask carries both the last four
 * digits and the digit count — enough to separate one person's own accounts.
 *
 * Known limit: two accounts at the same bank with the same length and last four
 * digits collide and would merge. Vanishingly unlikely for one person, and the
 * dashboard names the account on every row so a wrong merge is visible rather
 * than silent.
 */
export function accountKey(institution: string, identifierMasked: string): string {
  return `${norm(institution)}:${norm(identifierMasked)}`;
}

/**
 * The identity of a whole statement, so re-uploading the same PDF is recognised
 * and rejected outright rather than walked row by row.
 *
 * Derived from the statement's own figures rather than a hash of the file bytes:
 * the store never receives bytes (by design — raw statement content must not
 * travel past ingestion), and hashing is async while this must be usable from
 * anywhere. Period plus both balances plus row count is specific enough that two
 * different statements colliding would require the bank to have printed the same
 * period, the same opening and closing balance, and the same number of rows.
 */
export function statementKey(statement: ParsedStatement): string {
  return [
    statement.account.id,
    statement.periodStart,
    statement.periodEnd,
    statement.openingBalance,
    statement.closingBalance,
    statement.transactions.length,
  ].join('|');
}

/**
 * The identity of a single row (feature §1.3's composite key), used to skip rows
 * an earlier statement already contributed when two periods overlap.
 *
 * The spec's tuple names a reference number; neither parser extracts one (both
 * fold the Chq/MODE column into the narration), so `balanceAfter` carries that
 * role — and it is a strong discriminator, since two distinct movements almost
 * never land on the same running balance. `type` is included beyond the spec
 * tuple because our `amount` is unsigned and direction lives in `type`; without
 * it a ₹500 credit and a ₹500 debit on the same day with the same narration
 * would collide and one would be dropped.
 *
 * `occurrence` is the subtle part. A statement can legitimately contain two
 * identical rows — two ₹50 UPI payments to the same payee on the same day, on a
 * bank that prints no running balance. Keying on the tuple alone collapses them
 * and *understates spend*, which is the kind of wrong number nobody notices.
 * Numbering occurrences within the source statement keeps both, and because a
 * re-import produces the same two occurrences, both still dedupe against it.
 * Net effect: duplicates *within* one statement are kept, duplicates *across*
 * statements are dropped.
 *
 * A missing `balanceAfter` keys as its own token rather than being omitted, so a
 * balance-less row can only ever match another balance-less row. That
 * under-dedupes rather than over-dedupes — the right direction, because a visible
 * duplicate is recoverable and a silently dropped transaction is not.
 */
export function transactionKey(txn: Transaction, occurrence: number): string {
  return [
    txn.accountId,
    txn.date,
    txn.type,
    txn.amount,
    txn.balanceAfter ?? 'none',
    norm(txn.description),
    occurrence,
  ].join('|');
}
