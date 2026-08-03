import { describe, it, expect } from 'vitest';
import { AxisParser } from '../../src/ingestion/parsers/axis.ts';
import { IciciParser } from '../../src/ingestion/parsers/icici.ts';
import { reconcileOutcome } from '../../src/ingestion/reconcile.ts';
import { createMemoryStore } from '../../src/storage/memoryStore.ts';
import { loadDashboard } from '../../src/engine/aggregate.ts';
import type { ParseContext } from '../../src/ingestion/parser.ts';
import type { Store } from '../../src/storage/store.ts';
import { axisSyntheticDoc, iciciSyntheticDoc } from '../fixtures/statements.ts';

/**
 * Parser → gate → store → dashboard, with no pdf.js in the way (the synthetic
 * fixtures are already positional documents). This is the one test that would
 * catch a break anywhere along the seam, and the re-import case at the bottom is
 * the whole point of the dedup work in a single assertion.
 */

const OPTIONS = { window: 'all', today: '2026-04-01' } as const;

/** Parse a fixture, run it through the gate, and record it — the exact path the
 *  import screen takes. */
async function importDoc(
  store: Store,
  parser: AxisParser | IciciParser,
  doc: ReturnType<typeof axisSyntheticDoc>,
  statementId: string,
) {
  const ctx: ParseContext = { statementId, importedAt: '2026-04-01T00:00:00Z' };
  const outcome = reconcileOutcome(parser.parse(doc, ctx));
  if (outcome.kind !== 'parsed' && outcome.kind !== 'needs_review') {
    throw new Error(`expected a statement, got ${outcome.kind}`);
  }
  return store.putStatement(outcome.statement, {
    statementId,
    fileName: `${statementId}.pdf`,
    importedAt: '2026-04-01T00:00:00Z',
    issues: outcome.kind === 'needs_review' ? outcome.issues : [],
  });
}

