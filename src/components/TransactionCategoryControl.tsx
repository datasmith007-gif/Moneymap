import type { CategoryId } from '../enrichment/taxonomy.ts';
import { CATEGORIES, categoryApplies } from '../enrichment/taxonomy.ts';
import type { TransactionRegisterRow } from '../engine/transactions.ts';
import { CategoryOptionGroups } from './CategoryOptionGroups.tsx';

const PERCENT = new Intl.NumberFormat('en-IN', {
  style: 'percent',
  maximumFractionDigits: 0,
});

/**
 * One transaction's category, including how it was chosen and the escape hatch
 * from a manual override back to deterministic classification.
 */
export function TransactionCategoryControl({
  row,
  disabled = false,
  onChange,
}: {
  readonly row: TransactionRegisterRow;
  readonly disabled?: boolean;
  readonly onChange: (category: CategoryId | null) => void | Promise<void>;
}) {
  const applicable = CATEGORIES.filter(
    (category) =>
      category.id === row.classification.category ||
      categoryApplies(category.id, row.transaction.type),
  );

  return (
    <span className="category-control">
      <select
        className="category-select"
        aria-label={`Category for ${row.transaction.description}`}
        value={row.classification.category}
        disabled={disabled}
        onChange={(event) => void onChange(event.target.value as CategoryId)}
      >
        <CategoryOptionGroups categories={applicable} />
      </select>
      <span className="category-meta">{classificationLabel(row)}</span>
      {row.classification.source === 'user' && (
        <button
          type="button"
          className="category-clear"
          disabled={disabled}
          onClick={() => void onChange(null)}
        >
          Use automatic
        </button>
      )}
    </span>
  );
}

function classificationLabel(row: TransactionRegisterRow): string {
  const { classification } = row;
  switch (classification.source) {
    case 'user':
      return 'Manual choice';
    case 'user_rule':
      return `Your rule · ${PERCENT.format(classification.confidence)}`;
    case 'shipped_rule':
      return `Automatic · ${PERCENT.format(classification.confidence)}`;
    case 'transfer':
      return 'Matched transfer';
    case 'none':
      return 'Needs category';
  }
}
