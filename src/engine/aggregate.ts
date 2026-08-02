import type { Account, Paise, Transaction } from '../model/canonical.ts';
import type { ImportRecord, Store } from '../storage/store.ts';
import { meanPaise } from '../model/money.ts';
import {
  addMonths,
  daysInMonth,
  monthBounds,
  monthOf,
  monthsBetween,
  monthsInRange,
  type MonthKey,
} from '../model/date.ts';

/**
 * Every number on the dashboard is computed here, and nowhere else.
 *
 * `aggregate` is pure: canonical records in, finished figures out. That matters
 * for two reasons. The project constraint is that any figure with financial
 * consequence comes from explicit, testable logic — and the test runner only
 * collects `.ts`, so a number computed inside a `.tsx` component could not be
 * tested at all. Components below this module render values; they never derive
 * them.
 *
 * What this module deliberately does NOT do, because the data cannot support it:
 * category breakdowns, an investment-vs-liquid split, and self-transfer
 * exclusion. All three need `Transaction.category` / `isInternalTransfer`, which
 * both parsers hardcode to `null` / `false` until Feature 2 exists. Rather than
 * compute something that looks like those numbers, the engine emits a caveat
 * naming what is missing.
 */

// ── Types ───────────────────────────────────────────────────────────────────

/** Rolling window, in months, or the whole imported range. */
export type WindowSize = 3 | 6 | 12 | 'all';

/**
 * How much of a month the imported statements actually cover.
 *
 * Derived from statement *periods*, never from whether transactions happen to
 * exist. The distinction between "covered, and nothing happened" and "not
 * covered" is the difference between a true ₹0 month and no data at all —
 * conflating them is the bug that quietly halves a monthly average.
 */
export type MonthCoverage = 'complete' | 'partial' | 'none';

export interface MonthFlow {
  readonly month: MonthKey;
  /** Σ credits across all accounts. */
  readonly inflow: Paise;
  /** Σ debits across all accounts. */
  readonly outflow: Paise;
  readonly net: Paise;
  readonly txnCount: number;
  readonly coverage: MonthCoverage;
  /** Institution + mask for accounts with no statement covering this month.
   *  Named, because "January looks low" is usually "the ICICI statement starts
   *  in March". */
  readonly missingAccounts: readonly string[];
}

export interface CumulativePoint {
  readonly month: MonthKey;
  readonly cumulativeNet: Paise;
}

export interface WindowStat {
  /** Rounded half away from zero — the only rounded figure in the group. */
  readonly mean: Paise;
  /** Exact, unrounded. */
  readonly min: Paise;
  /** Exact, unrounded. */
  readonly max: Paise;
  /** Population σ, rounded to paise. Display-only; never feeds another figure. */
  readonly stdDev: Paise;
  /** How many months actually counted — not the window size requested. */
  readonly months: number;
}

export interface Averages {
  readonly income: WindowStat;
  readonly spend: WindowStat;
  readonly savings: WindowStat;
  readonly monthsCounted: readonly MonthKey[];
  readonly monthsExcluded: readonly {
    readonly month: MonthKey;
    readonly reason: 'partial_coverage' | 'no_coverage';
  }[];
}

export interface AccountPosition {
  readonly accountId: string;
  readonly institution: string;
  readonly identifierMasked: string;
  /** Signed: liabilities count against the total. */
  readonly balance: Paise;
  /** `periodEnd` of the newest statement for this account — never the upload
   *  time, which would call a two-year-old statement fresh. */
  readonly asOf: string;
  /** Months between this account's `asOf` and the dashboard's anchor month. */
  readonly monthsBehind: number;
  /** True when this account's latest statement predates the selected window, so
   *  its balance is not comparable with the others'. */
  readonly staleForWindow: boolean;
  readonly hasFlaggedStatements: boolean;
}

export interface NetPosition {
  readonly total: Paise;
  /**
   * The OLDEST `asOf` among the accounts summed.
   *
   * A sum of balances taken on different dates is only true as of the earliest
   * one. Labelling it with the newest would be exactly the dishonesty §3.1
   * forbids — the total would look fresher than its weakest input.
   */
  readonly asOf: string;
  readonly newestAsOf: string;
  readonly accounts: readonly AccountPosition[];
  /** Accounts left out of `total`, and why. */
  readonly excluded: readonly { readonly accountId: string; readonly reason: 'currency' }[];
}

