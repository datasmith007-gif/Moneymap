import { Fragment, useState } from 'react';
import type { CategoryId } from '../enrichment/taxonomy.ts';
import type { CategoryTotal, ClassificationCoverage } from '../engine/aggregate.ts';
import type { TransactionRegisterRow } from '../engine/transactions.ts';
import { formatAccountLabel } from '../model/accountDisplay.ts';
import { formatIsoDate } from '../model/date.ts';
import { formatPaise } from '../model/money.ts';
import { TransactionCategoryControl } from './TransactionCategoryControl.tsx';

const PERCENT = new Intl.NumberFormat('en-IN', {
  style: 'percent',
  maximumFractionDigits: 0,
});

/**
 * Classified spending plus the overall transaction work still left to review.
 *
 * Category shares use all spend as their denominator in the engine, so this
 * table never makes understood categories look larger merely because some rows
 * are still unclassified.
 */
export function CategoryBreakdownPanel({
  categories,
  coverage,
  selectedCategory,
  rows,
  onSelectCategory,
  onCategorize,
}: {
  readonly categories: readonly CategoryTotal[];
  readonly coverage: ClassificationCoverage;
  readonly selectedCategory: CategoryId | null;
  readonly rows: readonly TransactionRegisterRow[] | null;
  readonly onSelectCategory: (category: CategoryId) => void;
  readonly onCategorize: (transactionId: string, category: CategoryId | null) => Promise<void>;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(transactionId: string, category: CategoryId | null) {
    setSavingId(transactionId);
    setError(null);
    try {
      await onCategorize(transactionId, category);
    } catch {
      setError('The category could not be saved. Try again.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="content-section category-section">
      <header className="panel-head">
        <h2>Spending by category</h2>
        <span className="muted">share of all spend in the selected window</span>
      </header>

      <div className="kpis coverage-kpis">
        <div className="kpi">
          <span className="kpi-label">Categorised transactions</span>
          <span className="kpi-value">{formatCoveragePercent(coverage.countRate)}</span>
          <span className="kpi-range">
            {coverage.classifiedCount} of {coverage.classifiedCount + coverage.unclassifiedCount}{' '}
            transactions
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Categorised amount</span>
          <span className="kpi-value">{formatCoveragePercent(coverage.amountRate)}</span>
          <span className="kpi-range">Share of spending amount with a category</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Needs review</span>
          <span className="kpi-value">{formatPaise(coverage.unclassifiedSpend)}</span>
          <span className="kpi-range">{coverage.unclassifiedCount} transactions overall</span>
        </div>
      </div>

      {categories.length === 0 ? (
        <p className="empty">No categorised spending in this window.</p>
      ) : (
        <div className="table-scroll category-table">
          <table className="txns">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Transactions</th>
                <th className="num">Amount</th>
                <th className="num">Share</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => {
                const isSelected = category.category === selectedCategory;
                return (
                  <Fragment key={category.category}>
                    <tr className={isSelected ? 'category-row-selected' : ''}>
                      <td>
                        <button
                          type="button"
                          className="category-toggle"
                          aria-expanded={isSelected}
                          aria-controls="category-transactions"
                          onClick={() => onSelectCategory(category.category)}
                        >
                          <span aria-hidden="true">{isSelected ? '▾' : '▸'}</span> {category.label}
                        </button>
                      </td>
                      <td className="num">{category.txnCount}</td>
                      <td className="num">{formatPaise(category.total)}</td>
                      <td className="num">{PERCENT.format(category.share)}</td>
                    </tr>
                    {isSelected && (
                      <tr id="category-transactions" className="category-inline-row">
                        <td colSpan={4} className="category-inline-cell">
                          <div className="category-drilldown">
                            <header className="panel-head">
                              <h3>{category.label} transactions</h3>
                              {rows !== null && (
                                <span className="muted">
                                  {rows.length} transaction{rows.length === 1 ? '' : 's'} in this
                                  window
                                </span>
                              )}
                            </header>
                            {error !== null && <p className="caveat caveat-warning">{error}</p>}
                            {rows === null ? (
                              <p className="empty">Loading transactions…</p>
                            ) : rows.length === 0 ? (
                              <p className="empty">No transactions remain in this category.</p>
                            ) : (
                              <div className="table-scroll category-inline-table">
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
                                        <td className="nowrap">
                                          {formatIsoDate(row.transaction.date)}
                                        </td>
                                        <td
                                          className="narration"
                                          title={row.transaction.description}
                                        >
                                          <span className="transaction-party">
                                            {row.classification.counterparty ??
                                              row.transaction.description}
                                          </span>
                                          {row.classification.counterparty !== null && (
                                            <span className="transaction-raw">
                                              {row.transaction.description}
                                            </span>
                                          )}
                                        </td>
                                        <td className="nowrap">
                                          {formatAccountLabel(
                                            row.account.institution,
                                            row.account.identifierMasked,
                                          )}
                                        </td>
                                        <td className="num nowrap">
                                          {formatPaise(row.transaction.amount)}
                                        </td>
                                        <td>
                                          <TransactionCategoryControl
                                            row={row}
                                            disabled={savingId === row.transaction.id}
                                            onChange={(category) =>
                                              save(row.transaction.id, category)
                                            }
                                          />
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
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
      )}
    </section>
  );
}

/** Never round an incomplete set up to the complete-looking `100%`. */
function formatCoveragePercent(rate: number): string {
  if (rate === 1) return '100%';
  if (rate === 0) return '0%';
  const flooredTenths = Math.floor(rate * 1_000) / 10;
  return flooredTenths === 0 ? '<0.1%' : `${flooredTenths.toFixed(1).replace(/\.0$/, '')}%`;
}
