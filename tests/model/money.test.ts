import { describe, it, expect } from 'vitest';
import {
  formatPaise,
  formatPaiseCompact,
  formatSignedPaise,
  meanPaise,
} from '../../src/model/money.ts';

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

describe('meanPaise', () => {
  it('divides exactly when it can', () => {
    expect(meanPaise(30000, 3)).toBe(10000);
    expect(meanPaise(0, 5)).toBe(0);
  });

  it('rounds halves away from zero, symmetrically', () => {
    // The whole reason this isn't Math.round: Math.round(-2.5) is -2 but
    // Math.round(2.5) is 3, so equal-and-opposite averages would round to
    // different magnitudes.
    expect(meanPaise(5, 2)).toBe(3);
    expect(meanPaise(-5, 2)).toBe(-3);
    expect(meanPaise(7, 2)).toBe(4);
    expect(meanPaise(-7, 2)).toBe(-4);
  });

  it('rounds ordinary fractions to the nearest paise', () => {
    expect(meanPaise(10, 3)).toBe(3); // 3.33
    expect(meanPaise(11, 3)).toBe(4); // 3.67
    expect(meanPaise(-10, 3)).toBe(-3);
  });

  it('is the identity at n = 1', () => {
    expect(meanPaise(12345, 1)).toBe(12345);
    expect(meanPaise(-12345, 1)).toBe(-12345);
  });

  it('refuses a non-positive divisor rather than returning Infinity', () => {
    expect(() => meanPaise(100, 0)).toThrow();
    expect(() => meanPaise(100, -1)).toThrow();
  });
});

describe('formatPaiseCompact', () => {
  it('uses the lakh/crore scale', () => {
    expect(formatPaiseCompact(12000000)).toBe('₹1.2L');
    expect(formatPaiseCompact(2500000000)).toBe('₹2.5Cr');
    expect(formatPaiseCompact(500000)).toBe('₹5K');
    expect(formatPaiseCompact(45000)).toBe('₹450');
    expect(formatPaiseCompact(0)).toBe('₹0');
  });

  it('marks negatives', () => {
    expect(formatPaiseCompact(-12000000)).toBe('−₹1.2L');
  });
});
