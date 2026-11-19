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

/** A full year, so the stats trend and month-by-month search have depth. */
export const SAMPLE_MONTHS = 12;

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

/** Categories that get sample budgets. Health and Other are left out on
 *  purpose: real users rarely budget everything, and the screen should be
 *  tried with partial coverage. */
const BUDGETED = ["c-food", "c-groc", "c-trvl", "c-home", "c-shop", "c-entm"];

/**
 * Limit as a multiple of what the batch actually spent. Below 1 ends over
 * budget, just above 1 lands in the "nearly there" zone, well above 1 is
 * comfortably under — so every month shows each state the screen can render.
 */
const LIMIT_RATIOS = [0.8, 0.95, 1.05, 1.2, 1.5, 2];

/**
 * Budgets to go with `transactions` (normally the batch from
 * `generateSampleTransactions`). Each limit is derived from what that batch
 * spent in the category that month, times a random ratio from
 * `LIMIT_RATIOS`, rounded to ₹100. Each category is skipped in roughly one
 * month in six so months differ, and a category the batch spent nothing on
 * still gets a small limit so "₹0 of ₹X" shows up too.
 *
 * Limits only reflect this batch — adding sample data several times stacks the
 * spend but replaces the budgets, so repeated runs drift towards "over".
 */
export function generateSampleBudgets(
  transactions: NewTransaction[],
): NewBudget[] {
  const spent = new Map<string, number>();
  const months = new Set<Month>();

  for (const t of transactions) {
    const month = monthOf(t.occurredAt);
    months.add(month);
    const key = `${month}|${t.categoryId}`;
    spent.set(key, (spent.get(key) ?? 0) + t.amountMinor);
  }

  const rows: NewBudget[] = [];
  for (const month of months) {
    for (const categoryId of BUDGETED) {
      if (Math.random() < 1 / 6) continue;
      const spentRupees = (spent.get(`${month}|${categoryId}`) ?? 0) / 100;
      const limitRupees = Math.max(
        500,
        Math.round((spentRupees * pick(LIMIT_RATIOS)) / 100) * 100,
      );
      // One-month budgets: sample limits are derived from each month's own spend.
      rows.push({ categoryId, startMonth: month, endMonth: month, limitMinor: limitRupees * 100 });
    }
  }

  return rows;
}
