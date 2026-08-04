import { describe, it, expect } from 'vitest';
import {
  aggregate,
  resolveRange,
  type AggregateOptions,
  type AggregationInput,
} from '../../src/engine/aggregate.ts';
import type { ImportRecord } from '../../src/storage/store.ts';
import { account, txn } from '../fixtures/canonical.ts';

const axis = account({ institution: 'Axis Bank', identifierMasked: 'XXXX4567' });
const icici = account({ institution: 'ICICI Bank', identifierMasked: 'XXXX3458' });

const OPTIONS: AggregateOptions = { window: 12, today: '2025-09-15' };

function record(over: Partial<ImportRecord> = {}): ImportRecord {
  return {
    statementId: 's1',
    accountId: axis.id,
    fileName: 'a.pdf',
    importedAt: '2025-09-01T00:00:00Z',
    periodStart: '2025-08-01',
    periodEnd: '2025-08-31',
    openingBalance: 0,
    closingBalance: 100000,
    transactionsImported: 0,
    transactionsSkipped: 0,
    issues: [],
    ...over,
  };
}

function ready(input: AggregationInput, options: AggregateOptions = OPTIONS) {
  const state = aggregate(input, options);
  if (state.kind !== 'ready') throw new Error('expected a ready dashboard');
  return state;
}

describe('resolveRange', () => {
  it('is null with nothing imported', () => {
    expect(resolveRange([], 6)).toBeNull();
  });

  it('anchors to the newest imported month, not to today', () => {
    // The user imported last year's statements; the window must land on the data.
    const range = resolveRange([record({ periodStart: '2024-01-01', periodEnd: '2024-06-30' })], 3);
    expect(range).toEqual({ from: '2024-04', to: '2024-06' });
  });

  it('clamps the window start to the oldest imported month', () => {
    const range = resolveRange(
      [record({ periodStart: '2025-07-01', periodEnd: '2025-08-31' })],
      12,
    );
    expect(range).toEqual({ from: '2025-07', to: '2025-08' });
  });

  it("'all' spans everything imported", () => {
    const range = resolveRange(
      [
        record({ periodStart: '2024-11-01', periodEnd: '2024-11-30' }),
        record({ periodStart: '2025-08-01', periodEnd: '2025-08-31' }),
      ],
      'all',
    );
    expect(range).toEqual({ from: '2024-11', to: '2025-08' });
  });
});

describe('net position', () => {
  it('sums the latest closing balance of each account', () => {
    const dashboard = ready({
      accounts: [axis, icici],
      imports: [
        record({ accountId: axis.id, closingBalance: 549950 }),
        record({ accountId: icici.id, statementId: 's2', closingBalance: 130000 }),
      ],
      transactions: [],
    });

    expect(dashboard.netPosition.total).toBe(679950);
    expect(dashboard.netPosition.accounts).toHaveLength(2);
  });

  it('takes the newest statement per account, never the sum of them', () => {
    // Jan–Mar closing + Feb–Apr closing is not a balance; it is two snapshots of
    // the same account added together.
    const dashboard = ready({
      accounts: [axis],
      imports: [
        record({
          statementId: 'a',
          periodStart: '2025-01-01',
          periodEnd: '2025-03-31',
          closingBalance: 100000,
        }),
        record({
          statementId: 'b',
          periodStart: '2025-02-01',
          periodEnd: '2025-04-30',
          closingBalance: 250000,
        }),
      ],
      transactions: [],
    });

    expect(dashboard.netPosition.total).toBe(250000);
    expect(dashboard.netPosition.accounts[0]?.asOf).toBe('2025-04-30');
  });

  it('is unaffected by the order statements were imported in', () => {
    const older = record({
      statementId: 'a',
      periodStart: '2025-07-01',
      periodEnd: '2025-07-31',
      closingBalance: 100000,
    });
    const newer = record({ statementId: 'b', periodEnd: '2025-08-31', closingBalance: 250000 });

    const forward = ready({ accounts: [axis], imports: [older, newer], transactions: [] });
    const reverse = ready({ accounts: [axis], imports: [newer, older], transactions: [] });

    expect(reverse.netPosition.total).toBe(forward.netPosition.total);
    expect(reverse.netPosition.asOf).toBe(forward.netPosition.asOf);
  });

  it('dates the total by the OLDEST account, not the newest', () => {
    // A sum of balances taken on different days is only true as of the earliest.
    const dashboard = ready({
      accounts: [axis, icici],
      imports: [
        record({ accountId: axis.id, periodEnd: '2025-08-31' }),
        record({
          accountId: icici.id,
          statementId: 's2',
          periodStart: '2025-05-01',
          periodEnd: '2025-05-31',
        }),
      ],
      transactions: [],
    });

    expect(dashboard.netPosition.asOf).toBe('2025-05-31');
    expect(dashboard.netPosition.newestAsOf).toBe('2025-08-31');
  });

  it('counts a liability against the total', () => {
    const card = account({
      institution: 'Axis Bank',
      identifierMasked: 'XXXX9999',
      isLiability: true,
    });
    const dashboard = ready({
      accounts: [axis, card],
      imports: [
        record({ accountId: axis.id, closingBalance: 500000 }),
        record({ accountId: card.id, statementId: 's2', closingBalance: 120000 }),
      ],
      transactions: [],
    });

    expect(dashboard.netPosition.total).toBe(380000);
  });

  it('leaves a non-rupee account out of the total and names it', () => {
    const foreign = {
      ...account({ institution: 'Foreign', identifierMasked: 'XXXX1111' }),
      currency: 'USD' as unknown as 'INR',
    };
    const dashboard = ready({
      accounts: [axis, foreign],
      imports: [
        record({ accountId: axis.id, closingBalance: 500000 }),
        record({ accountId: foreign.id, statementId: 's2', closingBalance: 999999 }),
      ],
      transactions: [],
    });

    expect(dashboard.netPosition.total).toBe(500000);
    expect(dashboard.netPosition.excluded).toEqual([{ accountId: foreign.id, reason: 'currency' }]);
  });
});

