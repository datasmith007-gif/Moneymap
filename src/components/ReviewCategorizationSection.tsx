import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORIES,
  categoryApplies,
  categoryLabel,
  type CategoryId,
} from '../enrichment/taxonomy.ts';
import {
  DEFAULT_LABEL_SORT,
  DEFAULT_ROW_SORT,
  filterCategorizationRows,
  groupCategorizationRows,
  sortCategorizationRows,
  type CategorizationReviewFilter,
  type LabelSort,
  type RowSort,
} from '../engine/categorization.ts';
import type { TransactionRegisterRow } from '../engine/transactions.ts';
import { formatAccountLabel } from '../model/accountDisplay.ts';
import { formatIsoDate } from '../model/date.ts';
import { formatPaise } from '../model/money.ts';
import { CategoryOptionGroups } from './CategoryOptionGroups.tsx';
import { InfoTip } from './InfoTip.tsx';
import { SortableHeader } from './SortableHeader.tsx';
import { TransactionCategoryControl } from './TransactionCategoryControl.tsx';

type ReviewView = 'labels' | 'transactions';
const PAGE_SIZE = 10;

interface UndoRow {
  readonly transactionId: string;
  readonly previous: CategoryId | null;
}

interface ActionNotice {
  readonly message: string;
  readonly rows: readonly UndoRow[];
}

