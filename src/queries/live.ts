import * as schema from "@/db/schema/schema";
import { budget, category, settings, transaction } from "@/db/schema/schema";
import {
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
import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  UseMutationResult,
} from "@tanstack/react-query";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  like,
  lt,
  lte,
  or,
  SQL,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";

import { DATABASE_NAME } from "@/constants/common";
import { Month, monthRange } from "@/lib/month";
import { useDrizzle } from "./helper";

const DEFAULT_SETTINGS: Settings = { theme: "system" };

function newTransactionId(): ID {
  return `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Adapts a TanStack `UseMutationResult` to the narrower `MutationResult`
 *  contract the mock implementation also satisfies. */
function toMutationResult<TArgs, TData>(
  mutation: UseMutationResult<TData, Error, TArgs>,
): MutationResult<TArgs> {
  return {
    mutate: (args) => mutation.mutate(args),
    mutateAsync: async (args) => {
      await mutation.mutateAsync(args);
    },
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

/** Everything that can change when transactions are written — including
 *  budgets, since `BudgetStatus.spentMinor` is derived from them. */
function invalidateTransactions(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["transaction"] });
  queryClient.invalidateQueries({ queryKey: ["monthSummary"] });
  queryClient.invalidateQueries({ queryKey: ["monthTrend"] });
  queryClient.invalidateQueries({ queryKey: ["knownMonths"] });
  queryClient.invalidateQueries({ queryKey: ["budget"] });
}

export function useCategories(): QueryResult<Category[]> {
  const db = useDrizzle();

  const { data, isPending, error } = useQuery<Category[]>({
    queryKey: ["category"],
    queryFn: () =>
      db
        .select({
          id: category.id,
          name: category.name,
          icon: category.icon,
          color: category.color,
          sortOrder: category.sortOrder,
        })
        .from(category)
        .orderBy(category.sortOrder)
        .all(),
  });

  return { data, isPending, error };
}

export function useTransactions(
  month: Month | null,
  filters?: TxFilters,
): QueryResult<Transaction[]> {
  const db = useDrizzle();
  const bounds = month ? monthRange(month) : null;

  const { data, isPending, error } = useQuery<Transaction[]>({
    queryKey: ["transaction", month, filters],
    queryFn: async () => {
      const conditions: SQL<unknown>[] = [];

      if (bounds || filters?.from != null || filters?.to != null) {
        const dateCondition: SQL<unknown> | undefined = and(
          gte(transaction.occurredAt, bounds?.from ?? filters?.from ?? 0),
          lt(transaction.occurredAt, bounds?.to ?? filters?.to ?? 0),
        );
        if (dateCondition) {
          conditions.push(dateCondition);
        }
      }

      const filterConditions: SQL<unknown>[] = [];
      if (filters?.text) {
        const textCondition = or(
          like(transaction.note, `%${filters.text}%`),
          inArray(
            transaction.categoryId,
            db
              .select({ id: category.id })
              .from(category)
              .where(like(category.name, `%${filters.text}%`)),
          ),
        );
        if (textCondition) {
          filterConditions.push(textCondition);
        }
      }
      if (filters?.categoryIds) {
        filterConditions.push(
          inArray(transaction.categoryId, filters.categoryIds),
        );
      }
      if (filters?.minMinor != null) {
        filterConditions.push(gte(transaction.amountMinor, filters.minMinor));
      }
      if (filters?.maxMinor != null) {
        filterConditions.push(lte(transaction.amountMinor, filters.maxMinor));
      }

      if (filterConditions.length > 0) {
        const allFilterConditions = and(...filterConditions);

        allFilterConditions && conditions.push(allFilterConditions);
      }

      return db
        .select()
        .from(transaction)
        .where(and(...conditions))
        .orderBy(desc(transaction.occurredAt))
        .all();
    },
  });

  return {
    data,
    isPending,
    error,
  };
}

export function useMonthSummary(month: Month): QueryResult<MonthSummary> {
  const db = useDrizzle();

  const { data, isPending, error } = useQuery<MonthSummary>({
    queryKey: ["monthSummary", month],
    queryFn: async () => {
      const { from, to } = monthRange(month);

      const transactions = db
        .select({
          total: transaction.amountMinor,
          categoryId: transaction.categoryId,
        })
        .from(transaction)
        .where(
          and(
            gte(transaction.occurredAt, from),
            lt(transaction.occurredAt, to),
          ),
        )
        .orderBy(desc(transaction.occurredAt))
        .all();

      let totalMinor = 0;
      const totals = new Map<string, number>();
      for (const tx of transactions) {
        totalMinor += tx.total;
        totals.set(tx.categoryId, (totals.get(tx.categoryId) ?? 0) + tx.total);
      }

      return {
        totalMinor,
        byCategory: [...totals.entries()]
          .map(([categoryId, total]) => ({ categoryId, totalMinor: total }))
          .sort((a, b) => b.totalMinor - a.totalMinor),
      };
    },
  });

  return {
    data,
    isPending,
    error,
  };
}

export function useMonthTrend(months: Month[]): QueryResult<MonthPoint[]> {
  const db = useDrizzle();

  const { data, isPending, error } = useQuery<MonthPoint[]>({
    queryKey: ["monthTrend", months],
    queryFn: async () => {
      const monthPoints: MonthPoint[] = [];

      let overallFrom = Infinity;
      let overallTo = -Infinity;

      for (const month of months) {
        const { from, to } = monthRange(month);
        overallFrom = Math.min(overallFrom, from);
        overallTo = Math.max(overallTo, to);
      }

      const rows = db
        .select({
          month: sql<string>`strftime('%Y-%m', ${transaction.occurredAt} / 1000, 'unixepoch', 'localtime')`,
          total: sql<number>`sum(${transaction.amountMinor})`,
        })
        .from(transaction)
        .where(
          and(
            gte(transaction.occurredAt, overallFrom),
            lt(transaction.occurredAt, overallTo),
          ),
        )
        .groupBy(
          sql`strftime('%Y-%m', ${transaction.occurredAt} / 1000, 'unixepoch', 'localtime')`,
        )
        .all();

      const totalsMap = new Map<string, number>();
      for (const row of rows) {
        totalsMap.set(row.month, row.total);
      }

      for (const month of months) {
        const monthStr = month.toString();
        const totalMinor = totalsMap.get(monthStr) ?? 0;
        monthPoints.push({ month, totalMinor });
      }

      return monthPoints;
    },
  });

  return {
    data,
    isPending,
    error,
  };
}

/** Budgets for a month joined with actual spend, ordered by category. */
export function useBudgets(month: Month): QueryResult<BudgetStatus[]> {
  const db = useDrizzle();

  const { data, isPending, error } = useQuery<BudgetStatus[]>({
    queryKey: ["budget", month],
    queryFn: () => {
      const { from, to } = monthRange(month);

      const spentRows = db
        .select({
          categoryId: transaction.categoryId,
          total: sql<number>`sum(${transaction.amountMinor})`,
        })
        .from(transaction)
        .where(
          and(
            gte(transaction.occurredAt, from),
            lt(transaction.occurredAt, to),
          ),
        )
        .groupBy(transaction.categoryId)
        .all();
      const spent = new Map(spentRows.map((r) => [r.categoryId, r.total]));

      const categories = db
        .select({ id: category.id, sortOrder: category.sortOrder })
        .from(category)
        .all();
      const order = new Map(categories.map((c) => [c.id, c.sortOrder]));

      const budgets = db
        .select()
        .from(budget)
        .where(eq(budget.month, month))
        .all();

      return budgets
        .map((b) => ({ ...b, spentMinor: spent.get(b.categoryId) ?? 0 }))
        .sort(
          (a, b) =>
            (order.get(a.categoryId) ?? 0) - (order.get(b.categoryId) ?? 0),
        );
    },
  });

  return { data, isPending, error };
}

export function useTransaction(id: ID): QueryResult<Transaction | null> {
  const db = useDrizzle();

  const { data, isPending, error } = useQuery<Transaction | null>({
    queryKey: ["transaction", "one", id],
    queryFn: () =>
      db.select().from(transaction).where(eq(transaction.id, id)).get() ??
      null,
  });

  return { data, isPending, error };
}

export function useSetting<K extends keyof Settings>(
  key: K,
): QueryResult<Settings[K]> {
  const db = useDrizzle();

  const { data, isPending, error } = useQuery<Settings[K]>({
    queryKey: ["setting", key],
    queryFn: () => {
      const row = db.select().from(settings).get();
      return (row?.[key] ?? DEFAULT_SETTINGS[key]) as Settings[K];
    },
  });

  return { data, isPending, error };
}

/** Months that contain at least one transaction, ascending. */
export function useKnownMonths(): QueryResult<Month[]> {
  const db = useDrizzle();

  const { data, isPending, error } = useQuery<Month[]>({
    queryKey: ["knownMonths"],
    queryFn: () => {
      const rows = db
        .select({
          month: sql<string>`strftime('%Y-%m', ${transaction.occurredAt} / 1000, 'unixepoch', 'localtime')`,
        })
        .from(transaction)
        .groupBy(
          sql`strftime('%Y-%m', ${transaction.occurredAt} / 1000, 'unixepoch', 'localtime')`,
        )
        .all();

      return rows.map((r) => r.month).sort();
    },
  });

  return { data, isPending, error };
}

// --- mutations --------------------------------------------------------------

export function useAddTransaction(): MutationResult<NewTransaction> {
  const db = useDrizzle();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: NewTransaction) =>
      db
        .insert(transaction)
        .values({ ...input, id: newTransactionId() })
        .run(),
    onSuccess: () => invalidateTransactions(queryClient),
  });

  return toMutationResult(mutation);
}

export function useUpdateTransaction(): MutationResult<TransactionPatch> {
  const db = useDrizzle();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ id, ...patch }: TransactionPatch) =>
      db.update(transaction).set(patch).where(eq(transaction.id, id)).run(),
    onSuccess: () => invalidateTransactions(queryClient),
  });

  return toMutationResult(mutation);
}

export function useDeleteTransaction(): MutationResult<ID> {
  const db = useDrizzle();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (id: ID) =>
      db.delete(transaction).where(eq(transaction.id, id)).run(),
    onSuccess: () => invalidateTransactions(queryClient),
  });

  return toMutationResult(mutation);
}

/** Upsert-or-delete: a limit of 0 or less removes the budget row, matching the
 *  mock store's semantics. */
export function useUpsertBudget(): MutationResult<Budget> {
  const db = useDrizzle();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: Budget) => {
      if (input.limitMinor <= 0) {
        return db
          .delete(budget)
          .where(
            and(
              eq(budget.categoryId, input.categoryId),
              eq(budget.month, input.month),
            ),
          )
          .run();
      }
      return db
        .insert(budget)
        .values(input)
        .onConflictDoUpdate({
          target: [budget.categoryId, budget.month],
          set: { limitMinor: input.limitMinor },
        })
        .run();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["budget"] }),
  });

  return toMutationResult(mutation);
}

export function useUpsertCategory(): MutationResult<Category> {
  const db = useDrizzle();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: Category) =>
      db
        .insert(category)
        .values(input)
        .onConflictDoUpdate({
          target: category.id,
          set: {
            name: input.name,
            icon: input.icon,
            color: input.color,
            sortOrder: input.sortOrder,
          },
        })
        .run(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["category"] });
      // Not ['transaction']: transaction rows only ever store a categoryId —
      // every consumer joins name/icon/color client-side against `useCategories`,
      // so that cache invalidation alone already refreshes what's on screen.
      // ['budget'] *is* needed, though, for a different reason: useBudgets bakes
      // category.sortOrder into its result's sort order server-side, so a
      // sortOrder change leaves the cached budget list in the old order until
      // that query re-runs.
      queryClient.invalidateQueries({ queryKey: ["budget"] });
    },
  });

  return toMutationResult(mutation);
}

/**
 * Deletes a category and the budgets attached to it.
 *
 * Two referencing tables, two deliberately different answers. A budget is a
 * monthly limit *on* a category and means nothing without one, so it goes where
 * the category goes — and for every month, not just the one the Categories
 * screen happens to be able to see. A transaction is a record of money that was
 * actually spent, so it is left alone and the "no action" foreign key aborts the
 * whole delete instead, which is exactly the loud failure the schema comment
 * asks for.
 *
 * Both deletes share one transaction, so an abort — the FK above, or the
 * `categories_protect_default_delete` trigger on a seeded category — takes the
 * budget rows back with it rather than stripping a surviving category's limits.
 */
export function useDeleteCategory(): MutationResult<ID> {
  const db = useDrizzle();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (id: ID) =>
      db.transaction((tx) => {
        tx.delete(budget).where(eq(budget.categoryId, id)).run();
        return tx.delete(category).where(eq(category.id, id)).run();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["category"] });
      // ['budget'] because rows were actually removed here, not just for the
      // sortOrder reason useUpsertCategory invalidates it for. Transaction keys
      // are untouched on purpose: a category with transactions can't reach this
      // point at all, so nothing under them can have changed.
      queryClient.invalidateQueries({ queryKey: ["budget"] });
    },
  });

  return toMutationResult(mutation);
}

export function useSetSetting(): MutationResult<{
  key: keyof Settings;
  value: Settings[keyof Settings];
}> {
  const db = useDrizzle();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      key,
      value,
    }: {
      key: keyof Settings;
      value: Settings[keyof Settings];
    }) => {
      const existing = db.select().from(settings).get();
      if (existing) {
        return db.update(settings).set({ [key]: value }).run();
      }
      return db.insert(settings).values({ [key]: value }).run();
    },
    onSuccess: (_data, { key }) => {
      queryClient.invalidateQueries({ queryKey: ["setting", key] });
    },
  });

  return toMutationResult(mutation);
}

// --- one-shot ---------------------------------------------------------------

/**
 * Whole-ledger CSV. Amounts are written as decimal rupees because that's what a
 * spreadsheet expects; everything internal stays in paise.
 */
export async function exportAllData(): Promise<string> {
  const handle = openDatabaseSync(DATABASE_NAME);

  try {
    const db = drizzle(handle, { schema });

    const transactions = db
      .select()
      .from(transaction)
      .orderBy(transaction.occurredAt)
      .all();
    const categories = db.select().from(category).all();
    const nameOf = (id: ID) => categories.find((c) => c.id === id)?.name ?? "";

    const { formatAmountExact, formatISODate } = await import("@/lib/format");

    const escape = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

    const rows = transactions.map((tx) =>
      [
        formatISODate(tx.occurredAt),
        escape(nameOf(tx.categoryId)),
        formatAmountExact(tx.amountMinor),
        escape(tx.note ?? ""),
      ].join(","),
    );

    return ["Date,Category,Amount,Note", ...rows].join("\n");
  } finally {
    handle.closeSync();
  }
}
