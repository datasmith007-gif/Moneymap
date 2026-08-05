import { describe, expect, it } from 'vitest';
import { detectAnomalies, loadAnomalies, type Anomaly } from '../../src/engine/anomalies.ts';
import type { Paise, Transaction } from '../../src/model/canonical.ts';
import { createMemoryStore } from '../../src/storage/memoryStore.ts';
import { account, statement, txn } from '../fixtures/canonical.ts';

/**
 * Rows in one category, one per amount, on consecutive days from `2025-03-01`.
 * Ids are explicit so ordering assertions do not depend on a shared counter.
 */
function rows(prefix: string, description: string, amounts: readonly Paise[]): Transaction[] {
  return amounts.map((amount, index) =>
    txn({
      id: `${prefix}-${index}`,
      date: `2025-03-${String(index + 1).padStart(2, '0')}`,
      type: 'debit',
      amount,
      description,
    }),
  );
}

/** Ten ordinary Swiggy orders — enough history for a baseline. */
const ORDINARY_FOOD: readonly Paise[] = [
  400_00, 420_00, 450_00, 460_00, 480_00, 500_00, 520_00, 540_00, 560_00, 600_00,
];

describe('anomaly detection', () => {
  it('flags the one payment far outside a category’s usual, and nothing else', () => {
    const found = detectAnomalies(rows('food', 'UPI SWIGGY ORDER', [...ORDINARY_FOOD, 15_000_00]));

    expect(found).toHaveLength(1);
    expect(found[0]?.transactionId).toBe('food-10');
    expect(found[0]?.category).toBe('food_dining');
    expect(found[0]?.amount).toBe(15_000_00);
    expect(found[0]?.baseline).toBe(500_00);
    expect(found[0]?.excess).toBe(14_500_00);
    expect(found[0]?.multiple).toBeCloseTo(30);
    expect(found[0]?.sampleSize).toBe(11);
  });

  it('is order-independent — the same rows in any sequence give the same list', () => {
    const supplied = [
      ...rows('food', 'UPI SWIGGY ORDER', [...ORDINARY_FOOD, 15_000_00]),
      ...rows('shop', 'AMAZON RETAIL', [...ORDINARY_FOOD, 9_000_00]),
    ];

    const forward = detectAnomalies(supplied);
    const reversed = detectAnomalies([...supplied].reverse());
    // A rotation as well, so the result cannot be an artefact of symmetry.
    const rotated = detectAnomalies([...supplied.slice(7), ...supplied.slice(0, 7)]);

    expect(reversed).toEqual(forward);
    expect(rotated).toEqual(forward);
  });

  it('ranks by rupees over the usual, not by multiple', () => {
    // The shopping row is the larger multiple; the food row is the larger
    // surprise in money, and money is what the list leads with.
    const found = detectAnomalies([
      ...rows('food', 'UPI SWIGGY ORDER', [...ORDINARY_FOOD, 40_000_00]),
      ...rows('shop', 'AMAZON RETAIL', [...ORDINARY_FOOD.map((a) => a / 10), 9_000_00]),
    ]);

    expect(found.map((anomaly) => anomaly.category)).toEqual(['food_dining', 'shopping']);
    expect(found[1]!.multiple).toBeGreaterThan(found[0]!.multiple);
    expect(found[0]!.excess).toBeGreaterThan(found[1]!.excess);
  });

  it('says nothing about a category with too little history, however extreme the row', () => {
    // Seven rows total: one short of a baseline. The outlier is 200× the rest.
    const thin = detectAnomalies(
      rows('food', 'UPI SWIGGY ORDER', [400_00, 420_00, 450_00, 460_00, 480_00, 500_00, 99_999_00]),
    );
    expect(thin).toEqual([]);

    // One more ordinary row is all it takes to have something to compare against.
    const enough = detectAnomalies(
      rows(
        'food',
        'UPI SWIGGY ORDER',
        [400_00, 420_00, 450_00, 460_00, 480_00, 500_00, 520_00, 99_999_00],
      ),
    );
    expect(enough).toHaveLength(1);
    expect(enough[0]?.sampleSize).toBe(8);
  });

  it('handles a category whose amount never varies, without dividing by zero', () => {
    // Twelve identical recharges: median absolute deviation is exactly 0.
    const found = detectAnomalies(
      rows('bill', 'JIO RECHARGE', [...Array<Paise>(12).fill(500_00), 9_000_00]),
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.baseline).toBe(500_00);
    expect(found[0]?.multiple).toBe(18);
    expect(Number.isFinite(found[0]!.multiple)).toBe(true);
  });

  it('does not report a large multiple of a trivial amount', () => {
    // ₹60 against a ₹15 usual is four times the median and worth nobody's
    // attention. The absolute floor, not the multiple, is what stops it.
    const found = detectAnomalies(
      rows('bill', 'JIO RECHARGE', [...Array<Paise>(10).fill(15_00), 60_00]),
    );
    expect(found).toEqual([]);
  });

  it('never measures credits, internal transfers, or unclassified rows', () => {
    const credits = detectAnomalies(
      [...ORDINARY_FOOD, 15_000_00].map((amount, index) =>
        txn({
          id: `c-${index}`,
          date: '2025-03-01',
          type: 'credit',
          amount,
          description: 'SALARY CREDIT',
        }),
      ),
    );
    expect(credits).toEqual([]);

    // Nothing in the shipped rules matches this narration, so every row lands
    // unclassified — there is no such thing as a usual unknown payment.
    const unknown = detectAnomalies(rows('u', 'XXQZ 8891 PQ', [...ORDINARY_FOOD, 15_000_00]));
    expect(unknown).toEqual([]);

    // 'SELF' is a shipped self-transfer pattern: money movement, not spending.
    const transfers = detectAnomalies(rows('s', 'NEFT TO SELF', [...ORDINARY_FOOD, 15_000_00]));
    expect(transfers).toEqual([]);
  });

  it('reports only rows inside the bounds, while the baseline keeps the whole history', () => {
    const history = rows('food', 'UPI SWIGGY ORDER', [...ORDINARY_FOOD, 15_000_00]);
    // A second, much larger outlier well after the ordinary run.
    const later = txn({
      id: 'food-late',
      date: '2025-06-15',
      type: 'debit',
      amount: 30_000_00,
      description: 'UPI SWIGGY ORDER',
    });

    const all = detectAnomalies([...history, later]);
    const bounded = detectAnomalies([...history, later], { from: '2025-06-01', to: '2025-06-30' });

    expect(all.map((a) => a.transactionId)).toEqual(['food-late', 'food-10']);
    expect(bounded.map((a) => a.transactionId)).toEqual(['food-late']);
    // The promise: narrowing the reported range does not move the baseline.
    expect(bounded[0]?.baseline).toBe(all[0]?.baseline);
    expect(bounded[0]?.sampleSize).toBe(all[0]?.sampleSize);
  });

  it('keeps every money figure an integer, leaving only the multiple fractional', () => {
    // An odd-count baseline whose median falls between two values, so the
    // rounding path is exercised rather than skipped.
    const found = detectAnomalies(
      rows(
        'food',
        'UPI SWIGGY ORDER',
        [401_00, 403_00, 407_00, 409_00, 411_00, 413_00, 417_00, 419_00, 12_345_67],
      ),
    );

    expect(found).toHaveLength(1);
    expect(Number.isInteger(found[0]!.baseline)).toBe(true);
    expect(Number.isInteger(found[0]!.excess)).toBe(true);
    expect(Number.isInteger(found[0]!.amount)).toBe(true);
    expect(found[0]!.excess).toBe(found[0]!.amount - found[0]!.baseline);
  });

  it('returns nothing for an empty set rather than throwing', () => {
    expect(detectAnomalies([])).toEqual([]);
  });
});

