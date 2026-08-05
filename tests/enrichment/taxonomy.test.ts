import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  categoryApplies,
  categoryLabel,
  isFlowNeutral,
} from '../../src/enrichment/taxonomy.ts';

describe('expanded category taxonomy', () => {
  it('uses unambiguous loan-principal labels with strict directions', () => {
    expect(categoryLabel('money_lent')).toBe('Money lent');
    expect(categoryApplies('money_lent', 'debit')).toBe(true);
    expect(categoryApplies('money_lent', 'credit')).toBe(false);

    expect(categoryLabel('borrowed_money')).toBe('Borrowed money');
    expect(categoryApplies('borrowed_money', 'credit')).toBe(true);
    expect(categoryApplies('borrowed_money', 'debit')).toBe(false);

    expect(categoryApplies('loan_repayment_received', 'credit')).toBe(true);
  });

  it('treats loan principal as money movement, not income or spending', () => {
    expect(isFlowNeutral('money_lent')).toBe(true);
    expect(isFlowNeutral('borrowed_money')).toBe(true);
    expect(isFlowNeutral('loan_repayment_received')).toBe(true);
    expect(isFlowNeutral('emi_loan')).toBe(false);
  });

  it('keeps every category id unique', () => {
    expect(new Set(CATEGORIES.map((category) => category.id)).size).toBe(CATEGORIES.length);
  });
});
