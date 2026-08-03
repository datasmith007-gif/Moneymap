import { describe, expect, it } from 'vitest';
import { nextRuleOrder, previewRule, reorderRules } from '../../src/enrichment/preview.ts';
import type { Rule } from '../../src/enrichment/types.ts';
import { txn } from '../fixtures/canonical.ts';

function rule(over: Partial<Rule> & Pick<Rule, 'id'>): Rule {
  return {
    order: 0,
    operator: 'contains',
    patterns: ['WILDCRAFT'],
    category: 'shopping',
    origin: 'user',
    ...over,
  };
}

const shopping = rule({ id: 'candidate' });

describe('previewRule', () => {
  it('counts the rows a rule would claim, and their value', () => {
    const rows = [
      txn({ id: 'a', date: '2025-08-02', type: 'debit', amount: 8_499_00, description: 'POS WILDCRAFT OUTDOORS' }),
      txn({ id: 'b', date: '2025-08-09', type: 'debit', amount: 1_500_00, description: 'UPI/WILDCRAFT/12/PAY' }),
      txn({ id: 'c', date: '2025-08-11', type: 'debit', amount: 900_00, description: 'UPI SWIGGY' }),
    ];

    const preview = previewRule(shopping, rows);
    expect(preview.matchCount).toBe(2);
    expect(preview.matchTotal).toBe(8_499_00 + 1_500_00);
  });

  it('separates filling a blank from overwriting a label', () => {
    // A merchant deliberately absent from the shipped rule set, so "blank"
    // really is blank. `WILDCRAFT` would not do — it already ships as shopping.
    const zorblax = rule({ id: 'candidate', patterns: ['ZORBLAX'] });
    const rows = [
      txn({ id: 'blank', date: '2025-08-02', type: 'debit', amount: 100, description: 'REF 8812 ZORBLAX' }),
      // Already understood as food; the candidate would take it instead.
      txn({ id: 'taken', date: '2025-08-03', type: 'debit', amount: 100, description: 'UPI SWIGGY ZORBLAX' }),
    ];

    const preview = previewRule(zorblax, rows);
    expect(preview.newlyLabelled.map((c) => c.transaction.id)).toEqual(['blank']);
    expect(preview.relabelled).toHaveLength(1);
    expect(preview.relabelled[0]).toMatchObject({ from: 'food_dining', to: 'shopping' });
  });

  it('reports nothing when the rule matches nothing', () => {
    const rows = [txn({ id: 'a', date: '2025-08-02', type: 'debit', amount: 100, description: 'UPI SWIGGY' })];
    expect(previewRule(shopping, rows)).toMatchObject({
      matchCount: 0,
      matchTotal: 0,
      relabelled: [],
      newlyLabelled: [],
    });
  });

  it('does not claim a row the user has pinned by hand', () => {
    // The preview has to respect precedence, or it promises a reach the save
    // will not deliver.
    const rows = [
      txn({ id: 'a', date: '2025-08-02', type: 'debit', amount: 100, description: 'POS WILDCRAFT' }),
    ];

    const preview = previewRule(shopping, rows, {
      rules: [],
      overrides: new Map([['a', 'friends_family']]),
    });

    expect(preview.matchCount).toBe(0);
  });

  it('is evaluated at its own order, not first', () => {
    // The reach a rule really has depends on where it sits. A rule earlier in
    // the order claims the row and the candidate never sees it — so a preview
    // that ignored `order` would promise a reach the save could not deliver.
    const rows = [
      txn({ id: 'a', date: '2025-08-02', type: 'debit', amount: 100, description: 'POS WILDCRAFT' }),
    ];
    const earlier = rule({ id: 'existing', order: -100, category: 'travel', patterns: ['WILDCRAFT'] });

    const behind = previewRule(shopping, rows, { rules: [earlier], overrides: new Map() });
    expect(behind.matchCount).toBe(0);

    // Move the candidate ahead of it and the same rule now claims the row.
    const ahead = previewRule(rule({ id: 'candidate', order: -500 }), rows, {
      rules: [earlier],
      overrides: new Map(),
    });
    expect(ahead.matchCount).toBe(1);
  });

  it('respects the direction a category can describe', () => {
    const rows = [
      txn({ id: 'a', date: '2025-08-02', type: 'credit', amount: 100, description: 'POS WILDCRAFT REFUND' }),
    ];
    // `shopping` is a debit-only category, so a credit cannot take it.
    expect(previewRule(shopping, rows).matchCount).toBe(0);
  });
});

describe('nextRuleOrder', () => {
  it('starts at zero and then leaves gaps', () => {
    expect(nextRuleOrder([])).toBe(0);
    expect(nextRuleOrder([rule({ id: 'a', order: 0 }), rule({ id: 'b', order: 10 })])).toBe(20);
  });

  it('goes past the highest order, not the count', () => {
    expect(nextRuleOrder([rule({ id: 'a', order: 500 }), rule({ id: 'b', order: 10 })])).toBe(510);
  });
});

describe('reorderRules', () => {
  const a = rule({ id: 'a', order: 0 });
  const b = rule({ id: 'b', order: 10 });
  const c = rule({ id: 'c', order: 20 });

  it('moves a rule above another and returns only what changed', () => {
    const changed = reorderRules([a, b, c], 'c', 'b');
    // c moves to position 1; only b and c shift.
    expect(changed.map((r) => [r.id, r.order])).toEqual([
      ['c', 10],
      ['b', 20],
    ]);
  });

  it('moves a rule to the end when there is nothing to sit before', () => {
    const changed = reorderRules([a, b, c], 'a', null);
    expect(changed.map((r) => [r.id, r.order])).toEqual([
      ['b', 0],
      ['c', 10],
      ['a', 20],
    ]);
  });

  it('returns nothing when the move is a no-op', () => {
    expect(reorderRules([a, b, c], 'a', 'b')).toEqual([]);
  });

  it('returns nothing for an unknown rule or target', () => {
    expect(reorderRules([a, b], 'zz', 'a')).toEqual([]);
    expect(reorderRules([a, b], 'a', 'zz')).toEqual([]);
  });
});