describe('loadAnomalies', () => {
  it('reads the whole store for the baseline even when bounds are given', async () => {
    const store = createMemoryStore();
    const transactions = [
      ...rows('food', 'UPI SWIGGY ORDER', [...ORDINARY_FOOD, 15_000_00]),
      txn({
        id: 'food-late',
        date: '2025-06-15',
        type: 'debit',
        amount: 30_000_00,
        description: 'UPI SWIGGY ORDER',
      }),
    ];
    await store.putStatement(
      statement({
        account: account(),
        transactions,
        periodStart: '2025-03-01',
        periodEnd: '2025-06-30',
      }),
      { statementId: 'st-1', fileName: 'a.pdf', importedAt: '2025-07-01T00:00:00Z', issues: [] },
    );

    const bounded: readonly Anomaly[] = await loadAnomalies(store, {
      from: '2025-06-01',
      to: '2025-06-30',
    });

    expect(bounded.map((anomaly) => anomaly.transactionId)).toEqual(['food-late']);
    // Eleven rows outside the reported bounds still shape the baseline.
    expect(bounded[0]?.sampleSize).toBe(12);
    expect(bounded[0]?.baseline).toBe(510_00);
  });

  it('returns nothing for an empty store', async () => {
    expect(await loadAnomalies(createMemoryStore())).toEqual([]);
  });
});
