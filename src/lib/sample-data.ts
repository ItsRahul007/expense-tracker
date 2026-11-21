/**
 * Fake expenses for trying the app out in development. Only reachable from the
 * `__DEV__` row in Settings — never shipped as a migration, because anything a
 * migration inserts lands in every real install too.
 *
 * Uses the seeded default category ids, which the trigger in
 * `0003_protect_default_categories.sql` guarantees still exist.
 */

import { monthOf, type Month } from "@/lib/month";
import type { NewBudget, NewTransaction } from "@/types/domain";

/** [categoryId, notes to pick from, min rupees, max rupees] */
const TEMPLATES: [string, string[], number, number][] = [
  ["c-food", ["Coffee", "Lunch with team", "Swiggy dinner", "Chai & samosa", "Pizza night"], 60, 1200],
  ["c-groc", ["BigBasket order", "Vegetables", "Milk & bread", "DMart run", "Fruits"], 80, 2500],
  ["c-trvl", ["Uber to office", "Metro recharge", "Petrol", "Auto", "Rapido"], 40, 1800],
  ["c-home", ["Electricity bill", "Internet bill", "Mobile recharge", "Water bill"], 300, 3000],
  ["c-hlth", ["Pharmacy", "Gym membership", "Doctor visit", "Vitamins"], 150, 2500],
  ["c-shop", ["Amazon order", "New shoes", "T-shirt", "Headphones", "Books"], 300, 5000],
  ["c-entm", ["Movie tickets", "Netflix", "Spotify", "Concert", "Bowling"], 150, 1500],
  ["c-misc", ["Gift", "Haircut", "Donation", "Laundry"], 100, 1500],
];

/** Two years, so the stats trend, year-over-year browsing and long budget
 *  ranges all have depth. */
export const SAMPLE_MONTHS = 24;

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * ~`perMonth` expenses in each of the last `months` calendar months (the
 * current one included), at random times of day, never in the future. Plus a
 * fixed ₹15,000 rent on the 1st of each month so totals look realistic.
 */
export function generateSampleTransactions(
  months = SAMPLE_MONTHS,
  perMonth = 25,
  now: number = Date.now(),
): NewTransaction[] {
  const rows: NewTransaction[] = [];
  const today = new Date(now);

  for (let offset = 0; offset < months; offset++) {
    const year = today.getFullYear();
    const month = today.getMonth() - offset;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // The current month only runs up to today.
    const lastDay = offset === 0 ? today.getDate() : daysInMonth;

    rows.push({
      categoryId: "c-home",
      amountMinor: 15_000_00,
      occurredAt: new Date(year, month, 1, 9, 0).getTime(),
      note: "Rent",
    });

    for (let i = 0; i < perMonth; i++) {
      const [categoryId, notes, min, max] = pick(TEMPLATES);
      const day = 1 + Math.floor(Math.random() * lastDay);
      const occurredAt = Math.min(
        new Date(
          year,
          month,
          day,
          8 + Math.floor(Math.random() * 14),
          Math.floor(Math.random() * 60),
        ).getTime(),
        now,
      );
      const rupees = min + Math.floor(Math.random() * (max - min));
      // Roughly one in five amounts has paise, like real UPI totals.
      const paise = Math.random() < 0.2 ? Math.floor(Math.random() * 100) : 0;

      rows.push({
        categoryId,
        amountMinor: rupees * 100 + paise,
        occurredAt,
        note: pick(notes),
      });
    }
  }

  return rows;
}

/**
 * Limit as a multiple of what the batch actually spent. Below 1 ends over
 * budget, just above 1 lands in the "nearly there" zone, well above 1 is
 * comfortably under — so every month shows each state the screen can render.
 */
const LIMIT_RATIOS = [0.8, 0.95, 1.05, 1.2, 1.5, 2];

/** Categories with a fresh one-month budget each month (skipped ~1 month in 6). */
const MONTHLY = ["c-trvl", "c-shop", "c-entm"];

