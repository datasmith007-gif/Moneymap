/**
 * Month arithmetic on ISO date strings — the date twin of `money.ts`. ISO strings
 * are the storage form; month buckets and "31 May 2025" are derived forms, and
 * this is the one place the conversion happens.
 *
 * **No `Date` object appears anywhere in this file, deliberately.** `new Date('2025-08-01')`
 * parses as UTC midnight and then reports local-time fields, so in any timezone
 * west of UTC it reads back as 31 July — a transaction silently lands in the
 * wrong month, and a monthly average is quietly wrong. Every operation here is
 * either string slicing or integer arithmetic, which has no timezone, no DST, and
 * no month-length surprises.
 */

/** `'YYYY-MM'`. Chosen over a {year, month} pair because it sorts correctly as a
 *  plain string, so it works as a `Map` key, an array sort, and a chart x-value
 *  with no comparator anywhere. */
export type MonthKey = string;

/** The month a transaction falls in. Slicing, not parsing — an ISO date's first
 *  seven characters *are* its month. */
export function monthOf(isoDate: string): MonthKey {
  return isoDate.slice(0, 7);
}

/**
 * Months since year 0 — the trick that makes all month arithmetic integer
 * arithmetic. Crossing a year boundary stops being a special case.
 */
function monthIndex(month: MonthKey): number {
  return Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1);
}

function monthAt(index: number): MonthKey {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** How many months from `from` to `to`; negative if `to` is earlier. */
export function monthsBetween(from: MonthKey, to: MonthKey): number {
  return monthIndex(to) - monthIndex(from);
}

/** `n` months after `month` (negative `n` goes back). */
export function addMonths(month: MonthKey, n: number): MonthKey {
  return monthAt(monthIndex(month) + n);
}

/**
 * Every month from `from` to `to` inclusive — the gap-filling primitive.
 *
 * The dashboard must show a month with no data as an explicit gap, not omit it.
 * An average taken over "the months we happen to have rows for" silently answers
 * a different question than an average over the window the user selected.
 */
export function monthsInRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const months: MonthKey[] = [];
  const last = monthIndex(to);
  for (let i = monthIndex(from); i <= last; i++) months.push(monthAt(i));
  return months;
}

const MONTH_LENGTHS = [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Days in a month, Gregorian leap rule included (1900 has 28, 2000 has 29). */
export function daysInMonth(month: MonthKey): number {
  const m = Number(month.slice(5, 7));
  if (m !== 2) return MONTH_LENGTHS[m - 1]!;
  const y = Number(month.slice(0, 4));
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
}

/** The first and last ISO dates of a month — the inclusive bounds for a query. */
export function monthBounds(month: MonthKey): { readonly start: string; readonly end: string } {
  return {
    start: `${month}-01`,
    end: `${month}-${String(daysInMonth(month)).padStart(2, '0')}`,
  };
}

/**
 * Days since 1970-01-01 — the day-level twin of `monthIndex`, and for the same
 * reason: it turns date arithmetic into integer arithmetic, so leap years and
 * month lengths stop being special cases.
 *
 * This is Howard Hinnant's `days_from_civil`, which shifts the year to start in
 * March so the leap day lands at the end of the year and needs no branch at all.
 * The `146097` is the days in a 400-year Gregorian era; `719468` re-bases the
 * result from era zero onto the Unix epoch.
 *
 * Written out rather than delegated to `Date` for the reason at the top of this
 * file: `new Date('2025-08-01')` reads back as 31 July anywhere west of UTC.
 */
function dayIndex(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));

  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;

  return era * 146097 + dayOfEra - 719468;
}

/** How many days from `from` to `to`; negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return dayIndex(to) - dayIndex(from);
}

/**
 * Shift an ISO date by whole calendar days without a timezone-bearing `Date`.
 *
 * The implementation jumps across month boundaries rather than stepping one
 * day at a time, so large statement gaps remain cheap while leap handling stays
 * centralized in `daysInMonth`.
 */
export function addDays(isoDate: string, amount: number): string {
  if (!Number.isInteger(amount))
    throw new RangeError(`addDays: amount must be an integer, got ${amount}`);

  let year = Number(isoDate.slice(0, 4));
  let month = Number(isoDate.slice(5, 7));
  let day = Number(isoDate.slice(8, 10));
  let remaining = amount;

  while (remaining > 0) {
    const available = daysInMonth(monthKey(year, month)) - day;
    if (remaining <= available) {
      day += remaining;
      remaining = 0;
    } else {
      remaining -= available + 1;
      month++;
      if (month === 13) {
        year++;
        month = 1;
      }
      day = 1;
    }
  }

  while (remaining < 0) {
    const available = day - 1;
    if (-remaining <= available) {
      day += remaining;
      remaining = 0;
    } else {
      remaining += available + 1;
      month--;
      if (month === 0) {
        year--;
        month = 12;
      }
      day = daysInMonth(monthKey(year, month));
    }
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthKey(year: number, month: number): MonthKey {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function monthName(month: MonthKey): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? '???';
}

/** `'2025-08'` → `'Aug 2025'`. Panel headings and tooltips. */
export function formatMonth(month: MonthKey): string {
  return `${monthName(month)} ${month.slice(0, 4)}`;
}

/** `'2025-08'` → `"Aug '25"`. Axis ticks, where horizontal room is scarce. */
export function formatMonthShort(month: MonthKey): string {
  return `${monthName(month)} '${month.slice(2, 4)}`;
}

/** `'2025-05-31'` → `'31 May 2025'`. "As of" dates, which are read, not scanned. */
export function formatIsoDate(isoDate: string): string {
  const day = Number(isoDate.slice(8, 10));
  return `${day} ${monthName(monthOf(isoDate))} ${isoDate.slice(0, 4)}`;
}
