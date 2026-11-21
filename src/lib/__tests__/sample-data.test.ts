import { effectiveBudgets, scopeKind } from "@/lib/budget-scope";
import { monthOf, shiftMonth } from "@/lib/month";
import {
  SAMPLE_MONTHS,
  generateSampleBudgets,
  generateSampleTransactions,
} from "@/lib/sample-data";
import type { Budget } from "@/types/domain";

const NOW = new Date(2026, 10, 21, 18, 0).getTime(); // 21 Nov 2026

describe("sample data", () => {
  const transactions = generateSampleTransactions(SAMPLE_MONTHS, 25, NOW);
  const budgets = generateSampleBudgets(transactions);

  it("spans 24 months ending this month, never in the future", () => {
    const months = new Set(transactions.map((t) => monthOf(t.occurredAt)));
    expect(months.size).toBe(24);
    expect(months.has("2026-11")).toBe(true);
    expect(months.has(shiftMonth("2026-11", -23))).toBe(true);
    expect(Math.max(...transactions.map((t) => t.occurredAt))).toBeLessThanOrEqual(NOW);
  });

  it("includes every budget scope kind", () => {
    const kinds = new Set(budgets.map(scopeKind));
    expect(kinds).toEqual(new Set(["month", "ongoing", "range"]));
  });

  it("lets the food override beat the every-month budget", () => {
    // Saved in array order, so array index stands in for createdAt.
    const saved: Budget[] = budgets.map((b, i) => ({ ...b, id: `b${i}`, createdAt: i }));
    const food = (month: string) =>
      effectiveBudgets(saved, month).find((b) => b.categoryId === "c-food");

    expect(scopeKind(food("2026-10")!)).toBe("month");
    expect(scopeKind(food("2026-11")!)).toBe("month");
    expect(scopeKind(food("2026-09")!)).toBe("ongoing");
  });

  it("covers every month with Rent & Bills and Groceries", () => {
    const saved: Budget[] = budgets.map((b, i) => ({ ...b, id: `b${i}`, createdAt: i }));
    for (let n = 0; n < 24; n++) {
      const month = shiftMonth("2026-11", -n);
      const ids = effectiveBudgets(saved, month).map((b) => b.categoryId);
      expect(ids).toEqual(expect.arrayContaining(["c-home", "c-groc"]));
    }
  });
});
