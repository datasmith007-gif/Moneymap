import { normalise } from '../enrichment/narration.ts';
import type { Paise, TransactionType } from '../model/canonical.ts';
import { formatAccountLabel } from '../model/accountDisplay.ts';
import type { TransactionRegisterRow } from './transactions.ts';

export interface CategorizationLabelGroup {
  /** Stable UI key: normalized label plus movement direction. */
  readonly key: string;
  /** The newest source spelling retained for display. */
  readonly label: string;
  readonly type: TransactionType;
  readonly rows: readonly TransactionRegisterRow[];
  readonly total: Paise;
}

/**
 * Ordering for the review's two tables.
 *
 * Both sorts live here rather than in the component for the reason every
 * ordering in this engine does: a comparator is logic, the test runner only
 * collects `.ts`, and an ordering nobody can test is an ordering that will
 * silently stop being total. Each comparator below ends in the same fixed
 * tie-break chain, so equal values never leave rows free to swap places between
 * renders — which, on a paged table, would move a row the reader was about to
 * click onto another page.
 */
export type SortDirection = 'asc' | 'desc';

export interface ColumnSort<Column extends string> {
  readonly column: Column;
  readonly direction: SortDirection;
}

export type LabelSortColumn = 'label' | 'direction' | 'occurrences' | 'total';
export type LabelSort = ColumnSort<LabelSortColumn>;

export type RowSortColumn = 'date' | 'transaction' | 'account' | 'amount';
export type RowSort = ColumnSort<RowSortColumn>;

/** Most-repeated first: the label queue exists to clear many rows at one click. */
export const DEFAULT_LABEL_SORT: LabelSort = { column: 'occurrences', direction: 'desc' };

/** Oldest first — the order the store already returns rows in, so opening the
 *  exact-row view does not reshuffle what the reader was just looking at. */
export const DEFAULT_ROW_SORT: RowSort = { column: 'date', direction: 'asc' };

const COLLATOR_OPTIONS: Intl.CollatorOptions = { sensitivity: 'base' };

function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'en-IN', COLLATOR_OPTIONS);
}

/**
 * Collapse uncategorized rows into labels, ordered by the chosen column.
 *
 * Direction is part of a group because valid categories differ for credits and
 * debits. Keeping it here prevents the UI from accidentally applying a debit
 * category to a credit row that happens to share the same narration.
 */
export function groupCategorizationRows(
  rows: readonly TransactionRegisterRow[],
  sort: LabelSort = DEFAULT_LABEL_SORT,
): readonly CategorizationLabelGroup[] {
  const groups = new Map<string, CategorizationLabelGroup>();

  for (const row of rows) {
    const label = (row.classification.counterparty ?? row.transaction.description).trim();
    const normalizedLabel = normalise(label) || label.toLocaleLowerCase('en-IN');
    // Separator only has to distinguish the two movement directions, and
    // neither "credit" nor "debit" contains a pipe, so (type, label) maps to
    // a key one-to-one.
    const key = `${row.transaction.type}|${normalizedLabel}`;
    const existing = groups.get(key);

    if (existing === undefined) {
      groups.set(key, {
        key,
        label,
        type: row.transaction.type,
        rows: [row],
        total: row.transaction.amount,
      });
      continue;
    }

    groups.set(key, {
      ...existing,
      rows: [...existing.rows, row],
      total: existing.total + row.transaction.amount,
    });
  }

  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...groups.values()].sort(
    (a, b) =>
      sign * compareLabelGroups(a, b, sort.column) ||
      // The tie-break never flips with direction. A reader reversing one column
      // should see that column reverse and nothing else move.
      compareText(a.label, b.label) ||
      a.type.localeCompare(b.type) ||
      a.key.localeCompare(b.key),
  );
}

function compareLabelGroups(
  a: CategorizationLabelGroup,
  b: CategorizationLabelGroup,
  column: LabelSortColumn,
): number {
  switch (column) {
    case 'label':
      return compareText(a.label, b.label);
    case 'direction':
      return a.type.localeCompare(b.type);
    case 'occurrences':
      return a.rows.length - b.rows.length;
    case 'total':
      return a.total - b.total;
  }
}

/** The same rows, ordered by the chosen column. Does not mutate the input. */
export function sortCategorizationRows(
  rows: readonly TransactionRegisterRow[],
  sort: RowSort = DEFAULT_ROW_SORT,
): readonly TransactionRegisterRow[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort(
    (a, b) =>
      sign * compareRows(a, b, sort.column) ||
      a.transaction.date.localeCompare(b.transaction.date) ||
      a.transaction.id.localeCompare(b.transaction.id),
  );
}

function compareRows(
  a: TransactionRegisterRow,
  b: TransactionRegisterRow,
  column: RowSortColumn,
): number {
  switch (column) {
    case 'date':
      return a.transaction.date.localeCompare(b.transaction.date);
    case 'transaction':
      // Sorted on what the reader can actually see, which is the counterparty
      // when one was extracted and the raw narration otherwise. Sorting the
      // narration underneath would order the column by text that is not in it.
      return compareText(displayLabel(a), displayLabel(b));
    case 'account':
      return compareText(accountLabel(a), accountLabel(b));
    case 'amount':
      return a.transaction.amount - b.transaction.amount;
  }
}

function displayLabel(row: TransactionRegisterRow): string {
  return row.classification.counterparty ?? row.transaction.description;
}

function accountLabel(row: TransactionRegisterRow): string {
  return formatAccountLabel(row.account.institution, row.account.identifierMasked);
}