/** Filtered, paged categorization workbench used inside the Review center. */
export function ReviewCategorizationSection({
  rows,
  onCategorize,
}: {
  readonly rows: readonly TransactionRegisterRow[] | null;
  readonly onCategorize: (transactionId: string, category: CategoryId | null) => Promise<void>;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocusIndex = useRef<number | null>(null);
  const [view, setView] = useState<ReviewView>('labels');
  const [filter, setFilter] = useState<CategorizationReviewFilter>({});
  const [labelSort, setLabelSort] = useState<LabelSort>(DEFAULT_LABEL_SORT);
  const [rowSort, setRowSort] = useState<RowSort>(DEFAULT_ROW_SORT);
  const [page, setPage] = useState(1);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const completeRows = rows ?? [];
  const filteredRows = useMemo(
    () => filterCategorizationRows(completeRows, filter),
    [completeRows, filter],
  );
  const groups = useMemo(
    () => groupCategorizationRows(filteredRows, labelSort),
    [filteredRows, labelSort],
  );
  const sortedRows = useMemo(
    () => sortCategorizationRows(filteredRows, rowSort),
    [filteredRows, rowSort],
  );
  const accounts = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of completeRows) {
      byId.set(
        row.transaction.accountId,
        formatAccountLabel(row.account.institution, row.account.identifierMasked),
      );
    }
    return [...byId].sort((a, b) => a[1].localeCompare(b[1], 'en-IN', { sensitivity: 'base' }));
  }, [completeRows]);
  const itemCount = view === 'labels' ? groups.length : filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(itemCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visibleGroups = groups.slice(pageStart, pageStart + PAGE_SIZE);
  const visibleRows = sortedRows.slice(pageStart, pageStart + PAGE_SIZE);
  const hasFilters = Boolean(filter.search || filter.accountId || filter.type);

  useEffect(() => {
    if (pendingFocusIndex.current === null) return;
    const controls = rootRef.current?.querySelectorAll<HTMLSelectElement>('.category-select');
    const index = pendingFocusIndex.current;
    pendingFocusIndex.current = null;
    if (controls !== undefined && controls.length > 0) {
      controls[Math.min(index, controls.length - 1)]?.focus();
    } else {
      headingRef.current?.focus();
    }
  }, [filteredRows.length, currentPage, view]);

  function resetPosition() {
    setPage(1);
    setSelectedGroupKey(null);
  }

  function updateFilter(next: CategorizationReviewFilter) {
    setFilter(next);
    resetPosition();
  }

  function rememberFocus() {
    const controls = [
      ...(rootRef.current?.querySelectorAll<HTMLSelectElement>('.category-select') ?? []),
    ];
    const index = controls.findIndex((control) => control === document.activeElement);
    pendingFocusIndex.current = Math.max(0, index);
  }

  async function save(
    key: string,
    targetRows: readonly TransactionRegisterRow[],
    category: CategoryId | null,
    label: string,
  ) {
    rememberFocus();
    setSavingKey(key);
    setError(null);
    const changed: UndoRow[] = [];
    for (const row of targetRows) {
      try {
        await onCategorize(row.transaction.id, category);
        changed.push({
          transactionId: row.transaction.id,
          previous: row.classification.source === 'user' ? row.classification.category : null,
        });
      } catch {
        break;
      }
    }

    if (changed.length > 0) {
      const categoryName = category === null ? 'automatic categorization' : categoryLabel(category);
      const message =
        changed.length === 1
          ? category === null
            ? `Returned ${label} to ${categoryName}.`
            : `Categorized ${label} as ${categoryName}.`
          : `Categorized ${changed.length} ${label} transactions as ${categoryName}.`;
      setNotice({ message, rows: changed });
      setAnnouncement(message);
    }

    if (changed.length !== targetRows.length) {
      const message = `Saved ${changed.length} of ${targetRows.length} transactions. The remaining changes failed.`;
      setError(message);
      setAnnouncement(message);
    }
    setSavingKey(null);
  }

  async function undo() {
    if (notice === null) return;
    setUndoing(true);
    setError(null);
    let restored = 0;
    for (const row of notice.rows) {
      try {
        await onCategorize(row.transactionId, row.previous);
        restored++;
      } catch {
        break;
      }
    }
    if (restored === notice.rows.length) {
      setNotice(null);
      setAnnouncement(
        `Undid categorization for ${restored} transaction${restored === 1 ? '' : 's'}.`,
      );
    } else {
      const message = `Undid ${restored} of ${notice.rows.length} changes. Try again for the rest.`;
      setError(message);
      setAnnouncement(message);
    }
    setUndoing(false);
  }

  function selectView(next: ReviewView) {
    setView(next);
    resetPosition();
  }

  function reorder<Sort>(apply: (sort: Sort) => void): (sort: Sort) => void {
    return (sort) => {
      apply(sort);
      resetPosition();
    };
  }

  return (
    <section ref={rootRef} className="review-section categorization-review">
      <header className="panel-head">
        <h3 ref={headingRef} tabIndex={-1}>
          Categorization review
        </h3>
        {rows !== null && (
          <span className="muted">
            {filteredRows.length} of {rows.length} transactions
          </span>
        )}
        <InfoTip glyph="i" label="How label grouping works">
          Labels combine punctuation-insensitive counterparty or narration text. Group choices apply
          to the matching rows currently shown; use a rule for future imports.
        </InfoTip>
      </header>

      <div className="review-toolbar">
        <div className="review-filters" role="group" aria-label="Review filters">
          <label className="field review-search">
            <span>Search</span>
            <input
              type="search"
              value={filter.search ?? ''}
              placeholder="Counterparty or narration"
              onChange={(event) => updateFilter({ ...filter, search: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Account</span>
            <select
              value={filter.accountId ?? ''}
              onChange={(event) => {
                updateFilter(
                  event.target.value === ''
                    ? omitFilter(filter, 'accountId')
                    : { ...filter, accountId: event.target.value },
                );
              }}
            >
              <option value="">All accounts</option>
              {accounts.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Direction</span>
            <select
              value={filter.type ?? ''}
              onChange={(event) => {
                updateFilter(
                  event.target.value === ''
                    ? omitFilter(filter, 'type')
                    : { ...filter, type: event.target.value as 'debit' | 'credit' },
                );
              }}
            >
              <option value="">Debit and credit</option>
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>
          </label>
          <button
            type="button"
            className="button-tertiary clear-filters"
            disabled={!hasFilters}
            onClick={() => updateFilter({})}
          >
            Clear filters
          </button>
        </div>
        <div className="segmented" role="group" aria-label="Categorization review view">
          <button
            type="button"
            className={view === 'labels' ? 'segment segment-active' : 'segment'}
            aria-pressed={view === 'labels'}
            onClick={() => selectView('labels')}
          >
            By label
          </button>
          <button
            type="button"
            className={view === 'transactions' ? 'segment segment-active' : 'segment'}
            aria-pressed={view === 'transactions'}
            onClick={() => selectView('transactions')}
          >
            Transactions
          </button>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {error !== null && (
        <p className="caveat caveat-warning" role="alert">
          {error}
        </p>
      )}
      {notice !== null && (
        <div className="action-toast">
          <p role="status">{notice.message}</p>
          <button
            type="button"
            className="button-tertiary"
            disabled={undoing}
            onClick={() => void undo()}
          >
            {undoing ? 'Undoing…' : 'Undo'}
          </button>
          <button type="button" className="button-tertiary" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {rows === null ? (
        <p className="empty">Loading transactions…</p>
      ) : rows.length === 0 ? (
        <p className="status status-good">
          <span aria-hidden="true">✓</span> Everything is categorized.
        </p>
      ) : filteredRows.length === 0 ? (
        <p className="empty">No uncategorized transactions match these filters.</p>
      ) : view === 'labels' ? (
        <LabelTable
          groups={visibleGroups}
          sort={labelSort}
          onSort={reorder(setLabelSort)}
          selectedGroupKey={selectedGroupKey}
          savingKey={savingKey}
          onSelectGroup={(key) => setSelectedGroupKey(key === selectedGroupKey ? null : key)}
          onSave={save}
        />
      ) : (
        <div className="table-scroll categorization-table">
          <TransactionReviewTable
            rows={visibleRows}
            savingId={savingKey}
            sort={rowSort}
            onSort={reorder(setRowSort)}
            onCategorize={(row, category) =>
              save(row.transaction.id, [row], category, displayLabel(row))
            }
          />
        </div>
      )}

      {filteredRows.length > 0 && totalPages > 1 && (
        <nav className="pagination" aria-label="Categorization pages">
          <button
            type="button"
            className="button-secondary"
            disabled={currentPage === 1}
            onClick={() => {
              setPage(currentPage - 1);
              setSelectedGroupKey(null);
            }}
          >
            Previous
          </button>
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            className="button-secondary"
            disabled={currentPage === totalPages}
            onClick={() => {
              setPage(currentPage + 1);
              setSelectedGroupKey(null);
            }}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}

function LabelTable({
  groups,
  sort,
  onSort,
  selectedGroupKey,
  savingKey,
  onSelectGroup,
  onSave,
}: {
  readonly groups: ReturnType<typeof groupCategorizationRows>;
  readonly sort: LabelSort;
  readonly onSort: (sort: LabelSort) => void;
  readonly selectedGroupKey: string | null;
  readonly savingKey: string | null;
  readonly onSelectGroup: (key: string) => void;
  readonly onSave: (
    key: string,
    rows: readonly TransactionRegisterRow[],
    category: CategoryId | null,
    label: string,
  ) => Promise<void>;
}) {
  return (
    <div className="table-scroll categorization-table">
      <table className="txns">
        <thead>
          <tr>
            <SortableHeader column="label" sort={sort} onSort={onSort}>
              Label
            </SortableHeader>
            <SortableHeader column="direction" sort={sort} onSort={onSort}>
              Direction
            </SortableHeader>
            <SortableHeader column="occurrences" sort={sort} onSort={onSort} numeric>
              Occurrences
            </SortableHeader>
            <SortableHeader column="total" sort={sort} onSort={onSort} numeric>
              Total
            </SortableHeader>
            <th>Category</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group, index) => {
            const categories = CATEGORIES.filter(
              (category) =>
                category.id === 'unclassified' || categoryApplies(category.id, group.type),
            );
            const selected = selectedGroupKey === group.key;
            const detailId = `review-group-${index}`;
            return (
              <Fragment key={group.key}>
                <tr className={selected ? 'category-row-selected' : undefined}>
                  <td className="narration">
                    {group.rows.length > 1 ? (
                      <button
                        type="button"
                        className="category-toggle"
                        aria-expanded={selected}
                        aria-controls={detailId}
                        onClick={() => onSelectGroup(group.key)}
                      >
                        <span aria-hidden="true">{selected ? '▾' : '▸'}</span> {group.label}
                      </button>
                    ) : (
                      <span className="transaction-party">{group.label}</span>
                    )}
                  </td>
                  <td className="nowrap">{group.type === 'debit' ? 'Debit' : 'Credit'}</td>
                  <td className="num">{group.rows.length}</td>
                  <td className="num nowrap">
                    {group.type === 'debit' ? '−' : '+'}
                    {formatPaise(group.total)}
                  </td>
                  <td>
                    <span className="category-control">
                      <select
                        className="category-select"
                        aria-label={`Category for ${group.label} ${group.type}`}
                        value="unclassified"
                        disabled={savingKey === group.key}
                        onChange={(event) =>
                          void onSave(
                            group.key,
                            group.rows,
                            event.target.value as CategoryId,
                            group.label,
                          )
                        }
                      >
                        <CategoryOptionGroups categories={categories} />
                      </select>
                      <span className="category-meta">
                        Applies to {group.rows.length} transaction
                        {group.rows.length === 1 ? '' : 's'}
                      </span>
                    </span>
                  </td>
                </tr>
                {selected && group.rows.length > 1 && (
                  <tr id={detailId} className="category-inline-row">
                    <td colSpan={5} className="category-inline-cell">
                      <div className="category-drilldown">
                        <header className="panel-head">
                          <h4>{group.label} transactions</h4>
                          <span className="muted">
                            {group.rows.length} transactions with this label
                          </span>
                        </header>
                        <p className="panel-note">
                          The group choice applies to all; choose categories below when the
                          transactions differ.
                        </p>
                        <div className="table-scroll category-inline-table">
                          <TransactionReviewTable
                            rows={group.rows}
                            savingId={savingKey}
                            onCategorize={(row, category) =>
                              onSave(row.transaction.id, [row], category, displayLabel(row))
                            }
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TransactionReviewTable({
  rows,
  savingId,
  sort,
  onSort,
  onCategorize,
}: {
  readonly rows: readonly TransactionRegisterRow[];
  readonly savingId: string | null;
  readonly sort?: RowSort;
  readonly onSort?: (sort: RowSort) => void;
  readonly onCategorize: (
    row: TransactionRegisterRow,
    category: CategoryId | null,
  ) => Promise<void>;
}) {
  return (
    <table className="txns">
      <thead>
        <tr>
          {sort !== undefined && onSort !== undefined ? (
            <>
              <SortableHeader column="date" sort={sort} onSort={onSort}>
                Date
              </SortableHeader>
              <SortableHeader column="transaction" sort={sort} onSort={onSort}>
                Transaction
              </SortableHeader>
              <SortableHeader column="account" sort={sort} onSort={onSort}>
                Account
              </SortableHeader>
              <SortableHeader column="amount" sort={sort} onSort={onSort} numeric>
                Amount
              </SortableHeader>
            </>
          ) : (
            <>
              <th>Date</th>
              <th>Transaction</th>
              <th>Account</th>
              <th className="num">Amount</th>
            </>
          )}
          <th>Category</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.transaction.id}>
            <td className="nowrap">{formatIsoDate(row.transaction.date)}</td>
            <td className="narration" title={row.transaction.description}>
              <span className="transaction-party">{displayLabel(row)}</span>
              {row.classification.counterparty !== null && (
                <span className="transaction-raw">{row.transaction.description}</span>
              )}
            </td>
            <td className="nowrap">
              {formatAccountLabel(row.account.institution, row.account.identifierMasked)}
            </td>
            <td className="num nowrap">
              {row.transaction.type === 'debit' ? '−' : '+'}
              {formatPaise(row.transaction.amount)}
            </td>
            <td>
              <TransactionCategoryControl
                row={row}
                disabled={savingId === row.transaction.id}
                onChange={(category) => onCategorize(row, category)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function displayLabel(row: TransactionRegisterRow): string {
  return row.classification.counterparty ?? row.transaction.description;
}

function omitFilter<Key extends keyof CategorizationReviewFilter>(
  filter: CategorizationReviewFilter,
  key: Key,
): Omit<CategorizationReviewFilter, Key> {
  const next = { ...filter };
  delete next[key];
  return next;
}
