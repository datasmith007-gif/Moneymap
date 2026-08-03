import { describe, expect, it } from 'vitest';
import { buildReviewQueue } from '../../src/engine/reviewQueue.ts';
import { classify } from '../../src/enrichment/classify.ts';
import {
  classificationStats,
  confidenceBand,
  countByCategory,
} from '../../src/enrichment/stats.ts';
import { txn } from '../fixtures/canonical.ts';

/** A row nothing in the shipped rule set can name. */
function unknown(id: string, date: string, amount: number, description: string) {
  return txn({ id, date, type: 'debit', amount, description });
}

describe('buildReviewQueue', () => {
  it('holds only the rows nothing could label', () => {
    const rows = [
      txn({ id: 'known', date: '2025-08-02', type: 'debit', amount: 500_00, description: 'UPI SWIGGY' }),
      unknown('mystery', '2025-08-03', 900_00, 'UPI/RAHUL SHARMA/98/PAY'),
    ];

    const queue = buildReviewQueue(rows);
    expect(queue.groups).toHaveLength(1);
    expect(queue.groups[0]?.transactions.map((t) => t.id)).toEqual(['mystery']);
  });

  it('groups rows that share a counterparty, so one decision clears many', () => {
    const rows = [
      unknown('t1', '2025-06-05', 15_000_00, 'UPI/XYZ TUITION/11/PAY'),
      unknown('t2', '2025-07-05', 15_000_00, 'UPI/XYZ TUITION/12/PAY'),
      unknown('t3', '2025-08-05', 15_000_00, 'UPI/XYZ TUITION/13/PAY'),
    ];

    const queue = buildReviewQueue(rows);
    expect(queue.groups).toHaveLength(1);
    expect(queue.groups[0]).toMatchObject({
      label: 'XYZ TUITION',
      count: 3,
      total: 45_000_00,
      firstDate: '2025-06-05',
      lastDate: '2025-08-05',
    });
  });

  it('ranks by money, not by date', () => {
    // The queue exists to make the category breakdown trustworthy, and one big
    // unexplained group distorts it more than many small ones.
    const rows = [
      unknown('small1', '2025-08-20', 40_00, 'UPI/CHAIWALA/1/PAY'),
      unknown('small2', '2025-08-21', 40_00, 'UPI/CHAIWALA/2/PAY'),
      unknown('big', '2025-08-01', 32_000_00, 'UPI/LANDLORD IYER/9/PAY'),
    ];

    expect(buildReviewQueue(rows).groups.map((g) => g.label)).toEqual([
      'LANDLORD IYER',
      'CHAIWALA',
    ]);
  });

  it('gives a row naming nobody its own group rather than an unknown bucket', () => {
    // Lumping them together would make a group no single rule could ever clear.
    const rows = [
      unknown('a', '2025-08-02', 100_00, 'REF 998127346612'),
      unknown('b', '2025-08-03', 200_00, 'REF 771823001192'),
    ];

    const queue = buildReviewQueue(rows);
    expect(queue.groups).toHaveLength(2);
    expect(queue.groups.map((g) => g.count)).toEqual([1, 1]);
  });

  it('reports progress across everything, not just the queue', () => {
    const rows = [
      txn({ id: 'a', date: '2025-08-02', type: 'debit', amount: 100, description: 'UPI SWIGGY' }),
      txn({ id: 'b', date: '2025-08-03', type: 'debit', amount: 100, description: 'UPI BIGBASKET' }),
      unknown('c', '2025-08-04', 100, 'REF 8812'),
    ];

    expect(buildReviewQueue(rows).stats).toMatchObject({ total: 3, unclassified: 1 });
  });

  it('empties as the user labels rows', () => {
    const rows = [unknown('a', '2025-08-02', 900_00, 'UPI/RAHUL/98/PAY')];

    expect(buildReviewQueue(rows).groups).toHaveLength(1);
    expect(
      buildReviewQueue(rows, { rules: [], overrides: new Map([['a', 'friends_family']]) }).groups,
    ).toHaveLength(0);
  });

  it('is stable — the same rows always produce the same order', () => {
    const rows = [
      unknown('a', '2025-08-02', 100_00, 'UPI/ALPHA/1/PAY'),
      unknown('b', '2025-08-03', 100_00, 'UPI/BETA/2/PAY'),
    ];
    // Equal totals and counts, so the tie-break on key is what decides.
    expect(buildReviewQueue(rows).groups.map((g) => g.label)).toEqual(
      buildReviewQueue([...rows].reverse()).groups.map((g) => g.label),
    );
  });

  it('has nothing to show for an empty store', () => {
    expect(buildReviewQueue([])).toMatchObject({ groups: [], stats: { total: 0, rate: 1 } });
  });
});

