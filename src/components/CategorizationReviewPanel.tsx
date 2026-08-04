import { Fragment, useMemo, useState } from 'react';
import { CATEGORIES, categoryApplies, type CategoryId } from '../enrichment/taxonomy.ts';
import { groupCategorizationRows, type CategorizationOrder } from '../engine/categorization.ts';
import type { TransactionRegisterRow } from '../engine/transactions.ts';
import { formatAccountLabel } from '../model/accountDisplay.ts';
import { formatIsoDate } from '../model/date.ts';
import { formatPaise } from '../model/money.ts';
import { CategoryOptionGroups } from './CategoryOptionGroups.tsx';
import { TransactionCategoryControl } from './TransactionCategoryControl.tsx';

type ReviewView = 'labels' | 'transactions';
const PAGE_SIZE = 10;

/** The complete unclassified set, grouped for speed with exact rows available for inspection. */
export function CategorizationReviewPanel({
  rows,
  onCategorize,
}: {
  readonly rows: readonly TransactionRegisterRow[] | null;
  readonly onCategorize: (transactionId: string, category: CategoryId | null) => Promise<void>;
}) {
  const [view, setView] = useState<ReviewView>('labels');
  const [orderBy, setOrderBy] = useState<CategorizationOrder>('occurrences');
  const [expanded, setExpanded] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => groupCategorizationRows(rows ?? [], orderBy), [rows, orderBy]);
  const itemCount = view === 'labels' ? groups.length : (rows?.length ?? 0);
  const totalPages = Math.max(1, Math.ceil(itemCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visibleGroups = groups.slice(pageStart, pageStart + PAGE_SIZE);
  const visibleRows = rows?.slice(pageStart, pageStart + PAGE_SIZE) ?? [];

  function selectView(next: ReviewView) {
    setView(next);
    setPage(1);
    setSelectedGroupKey(null);
  }

  async function save(key: string, transactionIds: readonly string[], category: CategoryId | null) {
    setSavingKey(key);
    setError(null);
    try {
      // Session writes are intentionally serial. Awaiting each choice also keeps
      // a partial failure honest: successfully updated rows disappear, while
      // untouched rows remain available to retry.
      for (const transactionId of transactionIds) {
        await onCategorize(transactionId, category);
      }
    } catch {
      setError('Some categories could not be saved. Review the remaining rows and try again.');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Categorization review</h2>
        {rows !== null && (
          <span className="muted">
            {rows.length} transaction{rows.length === 1 ? '' : 's'} need a category
          </span>
        )}
        <button
          type="button"
          className="link"
          aria-expanded={expanded}
          aria-controls="categorization-review-content"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Hide review' : 'Show review'}
        </button>
      </header>

      {expanded && (
        <div id="categorization-review-content">
          <div className="categorization-view">
            <p className="panel-note">
              Labels combine punctuation-insensitive counterparty or narration text. Group choices
              apply to current matching rows; use a rule for future imports.
            </p>
            <div className="categorization-controls">
              {view === 'labels' && (
                <label className="categorization-order">
                  <span>Order by</span>
                  <select
                    aria-label="Order labels by"
                    value={orderBy}
                    onChange={(event) => {
                      setOrderBy(event.target.value as CategorizationOrder);
                      setPage(1);
                      setSelectedGroupKey(null);
                    }}
                  >
                    <option value="occurrences">Occurrences</option>
                    <option value="total">Total</option>
                  </select>
                </label>
              )}
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
          </div>

          {error !== null && <p className="caveat caveat-warning">{error}</p>}

          {rows === null ? (
            <p className="empty">Loading transactions…</p>
          ) : rows.length === 0 ? (
            <p className="status status-good">
              <span aria-hidden="true">✓</span> Everything is categorized.
            </p>
          ) : view === 'labels' ? (
            <div className="table-scroll categorization-table">
              <table className="txns">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Direction</th>
                    <th className="num">Occurrences</th>
                    <th className="num">Total</th>
                    <th>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleGroups.map((group) => {
                    const categories = CATEGORIES.filter(
                      (category) =>
                        category.id === 'unclassified' || categoryApplies(category.id, group.type),
                    );
                    const isSelected = selectedGroupKey === group.key;
                    return (
                      <Fragment key={group.key}>
                        <tr className={isSelected ? 'category-row-selected' : ''}>
                          <td className="narration">
                            {group.rows.length > 1 ? (
                              <button
                                type="button"
                                className="category-toggle"
                                aria-expanded={isSelected}
                                aria-controls="categorization-group-transactions"
                                onClick={() => setSelectedGroupKey(isSelected ? null : group.key)}
                              >
                                <span aria-hidden="true">{isSelected ? '▾' : '▸'}</span>{' '}
                                {group.label}
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
                                  void save(
                                    group.key,
                                    group.rows.map((row) => row.transaction.id),
                                    event.target.value as CategoryId,
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
                        {isSelected && group.rows.length > 1 && (
                          <tr
                            id="categorization-group-transactions"
                            className="category-inline-row"
                          >
                            <td colSpan={5} className="category-inline-cell">
                              <div className="category-drilldown">
                                <header className="panel-head">
                                  <h3>{group.label} transactions</h3>
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
                                    onCategorize={(transactionId, category) =>
                                      save(transactionId, [transactionId], category)
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
          ) : (
            <div className="table-scroll categorization-table">
              <TransactionReviewTable
                rows={visibleRows}
                savingId={savingKey}
                onCategorize={(transactionId, category) =>
                  save(transactionId, [transactionId], category)
                }
              />
            </div>
          )}

          {rows !== null && rows.length > 0 && totalPages > 1 && (
            <nav className="pagination" aria-label="Categorization pages">
              <button
                type="button"
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
        </div>
      )}
    </section>
  );
}

/** One exact transaction table shared by the full view and repeated-label drill-downs. */
function TransactionReviewTable({
  rows,
  savingId,
  onCategorize,
}: {
  readonly rows: readonly TransactionRegisterRow[];
  readonly savingId: string | null;
  readonly onCategorize: (transactionId: string, category: CategoryId | null) => Promise<void>;
}) {
  return (
    <table className="txns">
      <thead>
        <tr>
          <th>Date</th>
          <th>Transaction</th>
          <th>Account</th>
          <th className="num">Amount</th>
          <th>Category</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.transaction.id}>
            <td className="nowrap">{formatIsoDate(row.transaction.date)}</td>
            <td className="narration" title={row.transaction.description}>
              <span className="transaction-party">
                {row.classification.counterparty ?? row.transaction.description}
              </span>
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
                onChange={(category) => onCategorize(row.transaction.id, category)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
