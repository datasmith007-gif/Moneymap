import { describe, expect, it } from 'vitest';
import { classify, classifyById } from '../../src/enrichment/classify.ts';
import { extractCounterparty } from '../../src/enrichment/counterparty.ts';
import { CONFIDENCE_THRESHOLD, type Rule } from '../../src/enrichment/types.ts';
import { txn } from '../fixtures/canonical.ts';

const SAVINGS = 'bank:xxxx1111';
const SALARY = 'bank:xxxx2222';

function userRule(over: Partial<Rule> & Pick<Rule, 'id' | 'category' | 'patterns'>): Rule {
  return { order: 0, operator: 'contains', origin: 'user', ...over };
}

describe('classify — precedence', () => {
  it("puts the user's own label above everything", () => {
    const row = txn({ id: 't1', date: '2025-08-05', type: 'debit', amount: 500_00, description: 'UPI/SWIGGY/1/PAY' });

    const [result] = classify([row], {
      rules: [],
      overrides: new Map([['t1', 'friends_family' as const]]),
    });

    expect(result?.category).toBe('friends_family');
    expect(result?.source).toBe('user');
    expect(result?.confidence).toBe(1);
  });

  it('puts a detected transfer above any rule', () => {
    // Evidence from two statements beats a keyword guess.
    const out = txn({ id: 'd', accountId: SAVINGS, date: '2025-08-10', type: 'debit', amount: 5_000_00, description: 'UPI/SWIGGY/1/PAY' });
    const inn = txn({ id: 'c', accountId: SALARY, date: '2025-08-10', type: 'credit', amount: 5_000_00, description: 'NEFT CR' });

    const byId = classifyById([out, inn]);
    expect(byId.get('d')?.category).toBe('self_transfer');
    expect(byId.get('d')?.source).toBe('transfer');
    expect(byId.get('d')?.transferPeerId).toBe('c');
  });

  it('puts a user rule above a shipped rule regardless of order number', () => {
    const row = txn({ id: 't1', date: '2025-08-05', type: 'debit', amount: 500_00, description: 'UPI/SWIGGY/1/PAY' });

    const [result] = classify([row], {
      // Order 999 — far below every shipped rule, and it must still win.
      rules: [userRule({ id: 'u1', order: 999, category: 'entertainment', patterns: ['SWIGGY'] })],
      overrides: new Map(),
    });

    expect(result?.category).toBe('entertainment');
    expect(result?.source).toBe('user_rule');
    expect(result?.ruleId).toBe('u1');
  });

  it('falls back to a shipped rule when the user has none', () => {
    const row = txn({ id: 't1', date: '2025-08-05', type: 'debit', amount: 500_00, description: 'UPI/SWIGGY/1/PAY' });
    const [result] = classify([row]);

    expect(result?.category).toBe('food_dining');
    expect(result?.source).toBe('shipped_rule');
    expect(result?.ruleId).toBe('shipped:food');
  });
});

describe('classify — honesty', () => {
  it('leaves an unrecognisable narration unclassified rather than guessing', () => {
    const row = txn({ id: 't1', date: '2025-08-05', type: 'debit', amount: 500_00, description: 'REF 998127346612' });
    const [result] = classify([row]);

    expect(result?.category).toBe('unclassified');
    expect(result?.source).toBe('none');
    expect(result?.confidence).toBe(0);
  });

  it('never emits a labelled row below the confidence threshold', () => {
    const rows = [
      txn({ id: 't1', date: '2025-08-05', type: 'debit', amount: 100, description: 'UPI SWIGGYINSTAMART' }),
      txn({ id: 't2', date: '2025-08-06', type: 'debit', amount: 100, description: 'REF 8812' }),
      txn({ id: 't3', date: '2025-08-07', type: 'debit', amount: 100, description: 'ATM WDL 12' }),
    ];

    for (const result of classify(rows)) {
      if (result.category !== 'unclassified') {
        expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
      }
    }
  });

  it('scores an infix match lower than a clean token match', () => {
    const token = classify([
      txn({ id: 'a', date: '2025-08-05', type: 'debit', amount: 100, description: 'UPI SWIGGY BLR' }),
    ])[0];
    const infix = classify([
      txn({ id: 'b', date: '2025-08-05', type: 'debit', amount: 100, description: 'UPI ZOMATOGOLD' }),
    ])[0];

    expect(infix!.confidence).toBeLessThan(token!.confidence);
  });

  it('trusts a user rule more than a shipped one at the same strength', () => {
    const row = txn({ id: 't1', date: '2025-08-05', type: 'debit', amount: 100, description: 'UPI SWIGGY BLR' });
    const shipped = classify([row])[0];
    const mine = classify([row], {
      rules: [userRule({ id: 'u1', category: 'food_dining', patterns: ['SWIGGY'] })],
      overrides: new Map(),
    })[0];

    expect(mine!.confidence).toBeGreaterThan(shipped!.confidence);
  });
});

