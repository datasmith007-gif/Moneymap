import type { Account } from '../model/canonical.ts';
import { addDays, daysBetween } from '../model/date.ts';
import type { ImportRecord, Store } from '../storage/store.ts';

export interface CoverageGap {
  /** Inclusive ISO dates the next statement should cover. */
  readonly from: string;
  readonly to: string;
}

export interface AccountCoverage {
  readonly accountId: string;
  readonly institution: string;
  readonly identifierMasked: string;
  /** Bounds of this account's observed coverage, not the global import range. */
  readonly coverageStart: string;
  readonly coverageEnd: string;
  /** Exact internal holes only; leading/trailing absence is staleness, not a gap. */
  readonly gaps: readonly CoverageGap[];
}

interface DateInterval {
  readonly from: string;
  readonly to: string;
}

/**
 * Build the Accounts screen's statement-coverage model.
 *
 * Statement issues do not remove coverage: a reviewed statement can be
 * imperfect while still proving which dates it contains. Issues remain on the
 * import records and are reported by the existing honesty machinery.
 */
export function buildAccountCoverage(
  accounts: readonly Account[],
  imports: readonly ImportRecord[],
): readonly AccountCoverage[] {
  const importsByAccount = groupImports(imports);
  const result: AccountCoverage[] = [];

  for (const account of accounts) {
    const records = importsByAccount.get(account.id) ?? [];
    if (records.length === 0) continue;

    const intervals = mergeIntervals(records.map(importInterval));
    const first = intervals[0]!;
    const last = intervals[intervals.length - 1]!;
    const gaps: CoverageGap[] = [];

    for (let index = 1; index < intervals.length; index++) {
      const previous = intervals[index - 1]!;
      const next = intervals[index]!;
      gaps.push({ from: addDays(previous.to, 1), to: addDays(next.from, -1) });
    }

    result.push({
      accountId: account.id,
      institution: account.institution,
      identifierMasked: account.identifierMasked,
      coverageStart: first.from,
      coverageEnd: last.to,
      gaps,
    });
  }

  result.sort(
    (a, b) =>
      a.institution.localeCompare(b.institution) ||
      a.identifierMasked.localeCompare(b.identifierMasked) ||
      a.accountId.localeCompare(b.accountId),
  );
  return result;
}

export async function loadAccountCoverage(store: Store): Promise<readonly AccountCoverage[]> {
  const [accounts, imports] = await Promise.all([store.listAccounts(), store.listImports()]);
  return buildAccountCoverage(accounts, imports);
}

/**
 * Number of distinct statement-covered days inside an inclusive range.
 * Shared with the dashboard so its monthly completeness and Accounts gaps are
 * two views of the same interval union rather than parallel implementations.
 */
export function coveredDays(from: string, to: string, records: readonly ImportRecord[]): number {
  validateInterval({ from, to }, 'coverage range');
  const clamped: DateInterval[] = [];

  for (const record of records) {
    const interval = importInterval(record);
    if (interval.to < from || interval.from > to) continue;
    clamped.push({
      from: interval.from < from ? from : interval.from,
      to: interval.to > to ? to : interval.to,
    });
  }

  return mergeIntervals(clamped).reduce(
    (total, interval) => total + daysBetween(interval.from, interval.to) + 1,
    0,
  );
}

function groupImports(imports: readonly ImportRecord[]): Map<string, ImportRecord[]> {
  const grouped = new Map<string, ImportRecord[]>();
  for (const record of imports) {
    const held = grouped.get(record.accountId);
    if (held) held.push(record);
    else grouped.set(record.accountId, [record]);
  }
  return grouped;
}

function importInterval(record: ImportRecord): DateInterval {
  const interval = { from: record.periodStart, to: record.periodEnd };
  validateInterval(interval, `import ${record.statementId}`);
  return interval;
}

function validateInterval(interval: DateInterval, name: string): void {
  if (interval.from > interval.to) {
    throw new RangeError(`${name} starts after it ends: ${interval.from} > ${interval.to}`);
  }
}

function mergeIntervals(intervals: readonly DateInterval[]): DateInterval[] {
  const ordered = intervals.map((interval) => {
    validateInterval(interval, 'coverage interval');
    return { ...interval };
  });
  ordered.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const merged: DateInterval[] = [];
  for (const interval of ordered) {
    const held = merged[merged.length - 1];
    if (held === undefined || daysBetween(held.to, interval.from) > 1) {
      merged.push(interval);
      continue;
    }
    if (interval.to > held.to) merged[merged.length - 1] = { from: held.from, to: interval.to };
  }
  return merged;
}