describe('monthly coverage', () => {
  it('counts a covered month with no transactions as a real zero month', () => {
    const dashboard = ready({
      accounts: [axis],
      imports: [record({ periodStart: '2025-07-01', periodEnd: '2025-08-31' })],
      transactions: [
        txn({ accountId: axis.id, date: '2025-08-10', type: 'credit', amount: 50000 }),
      ],
    });

    const july = dashboard.flows.find((flow) => flow.month === '2025-07');
    expect(july?.coverage).toBe('complete');
    expect(july?.inflow).toBe(0);
    // A genuine ₹0 month counts, so the average is over both months.
    expect(dashboard.averages.income.months).toBe(2);
    expect(dashboard.averages.income.mean).toBe(25000);
  });

  it('excludes a month no statement covers rather than averaging it as zero', () => {
    const dashboard = ready({
      accounts: [axis],
      imports: [
        record({ statementId: 'a', periodStart: '2025-06-01', periodEnd: '2025-06-30' }),
        record({ statementId: 'b', periodStart: '2025-08-01', periodEnd: '2025-08-31' }),
      ],
      transactions: [
        txn({ accountId: axis.id, date: '2025-06-10', type: 'credit', amount: 100000 }),
        txn({ accountId: axis.id, date: '2025-08-10', type: 'credit', amount: 100000 }),
      ],
    });

    expect(dashboard.flows.find((flow) => flow.month === '2025-07')?.coverage).toBe('none');
    expect(dashboard.averages.income.months).toBe(2);
    // Counting the gap as ₹0 would have made this 66,667 — quietly wrong.
    expect(dashboard.averages.income.mean).toBe(100000);
    expect(dashboard.averages.monthsExcluded).toContainEqual({
      month: '2025-07',
      reason: 'no_coverage',
    });
  });

  it('excludes a partly covered edge month', () => {
    const dashboard = ready({
      accounts: [axis],
      imports: [record({ periodStart: '2025-07-15', periodEnd: '2025-08-31' })],
      transactions: [
        txn({ accountId: axis.id, date: '2025-08-10', type: 'credit', amount: 60000 }),
      ],
    });

    expect(dashboard.flows.find((flow) => flow.month === '2025-07')?.coverage).toBe('partial');
    expect(dashboard.averages.income.months).toBe(1);
    expect(dashboard.averages.monthsExcluded).toContainEqual({
      month: '2025-07',
      reason: 'partial_coverage',
    });
  });

  it('unions overlapping periods rather than summing their days', () => {
    // Jan–Mar and Feb–Apr both cover February. Summed, February would look like
    // 56 days covered; unioned it is 28, which is what "complete" must mean.
    const dashboard = ready({
      accounts: [axis],
      imports: [
        record({ statementId: 'a', periodStart: '2025-01-01', periodEnd: '2025-03-31' }),
        record({ statementId: 'b', periodStart: '2025-02-01', periodEnd: '2025-04-30' }),
      ],
      transactions: [],
    });

    expect(dashboard.flows.find((flow) => flow.month === '2025-02')?.coverage).toBe('complete');
  });

  it('marks a month partial when one account has no statement for it, and names it', () => {
    const dashboard = ready({
      accounts: [axis, icici],
      imports: [
        record({
          accountId: axis.id,
          statementId: 'a',
          periodStart: '2025-07-01',
          periodEnd: '2025-08-31',
        }),
        record({
          accountId: icici.id,
          statementId: 'b',
          periodStart: '2025-08-01',
          periodEnd: '2025-08-31',
        }),
      ],
      transactions: [],
    });

    const july = dashboard.flows.find((flow) => flow.month === '2025-07');
    expect(july?.coverage).toBe('partial');
    expect(july?.missingAccounts).toEqual(['ICICI Bank 3458']);
  });
});

