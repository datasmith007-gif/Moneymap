import type { Account, Paise, Transaction } from '../model/canonical.ts';
import { classifyById, EMPTY_CONTEXT, type ClassifyContext } from '../enrichment/classify.ts';
import { normalise } from '../enrichment/narration.ts';
import { categoryLabel, type CategoryId } from '../enrichment/taxonomy.ts';
import type { Classification } from '../enrichment/types.ts';
import type { ImportRecord, Store } from '../storage/store.ts';

/** Filters shared by the on-screen register and its export. */
export interface TransactionFilter {
  readonly accountId?: string;
  /** Inclusive ISO-date bounds. */
  readonly from?: string;
  readonly to?: string;
  /** Case- and punctuation-insensitive narration/counterparty search. */
  readonly search?: string;
  readonly category?: CategoryId;
}

export interface TransactionRegisterQuery extends TransactionFilter {
  /** One-based. Defaults to 1. */
  readonly page?: number;
  /** Defaults to 50; capped at 200 so a UI cannot accidentally render the store. */
  readonly pageSize?: number;
}

export interface TransactionAccount {
  readonly institution: string;
  readonly identifierMasked: string;
}

/** A source row with the two pieces of derived/display context the register needs. */
export interface TransactionRegisterRow {
  readonly transaction: Transaction;
  readonly classification: Classification;
  readonly account: TransactionAccount;
}

