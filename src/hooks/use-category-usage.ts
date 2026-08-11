import { useMemo } from "react";

import { currentMonth } from "@/lib/month";
import { useBudgets, useTransactions } from "@/queries";
import type { ID } from "@/types/domain";

export type CategoryUsage = {
  /** Across all history, not just this month. */
  transactionCount: number;
  hasBudget: boolean;
  /** True while still unknown — see the note on the return below. */
  inUse: boolean;
  isPending: boolean;
};

/**
 * Whether anything still points at a category, used to gate deleting it.
 *
 * ---------------------------------------------------------------------------
 * RAHUL — this is a UI-layer stand-in, and it has one real gap.
 *
 * It answers the question by *fetching rows and counting them in JS*: every
 * transaction in the category (correct — `month: null` searches all history),
 * plus the budgets for the current month (incomplete — `useBudgets` takes one
 * month, so a budget you set for this category last March is invisible here,
 * and the delete button would wrongly stay enabled).
 *
 * The data-layer version is one query and has no gap:
 *
 *     useCategoryUsage(id) -> { transactionCount, budgetCount }
 *
 * two `select count(*)` — one on transaction, one on budget with no month
 * filter. That reads two integers instead of hydrating potentially thousands of
 * rows to call `.length` on them, and it can see every month at once. Swap this
 * file's body for that hook when you write it; the components below don't
 * change.
 * ---------------------------------------------------------------------------
 */
export function useCategoryUsage(categoryId: ID): CategoryUsage {
  const filters = useMemo(() => ({ categoryIds: [categoryId] }), [categoryId]);

  const { data: transactions, isPending: transactionsPending } = useTransactions(
    null,
    filters,
  );
  const { data: budgets, isPending: budgetsPending } = useBudgets(
    currentMonth(),
  );

  const transactionCount = transactions?.length ?? 0;
  const hasBudget = (budgets ?? []).some((b) => b.categoryId === categoryId);
  const isPending = transactionsPending || budgetsPending;

  return {
    transactionCount,
    hasBudget,
    // Unresolved counts as in-use. Guessing the other way would enable a
    // destructive button on the strength of data that hasn't arrived yet.
    inUse: isPending || transactionCount > 0 || hasBudget,
    isPending,
  };
}
