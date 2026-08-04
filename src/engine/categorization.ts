import { normalise } from '../enrichment/narration.ts';
import type { Paise, TransactionType } from '../model/canonical.ts';
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

export type CategorizationOrder = 'occurrences' | 'total';

/**
 * Collapse uncategorized rows into frequency-ranked labels.
 *
 * Direction is part of a group because valid categories differ for credits and
 * debits. Keeping it here prevents the UI from accidentally applying a debit
 * category to a credit row that happens to share the same narration.
 */
export function groupCategorizationRows(
  rows: readonly TransactionRegisterRow[],
  orderBy: CategorizationOrder = 'occurrences',
): readonly CategorizationLabelGroup[] {
  const groups = new Map<string, CategorizationLabelGroup>();

  for (const row of rows) {
    const label = (row.classification.counterparty ?? row.transaction.description).trim();
    const normalizedLabel = normalise(label) || label.toLocaleLowerCase('en-IN');
    const key = `${row.transaction.type}\u0000${normalizedLabel}`;
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

  return [...groups.values()].sort((a, b) => {
    const primary = orderBy === 'occurrences' ? b.rows.length - a.rows.length : b.total - a.total;
    const secondary = orderBy === 'occurrences' ? b.total - a.total : b.rows.length - a.rows.length;
    return (
      primary ||
      secondary ||
      a.label.localeCompare(b.label, 'en-IN', { sensitivity: 'base' }) ||
      a.type.localeCompare(b.type)
    );
  });
}
