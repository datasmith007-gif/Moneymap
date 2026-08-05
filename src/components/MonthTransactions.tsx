import { useState } from 'react';
import type { CategoryId } from '../enrichment/taxonomy.ts';
import type { MonthFlow } from '../engine/aggregate.ts';
import type { TransactionRegisterRow } from '../engine/transactions.ts';
import { formatPaise } from '../model/money.ts';
import { formatIsoDate, formatMonth, type MonthKey } from '../model/date.ts';
import { TransactionCategoryControl } from './TransactionCategoryControl.tsx';

/**
 * The transactions behind one month's bar.
 *
 * The panel re-sums the rows it fetched and compares that against the aggregate's
 * figures. **This duplicated arithmetic is deliberate — it is a check, not a
 * second copy of a rule.** The aggregate is computed over the store; this list is
 * fetched from the store; if the two ever disagree, something between them is
 * broken, and the user sees that plainly instead of trusting a wrong bar. It is
 * the acceptance criterion "every number reconciles to the transactions behind
 * it", made visible rather than asserted.
 */
export function MonthTransactions({
  month,
  flow,
  rows,
  onCategorize,
  onClose,
}: {
  readonly month: MonthKey;
  readonly flow: MonthFlow | undefined;
  readonly rows: readonly TransactionRegisterRow[];
  readonly onCategorize: (transactionId: string, category: CategoryId | null) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  let inflow = 0;
  let outflow = 0;
  let countedRows = 0;
  for (const { transaction: txn, classification } of rows) {
    if (classification.isInternalTransfer) continue;
    if (txn.type === 'credit') inflow += txn.amount;
    else outflow += txn.amount;
    countedRows++;
  }
  const matches = flow !== undefined && flow.inflow === inflow && flow.outflow === outflow;

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
    <section className="work-panel month-transactions">
      <header className="panel-head">
        <h2>{formatMonth(month)}</h2>
        <button type="button" className="link" onClick={onClose}>
          Close
        </button>
      </header>

      {rows.length === 0 ? (
        <p>No transactions in this month.</p>
      ) : (
        <>
          <p className={`verdict-sub ${matches ? 'status-good' : 'status-critical'}`}>
            <span aria-hidden="true">{matches ? '✓' : '!'}</span> {countedRows} non-transfer row
            {countedRows === 1 ? '' : 's'} sum to {formatPaise(inflow)} in and{' '}
            {formatPaise(outflow)} out
            {matches ? ' — exactly the chart above' : ' — which does NOT match the chart above'}
          </p>

          {error !== null && <p className="caveat caveat-warning">{error}</p>}

          <div className="table-scroll">
            <table className="txns">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Narration</th>
                  <th className="num">Debit</th>
                  <th className="num">Credit</th>
                  <th>Category</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.transaction.id}>
                    <td className="nowrap">{formatIsoDate(row.transaction.date)}</td>
                    <td className="narration" title={row.transaction.description}>
                      {row.transaction.description}
                    </td>
                    <td className="num">
                      {row.transaction.type === 'debit' ? formatPaise(row.transaction.amount) : ''}
                    </td>
                    <td className="num">
                      {row.transaction.type === 'credit' ? formatPaise(row.transaction.amount) : ''}
                    </td>
                    <td>
                      <TransactionCategoryControl
                        row={row}
                        disabled={savingId === row.transaction.id}
                        onChange={(category) => save(row.transaction.id, category)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
