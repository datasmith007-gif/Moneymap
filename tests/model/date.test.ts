import { describe, it, expect } from 'vitest';
import {
  addMonths,
  daysBetween,
  daysInMonth,
  formatIsoDate,
  formatMonth,
  formatMonthShort,
  monthBounds,
  monthOf,
  monthsBetween,
  monthsInRange,
} from '../../src/model/date.ts';

describe('monthOf', () => {
  it('takes the month from an ISO date without parsing it', () => {
    expect(monthOf('2025-08-31')).toBe('2025-08');
    // The reason this module avoids Date entirely: `new Date('2025-08-01')` is
    // UTC midnight and reads back as 31 July in any timezone west of UTC.
    expect(monthOf('2025-08-01')).toBe('2025-08');
  });
});

describe('month arithmetic', () => {
  it('crosses year boundaries in both directions', () => {
    expect(addMonths('2025-12', 1)).toBe('2026-01');
    expect(addMonths('2025-01', -1)).toBe('2024-12');
    expect(addMonths('2025-06', -11)).toBe('2024-07');
  });

  it('measures distance between months, signed', () => {
    expect(monthsBetween('2025-01', '2025-12')).toBe(11);
    expect(monthsBetween('2025-12', '2025-01')).toBe(-11);
    expect(monthsBetween('2025-08', '2025-08')).toBe(0);
  });

  it('enumerates an inclusive range across a year boundary', () => {
    expect(monthsInRange('2024-11', '2025-02')).toEqual([
      '2024-11',
      '2024-12',
      '2025-01',
      '2025-02',
    ]);
  });

  it('returns a single month when from equals to', () => {
    expect(monthsInRange('2025-08', '2025-08')).toEqual(['2025-08']);
  });
});

describe('daysInMonth', () => {
  it('handles the Gregorian leap rule', () => {
    expect(daysInMonth('2024-02')).toBe(29); // divisible by 4
    expect(daysInMonth('2025-02')).toBe(28);
    expect(daysInMonth('1900-02')).toBe(28); // century, not divisible by 400
    expect(daysInMonth('2000-02')).toBe(29); // divisible by 400
  });

  it('knows the short months', () => {
    expect(daysInMonth('2025-04')).toBe(30);
    expect(daysInMonth('2025-08')).toBe(31);
  });
});

describe('monthBounds', () => {
  it('gives inclusive first and last dates', () => {
    expect(monthBounds('2025-02')).toEqual({ start: '2025-02-01', end: '2025-02-28' });
    expect(monthBounds('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(monthBounds('2025-12')).toEqual({ start: '2025-12-01', end: '2025-12-31' });
  });
});

describe('daysBetween', () => {
  it('counts days forward and backward', () => {
    expect(daysBetween('2025-08-10', '2025-08-13')).toBe(3);
    expect(daysBetween('2025-08-13', '2025-08-10')).toBe(-3);
    expect(daysBetween('2025-08-10', '2025-08-10')).toBe(0);
  });

  it('crosses months and years without a special case', () => {
    expect(daysBetween('2025-08-31', '2025-09-01')).toBe(1);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2025-01-01', '2026-01-01')).toBe(365);
  });

  it('gets leap years right', () => {
    // 2024 is a leap year, 1900 is not, 2000 is.
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2025-02-28', '2025-03-01')).toBe(1);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
    expect(daysBetween('1900-02-28', '1900-03-01')).toBe(1);
    expect(daysBetween('2000-02-28', '2000-03-01')).toBe(2);
  });

  it('ignores any time component the string carries', () => {
    expect(daysBetween('2025-08-10T23:59:59Z', '2025-08-11T00:00:01Z')).toBe(1);
  });
});

describe('formatting', () => {
  it('renders months and dates for reading', () => {
    expect(formatMonth('2025-08')).toBe('Aug 2025');
    expect(formatMonthShort('2025-08')).toBe("Aug '25");
    expect(formatIsoDate('2025-05-31')).toBe('31 May 2025');
    expect(formatIsoDate('2025-05-01')).toBe('1 May 2025');
  });
});