export interface Caveat {
  readonly id:
    | 'self_transfers'
    | 'stale_data'
    | 'flagged_statements'
    | 'single_month'
    | 'short_window'
    | 'partial_months';
  readonly text: string;
  readonly severity: 'note' | 'warning';
  /** Which figures this caveat actually affects. An undifferentiated warning
   *  painted on everything teaches the reader to ignore it. */
  readonly affects: readonly ('income' | 'spend' | 'savings' | 'net_position')[];
}

export interface Dashboard {
  readonly kind: 'ready';
  readonly window: WindowSize;
  /** The latest month with any coverage. The window is anchored here, not to
   *  the wall clock. */
  readonly anchorMonth: MonthKey;
  readonly range: { readonly from: MonthKey; readonly to: MonthKey };
  readonly netPosition: NetPosition;
  /** Every month in range, gaps included as explicit `none`-coverage entries. */
  readonly flows: readonly MonthFlow[];
  readonly cumulative: readonly CumulativePoint[];
  readonly averages: Averages;
  /** Months between the newest statement and `today` — the staleness the wall
   *  clock is responsible for, kept separate from window selection. */
  readonly monthsSinceLatestStatement: number;
  readonly caveats: readonly Caveat[];
}

export type DashboardState = { readonly kind: 'empty' } | Dashboard;

export interface AggregationInput {
  readonly accounts: readonly Account[];
  readonly imports: readonly ImportRecord[];
  /** Must cover at least the resolved range; `loadDashboard` guarantees it. */
  readonly transactions: readonly Transaction[];
}

export interface AggregateOptions {
  readonly window: WindowSize;
  /** ISO date. Used ONLY for the "your data ends N months ago" notice — never to
   *  choose the window. Injected so tests are deterministic. */
  readonly today: string;
}

// ── Entry points ────────────────────────────────────────────────────────────

/**
 * The months the window covers, given what has been imported.
 *
 * Anchored to the newest month in the *data*, not to `today`. Anchoring to the
 * wall clock means a user importing last financial year's statements gets an
 * empty window and an average of ₹0 with no explanation. The window start is
 * clamped to the oldest imported month, so selecting "12 months" with 4 months
 * of data yields a 4-month range rather than 8 empty slots — the caveat states
 * the real count.
 */
export function resolveRange(
  imports: readonly ImportRecord[],
  window: WindowSize,
): { readonly from: MonthKey; readonly to: MonthKey } | null {
  if (imports.length === 0) return null;

  let earliest = monthOf(imports[0]!.periodStart);
  let latest = monthOf(imports[0]!.periodEnd);
  for (const record of imports) {
    const start = monthOf(record.periodStart);
    const end = monthOf(record.periodEnd);
    if (start < earliest) earliest = start;
    if (end > latest) latest = end;
  }

  if (window === 'all') return { from: earliest, to: latest };
  const windowStart = addMonths(latest, -(window - 1));
  return { from: windowStart < earliest ? earliest : windowStart, to: latest };
}

/** Read the store, then aggregate. The only async function in the engine. */
export async function loadDashboard(
  store: Store,
  options: AggregateOptions,
): Promise<DashboardState> {
  const imports = await store.listImports();
  const range = resolveRange(imports, options.window);
  if (range === null) return { kind: 'empty' };

  const [accounts, transactions] = await Promise.all([
    store.listAccounts(),
    // Range-bounded on purpose: the V2 SQLite adapter would scan the whole table
    // otherwise. Derived from the same `resolveRange` call the aggregate uses, so
    // the query and the range can never drift apart.
    store.listTransactions({
      from: monthBounds(range.from).start,
      to: monthBounds(range.to).end,
    }),
  ]);

  return aggregate({ accounts, imports, transactions }, options);
}

