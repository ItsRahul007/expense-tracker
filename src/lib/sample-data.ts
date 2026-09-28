/**
 * Fake expenses for trying the app out in development. Only reachable from the
 * `__DEV__` row in Settings — never shipped as a migration, because anything a
 * migration inserts lands in every real install too.
 *
 * Uses the seeded default category ids, which the trigger in
 * `0003_protect_default_categories.sql` guarantees still exist.
 */

import type { NewTransaction } from "@/types/domain";

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
