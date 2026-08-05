import type { Anomaly } from '../engine/anomalies.ts';
import { categoryLabel } from '../enrichment/taxonomy.ts';
import { formatIsoDate } from '../model/date.ts';
import { formatPaise } from '../model/money.ts';

/**
 * Payments far outside what their category normally costs.
 *
 * Renders **nothing** when there is nothing to report — no empty state, no "all
 * clear" box. A panel that is always on screen saying everything is fine is a
 * panel the reader learns to skip, and by the time it has something to say they
 * are no longer looking at it. Its presence is the signal.
 *
 * Every figure here is finished by `anomalies.ts`; this file formats and nothing
 * more. The multiple in particular is computed in the engine, where it is
 * tested, rather than divided in a component where it could not be.
 */
export function AnomalyPanel({ anomalies }: { readonly anomalies: readonly Anomaly[] | null }) {
  if (anomalies === null || anomalies.length === 0) return null;

  return (
    <section className="content-section anomaly-section">
      <header className="panel-head">
        <h2>Unusual spending</h2>
        <span className="muted">
          measured against what each category usually costs you, not a budget
        </span>
      </header>

      <div className="table-scroll">
        <table className="txns">
          <thead>
            <tr>
              <th>Date</th>
              <th>Transaction</th>
              <th>Category</th>
              <th className="num">Amount</th>
              <th>Compared with usual</th>
            </tr>
          </thead>
          <tbody>
            {anomalies.map((anomaly) => (
              <tr key={anomaly.transactionId}>
                <td className="nowrap">{formatIsoDate(anomaly.date)}</td>
                <td className="narration" title={anomaly.description}>
                  <span className="transaction-party">
                    {anomaly.counterparty ?? anomaly.description}
                  </span>
                  {anomaly.counterparty !== null && (
                    <span className="transaction-raw">{anomaly.description}</span>
                  )}
                </td>
                <td className="nowrap">{categoryLabel(anomaly.category)}</td>
                <td className="num nowrap">{formatPaise(anomaly.amount)}</td>
                <td>
                  <span className="anomaly-compare">
                    <span className="anomaly-multiple">
                      {formatMultiple(anomaly.multiple)}× your usual{' '}
                      {categoryLabel(anomaly.category).toLowerCase()}
                    </span>
                    {/*
                      The baseline and its sample size travel with the claim.
                      "6× your usual" resting on eight rows is a very different
                      statement from the same figure resting on ninety, and the
                      reader can only tell if both are shown.
                    */}
                    <span className="anomaly-baseline">
                      usually {formatPaise(anomaly.baseline)}, over {anomaly.sampleSize} payments
                    </span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * One decimal below ten, none above.
 *
 * "1.5×" is a meaningfully different claim from "2×", while "30.4×" pretends to
 * a precision the underlying median does not have.
 */
function formatMultiple(multiple: number): string {
  return multiple < 10 ? multiple.toFixed(1) : String(Math.round(multiple));
}