export interface TransactionRegisterPage {
  readonly rows: readonly TransactionRegisterRow[];
  readonly totalRows: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

export interface TransactionRegisterInput {
  readonly accounts: readonly Account[];
  /** The complete imported horizon, not a pre-filtered subset. */
  readonly transactions: readonly Transaction[];
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Build one register page from canonical rows.
 *
 * Classification deliberately precedes every filter. Transfer detection is a
 * relationship across accounts and dates, so filtering the input first could
 * change a row's category merely because the user narrowed the register.
 */
export function buildTransactionRegister(
  input: TransactionRegisterInput,
  query: TransactionRegisterQuery = {},
  context: ClassifyContext = EMPTY_CONTEXT,
): TransactionRegisterPage {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  validatePaging(page, pageSize);

  const rows = matchingRows(input, query, context);
  const offset = (page - 1) * pageSize;
  return {
    rows: rows.slice(offset, offset + pageSize),
    totalRows: rows.length,
    page,
    pageSize,
    totalPages: Math.ceil(rows.length / pageSize),
  };
}

/** Read the store's complete imported horizon, enrich it once, then query it. */
export async function loadTransactionRegister(
  store: Store,
  query: TransactionRegisterQuery = {},
): Promise<TransactionRegisterPage> {
  const { input, context } = await loadUniverse(store);
  return buildTransactionRegister(input, query, context);
}

const CSV_HEADERS = [
  'date',
  'institution',
  'account',
  'transaction_id',
  'type',
  'description',
  'counterparty',
  'category_id',
  'category',
  'amount_inr',
  'balance_after_inr',
  'statement_id',
  'source_page',
] as const;

/**
 * Export every matching row in the register's deterministic order.
 *
 * This module owns both filtering and serialization so the downloaded set
 * cannot drift from the register semantics. Paging is absent from the interface
 * on purpose: an export is the full filtered result, never just the visible page.
 */
export function buildTransactionCsv(
  input: TransactionRegisterInput,
  filter: TransactionFilter = {},
  context: ClassifyContext = EMPTY_CONTEXT,
): string {
  const lines = [CSV_HEADERS.join(',')];

  for (const row of matchingRows(input, filter, context)) {
    const { transaction, classification, account } = row;
    const fields = [
      transaction.date,
      safeText(account.institution),
      safeText(account.identifierMasked),
      safeText(transaction.id),
      transaction.type,
      safeText(transaction.description),
      safeText(classification.counterparty ?? ''),
      classification.category,
      safeText(categoryLabel(classification.category)),
      decimalInr(transaction.amount),
      transaction.balanceAfter === null ? '' : decimalInr(transaction.balanceAfter),
      safeText(transaction.provenance.statementId),
      String(transaction.provenance.page),
    ];
    lines.push(fields.map(quoteCsv).join(','));
  }

  // The BOM makes UTF-8 explicit to spreadsheet applications; CRLF and a final
  // newline make the byte sequence stable across operating systems.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export async function loadTransactionCsv(
  store: Store,
  filter: TransactionFilter = {},
): Promise<string> {
  const { input, context } = await loadUniverse(store);
  return buildTransactionCsv(input, filter, context);
}

function matchingRows(
  input: TransactionRegisterInput,
  filter: TransactionFilter,
  context: ClassifyContext,
): TransactionRegisterRow[] {
  const classifications = classifyById(input.transactions, context);
  const accounts = new Map(input.accounts.map((account) => [account.id, account]));
  const needle = normalise(filter.search ?? '');
  const rows: TransactionRegisterRow[] = [];

  for (const transaction of input.transactions) {
    const classification = classifications.get(transaction.id);
    if (classification === undefined) {
      throw new Error(`Missing classification for transaction ${transaction.id}`);
    }
    const account = accounts.get(transaction.accountId);
    if (account === undefined) {
      throw new Error(`Missing account ${transaction.accountId} for transaction ${transaction.id}`);
    }

    if (filter.accountId !== undefined && transaction.accountId !== filter.accountId) continue;
    if (filter.from !== undefined && transaction.date < filter.from) continue;
    if (filter.to !== undefined && transaction.date > filter.to) continue;
    if (filter.category !== undefined && classification.category !== filter.category) continue;
    if (
      needle !== '' &&
      !normalise(transaction.description).includes(needle) &&
      !normalise(classification.counterparty ?? '').includes(needle)
    ) {
      continue;
    }

    rows.push({
      transaction,
      classification,
      account: {
        institution: account.institution,
        identifierMasked: account.identifierMasked,
      },
    });
  }

  rows.sort(
    (a, b) =>
      b.transaction.date.localeCompare(a.transaction.date) ||
      a.transaction.accountId.localeCompare(b.transaction.accountId) ||
      a.transaction.id.localeCompare(b.transaction.id),
  );
  return rows;
}

function validatePaging(page: number, pageSize: number): void {
  if (!Number.isInteger(page) || page <= 0) {
    throw new RangeError(`page must be a positive integer, got ${page}`);
  }
  if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > MAX_PAGE_SIZE) {
    throw new RangeError(
      `pageSize must be a positive integer no greater than ${MAX_PAGE_SIZE}, got ${pageSize}`,
    );
  }
}

async function loadUniverse(
  store: Store,
): Promise<{ readonly input: TransactionRegisterInput; readonly context: ClassifyContext }> {
  const [accounts, imports, rules, overrides] = await Promise.all([
    store.listAccounts(),
    store.listImports(),
    store.listRules(),
    store.listOverrides(),
  ]);

  const horizon = importHorizon(imports);
  const transactions =
    horizon === null ? [] : await store.listTransactions({ from: horizon.from, to: horizon.to });

  return {
    input: { accounts, transactions },
    context: { rules, overrides },
  };
}

function importHorizon(
  imports: readonly ImportRecord[],
): { readonly from: string; readonly to: string } | null {
  if (imports.length === 0) return null;
  let from = imports[0]!.periodStart;
  let to = imports[0]!.periodEnd;
  for (const record of imports) {
    if (record.periodStart < from) from = record.periodStart;
    if (record.periodEnd > to) to = record.periodEnd;
  }
  return { from, to };
}

/** Integer paise to an ungrouped, exact decimal string. */
function decimalInr(paise: Paise): string {
  const magnitude = Math.abs(paise);
  const whole = Math.trunc(magnitude / 100);
  const fraction = String(magnitude % 100).padStart(2, '0');
  return `${paise < 0 ? '-' : ''}${whole}.${fraction}`;
}

/** Prevent spreadsheet software from interpreting source text as a formula. */
function safeText(value: string): string {
  return /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function quoteCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