describe('averages', () => {
  const threeMonths: AggregationInput = {
    accounts: [axis],
    imports: [record({ periodStart: '2025-06-01', periodEnd: '2025-08-31' })],
    transactions: [
      txn({ accountId: axis.id, date: '2025-06-10', type: 'credit', amount: 100000 }),
      txn({ accountId: axis.id, date: '2025-06-20', type: 'debit', amount: 40000 }),
      txn({ accountId: axis.id, date: '2025-07-10', type: 'credit', amount: 200000 }),
      txn({ accountId: axis.id, date: '2025-07-20', type: 'debit', amount: 50000 }),
      txn({ accountId: axis.id, date: '2025-08-10', type: 'credit', amount: 300000 }),
      txn({ accountId: axis.id, date: '2025-08-20', type: 'debit', amount: 60000 }),
    ],
  };

  it('computes mean, min, and max exactly', () => {
    const { averages } = ready(threeMonths);
    expect(averages.income.mean).toBe(200000); // (1L + 2L + 3L) / 3
    expect(averages.income.min).toBe(100000);
    expect(averages.income.max).toBe(300000);
    expect(averages.spend.mean).toBe(50000);
    expect(averages.savings.mean).toBe(150000); // (60k + 150k + 240k) / 3
  });

  it('reports population standard deviation', () => {
    const { averages } = ready(threeMonths);
    // Incomes 1L/2L/3L → σ = sqrt((100000² + 0 + 100000²)/3) ≈ 81650
    expect(averages.income.stdDev).toBe(81650);
  });

  it('derives average savings from the monthly nets, not from the other means', () => {
    // Rounded independently, mean(income) − mean(spend) can disagree with
    // mean(net) by a paise; savings must come from the nets themselves.
    const input: AggregationInput = {
      accounts: [axis],
      imports: [record({ periodStart: '2025-07-01', periodEnd: '2025-08-31' })],
      transactions: [
        txn({ accountId: axis.id, date: '2025-07-10', type: 'credit', amount: 101 }),
        txn({ accountId: axis.id, date: '2025-08-10', type: 'debit', amount: 1 }),
      ],
    };
    const { averages } = ready(input);
    expect(averages.savings.mean).toBe(50); // (101 + −1) / 2 = 50
  });

  it('flags a single month instead of showing a zero spread', () => {
    const dashboard = ready({
      accounts: [axis],
      imports: [record({ periodStart: '2025-08-01', periodEnd: '2025-08-31' })],
      transactions: [
        txn({ accountId: axis.id, date: '2025-08-10', type: 'credit', amount: 50000 }),
      ],
    });

    expect(dashboard.averages.income.months).toBe(1);
    expect(dashboard.averages.income.stdDev).toBe(0);
    expect(dashboard.caveats.map((c) => c.id)).toContain('single_month');
  });

  it('says how many months a short window actually covers', () => {
    const dashboard = ready(threeMonths, { window: 12, today: '2025-09-15' });
    const caveat = dashboard.caveats.find((c) => c.id === 'short_window');
    expect(caveat?.text).toContain('3 full months');
  });
});

