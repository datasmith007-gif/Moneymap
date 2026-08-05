import type { Averages, WindowStat } from '../engine/aggregate.ts';
import { formatPaise } from '../model/money.ts';

/**
 * Average monthly income, spend, and savings.
 *
 * Each tile shows the mean and nothing else. Range and standard deviation used
 * to sit under every mean; they are dispersion analysis, not the headline this
 * panel exists to give, and three extra figures per tile made the four tiles
 * read as a table to be studied rather than a row to be scanned. If dispersion
 * comes back it belongs in a view of its own.
 *
 * The tiles are **not** an equation. Each mean is rounded independently, so
 * income − spend can differ from savings by a paise, and savings is computed from
 * the monthly nets rather than derived from the other two. Laying them out as a
 * row of separate statistics rather than a sum keeps that honest.
 *
 * What is *excluded* from these averages — partly covered months, short windows —
 * is not printed here. It is collected with every other standing caveat in
 * `DashboardNotices`, so the reader has one place to look rather than one
 * footnote per panel.
 */
export function AveragesPanel({
  averages,
  savingsRate,
}: {
  readonly averages: Averages;
  readonly savingsRate: number | null;
}) {
  const months = averages.monthsCounted.length;

  if (months === 0) {
    return (
      <section className="panel">
        <header className="panel-head">
          <h2>Monthly averages</h2>
        </header>
        <p>
          No month in this window is fully covered by the statements you&rsquo;ve imported, so there
          is nothing to average yet. Import a statement spanning a whole month.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Monthly averages</h2>
        <span className="muted">
          over {months} full month{months === 1 ? '' : 's'}
        </span>
      </header>

      <div className="kpis">
        <Kpi label="Average income" stat={averages.income} />
        <Kpi label="Average spend" stat={averages.spend} />
        <Kpi label="Average savings" stat={averages.savings} />
        <div className="kpi">
          <span className="kpi-label">Savings rate</span>
          <span className="kpi-value">
            {savingsRate === null ? '—' : PERCENT.format(savingsRate)}
          </span>
          <span className="kpi-range">
            {savingsRate === null ? 'No recorded income' : 'Savings as a share of income'}
          </span>
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, stat }: { readonly label: string; readonly stat: WindowStat }) {
  // No inflation marker any more: transfers between the user's own accounts are
  // detected and excluded before these figures are computed, so the "~" this
  // tile used to carry would now be claiming a distortion that isn't there.
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{formatPaise(stat.mean)}</span>
    </div>
  );
}

const PERCENT = new Intl.NumberFormat('en-IN', {
  style: 'percent',
  maximumFractionDigits: 0,
});
