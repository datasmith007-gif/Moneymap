import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MonthFlow } from '../engine/aggregate.ts';
import { formatPaise, formatPaiseCompact } from '../model/money.ts';
import { formatMonth, formatMonthShort, type MonthKey } from '../model/date.ts';

/**
 * Money in against money out, by month.
 *
 * Two series of the same measure, so they are grouped columns on one axis — never
 * a dual axis, and never stacked (stacking would imply inflow and outflow compose
 * a whole, which they don't).
 *
 * Colour comes from the categorical slots, not from `--good`/`--critical`. Status
 * colours are reserved for state, and letting them stand in for a series would
 * mean "outflow" reads as "something is wrong". High spend is not an error.
 *
 * Coverage is encoded without relying on colour: a month no statement covers
 * passes `null` so no bar is drawn while its axis label stays (an absent bar and
 * a zero bar are different facts), and a partly covered month is drawn at reduced
 * opacity and says so in its tooltip.
 */
export function MoneyFlowChart({
  flows,
  selectedMonth,
  onSelectMonth,
}: {
  readonly flows: readonly MonthFlow[];
  readonly selectedMonth: MonthKey | null;
  readonly onSelectMonth: (month: MonthKey) => void;
}) {
  const data = flows.map((flow) => ({
    month: flow.month,
    label: formatMonthShort(flow.month),
    inflow: flow.coverage === 'none' ? null : flow.inflow,
    outflow: flow.coverage === 'none' ? null : flow.outflow,
    coverage: flow.coverage,
    txnCount: flow.txnCount,
    missingAccounts: flow.missingAccounts,
  }));

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Money in and out</h2>
        <span className="muted">click a month for the transactions behind it</span>
      </header>

      <div
        className="chart"
        role="img"
        aria-label={`Monthly money in and out across ${flows.length} months, in rupees.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
            barGap={2}
            onClick={(next) => {
              // Recharts types `activeLabel` as string | number (it can be a
              // numeric axis value); ours is always the month label string.
              const clicked = data.find((row) => row.label === String(next.activeLabel));
              if (clicked) onSelectMonth(clicked.month);
            }}
          >
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
            <Tooltip content={<FlowTooltip />} cursor={{ fill: 'var(--border)' }} />
            <Legend
              verticalAlign="top"
              align="left"
              height={28}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, color: 'var(--ink-2)' }}
            />
            <Bar dataKey="inflow" name="In" fill="var(--series-1)" maxBarSize={22} radius={[4, 4, 0, 0]}>
              {data.map((row) => (
                <Cell
                  key={row.month}
                  fillOpacity={row.coverage === 'partial' ? 0.45 : 1}
                  stroke={row.month === selectedMonth ? 'var(--ink)' : 'none'}
                  strokeWidth={row.month === selectedMonth ? 1.5 : 0}
                />
              ))}
            </Bar>
            <Bar dataKey="outflow" name="Out" fill="var(--series-2)" maxBarSize={22} radius={[4, 4, 0, 0]}>
              {data.map((row) => (
                <Cell
                  key={row.month}
                  fillOpacity={row.coverage === 'partial' ? 0.45 : 1}
                  stroke={row.month === selectedMonth ? 'var(--ink)' : 'none'}
                  strokeWidth={row.month === selectedMonth ? 1.5 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

interface FlowRow {
  readonly month: MonthKey;
  readonly inflow: number | null;
  readonly outflow: number | null;
  readonly coverage: string;
  readonly txnCount: number;
  readonly missingAccounts: readonly string[];
}

/** Recharts hands the tooltip an untyped payload array; narrow it and guard
 *  rather than reaching for a non-null assertion. */
function FlowTooltip({
  active,
  payload,
}: {
  readonly active?: boolean | undefined;
  readonly payload?: readonly { readonly payload?: unknown }[] | undefined;
}) {
  if (active !== true) return null;
  const row = payload?.[0]?.payload as FlowRow | undefined;
  if (row === undefined) return null;

  return (
    <div className="tooltip">
      <p className="tooltip-title">{formatMonth(row.month)}</p>
      {row.coverage === 'none' ? (
        <p className="tooltip-note">No statement covers this month.</p>
      ) : (
        <>
          <p>
            <span className="swatch swatch-1" aria-hidden="true" /> In{' '}
            {formatPaise(row.inflow ?? 0)}
          </p>
          <p>
            <span className="swatch swatch-2" aria-hidden="true" /> Out{' '}
            {formatPaise(row.outflow ?? 0)}
          </p>
          <p className="tooltip-note">
            {row.txnCount} transaction{row.txnCount === 1 ? '' : 's'}
            {row.coverage === 'partial' && ' · partly covered month'}
          </p>
          {row.missingAccounts.length > 0 && (
            <p className="tooltip-note">No data from: {row.missingAccounts.join(', ')}</p>
          )}
        </>
      )}
    </div>
  );
}
