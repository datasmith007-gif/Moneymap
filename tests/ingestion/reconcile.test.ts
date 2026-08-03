import { describe, it, expect } from 'vitest';
import { reconcile, reconcileOutcome, runningBalanceBreaks } from '../../src/ingestion/reconcile.ts';
import { AxisParser } from '../../src/ingestion/parsers/axis.ts';
import type { ParseContext } from '../../src/ingestion/parser.ts';
import type { ParseOutcome } from '../../src/ingestion/outcome.ts';
import type { Account, ParsedStatement, Transaction } from '../../src/model/canonical.ts';
import { axisSyntheticDoc } from '../fixtures/statements.ts';

const account: Account = {
  id: 'a',
  type: 'savings',
  institution: 'Test',
  identifierMasked: 'XXXX0000',
  currency: 'INR',
  isLiability: false,
  source: 'upload',
  lastUpdated: '2026-07-22T00:00:00Z',
};

function txn(over: Partial<Transaction> & Pick<Transaction, 'date' | 'type' | 'amount' | 'balanceAfter'>): Transaction {
  return {
    id: 'x',
    accountId: 'a',
    description: '',
    provenance: { statementId: 'test', page: 1, rawLine: '' },
    ...over,
  };
}

/** A statement that reconciles cleanly: 1000.00 − 200.00 + 5000.00 − 300.50 = 5499.50. */
function goodStatement(over: Partial<ParsedStatement> = {}): ParsedStatement {
  return {
    account,
    transactions: [
      txn({ date: '2025-08-02', type: 'debit', amount: 20000, balanceAfter: 80000 }),
      txn({ date: '2025-08-03', type: 'credit', amount: 500000, balanceAfter: 580000 }),
      txn({ date: '2025-08-04', type: 'debit', amount: 30050, balanceAfter: 549950 }),
    ],
    openingBalance: 100000,
    closingBalance: 549950,
    periodStart: '2025-08-01',
    periodEnd: '2025-08-31',
    ...over,
  };
}

describe('reconcile', () => {
  it('passes a statement whose figures are internally consistent', () => {
    const result = reconcile(goodStatement());
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('fails when opening + credits − debits does not equal the closing balance', () => {
    const result = reconcile(goodStatement({ closingBalance: 550000 }));
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/does not reconcile/i);
  });

  it('fails when a printed running balance does not follow from the previous row', () => {
    const s = goodStatement();
    const tampered = { ...s, transactions: [...s.transactions] };
    tampered.transactions[1] = txn({ date: '2025-08-03', type: 'credit', amount: 500000, balanceAfter: 580001 });
    const result = reconcile(tampered);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /discontinuous/i.test(i) && /row 2/.test(i))).toBe(true);
    // the closing-balance check uses amounts, not the tampered balance, so it still passes
    expect(result.issues.some((i) => /does not reconcile/i.test(i))).toBe(false);
  });

  it('skips continuity across a row with no printed balance rather than failing it', () => {
    const s = goodStatement();
    const withGap = { ...s, transactions: [...s.transactions] };
    withGap.transactions[1] = txn({ date: '2025-08-03', type: 'credit', amount: 500000, balanceAfter: null });
    const result = reconcile(withGap);
    expect(result.issues.some((i) => /discontinuous/i.test(i))).toBe(false);
  });

  it('flags a transaction dated outside the statement period', () => {
    const s = goodStatement();
    const outOfRange = { ...s, transactions: [...s.transactions] };
    outOfRange.transactions[0] = txn({ date: '2025-09-15', type: 'debit', amount: 20000, balanceAfter: 80000 });
    const result = reconcile(outOfRange);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /outside the statement period/i.test(i) && /2025-09-15/.test(i))).toBe(true);
  });

  it('flags an empty statement', () => {
    const result = reconcile(goodStatement({ transactions: [], openingBalance: 0, closingBalance: 0 }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /no transactions/i.test(i))).toBe(true);
  });

  it('never leaks raw amounts or balances into issue text', () => {
    const result = reconcile(goodStatement({ closingBalance: 987654 }));
    for (const issue of result.issues) {
      expect(issue).not.toMatch(/987654|9876\.54/);
    }
  });
});

