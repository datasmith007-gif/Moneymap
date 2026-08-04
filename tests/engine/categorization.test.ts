import { describe, expect, it } from 'vitest';
import { groupCategorizationRows } from '../../src/engine/categorization.ts';
import type { TransactionRegisterRow } from '../../src/engine/transactions.ts';
import { txn } from '../fixtures/canonical.ts';

function row(
  id: string,
  label: string,
  type: 'credit' | 'debit' = 'debit',
  amount = 100_00,
): TransactionRegisterRow {
  const transaction = txn({
    id,
    date: '2025-08-10',
    type,
    amount,
    description: `UPI ${label}`,
  });
  return {
    transaction,
    account: { institution: 'Test Bank', identifierMasked: 'XXXX0000' },
    classification: {
      transactionId: id,
      category: 'unclassified',
      confidence: 0,
      source: 'none',
      ruleId: null,
      counterparty: label,
      isInternalTransfer: false,
      transferPeerId: null,
    },
  };
}

describe('categorization label groups', () => {
  it('normalizes punctuation, sorts by count, and keeps movement directions separate', () => {
    const groups = groupCategorizationRows([
      row('debit-new', 'LOCAL MART'),
      row('cafe', 'CAFE'),
      row('debit-old', 'Local-Mart'),
      row('credit', 'LOCAL MART', 'credit'),
    ]);

    expect(
      groups.map((group) => [group.label, group.type, group.rows.length, group.total]),
    ).toEqual([
      ['LOCAL MART', 'debit', 2, 200_00],
      ['CAFE', 'debit', 1, 100_00],
      ['LOCAL MART', 'credit', 1, 100_00],
    ]);
  });

  it('can order groups by total with occurrence count as a deterministic tie-breaker', () => {
    const groups = groupCategorizationRows(
      [
        row('frequent-a', 'FREQUENT'),
        row('frequent-b', 'FREQUENT'),
        row('large', 'LARGE', 'debit', 500_00),
      ],
      'total',
    );

    expect(groups.map((group) => group.label)).toEqual(['LARGE', 'FREQUENT']);
  });
});
