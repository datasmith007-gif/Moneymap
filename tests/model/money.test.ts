import { describe, it, expect } from 'vitest';
import { formatPaise, formatSignedPaise } from '../../src/model/money.ts';

describe('formatPaise', () => {
  it('groups rupees the Indian way and always shows two decimals', () => {
    expect(formatPaise(12348100)).toBe('1,23,481.00');
    expect(formatPaise(100)).toBe('1.00');
    expect(formatPaise(0)).toBe('0.00');
    expect(formatPaise(5)).toBe('0.05');
  });

  it('keeps the paise exact rather than rounding through a float', () => {
    // 0.1 + 0.2 in rupees is the classic float error; in paise it cannot happen.
    expect(formatPaise(10 + 20)).toBe('0.30');
    expect(formatPaise(999999999)).toBe('99,99,999.99');
  });

  it('renders negatives with a true minus sign', () => {
    expect(formatPaise(-30050)).toBe('−300.50');
  });

  it('signs deltas explicitly in both directions', () => {
    expect(formatSignedPaise(10000)).toBe('+100.00');
    expect(formatSignedPaise(-10000)).toBe('−100.00');
    expect(formatSignedPaise(0)).toBe('+0.00');
  });
});
