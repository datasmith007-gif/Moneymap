import { describe, expect, it } from 'vitest';
import { detectTransfers } from '../../src/enrichment/transfers.ts';
import { txn } from '../fixtures/canonical.ts';

const SAVINGS = 'bank:xxxx1111';
const SALARY = 'bank:xxxx2222';

describe('detectTransfers', () => {
  it('pairs a debit with the matching credit on another account', () => {
    const out = txn({ id: 'd', accountId: SAVINGS, date: '2025-08-10', type: 'debit', amount: 5_000_00 });
    const inn = txn({ id: 'c', accountId: SALARY, date: '2025-08-11', type: 'credit', amount: 5_000_00 });

    const peers = detectTransfers([out, inn]);
    expect(peers.get('d')).toBe('c');
    expect(peers.get('c')).toBe('d');
  });

  it('never pairs two rows on the same account', () => {
    // A reversal is not a transfer, and pairing it would delete a real movement.
    const out = txn({ id: 'd', accountId: SAVINGS, date: '2025-08-10', type: 'debit', amount: 900_00 });
    const inn = txn({ id: 'c', accountId: SAVINGS, date: '2025-08-10', type: 'credit', amount: 900_00 });

    expect(detectTransfers([out, inn]).size).toBe(0);
  });

  it('requires the amounts to match exactly', () => {
    const out = txn({ id: 'd', accountId: SAVINGS, date: '2025-08-10', type: 'debit', amount: 5_000_00 });
    const inn = txn({ id: 'c', accountId: SALARY, date: '2025-08-10', type: 'credit', amount: 4_999_99 });

    expect(detectTransfers([out, inn]).size).toBe(0);
  });

  it('allows up to three days between the legs, and no more', () => {
    const out = txn({ id: 'd', accountId: SAVINGS, date: '2025-08-10', type: 'debit', amount: 1_000_00 });
    const within = txn({ id: 'c', accountId: SALARY, date: '2025-08-13', type: 'credit', amount: 1_000_00 });
    const beyond = txn({ id: 'c2', accountId: SALARY, date: '2025-08-14', type: 'credit', amount: 1_000_00 });

    expect(detectTransfers([out, within]).get('d')).toBe('c');
    expect(detectTransfers([out, beyond]).size).toBe(0);
  });

  it('pairs across a month boundary, where the day arithmetic is easiest to get wrong', () => {
    const out = txn({ id: 'd', accountId: SAVINGS, date: '2025-08-31', type: 'debit', amount: 2_000_00 });
    const inn = txn({ id: 'c', accountId: SALARY, date: '2025-09-01', type: 'credit', amount: 2_000_00 });

    expect(detectTransfers([out, inn]).get('d')).toBe('c');
  });

  it('pairs a credit that lands BEFORE its debit', () => {
    // Value dates are not always in the order a human would expect.
    const inn = txn({ id: 'c', accountId: SALARY, date: '2025-08-09', type: 'credit', amount: 700_00 });
    const out = txn({ id: 'd', accountId: SAVINGS, date: '2025-08-10', type: 'debit', amount: 700_00 });

    expect(detectTransfers([out, inn]).get('d')).toBe('c');
  });

  it('gives the same answer whatever order the transactions arrive in', () => {
    // The property that keeps every downstream figure reproducible: a re-import
    // in a different order must not pair different rows.
    const rows = [
      txn({ id: 'd1', accountId: SAVINGS, date: '2025-08-10', type: 'debit', amount: 1_000_00 }),
      txn({ id: 'd2', accountId: SAVINGS, date: '2025-08-11', type: 'debit', amount: 1_000_00 }),
      txn({ id: 'c1', accountId: SALARY, date: '2025-08-10', type: 'credit', amount: 1_000_00 }),
      txn({ id: 'c2', accountId: SALARY, date: '2025-08-12', type: 'credit', amount: 1_000_00 }),
    ];

    const forward = detectTransfers(rows);
    const reversed = detectTransfers([...rows].reverse());
    const shuffled = detectTransfers([rows[2]!, rows[0]!, rows[3]!, rows[1]!]);

    expect([...reversed.entries()].sort()).toEqual([...forward.entries()].sort());
    expect([...shuffled.entries()].sort()).toEqual([...forward.entries()].sort());
  });

  it('uses each leg at most once', () => {
    // Two debits, one credit: exactly one pair, and the earlier debit takes it.
    const rows = [
      txn({ id: 'd1', accountId: SAVINGS, date: '2025-08-10', type: 'debit', amount: 300_00 }),
      txn({ id: 'd2', accountId: SAVINGS, date: '2025-08-11', type: 'debit', amount: 300_00 }),
      txn({ id: 'c1', accountId: SALARY, date: '2025-08-10', type: 'credit', amount: 300_00 }),
    ];

    const peers = detectTransfers(rows);
    expect(peers.size).toBe(2); // one pair, recorded in both directions
    expect(peers.get('d1')).toBe('c1');
    expect(peers.has('d2')).toBe(false);
  });

  it('finds nothing in a single-account statement', () => {
    const rows = [
      txn({ id: 'a', accountId: SAVINGS, date: '2025-08-10', type: 'debit', amount: 100_00 }),
      txn({ id: 'b', accountId: SAVINGS, date: '2025-08-10', type: 'credit', amount: 100_00 }),
    ];
    expect(detectTransfers(rows).size).toBe(0);
  });
});
