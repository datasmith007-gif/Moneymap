import type { Account } from '../model/canonical.ts';
import type { ImportRecord } from '../storage/store.ts';
import { formatPaise } from '../model/money.ts';
import { formatIsoDate } from '../model/date.ts';

/**
 * Everything imported this session, newest first.
 *
 * The import screen is a single-statement validation surface: it shows one
 * parse in full and then, on "Import another statement", forgets it. That made
 * the store look like it only held the latest upload, when in fact every
 * statement was still there and counted — the figures were right and the screen
 * simply could not say so.
 *
 * This panel is the memory. It reads `session.imports`, which has been
 * accumulating all along, so it introduces no new source of truth and cannot
 * disagree with the dashboard.
 *
 * Note the two counts per row. `transactionsImported` is what this statement
 * contributed; `transactionsSkipped` is what an earlier, overlapping statement
 * had already contributed. A user importing Jan–Mar and then Feb–Apr needs to
 * see that February was not counted twice, and this is the only place that says
 * so after the fact.
 */
export function ImportedList({
  imports,
  accounts,
}: {
  readonly imports: readonly ImportRecord[];
  readonly accounts: readonly Account[];
}) {
  if (imports.length === 0) return null;

  const byId = new Map(accounts.map((account) => [account.id, account]));
  const rows = [...imports].reverse();
  const totalRows = imports.reduce((sum, record) => sum + record.transactionsImported, 0);
  const accountCount = new Set(imports.map((record) => record.accountId)).size;

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Imported so far</h2>
        <span className="muted">
          {imports.length} statement{imports.length === 1 ? '' : 's'} · {accountCount} account
          {accountCount === 1 ? '' : 's'} · {totalRows} transaction{totalRows === 1 ? '' : 's'}
        </span>
      </header>

      <div className="table-scroll">
        <table className="txns">
          <thead>
            <tr>
              <th>File</th>
              <th>Account</th>
              <th>Period</th>
              <th className="num">Closing</th>
              <th className="num">Rows</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((record) => {
              const account = byId.get(record.accountId);
              return (
                <tr key={record.statementId}>
                  <td className="narration">{record.fileName}</td>
                  <td className="nowrap">
                    {account ? `${account.institution} ${account.identifierMasked}` : record.accountId}
                  </td>
                  <td className="nowrap">
                    {formatIsoDate(record.periodStart)} – {formatIsoDate(record.periodEnd)}
                  </td>
                  <td className="num nowrap">{formatPaise(record.closingBalance)}</td>
                  <td className="num nowrap">
                    {record.transactionsImported}
                    {record.transactionsSkipped > 0 && (
                      <span className="muted"> +{record.transactionsSkipped} dup</span>
                    )}
                  </td>
                  <td className="nowrap">
                    {record.issues.length > 0 ? (
                      <span title={record.issues.join(' ')}>Flagged</span>
                    ) : (
                      <span className="muted">Clean</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
