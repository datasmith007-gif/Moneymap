import { useEffect, useState } from 'react';
import type { Store } from '../storage/store.ts';
import { loadDashboard, type DashboardState, type WindowSize } from '../engine/aggregate.ts';
import { loadAccountCoverage, type AccountCoverage } from '../engine/coverage.ts';
import { loadAnomalies, type Anomaly } from '../engine/anomalies.ts';
import {
  loadTransactionRegister,
  loadTransactionRows,
  type TransactionRegisterPage,
  type TransactionRegisterQuery,
  type TransactionRegisterRow,
  type TransactionFilter,
} from '../engine/transactions.ts';
import type { RulePreview } from '../enrichment/preview.ts';
import type { Rule, RuleInput } from '../enrichment/types.ts';
import { loadRulePreview } from '../engine/ruleWorkspace.ts';

/**
 * Reading the store into React state. These hooks have one job — the store is an
 * external mutable source, so all follow the same shape: re-read whenever
 * `revision` changes, and ignore a result that arrives after its inputs moved on.
 *
 * Neither hook computes anything. The dashboard's figures come from
 * `aggregate.ts`, coverage comes from `coverage.ts`, and drill-down rows come
 * from the store. Components only format and render those finished answers.
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

/** User-authored rules in their real evaluation order. */
export function useRules(store: Store, revision: number): readonly Rule[] | null {
  const [rules, setRules] = useState<readonly Rule[] | null>(null);

  useEffect(() => {
    let live = true;
    void store.listRules().then((next) => {
      if (live) setRules(next);
    });
    return () => {
      live = false;
    };
  }, [store, revision]);

  return rules;
}

/** Consequences of a draft rule, computed by the real classifier before save. */
export function useRulePreview(
  store: Store,
  revision: number,
  input: RuleInput | null,
): RulePreview | null {
  const [preview, setPreview] = useState<{
    readonly key: string;
    readonly value: RulePreview;
  } | null>(null);
  const operator = input?.operator;
  const category = input?.category;
  const patternsKey = input?.patterns.join('\u0000');
  const previewKey =
    operator === undefined || category === undefined || patternsKey === undefined
      ? null
      : `${operator}\u0001${category}\u0001${patternsKey}`;

  useEffect(() => {
    if (operator === undefined || category === undefined || patternsKey === undefined) {
      setPreview(null);
      return;
    }
    setPreview(null);
    let live = true;
    const patterns = patternsKey.split('\u0000');
    void loadRulePreview(store, { operator, category, patterns }).then((next) => {
      if (live)
        setPreview({ key: `${operator}\u0001${category}\u0001${patternsKey}`, value: next });
    });
    return () => {
      live = false;
    };
  }, [store, revision, operator, category, patternsKey]);

  return preview !== null && preview.key === previewKey ? preview.value : null;
}

/** Every enriched row matching a filter, refreshed after rules or overrides change. */
export function useTransactionRows(
  store: Store,
  revision: number,
  filter: TransactionFilter | null,
): readonly TransactionRegisterRow[] | null {
  const [result, setResult] = useState<{
    readonly key: string;
    readonly rows: readonly TransactionRegisterRow[];
  } | null>(null);
  const accountId = filter?.accountId;
  const type = filter?.type;
  const from = filter?.from;
  const to = filter?.to;
  const search = filter?.search;
  const category = filter?.category;
  const key =
    filter === null
      ? null
      : [accountId ?? '', type ?? '', from ?? '', to ?? '', search ?? '', category ?? ''].join(
          '\u0000',
        );

  useEffect(() => {
    if (key === null) {
      setResult(null);
      return;
    }
    let live = true;
    const query: TransactionFilter = {
      ...(accountId === undefined ? {} : { accountId }),
      ...(type === undefined ? {} : { type }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      ...(search === undefined ? {} : { search }),
      ...(category === undefined ? {} : { category }),
    };
    void loadTransactionRows(store, query).then((rows) => {
      if (live) setResult({ key, rows });
    });
    return () => {
      live = false;
    };
  }, [store, revision, key, accountId, type, from, to, search, category]);

  return result?.key === key ? result.rows : null;
}

/** A paged enriched register, refreshed whenever rules or overrides change. */
export function useTransactionRegister(
  store: Store,
  revision: number,
  query: TransactionRegisterQuery,
): TransactionRegisterPage | null {
  const [page, setPage] = useState<TransactionRegisterPage | null>(null);

  useEffect(() => {
    let live = true;
    void loadTransactionRegister(store, query).then((next) => {
      if (live) setPage(next);
    });
    return () => {
      live = false;
    };
  }, [
    store,
    revision,
    query.accountId,
    query.type,
    query.from,
    query.to,
    query.search,
    query.category,
    query.page,
    query.pageSize,
  ]);

  return page;
}

/**
 * Spending far outside its category's usual, for the period being viewed.
 *
 * `from`/`to` bound which findings come back, never the baseline they are
 * measured against — that distinction belongs to the engine and is documented
 * there. Passing `null` bounds asks about everything imported.
 */
export function useAnomalies(
  store: Store,
  revision: number,
  from: string | null,
  to: string | null,
): readonly Anomaly[] | null {
  const [anomalies, setAnomalies] = useState<readonly Anomaly[] | null>(null);

  useEffect(() => {
    let live = true;
    void loadAnomalies(store, {
      ...(from === null ? {} : { from }),
      ...(to === null ? {} : { to }),
    }).then((next) => {
      if (live) setAnomalies(next);
    });
    return () => {
      live = false;
    };
  }, [store, revision, from, to]);

  return anomalies;
}

/** Account statement horizons and internal gaps, refreshed after every import. */
export function useAccountCoverage(
  store: Store,
  revision: number,
): readonly AccountCoverage[] | null {
  const [coverage, setCoverage] = useState<readonly AccountCoverage[] | null>(null);

  useEffect(() => {
    let live = true;
    void loadAccountCoverage(store).then((next) => {
      if (live) setCoverage(next);
    });
    return () => {
      live = false;
    };
  }, [store, revision]);

  return coverage;
}