describe('parser → store → dashboard', () => {
  it('sums both banks into one net position', async () => {
    const store = createMemoryStore();
    await importDoc(store, new AxisParser(), axisSyntheticDoc(), 'axis-1');
    await importDoc(store, new IciciParser(), iciciSyntheticDoc(), 'icici-1');

    const dashboard = await loadDashboard(store, OPTIONS);
    if (dashboard.kind !== 'ready') throw new Error('expected a ready dashboard');

    // Axis closes at 5,499.50 and ICICI at 1,300.00, both as printed on the
    // fixtures and already proven by the reconciliation gate.
    expect(dashboard.netPosition.total).toBe(549950 + 130000);
    expect(dashboard.netPosition.accounts).toHaveLength(2);
  });

  it('flags the account whose statement needed review', async () => {
    const store = createMemoryStore();
    await importDoc(store, new IciciParser(), iciciSyntheticDoc(), 'icici-1');

    const dashboard = await loadDashboard(store, OPTIONS);
    if (dashboard.kind !== 'ready') throw new Error('expected a ready dashboard');

    // The ICICI fixture is consolidated, so the parser flags the ledger it did
    // not import — that flag has to survive all the way to the dashboard.
    expect(dashboard.netPosition.accounts[0]?.hasFlaggedStatements).toBe(true);
    expect(dashboard.caveats.map((c) => c.id)).toContain('flagged_statements');
  });

  it('re-importing the same statement changes nothing', async () => {
    const store = createMemoryStore();
    await importDoc(store, new AxisParser(), axisSyntheticDoc(), 'axis-1');

    const before = await loadDashboard(store, OPTIONS);
    if (before.kind !== 'ready') throw new Error('expected a ready dashboard');
    const rowsBefore = (await store.listTransactions({})).length;

    // A fresh parse with a different statementId — exactly what happens when a
    // user drops the same PDF in again. Identity must come from the content.
    const second = await importDoc(store, new AxisParser(), axisSyntheticDoc(), 'axis-2');
    expect(second.kind).toBe('duplicate_statement');

    const after = await loadDashboard(store, OPTIONS);
    if (after.kind !== 'ready') throw new Error('expected a ready dashboard');

    expect((await store.listTransactions({})).length).toBe(rowsBefore);
    expect(after.netPosition.total).toBe(before.netPosition.total);
    expect(after.flows).toEqual(before.flows);
    expect(after.averages).toEqual(before.averages);
  });

  it('classifies imported rows on the way to the dashboard', async () => {
    const store = createMemoryStore();
    await importDoc(store, new AxisParser(), axisSyntheticDoc(), 'axis-1');

    const dashboard = await loadDashboard(store, OPTIONS);
    if (dashboard.kind !== 'ready') throw new Error('expected a ready dashboard');

    // Whatever the fixture's narrations are, the engine must publish a coherent
    // breakdown: every category total is real spend, and the shares are a
    // fraction of all spend rather than of the labelled part.
    const labelled = dashboard.spendByCategory.reduce((sum, c) => sum + c.total, 0);
    const allSpend = labelled + dashboard.coverage.unclassifiedSpend;
    expect(allSpend).toBe(dashboard.flows.reduce((sum, f) => sum + f.outflow, 0));
    expect(dashboard.spendByCategory.every((c) => c.category !== 'unclassified')).toBe(true);
    expect(dashboard.coverage.rate).toBeCloseTo(allSpend === 0 ? 1 : labelled / allSpend, 10);
  });

  it("applies the user's stored rules and overrides", async () => {
    const store = createMemoryStore();
    await importDoc(store, new AxisParser(), axisSyntheticDoc(), 'axis-1');

    const before = await loadDashboard(store, OPTIONS);
    if (before.kind !== 'ready') throw new Error('expected a ready dashboard');

    // A rule that claims every debit in the fixture, whatever it says.
    const debits = (await store.listTransactions({})).filter((t) => t.type === 'debit');
    for (const row of debits) await store.putOverride(row.id, 'entertainment');

    const after = await loadDashboard(store, OPTIONS);
    if (after.kind !== 'ready') throw new Error('expected a ready dashboard');

    expect(after.coverage.unclassifiedCount).toBe(0);
    expect(after.spendByCategory.map((c) => c.category)).toEqual(
      debits.length > 0 ? ['entertainment'] : [],
    );
    // Overrides change the breakdown, never the totals.
    expect(after.flows.map((f) => f.outflow)).toEqual(before.flows.map((f) => f.outflow));
    expect(after.netPosition.total).toBe(before.netPosition.total);
  });

  it('gives the same account the same id across separate parses', async () => {
    const first = new AxisParser().parse(axisSyntheticDoc(), {
      statementId: 'one',
      importedAt: '2026-04-01T00:00:00Z',
    });
    const second = new AxisParser().parse(axisSyntheticDoc(), {
      statementId: 'two',
      importedAt: '2026-05-01T00:00:00Z',
    });
    if (first.kind !== 'parsed' || second.kind !== 'parsed') throw new Error('not parsed');

    // The id used to embed statementId, which made every upload a new account.
    expect(second.statement.account.id).toBe(first.statement.account.id);
    expect(first.statement.account.id).not.toContain('one');
  });

  it('the dashboard reconciles to the rows the store holds', async () => {
    const store = createMemoryStore();
    await importDoc(store, new AxisParser(), axisSyntheticDoc(), 'axis-1');
    await importDoc(store, new IciciParser(), iciciSyntheticDoc(), 'icici-1');

    const dashboard = await loadDashboard(store, OPTIONS);
    if (dashboard.kind !== 'ready') throw new Error('expected a ready dashboard');

    const rows = await store.listTransactions({});
    const credits = rows.filter((r) => r.type === 'credit').reduce((n, r) => n + r.amount, 0);
    const debits = rows.filter((r) => r.type === 'debit').reduce((n, r) => n + r.amount, 0);

    expect(dashboard.flows.reduce((n, f) => n + f.inflow, 0)).toBe(credits);
    expect(dashboard.flows.reduce((n, f) => n + f.outflow, 0)).toBe(debits);
  });
});