describe('cumulative savings', () => {
  it('is the running sum of monthly net over covered months', () => {
    const dashboard = ready({
      accounts: [axis],
      imports: [record({ periodStart: '2025-06-01', periodEnd: '2025-08-31' })],
      transactions: [
        txn({ accountId: axis.id, date: '2025-06-10', type: 'credit', amount: 10000 }),
        txn({ accountId: axis.id, date: '2025-07-10', type: 'debit', amount: 4000 }),
        txn({ accountId: axis.id, date: '2025-08-10', type: 'credit', amount: 2000 }),
      ],
    });

    expect(dashboard.cumulative.map((p) => p.cumulativeNet)).toEqual([10000, 6000, 8000]);
  });
});

describe('reconciliation with the underlying rows', () => {
  it('total inflow across the window equals the sum of credits in it', () => {
    // The acceptance criterion — "every number reconciles exactly to the
    // transactions behind it" — as a property rather than a claim.
    const transactions = [
      txn({ accountId: axis.id, date: '2025-06-10', type: 'credit', amount: 12345 }),
      txn({ accountId: axis.id, date: '2025-07-02', type: 'credit', amount: 6789 }),
      txn({ accountId: axis.id, date: '2025-07-20', type: 'debit', amount: 4321 }),
      txn({ accountId: axis.id, date: '2025-08-31', type: 'credit', amount: 111 }),
    ];
    const dashboard = ready({
      accounts: [axis],
      imports: [record({ periodStart: '2025-06-01', periodEnd: '2025-08-31' })],
      transactions,
    });

    const credits = transactions
      .filter((t) => t.type === 'credit')
      .reduce((n, t) => n + t.amount, 0);
    const debits = transactions.filter((t) => t.type === 'debit').reduce((n, t) => n + t.amount, 0);

    expect(dashboard.flows.reduce((n, f) => n + f.inflow, 0)).toBe(credits);
    expect(dashboard.flows.reduce((n, f) => n + f.outflow, 0)).toBe(debits);
  });
});

describe('internal transfers', () => {
  /** One statement per account, both covering August in full. */
  const bothAccounts = [
    record({ statementId: 's1', accountId: axis.id }),
    record({ statementId: 's2', accountId: icici.id }),
  ];

  it('excludes both legs of a transfer from income and spend', () => {
    const withTransfer = ready({
      accounts: [axis, icici],
      imports: bothAccounts,
      transactions: [
        txn({
          id: 'salary',
          accountId: axis.id,
          date: '2025-08-01',
          type: 'credit',
          amount: 1_00_000_00,
          description: 'SALARY AUG',
        }),
        txn({
          id: 'food',
          accountId: axis.id,
          date: '2025-08-04',
          type: 'debit',
          amount: 1_200_00,
          description: 'UPI SWIGGY',
        }),
        // The pair: ₹50,000 leaves Axis and arrives at ICICI a day later.
        txn({
          id: 'out',
          accountId: axis.id,
          date: '2025-08-10',
          type: 'debit',
          amount: 50_000_00,
          description: 'NEFT TFR',
        }),
        txn({
          id: 'in',
          accountId: icici.id,
          date: '2025-08-11',
          type: 'credit',
          amount: 50_000_00,
          description: 'NEFT CR',
        }),
      ],
    });

    const august = withTransfer.flows.find((f) => f.month === '2025-08')!;
    // Neither leg counted: income is the salary alone, spend the lunch alone.
    expect(august.inflow).toBe(1_00_000_00);
    expect(august.outflow).toBe(1_200_00);
    expect(august.txnCount).toBe(2);
  });

  it('keeps a same-account credit and debit that merely share an amount', () => {
    const noTransfer = ready({
      accounts: [axis],
      imports: [record()],
      transactions: [
        txn({
          id: 'a',
          accountId: axis.id,
          date: '2025-08-10',
          type: 'debit',
          amount: 900_00,
          description: 'POS PURCHASE',
        }),
        txn({
          id: 'b',
          accountId: axis.id,
          date: '2025-08-10',
          type: 'credit',
          amount: 900_00,
          description: 'POS REVERSAL',
        }),
      ],
    });

    const august = noTransfer.flows.find((f) => f.month === '2025-08')!;
    expect(august.inflow).toBe(900_00);
    expect(august.outflow).toBe(900_00);
  });

  it('leaves a transfer out of the category breakdown entirely', () => {
    const dashboard = ready({
      accounts: [axis, icici],
      imports: bothAccounts,
      transactions: [
        txn({
          id: 'food',
          accountId: axis.id,
          date: '2025-08-04',
          type: 'debit',
          amount: 1_000_00,
          description: 'UPI SWIGGY',
        }),
        txn({
          id: 'out',
          accountId: axis.id,
          date: '2025-08-10',
          type: 'debit',
          amount: 50_000_00,
          description: 'NEFT TFR',
        }),
        txn({
          id: 'in',
          accountId: icici.id,
          date: '2025-08-11',
          type: 'credit',
          amount: 50_000_00,
          description: 'NEFT CR',
        }),
      ],
    });

    expect(dashboard.spendByCategory).toHaveLength(1);
    expect(dashboard.spendByCategory[0]).toMatchObject({
      category: 'food_dining',
      total: 1_000_00,
      txnCount: 1,
      // The transfer is not in the denominator either — it is not spend at all.
      share: 1,
    });
  });
});

