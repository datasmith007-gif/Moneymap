import type { Account, Paise, ParsedStatement, Transaction } from '../model/canonical.ts';

/**
 * The storage seam (planning doc §5.1, overview "Storage Adapter"). Every feature
 * reads and writes through this interface; nothing above it may know whether — or
 * where — data persists. V1 is in-memory and session-scoped, V2 is SQLite over
 * OPFS, and the point of the seam is that swapping them is additive.
 *
 * Three commitments the shape encodes:
 *
 *  - **Every method is async**, even though the V1 adapter answers instantly.
 *    OPFS access is async, so a sync V1 would make the V2 swap a rewrite of every
 *    caller — exactly what this interface exists to prevent.
 *  - **The store never receives file bytes**, only parsed canonical entities. Raw
 *    statement content must not travel past ingestion, and a type that cannot
 *    carry it cannot leak it.
 *  - **Writes are not concurrency-safe.** Two overlapping `putStatement` calls
 *    would race on "is this row already here?", making the new/duplicate split
 *    nondeterministic — and money must be deterministic. Callers serialise.
 */
export interface Store {
  /**
   * Record one reconciled statement, adding only what this account does not
   * already have.
   *
   * Idempotent by content, not by id: re-importing the same PDF is recognised and
   * rejected whole, and an overlapping period contributes only its new rows. A
   * caller cannot cause a double-count by importing twice or out of order.
   */
  putStatement(statement: ParsedStatement, meta: ImportMeta): Promise<ImportSummary>;

  /** Every accepted import, in the order it was written. */
  listImports(): Promise<readonly ImportRecord[]>;

  /** Every distinct account seen, keyed by the stable `accountKey`. */
  listAccounts(): Promise<readonly Account[]>;

  /**
   * Deduped rows matching `query`, ordered by (date, accountId, id) — a stable
   * total order, so any aggregate computed over them is reproducible.
   */
  listTransactions(query: TransactionQuery): Promise<readonly Transaction[]>;

  /** Drop everything. The session's "start over". */
  clear(): Promise<void>;
}

/** What the caller knows about an import that the statement itself doesn't carry. */
export interface ImportMeta {
  readonly statementId: string;
  readonly fileName: string;
  /** ISO 8601 instant. Injected rather than read from the clock inside the
   *  adapter, so tests can assert whole records. */
  readonly importedAt: string;
  /** Parser and reconciliation-gate issues. Non-empty means figures drawn from
   *  this statement are shown with a warning wherever they surface. */
  readonly issues: readonly string[];
}

/**
 * One accepted import.
 *
 * Not a log line — this is the raw material of the net-position and coverage
 * maths. The period says which months an account actually covers (which is how
 * a partial month is detected), and the closing balance is the bank's own
 * assertion of where the account stood, which the engine must never re-derive.
 */
export interface ImportRecord {
  readonly statementId: string;
  /** The stable `accountKey`, not a per-import id. */
  readonly accountId: string;
  readonly fileName: string;
  readonly importedAt: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly openingBalance: Paise;
  readonly closingBalance: Paise;
  readonly transactionsImported: number;
  /** Rows suppressed because an earlier import already contributed them. */
  readonly transactionsSkipped: number;
  readonly issues: readonly string[];
}

/**
 * The result of a write. A duplicate is a normal outcome rather than an error —
 * the same contract as `ParseOutcome`: expected failures are values the caller
 * switches on, not exceptions.
 */
export type ImportSummary =
  | { readonly kind: 'imported'; readonly record: ImportRecord }
  | { readonly kind: 'duplicate_statement'; readonly existing: ImportRecord };

/**
 * Inclusive ISO-date bounds, both optional.
 *
 * The range exists in the interface from the start because the V2 adapter needs
 * it: an unbounded scan is free over a `Map` and expensive over SQLite/OPFS. The
 * rule that goes with it — the engine never queries without a range — is cheap to
 * follow now and painful to retrofit.
 */
export interface TransactionQuery {
  readonly accountId?: string;
  readonly from?: string;
  readonly to?: string;
}
