import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CumulativePoint } from '../engine/aggregate.ts';
import { formatPaise, formatPaiseCompact } from '../model/money.ts';
import { formatMonth, formatMonthShort, type MonthKey } from '../model/date.ts';

/**
 * Cumulative savings — the running sum of monthly net across the window.
 *
 * A single series, so there is no legend box; the panel heading names it. The
 * zero line is drawn explicitly because this series can cross it, and "the month
 * you went from building up to drawing down" is the one moment on this chart
 * worth being able to locate exactly.
 *
 * Unlike the flow chart this one is unaffected by the missing self-transfer
 * detection: a transfer between the user's own accounts adds an equal inflow and
 * outflow in the same month, so it cancels in the net — provided both accounts
 * were imported.
 */
export function SavingsTrendChart({ points }: { readonly points: readonly CumulativePoint[] }) {
  const data = points.map((point) => ({
    month: point.month,
    label: formatMonthShort(point.month),
    cumulativeNet: point.cumulativeNet,
  }));
  const last = data[data.length - 1];

  return (
    <section className="content-section savings-section">
      <header className="panel-head">
        <h2>Cumulative savings</h2>
        {last && <span className="muted">{formatPaise(last.cumulativeNet)} over the window</span>}
      </header>

      <div
        className="chart"
        role="img"
        aria-label={`Cumulative savings across ${data.length} months, in rupees.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--rule)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'var(--rule)' }}
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
            />
            <YAxis
              tickFormatter={formatPaiseCompact}
              tickLine={false}
              axisLine={false}
              width={64}
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
            />
            <ReferenceLine y={0} stroke="var(--muted)" strokeDasharray="3 3" />
            <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--border)' }} />
            <Line
              type="monotone"
              dataKey="cumulativeNet"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function TrendTooltip({
  active,
  payload,
}: {
  readonly active?: boolean | undefined;
  readonly payload?: readonly { readonly payload?: unknown }[] | undefined;
}) {
  if (active !== true) return null;
  const row = payload?.[0]?.payload as
    { readonly month: MonthKey; readonly cumulativeNet: number } | undefined;
  if (row === undefined) return null;

  return (
    <div className="tooltip">
      <p className="tooltip-title">{formatMonth(row.month)}</p>
      <p>{formatPaise(row.cumulativeNet)} saved so far</p>
    </div>
  );
}
