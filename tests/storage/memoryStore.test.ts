import { describe, it, expect } from 'vitest';
import { createMemoryStore } from '../../src/storage/memoryStore.ts';
import type { ImportMeta } from '../../src/storage/store.ts';
import { account, statement, txn } from '../fixtures/canonical.ts';

const axis = account({ institution: 'Axis Bank', identifierMasked: 'XXXX4567' });
const icici = account({ institution: 'ICICI Bank', identifierMasked: 'XXXX3458' });

function meta(over: Partial<ImportMeta> = {}): ImportMeta {
  return {
    statementId: 's1',
    fileName: 'statement.pdf',
    importedAt: '2025-09-01T00:00:00Z',
    issues: [],
    ...over,
  };
}

/** A row on `axis`, described by only what matters to the case. */
function row(date: string, amount: number, balanceAfter: number | null, description = 'UPI/X') {
  return txn({ accountId: axis.id, date, type: 'debit', amount, balanceAfter, description });
}

describe('memory store — writing', () => {
  it('records a statement and its rows', async () => {
    const store = createMemoryStore();
    const summary = await store.putStatement(
      statement({ account: axis, transactions: [row('2025-08-02', 100, 900)], closingBalance: 900 }),
      meta(),
    );

    expect(summary.kind).toBe('imported');
    if (summary.kind !== 'imported') throw new Error('expected imported');
    expect(summary.record.transactionsImported).toBe(1);
    expect(summary.record.transactionsSkipped).toBe(0);
    expect(summary.record.accountId).toBe(axis.id);
    expect(await store.listAccounts()).toHaveLength(1);
  });

  it('rejects the same statement re-uploaded, adding nothing', async () => {
    const store = createMemoryStore();
    const s = statement({
      account: axis,
      transactions: [row('2025-08-02', 100, 900)],
      closingBalance: 900,
    });

    await store.putStatement(s, meta({ statementId: 'first' }));
    // A different statementId, as a genuine re-upload would produce — identity
    // must come from the content, not from the import.
    const again = await store.putStatement(s, meta({ statementId: 'second' }));

    expect(again.kind).toBe('duplicate_statement');
    expect(await store.listTransactions({})).toHaveLength(1);
    expect(await store.listImports()).toHaveLength(1);
  });
});

describe('memory store — overlapping periods', () => {
  const janMar = statement({
    account: axis,
    periodStart: '2025-01-01',
    periodEnd: '2025-03-31',
    transactions: [
      row('2025-01-15', 100, 900),
      row('2025-02-15', 200, 700),
      row('2025-03-15', 300, 400),
    ],
  });
  const febApr = statement({
    account: axis,
    periodStart: '2025-02-01',
    periodEnd: '2025-04-30',
    transactions: [
      row('2025-02-15', 200, 700), // same row, from the overlap
      row('2025-03-15', 300, 400), // same row, from the overlap
      row('2025-04-15', 400, 0),
    ],
  });

  it('adds only the rows the earlier statement did not have', async () => {
    const store = createMemoryStore();
    await store.putStatement(janMar, meta({ statementId: 'a' }));
    const second = await store.putStatement(febApr, meta({ statementId: 'b' }));

    if (second.kind !== 'imported') throw new Error('expected imported');
    expect(second.record.transactionsImported).toBe(1); // only April
    expect(second.record.transactionsSkipped).toBe(2);
    expect(await store.listTransactions({})).toHaveLength(4);
  });

  it('reaches the same rows whichever order the statements arrive in', async () => {
    const forward = createMemoryStore();
    await forward.putStatement(janMar, meta({ statementId: 'a' }));
    await forward.putStatement(febApr, meta({ statementId: 'b' }));

    const reverse = createMemoryStore();
    await reverse.putStatement(febApr, meta({ statementId: 'b' }));
    await reverse.putStatement(janMar, meta({ statementId: 'a' }));

    const dates = (rows: readonly { date: string }[]) => rows.map((r) => r.date);
    expect(dates(await reverse.listTransactions({}))).toEqual(
      dates(await forward.listTransactions({})),
    );
  });
});

