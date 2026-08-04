import type { AccountCoverage } from '../engine/coverage.ts';
import { formatAccountLabel } from '../model/accountDisplay.ts';
import { formatIsoDate } from '../model/date.ts';

/** Exact statement periods and the internal holes an account still needs filled. */
export function AccountCoveragePanel({
  accounts,
}: {
  readonly accounts: readonly AccountCoverage[];
}) {
  if (accounts.length === 0) return null;

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Statement coverage</h2>
        <span className="muted">gaps inside each account&rsquo;s imported history</span>
      </header>

      <div className="table-scroll">
        <table className="txns">
          <thead>
            <tr>
              <th>Account</th>
              <th>Observed period</th>
              <th>Missing periods</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.accountId}>
                <td className="nowrap">
                  {formatAccountLabel(account.institution, account.identifierMasked)}
                </td>
                <td className="nowrap">
                  {formatIsoDate(account.coverageStart)} – {formatIsoDate(account.coverageEnd)}
                </td>
                <td>
                  {account.gaps.length === 0 ? (
                    <span className="status status-good">
                      <span aria-hidden="true">✓</span> no internal gaps
                    </span>
                  ) : (
                    <span className="gap-list">
                      {account.gaps.map((gap) => (
                        <span key={`${gap.from}:${gap.to}`} className="status status-critical">
                          <span aria-hidden="true">!</span> {formatIsoDate(gap.from)} –{' '}
                          {formatIsoDate(gap.to)}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