describe('spend by category', () => {
  it('ranks categories by amount and shares them over all spend', () => {
    const dashboard = ready({
      accounts: [axis],
      imports: [record()],
      transactions: [
        txn({
          id: 'a',
          accountId: axis.id,
          date: '2025-08-02',
          type: 'debit',
          amount: 6_000_00,
          description: 'UPI SWIGGY',
        }),
        txn({
          id: 'b',
          accountId: axis.id,
          date: '2025-08-03',
          type: 'debit',
          amount: 2_000_00,
          description: 'UPI BIGBASKET',
        }),
        txn({
          id: 'c',
          accountId: axis.id,
          date: '2025-08-04',
          type: 'debit',
          amount: 2_000_00,
          description: 'REF 8812',
        }),
      ],
    });

    expect(dashboard.spendByCategory.map((c) => c.category)).toEqual(['food_dining', 'groceries']);
    expect(dashboard.spendByCategory[0]?.label).toBe('Food & dining');
    // 6,000 of 10,000 total spend — the unclassified 2,000 stays in the
    // denominator, so a category cannot look bigger the less we understand.
    expect(dashboard.spendByCategory[0]?.share).toBeCloseTo(0.6, 10);
    expect(dashboard.coverage.countRate).toBeCloseTo(2 / 3, 10);
    expect(dashboard.coverage.amountRate).toBeCloseTo(0.8, 10);
    expect(dashboard.coverage.unclassifiedSpend).toBe(2_000_00);
    expect(dashboard.coverage.unclassifiedCount).toBe(1);
  });

  it('reports full coverage rather than dividing by zero when there is no spend', () => {
    const dashboard = ready({ accounts: [axis], imports: [record()], transactions: [] });
    expect(dashboard.spendByCategory).toEqual([]);
    expect(dashboard.coverage.countRate).toBe(1);
    expect(dashboard.coverage.amountRate).toBe(1);
  });

  it('keeps transaction coverage honest when a large labelled row dominates the amount', () => {
    const dashboard = ready({
      accounts: [axis],
      imports: [record()],
      transactions: [
        txn({
          id: 'large',
          accountId: axis.id,
          date: '2025-08-01',
          type: 'debit',
          amount: 1_00_000_00,
          description: 'UPI SWIGGY',
        }),
        ...Array.from({ length: 9 }, (_, index) =>
          txn({
            id: `unknown-${index}`,
            accountId: axis.id,
            date: '2025-08-02',
            type: 'debit',
            amount: 1,
            description: `REF ${index}`,
          }),
        ),
      ],
    });

    expect(dashboard.coverage.countRate).toBe(0.1);
    expect(dashboard.coverage.amountRate).toBeGreaterThan(0.999);
    expect(dashboard.coverage.unclassifiedCount).toBe(9);
  });

  it('counts uncategorized credits even when every spending row is categorized', () => {
    const dashboard = ready({
      accounts: [axis],
      imports: [record()],
      transactions: [
        txn({
          id: 'food',
          accountId: axis.id,
          date: '2025-08-01',
          type: 'debit',
          amount: 500_00,
          description: 'UPI SWIGGY',
        }),
        txn({
          id: 'unknown-credit',
          accountId: axis.id,
          date: '2025-08-02',
          type: 'credit',
          amount: 100_00,
          description: 'REF 12345',
        }),
      ],
    });

    expect(dashboard.coverage.countRate).toBe(0.5);
    expect(dashboard.coverage.amountRate).toBe(1);
    expect(dashboard.coverage.unclassifiedCount).toBe(1);
    expect(dashboard.coverage.unclassifiedSpend).toBe(0);
  });
});

