import { describe, expect, it } from 'vitest';
import {
  buildTransactionRegister,
  loadTransactionRegister,
  type TransactionRegisterInput,
} from '../../src/engine/transactions.ts';
import type { ClassifyContext } from '../../src/enrichment/classify.ts';
import { createMemoryStore } from '../../src/storage/memoryStore.ts';
import { account, statement, txn } from '../fixtures/canonical.ts';

const axis = account({ institution: 'Axis Bank', identifierMasked: 'XXXX1111' });
const icici = account({ institution: 'ICICI Bank', identifierMasked: 'XXXX2222' });

function row(
  id: string,
  over: Partial<ReturnType<typeof txn>> & Pick<ReturnType<typeof txn>, 'date' | 'type' | 'amount'>,
) {
  return txn({ id, accountId: axis.id, ...over });
}

function input(rows: readonly ReturnType<typeof txn>[]): TransactionRegisterInput {
  return { accounts: [axis, icici], transactions: rows };
}

describe('transaction register — filtering and enrichment', () => {
  it('sorts newest first with stable account and id tie-breakers', () => {
    const rows = [
      row('z', { date: '2025-07-01', type: 'debit', amount: 1 }),
      row('b', { date: '2025-08-01', type: 'debit', amount: 1 }),
      txn({ id: 'c', accountId: icici.id, date: '2025-08-01', type: 'debit', amount: 1 }),
      row('a', { date: '2025-08-01', type: 'debit', amount: 1 }),
    ];

    expect(buildTransactionRegister(input(rows)).rows.map((r) => r.transaction.id)).toEqual([
      'a',
      'b',
      'c',
      'z',
    ]);
  });

  it('searches narration case- and punctuation-insensitively', () => {
    const rows = [
      row('match', {
        date: '2025-08-01',
        type: 'debit',
        amount: 1,
        description: 'UPI/RAHUL-SHARMA/123/PAY',
      }),
      row('miss', { date: '2025-08-02', type: 'debit', amount: 1, description: 'ATM WDL' }),
    ];

    expect(
      buildTransactionRegister(input(rows), { search: 'rahul sharma' }).rows.map(
        (r) => r.transaction.id,
      ),
    ).toEqual(['match']);
    expect(buildTransactionRegister(input(rows), { search: ' / ' }).totalRows).toBe(2);
  });

  it('searches the counterparty selected by classification', () => {
    const rows = [
      row('match', {
        date: '2025-08-01',
        type: 'debit',
        amount: 1,
        description: 'POS SWIGGYINSTAMART BLR',
      }),
    ];

    const result = buildTransactionRegister(input(rows), { search: 'instamart' });
    expect(result.rows[0]?.classification.counterparty).toBe('INSTAMART');
  });

  it('filters by the category computed from stored-style overrides', () => {
    const rows = [
      row('mine', { date: '2025-08-01', type: 'debit', amount: 1, description: 'UNKNOWN' }),
      row('other', { date: '2025-08-02', type: 'debit', amount: 1, description: 'UNKNOWN' }),
    ];
    const context: ClassifyContext = {
      rules: [],
      overrides: new Map([['mine', 'travel']]),
    };

    const result = buildTransactionRegister(input(rows), { category: 'travel' }, context);
    expect(result.rows.map((r) => r.transaction.id)).toEqual(['mine']);
    expect(result.rows[0]?.classification.source).toBe('user');
  });

  it('can select unclassified rows explicitly', () => {
    const rows = [
      row('unknown', { date: '2025-08-01', type: 'debit', amount: 1, description: 'REF 123' }),
      row('food', { date: '2025-08-02', type: 'debit', amount: 1, description: 'UPI SWIGGY' }),
    ];
    expect(
      buildTransactionRegister(input(rows), { category: 'unclassified' }).rows.map(
        (r) => r.transaction.id,
      ),
    ).toEqual(['unknown']);
  });

  it('classifies the complete input before applying an account filter', () => {
    const debit = row('out', {
      date: '2025-08-10',
      type: 'debit',
      amount: 500_00,
      description: 'NEFT OUT',
    });
    const credit = txn({
      id: 'in',
      accountId: icici.id,
      date: '2025-08-11',
      type: 'credit',
      amount: 500_00,
      description: 'NEFT IN',
    });

    const result = buildTransactionRegister(input([debit, credit]), {
      accountId: axis.id,
      category: 'self_transfer',
    });
    expect(result.rows.map((r) => r.transaction.id)).toEqual(['out']);
  });

  it('combines account, inclusive date, category, and search filters', () => {
    const rows = [
      row('yes', {
        date: '2025-08-10',
        type: 'debit',
        amount: 1,
        description: 'UPI SWIGGY',
      }),
      row('early', {
        date: '2025-08-09',
        type: 'debit',
        amount: 1,
        description: 'UPI SWIGGY',
      }),
      txn({
        id: 'wrong-account',
        accountId: icici.id,
        date: '2025-08-10',
        type: 'debit',
        amount: 1,
        description: 'UPI SWIGGY',
      }),
    ];

    const result = buildTransactionRegister(input(rows), {
      accountId: axis.id,
      from: '2025-08-10',
      to: '2025-08-10',
      category: 'food_dining',
      search: 'swiggy',
    });
    expect(result.rows.map((r) => r.transaction.id)).toEqual(['yes']);
  });
});