describe('reconcileOutcome', () => {
  const parsed = (statement: ParsedStatement): ParseOutcome => ({ kind: 'parsed', statement });

  it('returns a clean parsed outcome unchanged', () => {
    const outcome = reconcileOutcome(parsed(goodStatement()));
    expect(outcome.kind).toBe('parsed');
  });

  it('downgrades a parsed outcome that fails reconciliation to needs_review', () => {
    const outcome = reconcileOutcome(parsed(goodStatement({ closingBalance: 1 })));
    expect(outcome.kind).toBe('needs_review');
    if (outcome.kind !== 'needs_review') throw new Error('expected needs_review');
    expect(outcome.issues.some((i) => /does not reconcile/i.test(i))).toBe(true);
  });

  it('keeps a needs_review outcome and appends reconciliation issues after existing ones', () => {
    const prior: ParseOutcome = {
      kind: 'needs_review',
      statement: goodStatement({ closingBalance: 1 }),
      issues: ['Another ledger was not imported.'],
    };
    const outcome = reconcileOutcome(prior);
    if (outcome.kind !== 'needs_review') throw new Error('expected needs_review');
    expect(outcome.issues[0]).toBe('Another ledger was not imported.');
    expect(outcome.issues.some((i) => /does not reconcile/i.test(i))).toBe(true);
  });

  it('leaves a needs_review outcome that reconciles with only its original issues', () => {
    const prior: ParseOutcome = {
      kind: 'needs_review',
      statement: goodStatement(),
      issues: ['Another ledger was not imported.'],
    };
    const outcome = reconcileOutcome(prior);
    if (outcome.kind !== 'needs_review') throw new Error('expected needs_review');
    expect(outcome.issues).toEqual(['Another ledger was not imported.']);
  });

  it('passes outcomes with no statement through untouched', () => {
    const unreadable: ParseOutcome = { kind: 'unreadable', reason: 'corrupt', message: 'nope' };
    expect(reconcileOutcome(unreadable)).toBe(unreadable);
  });

  it('a real parser output reconciles cleanly through the gate', () => {
    const ctx: ParseContext = { statementId: 'test', importedAt: '2026-07-22T00:00:00Z' };
    const outcome = reconcileOutcome(new AxisParser().parse(axisSyntheticDoc(), ctx));
    expect(outcome.kind).toBe('parsed');
  });
});

describe('runningBalanceBreaks', () => {
  it('finds nothing in a continuous statement', () => {
    expect(runningBalanceBreaks(goodStatement())).toEqual([]);
  });

  it('locates the broken row and reports both figures', () => {
    const statement = goodStatement({
      transactions: [
        txn({ date: '2025-08-02', type: 'debit', amount: 20000, balanceAfter: 80000 }),
        // Should be 580000; the printed balance is 100.00 too high.
        txn({ date: '2025-08-03', type: 'credit', amount: 500000, balanceAfter: 590000 }),
      ],
    });
    expect(runningBalanceBreaks(statement)).toEqual([
      { index: 1, date: '2025-08-03', expected: 580000, printed: 590000 },
    ]);
  });

  it('does not cascade a single break into every later row', () => {
    const statement = goodStatement({
      transactions: [
        txn({ date: '2025-08-02', type: 'debit', amount: 20000, balanceAfter: 90000 }), // wrong
        txn({ date: '2025-08-03', type: 'credit', amount: 500000, balanceAfter: 590000 }), // follows
        txn({ date: '2025-08-04', type: 'debit', amount: 30050, balanceAfter: 559950 }), // follows
      ],
    });
    expect(runningBalanceBreaks(statement).map((b) => b.index)).toEqual([0]);
  });

  it('skips the pair straddling a row with no printed balance', () => {
    const statement = goodStatement({
      transactions: [
        txn({ date: '2025-08-02', type: 'debit', amount: 20000, balanceAfter: 80000 }),
        txn({ date: '2025-08-03', type: 'credit', amount: 500000, balanceAfter: null }),
        txn({ date: '2025-08-04', type: 'debit', amount: 30050, balanceAfter: 1 }),
      ],
    });
    expect(runningBalanceBreaks(statement)).toEqual([]);
  });

  it('is the same rule the gate reports', () => {
    const statement = goodStatement({
      transactions: [txn({ date: '2025-08-02', type: 'debit', amount: 20000, balanceAfter: 90000 })],
      closingBalance: 90000,
    });
    expect(runningBalanceBreaks(statement)).toHaveLength(1);
    expect(reconcile(statement).issues.some((i) => i.includes('discontinuous'))).toBe(true);
  });
});
