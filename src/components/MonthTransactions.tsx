import type { Transaction } from '../model/canonical.ts';
import type { MonthFlow } from '../engine/aggregate.ts';
import { formatPaise } from '../model/money.ts';
import { formatIsoDate, formatMonth, type MonthKey } from '../model/date.ts';

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
  transactions,
  onClose,
}: {
  readonly month: MonthKey;
  readonly flow: MonthFlow | undefined;
  readonly transactions: readonly Transaction[];
  readonly onClose: () => void;
}) {
  let inflow = 0;
  let outflow = 0;
  for (const txn of transactions) {
    if (txn.type === 'credit') inflow += txn.amount;
    else outflow += txn.amount;
  }
  const matches = flow !== undefined && flow.inflow === inflow && flow.outflow === outflow;

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{formatMonth(month)}</h2>
        <button type="button" className="link" onClick={onClose}>
          Close
        </button>
      </header>

      {transactions.length === 0 ? (
        <p>No transactions in this month.</p>
      ) : (
        <>
          <p className={`verdict-sub ${matches ? 'status-good' : 'status-critical'}`}>
            <span aria-hidden="true">{matches ? '✓' : '!'}</span> these {transactions.length} rows
            sum to {formatPaise(inflow)} in and {formatPaise(outflow)} out
            {matches ? ' — exactly the chart above' : " — which does NOT match the chart above"}
          </p>

          <div className="table-scroll">
            <table className="txns">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Narration</th>
                  <th className="num">Debit</th>
                  <th className="num">Credit</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((txn) => (
                  <tr key={txn.id}>
                    <td className="nowrap">{formatIsoDate(txn.date)}</td>
                    <td className="narration" title={txn.description}>
                      {txn.description}
                    </td>
                    <td className="num">
                      {txn.type === 'debit' ? formatPaise(txn.amount) : ''}
                    </td>
                    <td className="num">
                      {txn.type === 'credit' ? formatPaise(txn.amount) : ''}
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
