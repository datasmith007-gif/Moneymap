import { describe, expect, it } from 'vitest';
import {
  buildTransactionCsv,
  loadTransactionCsv,
  type TransactionRegisterInput,
} from '../../src/engine/transactions.ts';
import type { ClassifyContext } from '../../src/enrichment/classify.ts';
import { createMemoryStore } from '../../src/storage/memoryStore.ts';
import { account, statement, txn } from '../fixtures/canonical.ts';

const axis = account({ institution: 'Axis Bank', identifierMasked: 'XXXX1111' });

function input(
  rows: readonly ReturnType<typeof txn>[],
  accounts = [axis],
): TransactionRegisterInput {
  return { accounts, transactions: rows };
}

describe('transaction CSV — format', () => {
  it('emits the fixed audit columns, exact INR decimals, provenance, BOM, and CRLF', () => {
    const row = txn({
      id: 't1',
      accountId: axis.id,
      date: '2025-08-05',
      type: 'debit',
      amount: 123_481,
      balanceAfter: -5,
      description: 'UPI/RAHUL SHARMA/123/PAY',
      provenance: { statementId: 'axis-aug', page: 3, rawLine: 'not exported' },
    });
    const context: ClassifyContext = {
      rules: [],
      overrides: new Map([['t1', 'friends_family']]),
    };

    expect(buildTransactionCsv(input([row]), {}, context)).toBe(
      '\uFEFFdate,institution,account,transaction_id,type,description,counterparty,category_id,category,amount_inr,balance_after_inr,statement_id,source_page\r\n' +
        '2025-08-05,Axis Bank,XXXX1111,t1,debit,UPI/RAHUL SHARMA/123/PAY,RAHUL SHARMA,friends_family,Friends & family,1234.81,-0.05,axis-aug,3\r\n',
    );
  });

  it('leaves a missing running balance empty', () => {
    const row = txn({
      id: 't1',
      accountId: axis.id,
      date: '2025-08-05',
      type: 'credit',
      amount: 5,
      balanceAfter: null,
      description: 'REF 123',
    });

    const data = buildTransactionCsv(input([row])).split('\r\n')[1];
    expect(data).toContain(',0.05,,test,1');
  });

  it('quotes commas, quotes, and embedded newlines according to RFC 4180', () => {
    const row = txn({
      id: 't1',
      accountId: axis.id,
      date: '2025-08-05',
      type: 'debit',
      amount: 1,
      description: 'SHOP, "A"\r\nNEXT',
    });

    expect(buildTransactionCsv(input([row]))).toContain('"SHOP, ""A""\r\nNEXT"');
  });

  it('neutralizes spreadsheet formulas in text cells without changing numeric cells', () => {
    const unsafe = account({ institution: '+BANK', identifierMasked: '-MASK' });
    const row = txn({
      id: '@row',
      accountId: unsafe.id,
      date: '2025-08-05',
      type: 'debit',
      amount: 100,
      balanceAfter: -100,
      description: '=2+2',
      provenance: { statementId: '=statement', page: 1, rawLine: '' },
    });

    const csv = buildTransactionCsv(input([row], [unsafe]));
    expect(csv).toContain("'+BANK,'-MASK,'@row,debit,'=2+2");
    expect(csv).toContain(",1.00,-1.00,'=statement,1");
  });

  it('is byte-for-byte deterministic and preserves newest-first order', () => {
    const rows = [
      txn({ id: 'old', accountId: axis.id, date: '2025-07-01', type: 'debit', amount: 1 }),
      txn({ id: 'new', accountId: axis.id, date: '2025-08-01', type: 'debit', amount: 1 }),
    ];
    const first = buildTransactionCsv(input(rows));
    const second = buildTransactionCsv(input([...rows].reverse()));

    expect(second).toBe(first);
    expect(first.indexOf(',new,')).toBeLessThan(first.indexOf(',old,'));
  });
});

describe('transaction CSV — filter parity', () => {
  it('exports every filtered match without register pagination', () => {
    const rows = [1, 2, 3].map((day) =>
      txn({
        id: `t${day}`,
        accountId: axis.id,
        date: `2025-08-0${day}`,
        type: 'debit',
        amount: day,
        description: day === 2 ? 'REF OTHER' : 'UPI SWIGGY',
      }),
    );

    const csv = buildTransactionCsv(input(rows), {
      from: '2025-08-01',
      to: '2025-08-03',
      category: 'food_dining',
      search: 'swiggy',
    });
    expect(csv).toContain(',t3,');
    expect(csv).toContain(',t1,');
    expect(csv).not.toContain(',t2,');
    expect(csv.split('\r\n')).toHaveLength(4); // header + two rows + final empty item
  });

  it('loads stored overrides through the same enrichment path', async () => {
    const store = createMemoryStore();
    const row = txn({
      id: 'stored',
      accountId: axis.id,
      date: '2025-08-05',
      type: 'debit',
      amount: 1,
      description: 'REF 123',
    });
    await store.putStatement(statement({ account: axis, transactions: [row] }), {
      statementId: 's1',
      fileName: 'axis.pdf',
      importedAt: '2025-09-01T00:00:00Z',
      issues: [],
    });
    await store.putOverride('stored', 'travel');

    const csv = await loadTransactionCsv(store, { category: 'travel' });
    expect(csv).toContain(',stored,');
    expect(csv).toContain(',travel,Travel,');
  });
});
