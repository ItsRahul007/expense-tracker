/**
 * Mock implementation of the query contract.
 *
 * Every hook here has the exact signature `live.ts` must match. Deliberately
 * built on `useSyncExternalStore` and plain state rather than TanStack Query, so
 * the UI can be finished and reviewed before the data layer exists and without
 * pre-committing to any query-client configuration.
 *
 * A small artificial latency is included on purpose: without it, pending states
 * never render during development and end up untested.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { monthOf, monthRange, type Month } from "@/lib/month";
import type {
  Budget,
  BudgetStatus,
  Category,
  ID,
  MonthPoint,
  MonthSummary,
  MutationResult,
  NewTransaction,
  QueryResult,
  Settings,
  Transaction,
  TransactionPatch,
  TxFilters,
} from "@/types/domain";

import * as store from "./mock-store";
import type { MockState } from "./mock-store";

const LATENCY_MS = 140;

/** Keys whose first "fetch" has already resolved. Module-level so navigating
 *  back to a screen doesn't re-show a pending state, matching how a warm cache
 *  behaves. */
const warmed = new Set<string>();

/**
 * The selector receives state as an argument rather than closing over
 * `store.getState()` — that keeps the subscribed value and the computed value
 * provably the same snapshot, and avoids a stale-closure dependency problem.
 */
function useMockQuery<T>(key: string, select: (state: MockState) => T): QueryResult<T> {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [ready, setReady] = useState(() => warmed.has(key));

  useEffect(() => {
    if (warmed.has(key)) {
      setReady(true);
      return;
    }
    setReady(false);
    const timer = setTimeout(() => {
      warmed.add(key);
      setReady(true);
    }, LATENCY_MS);
    return () => clearTimeout(timer);
  }, [key]);

  return {
    data: ready ? select(state) : undefined,
    isPending: !ready,
    error: null,
  };
}

function useMockMutation<TArgs>(run: (args: TArgs) => void): MutationResult<TArgs> {
  const [isPending, setIsPending] = useState(false);

  const mutateAsync = useCallback(
    async (args: TArgs) => {
      setIsPending(true);
      await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
      run(args);
      setIsPending(false);
    },
    [run],
  );

  const mutate = useCallback(
    (args: TArgs) => {
      void mutateAsync(args);
    },
    [mutateAsync],
  );

  return { mutate, mutateAsync, isPending, error: null };
}

