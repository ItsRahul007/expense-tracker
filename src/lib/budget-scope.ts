/**
 * Which budget applies to which month.
 *
 * A budget covers a span of months (see `BudgetScope` in `src/types/domain.ts`)
 * and spans may overlap, so "₹5,000 every month" and "₹8,000 in December" can
 * both exist for Food. For any one month, exactly one budget per category is in
 * force: **the one saved most recently** among those that cover it.
 *
 * Latest-wins rather than most-specific-wins, because the budget someone just
 * saved must be the one they see. Under most-specific-wins, saving "every
 * month" on top of an older one-month budget appeared to do nothing. Overrides
 * still work the natural way round: set "every month", then "December only",
 * and December uses the override.
 *
 * Only when two budgets were saved at the same moment (e.g. rows converted by
 * the 0004 migration) does specificity break the tie: one with an end beats
 * one without, then fewer months, then the later start.
 *
 * Pure and database-free, so the budgets query, the import preview and the
 * screens all agree on the answer.
 */

import { monthLabel, monthShort, shiftMonth, type Month } from "@/lib/month";
import type { Budget, BudgetScope } from "@/types/domain";

export type ScopeKind = "month" | "ongoing" | "range";

export function scopeKind(scope: BudgetScope): ScopeKind {
  if (scope.endMonth === null) return "ongoing";
  return scope.startMonth === scope.endMonth ? "month" : "range";
}

export function coversMonth(scope: BudgetScope, month: Month): boolean {
  return (
    scope.startMonth <= month &&
    (scope.endMonth === null || month <= scope.endMonth)
  );
}

export function sameScope(a: BudgetScope, b: BudgetScope): boolean {
  return a.startMonth === b.startMonth && a.endMonth === b.endMonth;
}

/** Months covered, inclusive. Only meaningful for a scope with an end. */
function monthCount(start: Month, end: Month): number {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

/** Negative when `a` should win over `b`: saved later, or as specific and
 *  more so. */
function byPrecedence(a: Budget, b: Budget): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.endMonth === null && b.endMonth !== null) return 1;
  if (a.endMonth !== null && b.endMonth === null) return -1;
  if (a.endMonth !== null && b.endMonth !== null) {
    const span =
      monthCount(a.startMonth, a.endMonth) - monthCount(b.startMonth, b.endMonth);
    if (span !== 0) return span;
  }
  if (a.startMonth !== b.startMonth) return a.startMonth > b.startMonth ? -1 : 1;
  return 0;
}

/** The single budget in force per category for `month`. Order is unspecified. */
export function effectiveBudgets<B extends Budget>(budgets: B[], month: Month): B[] {
  const winners = new Map<string, B>();
  for (const budget of budgets) {
    if (!coversMonth(budget, month)) continue;
    const current = winners.get(budget.categoryId);
    if (!current || byPrecedence(budget, current) < 0) {
      winners.set(budget.categoryId, budget);
    }
  }
  return [...winners.values()];
}

/**
 * What's left of a scope once one month is cut out of it — zero, one or two
 * scopes. Used by "remove for this month only" on a multi-month budget.
 */
export function withoutMonth(scope: BudgetScope, month: Month): BudgetScope[] {
  if (!coversMonth(scope, month)) return [scope];

  const parts: BudgetScope[] = [];
  if (scope.startMonth < month) {
    parts.push({ startMonth: scope.startMonth, endMonth: shiftMonth(month, -1) });
  }
  if (scope.endMonth === null || month < scope.endMonth) {
    parts.push({ startMonth: shiftMonth(month, 1), endMonth: scope.endMonth });
  }
  return parts;
}

/** "Nov 2026" */
export function monthShortLabel(month: Month): string {
  return `${monthShort(month)} ${month.slice(0, 4)}`;
}

/** "November 2026 only" · "Every month from Nov 2026" · "Oct 2026 – Mar 2027" */
export function scopeLabel(scope: BudgetScope): string {
  switch (scopeKind(scope)) {
    case "month":
      return `${monthLabel(scope.startMonth)} only`;
    case "ongoing":
      return `Every month from ${monthShortLabel(scope.startMonth)}`;
    case "range":
      return `${monthShortLabel(scope.startMonth)} – ${monthShortLabel(scope.endMonth!)}`;
  }
}
