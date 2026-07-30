import { useMemo, useState } from 'react';
import type { ParsedStatement } from '../model/canonical.ts';
import { formatPaise, formatSignedPaise } from '../model/money.ts';
import { runningBalanceBreaks } from '../ingestion/reconcile.ts';

/**
 * Every parsed row, laid out so a human can check it against the PDF side by side:
 * same order, same columns, same figures. This is the point of the import screen —
 * the parser's own confidence is not evidence, so the numbers are shown in full
 * rather than summarised.
 *
 * The per-row balance verdict comes from `runningBalanceBreaks`, the same function
 * the reconciliation gate uses. Recomputing it here would put a money rule in two
 * places and let the table and the gate disagree.
 */

export function TransactionTable({ statement }: { statement: ParsedStatement }) {
  const [onlyProblems, setOnlyProblems] = useState(false);

  const breaks = useMemo(() => runningBalanceBreaks(statement), [statement]);
  const breakByIndex = useMemo(
    () => new Map(breaks.map((b) => [b.index, b] as const)),
    [breaks],
  );

  const rows = statement.transactions
    .map((txn, index) => ({ txn, index }))
    .filter(({ index }) => !onlyProblems || breakByIndex.has(index));

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Transactions</h2>
        {/* With no breaks there is nothing to filter down to, and a disabled
            checkbox reads as a broken one — so say what the state actually is. */}
        {breaks.length === 0 ? (
          <span className="toggle status status-good">
            <span aria-hidden="true">✓</span> all {statement.transactions.length} rows follow the
            running balance
          </span>
        ) : (
          <label className="toggle">
            <input
              type="checkbox"
              checked={onlyProblems}
              onChange={(e) => setOnlyProblems(e.target.checked)}
            />
            Only the {breaks.length} row{breaks.length === 1 ? '' : 's'} that don&rsquo;t reconcile
          </label>
        )}
      </header>

      <div className="table-scroll">
        <table className="txns">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Date</th>
              <th>Narration</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
              <th className="num">Balance</th>
              <th>Check</th>
              {/* Which page of the source PDF this row came from — the fastest way
                  to find it in the original when a figure looks wrong. */}
              <th className="num">Page</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ txn, index }) => {
              const broken = breakByIndex.get(index);
              return (
                <tr key={txn.id} className={broken ? 'row-break' : undefined}>
                  <td className="num muted">{index + 1}</td>
                  <td className="nowrap">{txn.date}</td>
                  <td className="narration" title={txn.description}>
                    {txn.description}
                  </td>
                  <td className="num">{txn.type === 'debit' ? formatPaise(txn.amount) : ''}</td>
                  <td className="num">{txn.type === 'credit' ? formatPaise(txn.amount) : ''}</td>
                  <td className="num">
                    {txn.balanceAfter === null ? (
                      <span className="muted">none</span>
                    ) : (
                      formatPaise(txn.balanceAfter)
                    )}
                  </td>
                  <td className="nowrap">
                    {broken ? (
                      <span className="status status-critical">
                        <span aria-hidden="true">!</span> off by{' '}
                        {formatSignedPaise(broken.printed - broken.expected)}
                      </span>
                    ) : txn.balanceAfter === null ? (
                      <span className="muted">not checked</span>
                    ) : (
                      <span className="status status-good">
                        <span aria-hidden="true">✓</span> follows
                      </span>
                    )}
                  </td>
                  <td className="num muted">{txn.provenance.page}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && <p className="empty">No rows to show.</p>}
    </section>
  );
}