/** Pure. Every dashboard figure originates here. */
export function aggregate(
  input: AggregationInput,
  options: AggregateOptions,
): DashboardState {
  const range = resolveRange(input.imports, options.window);
  if (range === null) return { kind: 'empty' };

  const months = monthsInRange(range.from, range.to);
  const netPosition = computeNetPosition(input.accounts, input.imports, range.from);
  const flows = computeFlows(months, input);
  const averages = computeAverages(flows);
  const cumulative = computeCumulative(flows);

  return {
    kind: 'ready',
    window: options.window,
    anchorMonth: range.to,
    range,
    netPosition,
    flows,
    cumulative,
    averages,
    monthsSinceLatestStatement: monthsBetween(monthOf(netPosition.newestAsOf), monthOf(options.today)),
    caveats: buildCaveats(netPosition, averages, input.imports, options.window),
  };
}

// ── Net position ────────────────────────────────────────────────────────────

/**
 * Pick the statement that says where an account currently stands.
 *
 * Maximum `periodEnd`, tie-broken by `importedAt` then `statementId` — a total
 * order, so the answer never depends on the order statements were uploaded in.
 * Two rules go with it, both of which would produce a plausible-looking wrong
 * number if broken:
 *
 *  - **Never sum a group.** A Jan–Mar closing balance plus a Feb–Apr closing
 *    balance is not a balance; it is two snapshots of the same account added
 *    together.
 *  - **Never re-derive the balance from transactions.** The printed closing
 *    balance is the bank's own assertion, and the reconciliation gate has already
 *    proved the rows bridge it. Re-deriving would produce a *different* figure
 *    whenever dedup skipped a row that an overlapping statement also carried.
 */
function latestImportPerAccount(
  imports: readonly ImportRecord[],
): Map<string, ImportRecord> {
  const latest = new Map<string, ImportRecord>();
  for (const record of imports) {
    const held = latest.get(record.accountId);
    if (held === undefined || isNewer(record, held)) latest.set(record.accountId, record);
  }
  return latest;
}

function isNewer(candidate: ImportRecord, held: ImportRecord): boolean {
  if (candidate.periodEnd !== held.periodEnd) return candidate.periodEnd > held.periodEnd;
  if (candidate.importedAt !== held.importedAt) return candidate.importedAt > held.importedAt;
  return candidate.statementId > held.statementId;
}

function computeNetPosition(
  accounts: readonly Account[],
  imports: readonly ImportRecord[],
  windowStart: MonthKey,
): NetPosition {
  const latest = latestImportPerAccount(imports);
  const flagged = new Set(
    imports.filter((record) => record.issues.length > 0).map((record) => record.accountId),
  );

  const positions: AccountPosition[] = [];
  const excluded: { accountId: string; reason: 'currency' }[] = [];
  let total = 0;
  let oldestAsOf: string | null = null;
  let newestAsOf: string | null = null;

  for (const account of accounts) {
    const record = latest.get(account.id);
    if (record === undefined) continue; // an account with no import contributes nothing

    // Always 'INR' today, but summing a future foreign-currency account into a
    // rupee headline would be silently wrong, so exclude and name it instead.
    if (account.currency !== 'INR') {
      excluded.push({ accountId: account.id, reason: 'currency' });
      continue;
    }

    // Sign by liability now, so credit-card support is additive rather than a
    // correction to a total that has already shipped.
    const balance = account.isLiability ? -record.closingBalance : record.closingBalance;
    total += balance;

    const asOf = record.periodEnd;
    if (oldestAsOf === null || asOf < oldestAsOf) oldestAsOf = asOf;
    if (newestAsOf === null || asOf > newestAsOf) newestAsOf = asOf;

    positions.push({
      accountId: account.id,
      institution: account.institution,
      identifierMasked: account.identifierMasked,
      balance,
      asOf,
      monthsBehind: 0, // filled below, once the anchor is known
      staleForWindow: monthOf(asOf) < windowStart,
      hasFlaggedStatements: flagged.has(account.id),
    });
  }

  const newest = newestAsOf ?? '';
  const anchor = monthOf(newest);
  const withDistance = positions.map((position) => ({
    ...position,
    monthsBehind: monthsBetween(monthOf(position.asOf), anchor),
  }));
  withDistance.sort((a, b) => b.balance - a.balance);

  return {
    total,
    asOf: oldestAsOf ?? '',
    newestAsOf: newest,
    accounts: withDistance,
    excluded,
  };
}

