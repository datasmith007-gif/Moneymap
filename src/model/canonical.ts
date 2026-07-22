/**
 * Canonical data model — the single schema every source is normalised into
 * (planning doc §6). This file holds only the slice a bank-statement parser
 * populates: `Account` and `Transaction`. `Instrument`, `Holding`, and
 * `Snapshot` are reserved for the non-bank scope and live elsewhere when added.
 *
 * The point of this model is that adding demat/MF/EPF later is *new parsers*,
 * not a schema migration — so the shape here is the general one, even though a
 * bank statement only ever fills the Account/Transaction part of it.
 */

/**
 * Money is stored as an integer count of **paise** (1 INR = 100 paise), never a
 * floating-point rupee value.
 *
 * Why: this is money with financial consequence, and the project constraint is
 * "deterministic where money is involved." Floats make `0.1 + 0.2 !== 0.3`, which
 * would make balance reconciliation (§1.2) fail on correct data. Integers make
 * `opening + credits − debits === closing` exact. Rupees are a display-edge
 * concern only — format to rupees when rendering, never store them.
 */
export type Paise = number;

/** ISO 4217. Only INR today; the type exists so multi-currency is additive. */
export type CurrencyCode = 'INR';

/** The container types from §6. A bank statement only ever produces `savings`
 *  or `current`; the rest are here so the enum is the canonical one. */
export type AccountType =
  | 'savings'
  | 'current'
  | 'demat'
  | 'mf_folio'
  | 'fd'
  | 'epf'
  | 'nps'
  | 'loan'
  | 'credit_card'
  | 'wallet'
  | 'manual_asset';

/** How a record entered the system. Bank statements are always `upload`. */
export type DataSource = 'upload' | 'manual';

/**
 * Traceability back to the exact source row (§6: `source`, `raw_ref`). Every
 * transaction carries this so a wrong figure can always be traced to the line
 * of the statement it came from — the first thing you need when a parser drifts.
 */
export interface Provenance {
  /** Id of the import/statement this row came from. */
  readonly statementId: string;
  /** 1-based page number within the source PDF. */
  readonly page: number;
  /** The raw text of the source line(s), verbatim, before any interpretation. */
  readonly rawLine: string;
}

/** A source container — here, one bank account read from one statement. */
export interface Account {
  readonly id: string;
  readonly type: AccountType;
  /** Bank / AMC / broker name; "self" for manual assets. */
  readonly institution: string;
  /** Masked identifier only — never store a full account number in the clear. */
  readonly identifierMasked: string;
  readonly currency: CurrencyCode;
  /** True for loans and cards; false for a savings/current account. */
  readonly isLiability: boolean;
  readonly source: DataSource;
  /** When this account's data was last refreshed, ISO 8601. */
  readonly lastUpdated: string;
}

/** The kinds of movement a bank statement produces. The wider set (buy, sell,
 *  dividend, …) belongs to instrument-bearing sources and is added with them. */
export type TransactionType = 'credit' | 'debit';

/** A single movement on an account (§6). */
export interface Transaction {
  readonly id: string;
  readonly accountId: string;
  /** Transaction (value) date, ISO 8601 date. */
  readonly date: string;
  readonly type: TransactionType;
  /** Always positive; direction is carried by `type`, not the sign. */
  readonly amount: Paise;
  /** The running balance printed on the statement after this row, if present.
   *  Kept because it is what running-balance-continuity checks (§1.2) verify. */
  readonly balanceAfter: Paise | null;
  /** Free-text narration as printed (UPI/NEFT/ATM strings, cheque refs, …). */
  readonly description: string;
  /**
   * Enrichment fields (Feature 2) — a parser leaves these at their defaults.
   * Present in the type now so enrichment is additive, not a schema change.
   */
  readonly category: string | null;
  readonly counterparty: string | null;
  readonly isInternalTransfer: boolean;
  readonly provenance: Provenance;
}

/**
 * A fully parsed statement: the account plus its transactions and the stated
 * opening/closing balances. This is what a `BankParser` returns and what the
 * (later) reconciliation stage checks before anything is written to the store.
 */
export interface ParsedStatement {
  readonly account: Account;
  readonly transactions: readonly Transaction[];
  /** Opening balance as printed on the statement. */
  readonly openingBalance: Paise;
  /** Closing balance as printed on the statement. */
  readonly closingBalance: Paise;
  /** Statement period, ISO 8601 dates. */
  readonly periodStart: string;
  readonly periodEnd: string;
}