describe('transaction register — paging', () => {
  const rows = [1, 2, 3, 4, 5].map((day) =>
    row(`t${day}`, { date: `2025-08-0${day}`, type: 'debit', amount: 1 }),
  );

  it('paginates only after filtering and reports full metadata', () => {
    const context: ClassifyContext = {
      rules: [],
      overrides: new Map([
        ['t1', 'shopping'],
        ['t3', 'shopping'],
        ['t5', 'shopping'],
      ]),
    };
    const result = buildTransactionRegister(
      input(rows),
      { category: 'shopping', page: 2, pageSize: 2 },
      context,
    );

    expect(result).toMatchObject({ page: 2, pageSize: 2, totalRows: 3, totalPages: 2 });
    expect(result.rows.map((r) => r.transaction.id)).toEqual(['t1']);
  });

  it('returns an empty page without clamping an out-of-range request', () => {
    const result = buildTransactionRegister(input(rows), { page: 9, pageSize: 2 });
    expect(result.rows).toEqual([]);
    expect(result.page).toBe(9);
    expect(result.totalRows).toBe(5);
  });

  it('uses the documented defaults', () => {
    const result = buildTransactionRegister(input([]));
    expect(result).toMatchObject({ page: 1, pageSize: 50, totalRows: 0, totalPages: 0 });
  });

  it.each([
    [{ page: 0 }, 'page'],
    [{ page: 1.5 }, 'page'],
    [{ pageSize: 0 }, 'pageSize'],
    [{ pageSize: 201 }, 'pageSize'],
    [{ pageSize: 1.5 }, 'pageSize'],
  ] as const)('rejects invalid paging %#', (query, field) => {
    expect(() => buildTransactionRegister(input(rows), query)).toThrow(field);
  });
});

describe('loadTransactionRegister', () => {
  it('loads the full import horizon and applies the store classification context', async () => {
    const store = createMemoryStore();
    await store.putStatement(
      statement({
        account: axis,
        periodStart: '2025-07-01',
        periodEnd: '2025-08-31',
        transactions: [
          row('july', { date: '2025-07-01', type: 'debit', amount: 1, description: 'REF 1' }),
          row('august', { date: '2025-08-01', type: 'debit', amount: 1, description: 'REF 2' }),
        ],
      }),
      {
        statementId: 'statement-1',
        fileName: 'axis.pdf',
        importedAt: '2025-09-01T00:00:00Z',
        issues: [],
      },
    );
    await store.putOverride('july', 'travel');

    const result = await loadTransactionRegister(store, { category: 'travel' });
    expect(result.rows.map((r) => r.transaction.id)).toEqual(['july']);
    expect(result.rows[0]?.account).toEqual({
      institution: 'Axis Bank',
      identifierMasked: 'XXXX1111',
    });
  });
});