describe('savings rate', () => {
  it('is savings over income across the counted months', () => {
    const dashboard = ready({
      accounts: [axis],
      imports: [record()],
      transactions: [
        txn({
          id: 'a',
          accountId: axis.id,
          date: '2025-08-01',
          type: 'credit',
          amount: 1_00_000_00,
          description: 'SALARY',
        }),
        txn({
          id: 'b',
          accountId: axis.id,
          date: '2025-08-05',
          type: 'debit',
          amount: 75_000_00,
          description: 'UPI SWIGGY',
        }),
      ],
    });

    expect(dashboard.savingsRate).toBeCloseTo(0.25, 10);
  });

  it('is null rather than 0% when no income was recorded', () => {
    // A zero denominator is unanswerable; printing 0% would read as "you saved
    // nothing", which is a different and wrong claim.
    const dashboard = ready({
      accounts: [axis],
      imports: [record()],
      transactions: [
        txn({ id: 'b', accountId: axis.id, date: '2025-08-05', type: 'debit', amount: 5_000_00 }),
      ],
    });

    expect(dashboard.savingsRate).toBeNull();
  });
});

describe('caveats', () => {
  it('no longer carries a standing self-transfer warning', () => {
    const dashboard = ready({
      accounts: [axis],
      imports: [record()],
      transactions: [],
    });

    // Transfers are detected and excluded now, so the caveat the engine used to
    // emit unconditionally would be claiming a distortion that no longer exists.
    expect(dashboard.caveats.map((c) => c.id)).not.toContain('unclassified_spend');
    expect(dashboard.caveats.every((c) => c.id !== ('self_transfers' as string))).toBe(true);
  });

  it('notes unclassified spend only once it is material', () => {
    // One recognised merchant, one narration nothing can label: 50% unlabelled.
    const dashboard = ready({
      accounts: [axis],
      imports: [record()],
      transactions: [
        txn({
          id: 't1',
          date: '2025-08-05',
          type: 'debit',
          amount: 50_000,
          description: 'UPI/SWIGGY/123/PAY',
        }),
        txn({
          id: 't2',
          date: '2025-08-06',
          type: 'debit',
          amount: 50_000,
          description: 'REF 99812734',
        }),
      ],
    });

    const caveat = dashboard.caveats.find((c) => c.id === 'unclassified_spend');
    expect(caveat).toBeDefined();
    expect(caveat?.affects).toEqual(['spend']);
    expect(caveat?.severity).toBe('note');
  });

  it('warns when a statement was flagged during import', () => {
    const dashboard = ready({
      accounts: [axis],
      imports: [record({ issues: ['Opening-balance row not found.'] })],
      transactions: [],
    });

    expect(dashboard.caveats.map((c) => c.id)).toContain('flagged_statements');
    expect(dashboard.netPosition.accounts[0]?.hasFlaggedStatements).toBe(true);
  });

  it('warns when an account has no statement inside the window', () => {
    const dashboard = ready(
      {
        accounts: [axis, icici],
        imports: [
          record({ accountId: axis.id, periodStart: '2025-08-01', periodEnd: '2025-08-31' }),
          record({
            accountId: icici.id,
            statementId: 's2',
            periodStart: '2025-01-01',
            periodEnd: '2025-01-31',
          }),
        ],
        transactions: [],
      },
      { window: 3, today: '2025-09-15' },
    );

    expect(dashboard.caveats.map((c) => c.id)).toContain('stale_data');
    expect(
      dashboard.netPosition.accounts.find((a) => a.accountId === icici.id)?.staleForWindow,
    ).toBe(true);
  });
});

describe('empty state', () => {
  it('reports empty when nothing has been imported', () => {
    expect(aggregate({ accounts: [], imports: [], transactions: [] }, OPTIONS).kind).toBe('empty');
  });
});

describe('staleness against the wall clock', () => {
  it('measures how far the newest statement is behind today', () => {
    const dashboard = ready(
      {
        accounts: [axis],
        imports: [record({ periodStart: '2025-05-01', periodEnd: '2025-05-31' })],
        transactions: [],
      },
      { window: 6, today: '2025-09-15' },
    );

    expect(dashboard.monthsSinceLatestStatement).toBe(4);
  });
});
