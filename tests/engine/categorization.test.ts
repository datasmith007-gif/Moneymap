import { describe, expect, it } from 'vitest';
import {
  filterCategorizationRows,
  groupCategorizationRows,
  sortCategorizationRows,
} from '../../src/engine/categorization.ts';
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

  it('can order groups by total with a deterministic tie-breaker', () => {
    const groups = groupCategorizationRows(
      [
        row('frequent-a', 'FREQUENT'),
        row('frequent-b', 'FREQUENT'),
        row('large', 'LARGE', 'debit', 500_00),
      ],
      { column: 'total', direction: 'desc' },
    );

    expect(groups.map((group) => group.label)).toEqual(['LARGE', 'FREQUENT']);
  });

  it('reverses only the sorted column, leaving the tie-break stable', () => {
    const supplied = [
      row('mart-a', 'LOCAL MART'),
      row('mart-b', 'LOCAL MART'),
      row('cafe', 'CORNER CAFE'),
      row('deli', 'DELI'),
    ];

    const desc = groupCategorizationRows(supplied, {
      column: 'occurrences',
      direction: 'desc',
    });
    const asc = groupCategorizationRows(supplied, { column: 'occurrences', direction: 'asc' });

    expect(desc.map((group) => group.label)).toEqual(['LOCAL MART', 'CORNER CAFE', 'DELI']);
    // The two single-occurrence groups tie, and keep their alphabetical order
    // in both directions — only the column being sorted flips.
    expect(asc.map((group) => group.label)).toEqual(['CORNER CAFE', 'DELI', 'LOCAL MART']);
  });

  it('sorts by label and by direction', () => {
    const supplied = [row('b', 'ZEBRA'), row('a', 'ANTELOPE'), row('c', 'MONGOOSE', 'credit')];

    expect(
      groupCategorizationRows(supplied, { column: 'label', direction: 'asc' }).map((g) => g.label),
    ).toEqual(['ANTELOPE', 'MONGOOSE', 'ZEBRA']);

    expect(
      groupCategorizationRows(supplied, { column: 'direction', direction: 'asc' }).map(
        (g) => g.type,
      ),
    ).toEqual(['credit', 'debit', 'debit']);
  });
});

describe('categorization review filtering', () => {
  it('normalizes search and combines it with exact account and direction filters', () => {
    const matching = row('match', 'LOCAL-MART');
    const otherAccount = {
      ...row('other-account', 'LOCAL MART'),
      transaction: { ...row('other-account', 'LOCAL MART').transaction, accountId: 'other' },
    };
    const credit = row('credit', 'LOCAL MART', 'credit');

    expect(
      filterCategorizationRows([matching, otherAccount, credit], {
        search: ' local, mart ',
        accountId: matching.transaction.accountId,
        type: 'debit',
      }).map((item) => item.transaction.id),
    ).toEqual(['match']);
  });

  it('treats blank normalized search as no search and can match raw narration', () => {
    const supplied = row('raw', 'COUNTERPARTY');
    const withoutCounterparty = {
      ...supplied,
      classification: { ...supplied.classification, counterparty: null },
      transaction: { ...supplied.transaction, description: 'UPI A/B CAFE' },
    };

    expect(filterCategorizationRows([withoutCounterparty], { search: '---' })).toHaveLength(1);
    expect(filterCategorizationRows([withoutCounterparty], { search: 'a b cafe' })).toHaveLength(1);
  });
});

describe('categorization row ordering', () => {
  const supplied = [
    row('c', 'ZEBRA', 'debit', 100_00),
    row('a', 'ANTELOPE', 'debit', 900_00),
    row('b', 'MONGOOSE', 'debit', 500_00),
  ];

  it('orders by amount in both directions without mutating the input', () => {
    const original = [...supplied];

    expect(
      sortCategorizationRows(supplied, { column: 'amount', direction: 'desc' }).map(
        (r) => r.transaction.id,
      ),
    ).toEqual(['a', 'b', 'c']);
    expect(
      sortCategorizationRows(supplied, { column: 'amount', direction: 'asc' }).map(
        (r) => r.transaction.id,
      ),
    ).toEqual(['c', 'b', 'a']);
    expect(supplied).toEqual(original);
  });

  it('orders by the transaction text the reader can actually see', () => {
    expect(
      sortCategorizationRows(supplied, { column: 'transaction', direction: 'asc' }).map(
        (r) => r.classification.counterparty,
      ),
    ).toEqual(['ANTELOPE', 'MONGOOSE', 'ZEBRA']);
  });

  it('breaks ties on date then id, so equal rows never swap between renders', () => {
    // Every row shares a date and an amount: only the tie-break decides.
    const tied = [row('z', 'SAME'), row('a', 'SAME'), row('m', 'SAME')];
    const forward = sortCategorizationRows(tied, { column: 'amount', direction: 'desc' });
    const reversed = sortCategorizationRows([...tied].reverse(), {
      column: 'amount',
      direction: 'desc',
    });

    expect(forward.map((r) => r.transaction.id)).toEqual(['a', 'm', 'z']);
    expect(reversed.map((r) => r.transaction.id)).toEqual(forward.map((r) => r.transaction.id));
  });
});