// ── Monthly flows and coverage ──────────────────────────────────────────────

/**
 * How many days of `month` an account's statements actually cover.
 *
 * The day-ranges are *unioned*, not summed. Overlapping statement periods are
 * the normal case (Jan–Mar and Feb–Apr both cover February), and summing them
 * would report February as 56 days covered — which would then read as
 * "complete" for the wrong reason. Both endpoints are clamped inside the month
 * first, so this is plain integer arithmetic on day numbers with no cross-month
 * date handling anywhere.
 */
function coveredDays(month: MonthKey, records: readonly ImportRecord[]): number {
  const { start, end } = monthBounds(month);
  const spans: { from: number; to: number }[] = [];

  for (const record of records) {
    if (record.periodEnd < start || record.periodStart > end) continue;
    const from = Number((record.periodStart > start ? record.periodStart : start).slice(8, 10));
    const to = Number((record.periodEnd < end ? record.periodEnd : end).slice(8, 10));
    spans.push({ from, to });
  }
  if (spans.length === 0) return 0;

  spans.sort((a, b) => a.from - b.from);
  let days = 0;
  let cursor = 0; // last day already counted
  for (const span of spans) {
    const from = Math.max(span.from, cursor + 1);
    if (span.to >= from) {
      days += span.to - from + 1;
      cursor = span.to;
    }
  }
  return days;
}

function computeFlows(months: readonly MonthKey[], input: AggregationInput): MonthFlow[] {
  const importsByAccount = new Map<string, ImportRecord[]>();
  for (const record of input.imports) {
    const list = importsByAccount.get(record.accountId);
    if (list) list.push(record);
    else importsByAccount.set(record.accountId, [record]);
  }

  // Seed every month with zeros before folding transactions in, so a month with
  // no rows is a zero bar rather than an absent one.
  const totals = new Map<MonthKey, { inflow: Paise; outflow: Paise; count: number }>();
  for (const month of months) totals.set(month, { inflow: 0, outflow: 0, count: 0 });

  for (const txn of input.transactions) {
    const bucket = totals.get(monthOf(txn.date));
    if (bucket === undefined) continue; // outside the window
    if (txn.type === 'credit') bucket.inflow += txn.amount;
    else bucket.outflow += txn.amount;
    bucket.count++;
  }

  return months.map((month) => {
    const bucket = totals.get(month)!;
    const expected = daysInMonth(month);
    const missingAccounts: string[] = [];
    let anyCovered = false;
    let allComplete = true;

    for (const account of input.accounts) {
      const days = coveredDays(month, importsByAccount.get(account.id) ?? []);
      if (days > 0) anyCovered = true;
      if (days < expected) {
        allComplete = false;
        if (days === 0) missingAccounts.push(`${account.institution} ${account.identifierMasked}`);
      }
    }

    const coverage: MonthCoverage = !anyCovered ? 'none' : allComplete ? 'complete' : 'partial';
    return {
      month,
      inflow: bucket.inflow,
      outflow: bucket.outflow,
      net: bucket.inflow - bucket.outflow,
      txnCount: bucket.count,
      coverage,
      missingAccounts,
    };
  });
}

// ── Averages ────────────────────────────────────────────────────────────────

/**
 * Statistics over the months that fully counted.
 *
 * Only `complete` months contribute. A partially covered month understates every
 * flow through it, and averaging it in would drag the mean down by an amount
 * nobody could see; excluding it and naming it is the honest alternative.
 */
function statOf(values: readonly Paise[]): WindowStat {
  if (values.length === 0) return { mean: 0, min: 0, max: 0, stdDev: 0, months: 0 };

  let total = 0;
  let min = values[0]!;
  let max = values[0]!;
  for (const value of values) {
    total += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const mean = meanPaise(total, values.length);

  // Population σ, not sample: these months are the whole population being
  // described, not a sample to infer from — and population σ is defined at n=1
  // (it is 0) where sample σ divides by zero. The float mean is used here rather
  // than the rounded one so the rounding does not bias the spread; this is the
  // only float path in the engine, and its result is display-only.
  const exactMean = total / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - exactMean) ** 2, 0) / values.length;

  return { mean, min, max, stdDev: Math.round(Math.sqrt(variance)), months: values.length };
}

