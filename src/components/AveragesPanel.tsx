import type { Averages, Caveat, WindowStat } from '../engine/aggregate.ts';
import { formatPaise } from '../model/money.ts';
import { formatMonth } from '../model/date.ts';

/**
 * Average monthly income, spend, and savings — each with the range behind it.
 *
 * The range is shown beside every mean because a ₹40k average hides a ₹10k–₹90k
 * swing, and the mean alone invites the reader to treat it as a typical month.
 * Min and max are exact integers; the mean is the one rounded figure here.
 *
 * The three tiles are **not** an equation. Each mean is rounded independently, so
 * income − spend can differ from savings by a paise, and savings is computed from
 * the monthly nets rather than derived from the other two. Laying them out as a
 * row of separate statistics rather than a sum keeps that honest.
 */
export function AveragesPanel({
  averages,
  caveats,
}: {
  readonly averages: Averages;
  readonly caveats: readonly Caveat[];
}) {
  const months = averages.monthsCounted.length;

  if (months === 0) {
    return (
      <section className="panel">
        <header className="panel-head">
          <h2>Monthly averages</h2>
        </header>
        <p>
          No month in this window is fully covered by the statements you&rsquo;ve imported, so
          there is nothing to average yet. Import a statement spanning a whole month.
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
        <Kpi label="Average income" stat={averages.income} caveats={caveats} affects="income" />
        <Kpi label="Average spend" stat={averages.spend} caveats={caveats} affects="spend" />
        <Kpi label="Average savings" stat={averages.savings} caveats={caveats} affects="savings" />
      </div>

      {averages.monthsExcluded.length > 0 && (
        <p className="caveat">
          Left out:{' '}
          {averages.monthsExcluded
            .map(
              (excluded) =>
                `${formatMonth(excluded.month)} (${
                  excluded.reason === 'no_coverage' ? 'no statement' : 'partly covered'
                })`,
            )
            .join(', ')}
        </p>
      )}

      {caveats
        .filter((caveat) => caveat.affects.some((a) => a !== 'net_position'))
        .map((caveat) => (
          <p key={caveat.id} className={`caveat caveat-${caveat.severity}`}>
            <span aria-hidden="true">{caveat.severity === 'warning' ? '!' : 'i'}</span>{' '}
            {caveat.text}
          </p>
        ))}
    </section>
  );
}

function Kpi({
  label,
  stat,
  caveats,
  affects,
}: {
  readonly label: string;
  readonly stat: WindowStat;
  readonly caveats: readonly Caveat[];
  readonly affects: 'income' | 'spend' | 'savings';
}) {
  const inflated = caveats.some(
    (caveat) => caveat.id === 'self_transfers' && caveat.affects.includes(affects),
  );

  return (
    <div className="kpi">
      <span className="kpi-label">
        {label}
        {/* Marks only the figures self-transfers actually inflate. Painting the
            same warning on all three would train the reader to skip it. */}
        {inflated && (
          <span className="kpi-flag" title="Includes transfers between your own accounts">
            {' '}
            ~
          </span>
        )}
      </span>
      <span className="kpi-value">{formatPaise(stat.mean)}</span>
      {stat.months > 1 ? (
        <span className="kpi-range">
          {formatPaise(stat.min)} – {formatPaise(stat.max)}
        </span>
      ) : (
        <span className="kpi-range muted">1 month — no variation yet</span>
      )}
    </div>
  );
}
