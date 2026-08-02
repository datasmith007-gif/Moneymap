import { useState } from 'react';
import type { SessionStore } from '../hooks/useSessionStore.ts';
import { useDashboard, useMonthTransactions } from '../hooks/useDashboard.ts';
import type { WindowSize } from '../engine/aggregate.ts';
import { NetPositionPanel } from '../components/NetPositionPanel.tsx';
import { AveragesPanel } from '../components/AveragesPanel.tsx';
import { MoneyFlowChart } from '../components/MoneyFlowChart.tsx';
import { SavingsTrendChart } from '../components/SavingsTrendChart.tsx';
import { MonthTransactions } from '../components/MonthTransactions.tsx';
import { formatMonth, type MonthKey } from '../model/date.ts';

const WINDOWS: readonly WindowSize[] = [3, 6, 12, 'all'];

/**
 * The dashboard. Holds the only two pieces of view state — the selected window
 * and the drilled-into month — and passes finished figures down. Nothing here
 * computes a number; every figure arrives from `aggregate.ts`.
 */
export function DashboardPage({ session }: { readonly session: SessionStore }) {
  const [window, setWindow] = useState<WindowSize>(6);
  const [selectedMonth, setSelectedMonth] = useState<MonthKey | null>(null);

  const dashboard = useDashboard(session.store, session.revision, window);
  const transactions = useMonthTransactions(session.store, session.revision, selectedMonth);

  if (dashboard === null) return <p className="empty">Loading…</p>;

  if (dashboard.kind === 'empty') {
    return (
      <section className="panel">
        <header className="panel-head">
          <h2>Nothing to show yet</h2>
        </header>
        <p>Import a statement and its figures will appear here.</p>
      </section>
    );
  }

  const stale = dashboard.monthsSinceLatestStatement;

  return (
    <>
      <div className="page-actions">
        {/*
          The window is anchored to the newest month in the data, not to today.
          Anchoring to the wall clock would give a user importing last year's
          statements an empty window and an average of zero, with nothing on
          screen explaining why. The anchor is printed for the same reason.
        */}
        <span className="muted">
          {window === 'all'
            ? `All ${dashboard.flows.length} months`
            : `${window} months`}{' '}
          to {formatMonth(dashboard.anchorMonth)}
        </span>
        <div className="segmented" role="group" aria-label="Time window">
          {WINDOWS.map((size) => (
            <button
              key={String(size)}
              type="button"
              className={size === window ? 'segment segment-active' : 'segment'}
              aria-pressed={size === window}
              onClick={() => setWindow(size)}
            >
              {size === 'all' ? 'All' : `${size}m`}
            </button>
          ))}
        </div>
      </div>

      {stale > 0 && (
        <p className="caveat caveat-note">
          <span aria-hidden="true">i</span> Your most recent statement ends{' '}
          {formatMonth(dashboard.anchorMonth)} — {stale} month{stale === 1 ? '' : 's'} ago. Import a
          newer one to bring these figures up to date.
        </p>
      )}

      <NetPositionPanel position={dashboard.netPosition} />
      <AveragesPanel averages={dashboard.averages} caveats={dashboard.caveats} />
      <MoneyFlowChart
        flows={dashboard.flows}
        selectedMonth={selectedMonth}
        onSelectMonth={(month) => setSelectedMonth(month === selectedMonth ? null : month)}
      />

      {selectedMonth !== null && (
        <MonthTransactions
          month={selectedMonth}
          flow={dashboard.flows.find((flow) => flow.month === selectedMonth)}
          transactions={transactions}
          onClose={() => setSelectedMonth(null)}
        />
      )}

      <SavingsTrendChart points={dashboard.cumulative} />
    </>
  );
}
