import { describe, it, expect } from 'vitest';
import { accountKey, statementKey, transactionKey } from '../../src/model/identity.ts';
import { account, statement, txn } from '../fixtures/canonical.ts';

describe('accountKey', () => {
  it('ignores case, spacing, and punctuation in the institution name', () => {
    expect(accountKey('Axis Bank', 'XXXX4567')).toBe(accountKey('axis  bank', 'xxxx4567'));
    expect(accountKey('ICICI Bank', 'XXXX3458')).toBe(accountKey('I.C.I.C.I. Bank', 'XXXX3458'));
  });

  it('separates different banks and different accounts', () => {
    expect(accountKey('Axis Bank', 'XXXX4567')).not.toBe(accountKey('ICICI Bank', 'XXXX4567'));
    expect(accountKey('Axis Bank', 'XXXX4567')).not.toBe(accountKey('Axis Bank', 'XXXX9999'));
  });

  it('separates accounts whose numbers differ in length', () => {
    // maskAccount preserves length, so the mask carries digit count as well as
    // the last four — two accounts ending 3458 are still distinguishable.
    expect(accountKey('ICICI Bank', 'XXXX3458')).not.toBe(
      accountKey('ICICI Bank', 'XXXXXXXX3458'),
    );
  });
});

describe('statementKey', () => {
  it('matches the same statement re-parsed under a different statementId', () => {
    const a = statement({ closingBalance: 5000, transactions: [txn({ date: '2025-08-02', type: 'debit', amount: 100 })] });
    const b = statement({ closingBalance: 5000, transactions: [txn({ date: '2025-08-02', type: 'debit', amount: 100 })] });
    expect(statementKey(a)).toBe(statementKey(b));
  });

  it('differs when the period, a balance, or the row count differs', () => {
    const base = statement({ closingBalance: 5000 });
    expect(statementKey(statement({ closingBalance: 5001 }))).not.toBe(statementKey(base));
    expect(statementKey(statement({ periodEnd: '2025-09-30', closingBalance: 5000 }))).not.toBe(
      statementKey(base),
    );
    expect(
      statementKey(
        statement({ closingBalance: 5000, transactions: [txn({ date: '2025-08-02', type: 'debit', amount: 1 })] }),
      ),
    ).not.toBe(statementKey(base));
  });

  it('separates statements from different accounts', () => {
    const other = account({ institution: 'Axis Bank', identifierMasked: 'XXXX1111' });
    expect(statementKey(statement({ account: other }))).not.toBe(statementKey(statement()));
  });
});

describe('transactionKey', () => {
  const row = txn({ date: '2025-08-02', type: 'debit', amount: 20000, balanceAfter: 80000, description: 'UPI/ALICE' });

  it('is stable across whitespace and case in the narration', () => {
    expect(transactionKey({ ...row, description: 'upi / alice' }, 0)).toBe(
      transactionKey(row, 0),
    );
  });

  it('distinguishes a credit from a debit of the same amount', () => {
    // `amount` is unsigned and direction lives in `type`, so without `type` in
    // the key these two would collide and one would be silently dropped.
    expect(transactionKey({ ...row, type: 'credit' }, 0)).not.toBe(transactionKey(row, 0));
  });

  it('distinguishes two otherwise-identical rows by occurrence', () => {
    expect(transactionKey(row, 1)).not.toBe(transactionKey(row, 0));
  });

  it('treats a missing balance as its own value, not an omission', () => {
    expect(transactionKey({ ...row, balanceAfter: null }, 0)).not.toBe(transactionKey(row, 0));
    expect(transactionKey({ ...row, balanceAfter: null }, 0)).toBe(
      transactionKey({ ...row, balanceAfter: null }, 0),
    );
  });
});