describe('memory store — genuinely identical rows', () => {
  // Two ₹50 payments to the same payee on the same day, with no printed balance
  // to tell them apart. Collapsing them would understate spend — the invisible
  // failure the occurrence counter exists to prevent.
  const twins = [row('2025-08-02', 5000, null, 'UPI/CHAIWALA'), row('2025-08-02', 5000, null, 'UPI/CHAIWALA')];

  it('keeps both when they are in one statement', async () => {
    const store = createMemoryStore();
    const summary = await store.putStatement(
      statement({ account: axis, transactions: twins }),
      meta(),
    );
    if (summary.kind !== 'imported') throw new Error('expected imported');
    expect(summary.record.transactionsImported).toBe(2);
  });

  it('skips both when the same pair arrives again from an overlapping period', async () => {
    const store = createMemoryStore();
    await store.putStatement(
      statement({ account: axis, periodStart: '2025-08-01', periodEnd: '2025-08-31', transactions: twins }),
      meta({ statementId: 'a' }),
    );
    const second = await store.putStatement(
      statement({
        account: axis,
        periodStart: '2025-08-15',
        periodEnd: '2025-09-15',
        transactions: [...twins, row('2025-09-02', 100, null)],
      }),
      meta({ statementId: 'b' }),
    );

    if (second.kind !== 'imported') throw new Error('expected imported');
    expect(second.record.transactionsSkipped).toBe(2);
    expect(second.record.transactionsImported).toBe(1);
  });

  it('adds only the extra copy when a third identical row appears', async () => {
    const store = createMemoryStore();
    await store.putStatement(
      statement({ account: axis, periodStart: '2025-08-01', periodEnd: '2025-08-31', transactions: twins }),
      meta({ statementId: 'a' }),
    );
    const second = await store.putStatement(
      statement({
        account: axis,
        periodStart: '2025-08-01',
        periodEnd: '2025-09-30',
        transactions: [...twins, row('2025-08-02', 5000, null, 'UPI/CHAIWALA')],
      }),
      meta({ statementId: 'b' }),
    );

    if (second.kind !== 'imported') throw new Error('expected imported');
    expect(second.record.transactionsImported).toBe(1);
    expect(await store.listTransactions({})).toHaveLength(3);
  });
});

describe('memory store — reading', () => {
  it('keeps accounts separate even when their rows are identical', async () => {
    const store = createMemoryStore();
    await store.putStatement(
      statement({ account: axis, transactions: [row('2025-08-02', 100, 900)] }),
      meta({ statementId: 'a' }),
    );
    await store.putStatement(
      statement({
        account: icici,
        transactions: [
          txn({ accountId: icici.id, date: '2025-08-02', type: 'debit', amount: 100, balanceAfter: 900, description: 'UPI/X' }),
        ],
      }),
      meta({ statementId: 'b' }),
    );

    expect(await store.listTransactions({})).toHaveLength(2);
    expect(await store.listTransactions({ accountId: axis.id })).toHaveLength(1);
    expect(await store.listAccounts()).toHaveLength(2);
  });

  it('filters by date range inclusively at both ends', async () => {
    const store = createMemoryStore();
    await store.putStatement(
      statement({
        account: axis,
        transactions: [
          row('2025-08-01', 100, 900),
          row('2025-08-15', 200, 700),
          row('2025-08-31', 300, 400),
        ],
      }),
      meta(),
    );

    const rows = await store.listTransactions({ from: '2025-08-01', to: '2025-08-31' });
    expect(rows).toHaveLength(3);
    expect(await store.listTransactions({ from: '2025-08-02', to: '2025-08-30' })).toHaveLength(1);
  });

  it('returns rows in date order regardless of write order', async () => {
    const store = createMemoryStore();
    await store.putStatement(
      statement({
        account: axis,
        periodStart: '2025-09-01',
        periodEnd: '2025-09-30',
        transactions: [row('2025-09-05', 100, 900)],
      }),
      meta({ statementId: 'later' }),
    );
    await store.putStatement(
      statement({
        account: axis,
        periodStart: '2025-08-01',
        periodEnd: '2025-08-31',
        transactions: [row('2025-08-05', 100, 900)],
      }),
      meta({ statementId: 'earlier' }),
    );

    expect((await store.listTransactions({})).map((r) => r.date)).toEqual([
      '2025-08-05',
      '2025-09-05',
    ]);
  });

  it('clears everything', async () => {
    const store = createMemoryStore();
    await store.putStatement(
      statement({ account: axis, transactions: [row('2025-08-02', 100, 900)] }),
      meta(),
    );
    await store.clear();

    expect(await store.listTransactions({})).toHaveLength(0);
    expect(await store.listAccounts()).toHaveLength(0);
    expect(await store.listImports()).toHaveLength(0);
  });
});