/** Rupees rounded to the nearest `step`, at least `floor`. */
function limitFrom(rupees: number, step = 100, floor = 500): number {
  return Math.max(floor, Math.round(rupees / step) * step) * 100;
}

/**
 * Budgets to go with `transactions` (normally the batch from
 * `generateSampleTransactions`), covering every kind of scope the app has so
 * the Budgets screen and its scope labels can be tried properly:
 *
 *  - Rent & Bills — one "every month" budget from the first month.
 *  - Food — "every month", plus one-month overrides in a few months.
 *  - Groceries — two date ranges (first half / second half), the later one
 *    higher, like prices going up.
 *  - Transport, Shopping, Entertainment — a one-month budget per month, each
 *    skipped in roughly one month in six so months differ.
 *  - Health and Other — none: real users rarely budget everything.
 *
 * Limits come from what this batch spent, times a ratio from `LIMIT_RATIOS`.
 * Order matters: rows are saved in order and the latest save wins where
 * budgets overlap (`src/lib/budget-scope.ts`), so the one-month overrides come
 * after the "every month" budget they override.
 *
 * Repeated runs stack the spend but replace the budgets (same category and
 * scope), so they drift towards "over".
 */
export function generateSampleBudgets(
  transactions: NewTransaction[],
): NewBudget[] {
  const spent = new Map<string, number>();
  const monthSet = new Set<Month>();

  for (const t of transactions) {
    const month = monthOf(t.occurredAt);
    monthSet.add(month);
    const key = `${month}|${t.categoryId}`;
    spent.set(key, (spent.get(key) ?? 0) + t.amountMinor);
  }

  const months = [...monthSet].sort();
  if (months.length === 0) return [];
  const first = months[0];
  const last = months[months.length - 1];

  /** Average monthly spend in rupees over `span`. */
  const average = (categoryId: string, span: Month[]) =>
    span.reduce((sum, m) => sum + (spent.get(`${m}|${categoryId}`) ?? 0), 0) /
    100 /
    Math.max(1, span.length);

  const rows: NewBudget[] = [];

  // Every month: comfortably above the usual rent + bills.
  rows.push({
    categoryId: "c-home",
    startMonth: first,
    endMonth: null,
    limitMinor: limitFrom(average("c-home", months) * 1.1, 1000),
  });

  // Every month, near the average so some months go over.
  rows.push({
    categoryId: "c-food",
    startMonth: first,
    endMonth: null,
    limitMinor: limitFrom(average("c-food", months)),
  });

  // Two ranges; with an odd count the first half is the shorter one.
  if (months.length >= 2) {
    const split = Math.floor(months.length / 2);
    const early = months.slice(0, split);
    const late = months.slice(split);
    rows.push({
      categoryId: "c-groc",
      startMonth: first,
      endMonth: early[early.length - 1],
      limitMinor: limitFrom(average("c-groc", early) * pick(LIMIT_RATIOS)),
    });
    rows.push({
      categoryId: "c-groc",
      startMonth: late[0],
      endMonth: last,
      limitMinor: limitFrom(average("c-groc", late) * pick(LIMIT_RATIOS) * 1.15),
    });
  }

  for (const month of months) {
    for (const categoryId of MONTHLY) {
      if (Math.random() < 1 / 6) continue;
      const spentRupees = (spent.get(`${month}|${categoryId}`) ?? 0) / 100;
      rows.push({
        categoryId,
        startMonth: month,
        endMonth: month,
        limitMinor: limitFrom(spentRupees * pick(LIMIT_RATIOS)),
      });
    }
  }

  // Food overrides last, so they beat the "every month" budget: a bigger
  // allowance for a festive month in each year, and the current month.
  const festive = months.filter((m) => m.endsWith("-10"));
  for (const month of new Set([...festive, last])) {
    rows.push({
      categoryId: "c-food",
      startMonth: month,
      endMonth: month,
      limitMinor: limitFrom(average("c-food", months) * 1.5),
    });
  }

  return rows;
}

