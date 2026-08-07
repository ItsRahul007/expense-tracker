/**
 * Month arithmetic.
 *
 * A `Month` is the string "YYYY-MM". It sorts lexically, survives JSON, and
 * makes a stable TanStack Query key — all things a Date object does badly.
 *
 * Transactions are stored as UTC epoch ms but grouped by the *local* calendar,
 * because an expense at 11pm on 31 July belongs to July from the spender's
 * point of view. Every boundary below is therefore local-time.
 */

export type Month = string;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthOf(ts: number): Month {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function currentMonth(now: number = Date.now()): Month {
  return monthOf(now);
}

function parse(month: Month): { year: number; index: number } {
  const [year, m] = month.split("-").map(Number);
  return { year, index: m - 1 };
}

/** "August 2026" — the month switcher. */
export function monthLabel(month: Month): string {
  const { year, index } = parse(month);
  return `${MONTHS[index]} ${year}`;
}

/** "Aug" — chart axes and other tight spots. */
export function monthShort(month: Month): string {
  return MONTHS[parse(month).index].slice(0, 3);
}

/** Shift by whole months; `n` may be negative. Handles year rollover. */
export function shiftMonth(month: Month, n: number): Month {
  const { year, index } = parse(month);
  const d = new Date(year, index + n, 1);
  return monthOf(d.getTime());
}

/**
 * Half-open local-time bounds for a month: `from <= t < to`.
 *
 * Half-open rather than inclusive so a transaction at 23:59:59.999 on the last
 * day can never be double-counted or dropped by an off-by-one millisecond.
 */
export function monthRange(month: Month): { from: number; to: number } {
  const { year, index } = parse(month);
  return {
    from: new Date(year, index, 1, 0, 0, 0, 0).getTime(),
    to: new Date(year, index + 1, 1, 0, 0, 0, 0).getTime(),
  };
}

/** The n most recent months, oldest first — the order the trend chart draws. */
export function lastNMonths(n: number, from: Month = currentMonth()): Month[] {
  return Array.from({ length: n }, (_, i) => shiftMonth(from, i - (n - 1)));
}

export function isFutureMonth(month: Month, now: number = Date.now()): boolean {
  return month > currentMonth(now);
}