describe('classify — invariants', () => {
  it('ties isInternalTransfer to the self_transfer category, both ways', () => {
    const out = txn({ id: 'd', accountId: SAVINGS, date: '2025-08-10', type: 'debit', amount: 900_00, description: 'NEFT' });
    const inn = txn({ id: 'c', accountId: SALARY, date: '2025-08-10', type: 'credit', amount: 900_00, description: 'NEFT' });
    const other = txn({ id: 'x', date: '2025-08-10', type: 'debit', amount: 12_00, description: 'UPI SWIGGY' });

    for (const result of classify([out, inn, other])) {
      expect(result.isInternalTransfer).toBe(result.category === 'self_transfer');
      if (!result.isInternalTransfer) expect(result.transferPeerId).toBeNull();
    }
  });

  it('honours a manual self_transfer label even with no peer leg imported', () => {
    const row = txn({ id: 't1', date: '2025-08-05', type: 'debit', amount: 900_00, description: 'REF 991' });
    const [result] = classify([row], {
      rules: [],
      overrides: new Map([['t1', 'self_transfer' as const]]),
    });

    expect(result?.isInternalTransfer).toBe(true);
    expect(result?.transferPeerId).toBeNull();
  });

  it('returns one classification per transaction, in input order', () => {
    const rows = [
      txn({ id: 'a', date: '2025-08-05', type: 'debit', amount: 1 }),
      txn({ id: 'b', date: '2025-08-06', type: 'debit', amount: 2 }),
    ];
    expect(classify(rows).map((c) => c.transactionId)).toEqual(['a', 'b']);
  });

  it('is deterministic — the same input always yields the same output', () => {
    const rows = [
      txn({ id: 'a', accountId: SAVINGS, date: '2025-08-05', type: 'debit', amount: 500_00, description: 'UPI SWIGGY' }),
      txn({ id: 'b', accountId: SALARY, date: '2025-08-05', type: 'credit', amount: 500_00, description: 'NEFT CR' }),
    ];
    expect(classify(rows)).toEqual(classify(rows));
  });
});

describe('counterparty', () => {
  it('names the merchant from the rule that matched, in canonical form', () => {
    const row = txn({ id: 't1', date: '2025-08-05', type: 'debit', amount: 100, description: 'UPI SWIGGYINSTAMART BLR 8812' });
    // The rule knows the merchant is INSTAMART; extraction would return the
    // whole concatenated blob.
    expect(classify([row])[0]?.counterparty).toBe('INSTAMART');
  });

  it('extracts a payee from UPI narration when no rule matched', () => {
    expect(extractCounterparty('UPI/RAHUL SHARMA/9876543210/PAY')).toBe('RAHUL SHARMA');
  });

  it('skips rails, reference numbers and IFSC codes', () => {
    expect(extractCounterparty('NEFT-HDFC0001234-IYER ASSOCIATES')).toBe('IYER ASSOCIATES');
    expect(extractCounterparty('UPI/523456789012/Payment from Ph/RAHUL/HDFC BANK')).toBe('RAHUL');
  });

  it('skips a masked card number rather than returning it as a name', () => {
    expect(extractCounterparty('POS 4471XXXXXX1234 WILDCRAFT')).toBe('WILDCRAFT');
  });

  it('returns null when the narration names nobody', () => {
    expect(extractCounterparty('REF 998127346612')).toBeNull();
    expect(extractCounterparty('UPI/123/PAY')).toBeNull();
  });
});
