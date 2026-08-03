import { useEffect, useState } from 'react';
import type { Transaction } from '../model/canonical.ts';
import type { Store } from '../storage/store.ts';
import { loadDashboard, type DashboardState, type WindowSize } from '../engine/aggregate.ts';
import { monthBounds, type MonthKey } from '../model/date.ts';

/**
 * Reading the store into React state. Two hooks, one job — the store is an
 * external mutable source, so both follow the same shape: re-read whenever
 * `revision` changes, and ignore a result that arrives after its inputs moved on.
 *
 * Neither hook computes anything. The dashboard's figures come from
 * `aggregate.ts` and the drill-down rows come from the store, because the test
 * runner only collects `.ts` and a number derived in a component could not be
 * tested.
 */

/** `null` while the first read is in flight. */
export function useDashboard(
  store: Store,
  revision: number,
  window: WindowSize,
): DashboardState | null {
  const [state, setState] = useState<DashboardState | null>(null);

  useEffect(() => {
    let live = true;
    void loadDashboard(store, {
      window,
      // The wall clock enters the engine here and nowhere else, and only to
      // report how old the newest statement is — never to choose the window.
      today: new Date().toISOString().slice(0, 10),
    }).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [store, revision, window]);

  return state;
}

/**
 * The transactions behind one month's bar.
 *
 * Fetched from the store rather than sliced out of the aggregate, so the
 * drill-down list is literally the rows the figure was computed from — which is
 * what lets the panel re-sum them as a visible check rather than an assertion.
 */
export function useMonthTransactions(
  store: Store,
  revision: number,
  month: MonthKey | null,
): readonly Transaction[] {
  const [rows, setRows] = useState<readonly Transaction[]>([]);

  useEffect(() => {
    if (month === null) {
      setRows([]);
      return;
    }
    let live = true;
    const { start, end } = monthBounds(month);
    void store.listTransactions({ from: start, to: end }).then((next) => {
      if (live) setRows(next);
    });
    return () => {
      live = false;
    };
  }, [store, revision, month]);

  return rows;
}