function matchesFilters(
  tx: Transaction,
  filters: TxFilters | undefined,
  categoryName: (id: ID) => string,
): boolean {
  if (!filters) return true;

  if (filters.text) {
    const needle = filters.text.toLowerCase();
    const haystack = `${tx.note ?? ""} ${categoryName(tx.categoryId)}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  if (filters.categoryIds?.length && !filters.categoryIds.includes(tx.categoryId)) return false;
  if (filters.minMinor != null && tx.amountMinor < filters.minMinor) return false;
  if (filters.maxMinor != null && tx.amountMinor > filters.maxMinor) return false;
  if (filters.from != null && tx.occurredAt < filters.from) return false;
  if (filters.to != null && tx.occurredAt >= filters.to) return false;

  return true;
}

// --- queries ----------------------------------------------------------------

export function useCategories(): QueryResult<Category[]> {
  return useMockQuery("category", (state) => state.categories);
}

/**
 * Transactions for a month, newest first.
 *
 * Pass `month: null` to search across all history — that's how the search
 * screen uses it.
 */
export function useTransactions(
  month: Month | null,
  filters?: TxFilters,
): QueryResult<Transaction[]> {
  const key = `tx:list:${month ?? "all"}:${JSON.stringify(filters ?? {})}`;

  return useMockQuery(key, ({ transactions, categories }) => {
    const nameOf = (id: ID) => categories.find((c) => c.id === id)?.name ?? "";
    const bounds = month ? monthRange(month) : null;

    return transactions.filter((tx) => {
      if (bounds && (tx.occurredAt < bounds.from || tx.occurredAt >= bounds.to)) return false;
      return matchesFilters(tx, filters, nameOf);
    });
  });
}

export function useMonthSummary(month: Month): QueryResult<MonthSummary> {
  return useMockQuery(`tx:summary:${month}`, ({ transactions }) => {
    const { from, to } = monthRange(month);

    let totalMinor = 0;
    const totals = new Map<ID, number>();

    for (const tx of transactions) {
      if (tx.occurredAt < from || tx.occurredAt >= to) continue;
      totalMinor += tx.amountMinor;
      totals.set(tx.categoryId, (totals.get(tx.categoryId) ?? 0) + tx.amountMinor);
    }

    return {
      totalMinor,
      byCategory: [...totals.entries()]
        .map(([categoryId, total]) => ({ categoryId, totalMinor: total }))
        .sort((a, b) => b.totalMinor - a.totalMinor),
    };
  });
}

export function useMonthTrend(months: Month[]): QueryResult<MonthPoint[]> {
  const key = `tx:trend:${months.join(",")}`;

  return useMockQuery(key, ({ transactions }) => {
    const totals = new Map<Month, number>(months.map((m) => [m, 0]));

    for (const tx of transactions) {
      const m = monthOf(tx.occurredAt);
      if (totals.has(m)) totals.set(m, (totals.get(m) ?? 0) + tx.amountMinor);
    }

    return months.map((month) => ({ month, totalMinor: totals.get(month) ?? 0 }));
  });
}

/** Budgets for a month joined with actual spend, ordered by category. */
export function useBudgets(month: Month): QueryResult<BudgetStatus[]> {
  return useMockQuery(`budget:${month}`, ({ budgets, transactions, categories }) => {
    const { from, to } = monthRange(month);

    const spent = new Map<ID, number>();
    for (const tx of transactions) {
      if (tx.occurredAt < from || tx.occurredAt >= to) continue;
      spent.set(tx.categoryId, (spent.get(tx.categoryId) ?? 0) + tx.amountMinor);
    }

    const order = new Map(categories.map((c) => [c.id, c.sortOrder]));

    return budgets
      .filter((b) => b.month === month)
      .map((b) => ({ ...b, spentMinor: spent.get(b.categoryId) ?? 0 }))
      .sort((a, b) => (order.get(a.categoryId) ?? 0) - (order.get(b.categoryId) ?? 0));
  });
}

export function useTransaction(id: ID): QueryResult<Transaction | null> {
  return useMockQuery(
    `tx:one:${id}`,
    ({ transactions }) => transactions.find((t) => t.id === id) ?? null,
  );
}

export function useSetting<K extends keyof Settings>(key: K): QueryResult<Settings[K]> {
  return useMockQuery(`setting:${key}`, ({ settings }) => settings[key]);
}

/** Months that contain at least one transaction, ascending. */
export function useKnownMonths(): QueryResult<Month[]> {
  return useMockQuery("tx:months", ({ transactions }) =>
    [...new Set(transactions.map((t) => monthOf(t.occurredAt)))].sort(),
  );
}

// --- mutations --------------------------------------------------------------

export function useAddTransaction(): MutationResult<NewTransaction> {
  return useMockMutation(store.addTransaction);
}

export function useUpdateTransaction(): MutationResult<TransactionPatch> {
  return useMockMutation(store.updateTransaction);
}

export function useDeleteTransaction(): MutationResult<ID> {
  return useMockMutation(store.deleteTransaction);
}

export function useUpsertBudget(): MutationResult<Budget> {
  return useMockMutation(store.upsertBudget);
}

export function useUpsertCategory(): MutationResult<Category> {
  return useMockMutation(store.upsertCategory);
}

export function useSetSetting(): MutationResult<{
  key: keyof Settings;
  value: Settings[keyof Settings];
}> {
  return useMockMutation(({ key, value }) => store.setSetting(key, value));
}

// --- one-shot ---------------------------------------------------------------

/**
 * Whole-ledger CSV. Amounts are written as decimal rupees because that's what a
 * spreadsheet expects; everything internal stays in paise.
 */
export async function exportAllData(): Promise<string> {
  const { transactions, categories } = store.getState();
  const nameOf = (id: ID) => categories.find((c) => c.id === id)?.name ?? "";

  const { formatAmountExact, formatISODate } = await import("@/lib/format");

  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const rows = [...transactions]
    .sort((a, b) => a.occurredAt - b.occurredAt)
    .map((tx) =>
      [
        formatISODate(tx.occurredAt),
        escape(nameOf(tx.categoryId)),
        formatAmountExact(tx.amountMinor),
        escape(tx.note ?? ""),
      ].join(","),
    );

  return ["Date,Category,Amount,Note", ...rows].join("\n");
}