function computeAverages(flows: readonly MonthFlow[]): Averages {
  const counted = flows.filter((flow) => flow.coverage === 'complete');
  const excluded = flows
    .filter((flow) => flow.coverage !== 'complete')
    .map((flow) => ({
      month: flow.month,
      reason: flow.coverage === 'none' ? ('no_coverage' as const) : ('partial_coverage' as const),
    }));

  return {
    income: statOf(counted.map((flow) => flow.inflow)),
    spend: statOf(counted.map((flow) => flow.outflow)),
    // Average savings is the mean of the monthly nets — NOT mean(income) −
    // mean(spend). Each mean is rounded independently, so the two can differ by
    // a paise; deriving it would make the displayed figures inconsistent with
    // each other. The three are independent statistics over the same months, and
    // the UI must not present them as an equation.
    savings: statOf(counted.map((flow) => flow.net)),
    monthsCounted: counted.map((flow) => flow.month),
    monthsExcluded: excluded,
  };
}

function computeCumulative(flows: readonly MonthFlow[]): CumulativePoint[] {
  let running = 0;
  return flows
    .filter((flow) => flow.coverage !== 'none')
    .map((flow) => {
      running += flow.net;
      return { month: flow.month, cumulativeNet: running };
    });
}

// ── Caveats ─────────────────────────────────────────────────────────────────

/**
 * What the reader must know for these numbers to be read correctly.
 *
 * Each caveat names the figures it actually affects. The self-transfer caveat is
 * the one that matters most and is the most easily over-applied: a transfer
 * between the user's own accounts adds its amount to *both* income and spend, so
 * those two are inflated — but savings, monthly net, and the net position are
 * unaffected whenever both legs are imported, because the transfer cancels
 * within the month. Warning about all four equally would be wrong and would
 * teach the reader to skip the warning.
 */
function buildCaveats(
  netPosition: NetPosition,
  averages: Averages,
  imports: readonly ImportRecord[],
  window: WindowSize,
): Caveat[] {
  const caveats: Caveat[] = [
    {
      id: 'self_transfers',
      text:
        'Transfers between your own accounts are counted as both income and spend — ' +
        'they are not detected yet. Savings and net position are unaffected when both ' +
        'accounts are imported, because the transfer cancels out.',
      severity: 'warning',
      affects: ['income', 'spend'],
    },
  ];

  const counted = averages.monthsCounted.length;
  if (counted === 1) {
    caveats.push({
      id: 'single_month',
      text: 'Only one full month of data — there is no variation to show yet.',
      severity: 'note',
      affects: ['income', 'spend', 'savings'],
    });
  } else if (window !== 'all' && counted < window) {
    caveats.push({
      id: 'short_window',
      text: `Averages cover ${counted} full month${counted === 1 ? '' : 's'}, not ${window} — that is all the imported statements fully cover.`,
      severity: 'note',
      affects: ['income', 'spend', 'savings'],
    });
  }

  const partial = averages.monthsExcluded.filter((m) => m.reason === 'partial_coverage');
  if (partial.length > 0) {
    caveats.push({
      id: 'partial_months',
      text: `${partial.length} month${partial.length === 1 ? ' is' : 's are'} only partly covered by your statements and ${partial.length === 1 ? 'is' : 'are'} left out of the averages.`,
      severity: 'note',
      affects: ['income', 'spend', 'savings'],
    });
  }

  if (netPosition.accounts.some((account) => account.staleForWindow)) {
    caveats.push({
      id: 'stale_data',
      text: 'One or more accounts have no statement inside the selected window, so their balance is older than the rest of the total.',
      severity: 'warning',
      affects: ['net_position'],
    });
  }

  if (imports.some((record) => record.issues.length > 0)) {
    caveats.push({
      id: 'flagged_statements',
      text: 'Some figures come from statements that were flagged for review during import.',
      severity: 'warning',
      affects: ['income', 'spend', 'savings', 'net_position'],
    });
  }

  return caveats;
}
