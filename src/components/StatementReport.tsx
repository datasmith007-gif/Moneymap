import type { ParsedStatement } from '../model/canonical.ts';
import { formatPaise, formatSignedPaise } from '../model/money.ts';
import { TransactionTable } from './TransactionTable.tsx';

/**
 * What a parsed statement claims, in the order you would check it: the account it
 * says it read, the balance arithmetic, anything the parser or the gate flagged,
 * then every row.
 *
 * The headline is deliberately the *closing-balance identity*, not the row count:
 * opening + credits − debits = closing is the one number that proves the parser
 * neither missed nor doubled a row, so it belongs at the top rather than buried
 * in a list of stats.
 */

export interface StatementReportProps {
  readonly statement: ParsedStatement;
  /** Issues from the parser and the reconciliation gate. Empty means it passed. */
  readonly issues: readonly string[];
  readonly fileName: string;
}

/** Display-side totals. Plain summation over integer paise, so it is exact and
 *  carries no rule of its own — the gate remains the authority on pass/fail. */
function totals(statement: ParsedStatement) {
  let credits = 0;
  let debits = 0;
  for (const txn of statement.transactions) {
    if (txn.type === 'credit') credits += txn.amount;
    else debits += txn.amount;
  }
  const computedClosing = statement.openingBalance + credits - debits;
  return { credits, debits, computedClosing, drift: computedClosing - statement.closingBalance };
}

export function StatementReport({ statement, issues, fileName }: StatementReportProps) {
  const { credits, debits, computedClosing, drift } = totals(statement);
  const balances = drift === 0;
  const { account } = statement;

  return (
    <>
      <section className={`panel verdict ${balances ? 'verdict-good' : 'verdict-critical'}`}>
        <p className="verdict-line">
          <span aria-hidden="true" className="verdict-glyph">
            {balances ? '✓' : '!'}
          </span>
          {balances
            ? 'Balances reconcile exactly'
            : `Balances are off by ${formatSignedPaise(drift)}`}
        </p>
        <p className="verdict-sub">
          opening {formatPaise(statement.openingBalance)} + credits {formatPaise(credits)} −
          debits {formatPaise(debits)} = {formatPaise(computedClosing)}, against a printed
          closing balance of {formatPaise(statement.closingBalance)}
        </p>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Account</h2>
          <span className="muted filename">{fileName}</span>
        </header>
        <dl className="facts">
          <div>
            <dt>Institution</dt>
            <dd>{account.institution}</dd>
          </div>
          <div>
            <dt>Account</dt>
            <dd>{account.identifierMasked}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{account.type}</dd>
          </div>
          <div>
            <dt>Period</dt>
            <dd className="nowrap">
              {statement.periodStart} → {statement.periodEnd}
            </dd>
          </div>
          <div>
            <dt>Transactions</dt>
            <dd>{statement.transactions.length}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>{account.currency}</dd>
          </div>
        </dl>
      </section>

      {issues.length > 0 && (
        <section className="panel">
          <header className="panel-head">
            <h2>Flagged for review ({issues.length})</h2>
          </header>
          <ul className="issues">
            {issues.map((issue) => (
              <li key={issue}>
                <span aria-hidden="true" className="issue-glyph">
                  !
                </span>
                {issue}
              </li>
            ))}
          </ul>
        </section>
      )}

      <TransactionTable statement={statement} />
    </>
  );
}