describe('confidenceBand', () => {
  it('stays silent when the user decided, or two statements agreed', () => {
    const [user] = classify([txn({ id: 'a', date: '2025-08-02', type: 'debit', amount: 100 })], {
      rules: [],
      overrides: new Map([['a', 'shopping']]),
    });
    expect(confidenceBand(user!)).toBe('certain');
  });

  it('marks a clean keyword match fair and an infix match low', () => {
    const [clean] = classify([
      txn({ id: 'a', date: '2025-08-02', type: 'debit', amount: 100, description: 'UPI SWIGGY BLR' }),
    ]);
    const [weak] = classify([
      txn({ id: 'b', date: '2025-08-02', type: 'debit', amount: 100, description: 'UPI ZOMATOGOLD' }),
    ]);

    expect(confidenceBand(clean!)).toBe('fair');
    expect(confidenceBand(weak!)).toBe('low');
  });

  it('calls an unlabelled row none', () => {
    const [none] = classify([
      txn({ id: 'a', date: '2025-08-02', type: 'debit', amount: 100, description: 'REF 8812' }),
    ]);
    expect(confidenceBand(none!)).toBe('none');
  });
});

describe('classificationStats', () => {
  it('splits automatic from user-driven labels', () => {
    const rows = [
      txn({ id: 'a', date: '2025-08-02', type: 'debit', amount: 100, description: 'UPI SWIGGY' }),
      txn({ id: 'b', date: '2025-08-03', type: 'debit', amount: 100, description: 'REF 8812' }),
      txn({ id: 'c', date: '2025-08-04', type: 'debit', amount: 100, description: 'REF 9911' }),
    ];

    const stats = classificationStats(
      classify(rows, { rules: [], overrides: new Map([['b', 'friends_family']]) }),
    );

    expect(stats).toMatchObject({ total: 3, auto: 1, byUser: 1, unclassified: 1 });
    expect(stats.rate).toBeCloseTo(2 / 3, 10);
  });

  it('counts rows, not rupees — the queue is work, not money', () => {
    // One huge labelled row and two tiny unlabelled ones is 33% done by count
    // and ~99% by value. This function answers the first question.
    const stats = classificationStats(
      classify([
        txn({ id: 'a', date: '2025-08-02', type: 'debit', amount: 80_000_00, description: 'UPI SWIGGY' }),
        txn({ id: 'b', date: '2025-08-03', type: 'debit', amount: 100, description: 'REF 1' }),
        txn({ id: 'c', date: '2025-08-04', type: 'debit', amount: 100, description: 'REF 2' }),
      ]),
    );
    expect(stats.rate).toBeCloseTo(1 / 3, 10);
  });

  it('calls an empty set fully classified rather than zero percent', () => {
    expect(classificationStats([])).toMatchObject({ total: 0, rate: 1 });
  });
});

describe('countByCategory', () => {
  it('ranks by count with a stable tie-break', () => {
    const counts = countByCategory(
      classify([
        txn({ id: 'a', date: '2025-08-02', type: 'debit', amount: 100, description: 'UPI SWIGGY' }),
        txn({ id: 'b', date: '2025-08-03', type: 'debit', amount: 100, description: 'UPI ZOMATO' }),
        txn({ id: 'c', date: '2025-08-04', type: 'debit', amount: 100, description: 'UPI BIGBASKET' }),
      ]),
    );

    expect(counts[0]).toEqual({ category: 'food_dining', count: 2 });
    expect(counts[1]).toEqual({ category: 'groceries', count: 1 });
  });
});
