import type { NetPosition } from '../engine/aggregate.ts';
import { formatPaise } from '../model/money.ts';
import { formatIsoDate } from '../model/date.ts';
import { formatAccountLabel } from '../model/accountDisplay.ts';

/**
 * Total across accounts, and the per-account balances behind it.
 *
 * The "as of" date is not decoration — it is the whole reason this panel is
 * trustworthy. The headline carries the *oldest* account's date, because a sum of
 * balances taken on different days is only true as of the earliest one, and an
 * account whose statement predates the selected window is marked rather than
 * quietly folded in.
 */
export function NetPositionPanel({ position }: { readonly position: NetPosition }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Net position</h2>
        {position.asOf !== position.newestAsOf && (
          <span className="muted">newest statement {formatIsoDate(position.newestAsOf)}</span>
        )}
      </header>

      <p className="hero">{formatPaise(position.total)}</p>
      <p className="hero-sub">
        as of {formatIsoDate(position.asOf)}
        {position.asOf !== position.newestAsOf && ' — the oldest statement in the total'}
      </p>

      <div className="table-scroll">
        <table className="txns">
          <thead>
            <tr>
              <th>Account</th>
              <th className="num">Balance</th>
              <th>As of</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {position.accounts.map((account) => (
              <tr key={account.accountId}>
                <td className="nowrap">
                  {formatAccountLabel(account.institution, account.identifierMasked)}
                </td>
                <td className="num">{formatPaise(account.balance)}</td>
                <td className="nowrap">{formatIsoDate(account.asOf)}</td>
                <td className="nowrap">
                  <span className="status-list">
                    {account.monthsBehind === 0 ? (
                      <span className="status status-good">
                        <span aria-hidden="true">✓</span> current
                      </span>
                    ) : (
                      <span className={`status ${account.staleForWindow ? 'status-critical' : ''}`}>
                        <span aria-hidden="true">{account.staleForWindow ? '!' : 'i'}</span>{' '}
                        {account.monthsBehind} month{account.monthsBehind === 1 ? '' : 's'} behind
                      </span>
                    )}
                    {account.hasFlaggedStatements && (
                      <span className="status status-critical">
                        <span aria-hidden="true">!</span> flagged on import
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {position.excluded.length > 0 && (
        <p className="caveat">
          {position.excluded.length} account
          {position.excluded.length === 1 ? ' is' : 's are'} not in rupees and{' '}
          {position.excluded.length === 1 ? 'is' : 'are'} left out of this total.
        </p>
      )}
    </section>
  );
}
