import { describe, expect, it } from 'vitest';
import { firstMatch, matchRule, SHIPPED_RULES } from '../../src/enrichment/rules.ts';
import type { CategoryId } from '../../src/enrichment/taxonomy.ts';
import type { Rule } from '../../src/enrichment/types.ts';

function rule(over: Partial<Rule> & Pick<Rule, 'id' | 'category'>): Rule {
  return {
    order: 0,
    operator: 'contains',
    patterns: ['ANYTHING'],
    origin: 'user',
    ...over,
  };
}

/** What the shipped set makes of a narration — the question every case below
 *  is really asking. */
function shippedCategory(narration: string, type: 'credit' | 'debit' = 'debit'): CategoryId | null {
  return firstMatch(SHIPPED_RULES, narration, type)?.rule.category ?? null;
}

describe('matchRule', () => {
  it('refuses a rule whose category cannot describe this direction', () => {
    const salary = rule({ id: 'r1', category: 'salary', patterns: ['SALARY'] });
    expect(matchRule(salary, 'SALARY CREDIT AUG', 'credit')).toBe('token');
    // The precision that keeps phantom income off the dashboard.
    expect(matchRule(salary, 'TFR TO SALARY ACCOUNT', 'debit')).toBeNull();
  });

  it('returns the strongest match across the pattern list, not the first', () => {
    const r = rule({ id: 'r1', category: 'shopping', patterns: ['AMAZONIA', 'MYNTRA'] });
    // 'AMAZONIA' would infix-match nothing here; 'MYNTRA' is a clean token hit.
    expect(matchRule(r, 'UPI MYNTRA 8891', 'debit')).toBe('token');
  });

  it('supports starts_with and exact as well as contains', () => {
    const starts = rule({ id: 'r1', category: 'rent_home', operator: 'starts_with', patterns: ['NEFT'] });
    expect(matchRule(starts, 'NEFT S IYER RENT', 'debit')).toBe('token');
    expect(matchRule(starts, 'UPI NEFT REF', 'debit')).toBeNull();

    const exact = rule({ id: 'r2', category: 'fees_charges', operator: 'exact', patterns: ['SMS CHRG'] });
    expect(matchRule(exact, 'sms-chrg', 'debit')).toBe('token');
    expect(matchRule(exact, 'SMS CHRG AUG', 'debit')).toBeNull();
  });
});

describe('firstMatch', () => {
  it('takes the lowest order, not the array position', () => {
    const late = rule({ id: 'a', order: 10, category: 'shopping', patterns: ['AMAZON'] });
    const early = rule({ id: 'b', order: 1, category: 'subscriptions', patterns: ['AMAZON'] });
    expect(firstMatch([late, early], 'AMAZON PRIME', 'debit')?.rule.id).toBe('b');
  });

  it('breaks an order tie by id, so the result never depends on input order', () => {
    const a = rule({ id: 'aaa', order: 5, category: 'shopping', patterns: ['ZARA'] });
    const b = rule({ id: 'bbb', order: 5, category: 'travel', patterns: ['ZARA'] });
    expect(firstMatch([a, b], 'ZARA STORE', 'debit')?.rule.id).toBe('aaa');
    expect(firstMatch([b, a], 'ZARA STORE', 'debit')?.rule.id).toBe('aaa');
  });

  it('returns null when nothing matches', () => {
    expect(firstMatch([rule({ id: 'r', category: 'shopping' })], 'REF 8812', 'debit')).toBeNull();
  });
});

describe('the shipped rule set', () => {
  it('recognises common Indian merchants and rails', () => {
    expect(shippedCategory('UPI/SWIGGY/9876543210/PAY')).toBe('food_dining');
    expect(shippedCategory('UPI-BIGBASKET.COM-PAYMENT')).toBe('groceries');
    expect(shippedCategory('POS 4471XXXXXX1234 UBER INDIA')).toBe('transport');
    expect(shippedCategory('ATM-WDL-1234 ANDHERI WEST')).toBe('cash_withdrawal');
    expect(shippedCategory('NACH DR ZERODHA BROKING')).toBe('investments');
    expect(shippedCategory('SALARY CREDIT AUG 2025', 'credit')).toBe('salary');
  });

  // The three orderings documented in rules.ts as load-bearing. Each is a
  // silent misfiling if the order is ever shuffled.
  it('files bank charges before housing, so MAINTENANCE does not win', () => {
    expect(shippedCategory('NON MAINTENANCE CHARGES AUG')).toBe('fees_charges');
    expect(shippedCategory('SOCIETY MAINTENANCE AUG')).toBe('rent_home');
  });

  it('files Instamart as groceries, not as Swiggy dining', () => {
    expect(shippedCategory('UPI SWIGGYINSTAMART BLR')).toBe('groceries');
    expect(shippedCategory('UPI SWIGGY BLR')).toBe('food_dining');
  });

  it('files Prime Video as a subscription, not as Amazon shopping', () => {
    expect(shippedCategory('AMAZON PRIME VIDEO IN')).toBe('subscriptions');
    expect(shippedCategory('AMAZON SELLER SERVICES')).toBe('shopping');
  });

  it('leaves a pure reference number unmatched rather than guessing', () => {
    expect(shippedCategory('REF 998127346612')).toBeNull();
  });

  it('has no duplicate ids and a strictly increasing order', () => {
    const ids = new Set(SHIPPED_RULES.map((r) => r.id));
    expect(ids.size).toBe(SHIPPED_RULES.length);
    const orders = SHIPPED_RULES.map((r) => r.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('is entirely shipped-origin, so nothing here can outrank a user rule', () => {
    expect(SHIPPED_RULES.every((r) => r.origin === 'shipped')).toBe(true);
  });
});
