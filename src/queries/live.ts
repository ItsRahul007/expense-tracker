import * as schema from "@/db/schema/schema";
import { budget, category, settings, transaction } from "@/db/schema/schema";
import {
  Budget,
  BudgetDeletion,
  BudgetInput,
  BudgetStatus,
  Category,
  ID,
  ImportRequest,
  MonthPoint,
  NewBudget,
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
  queryOptions,
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
  isNull,
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
import { effectiveBudgets, withoutMonth } from "@/lib/budget-scope";
import { formatCsvRow } from "@/lib/csv";
import { lastNMonths, Month, monthRange, shiftMonth } from "@/lib/month";
import { notifyLocalChange } from "@/sync/local-changes";
import {
  editStamp,
  newTransactionStamp,
  recordDeletions,
} from "@/sync/tracking";
import { useEffect } from "react";
import { type Db, useDrizzle } from "./helper";

const DEFAULT_SETTINGS: Settings = { theme: "system" };

/**
 * Rows per `INSERT` when importing. Nine bound columns each (the five domain
 * fields plus the four sync stamps — see `newTransactionStamp`), so 100 rows is
 * 900 bound parameters — inside SQLite's limit even if it's the lower, older
 * one (999), while still turning a thousand-row file into ten statements
 * rather than a thousand.
 */
const IMPORT_CHUNK_ROWS = 100;

/*
 * Explicit column lists for reads that hand whole rows to the UI. A bare
 * `select()` would also return the sync bookkeeping columns (`updated_at`,
 * `sync_dirty`, …), which are storage-only and deliberately absent from
 * src/types/domain.ts.
 */
const TRANSACTION_COLUMNS = {
  id: transaction.id,
  amountMinor: transaction.amountMinor,
  categoryId: transaction.categoryId,
  occurredAt: transaction.occurredAt,
  note: transaction.note,
};

const BUDGET_COLUMNS = {
  id: budget.id,
  categoryId: budget.categoryId,
  startMonth: budget.startMonth,
  endMonth: budget.endMonth,
  limitMinor: budget.limitMinor,
  createdAt: budget.createdAt,
};

function newTransactionId(): ID {
  return `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function newBudgetId(): ID {
  return `b-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Matches a budget row with exactly this category and scope. `end_month` is
 *  nullable, and `= NULL` never matches in SQL, hence the branch. */
function sameScopeWhere(input: {
  categoryId: ID;
  startMonth: Month;
  endMonth: Month | null;
}) {
  return and(
    eq(budget.categoryId, input.categoryId),
    eq(budget.startMonth, input.startMonth),
    input.endMonth === null
      ? isNull(budget.endMonth)
      : eq(budget.endMonth, input.endMonth),
  );
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


/*
 * Month-scoped queries are defined once as option factories so the hooks and
 * `usePrefetchAdjacentMonths` share the exact same key and query function —
 * a prefetch under a slightly different key would warm a cache nobody reads.
 */

function transactionsQuery(db: Db, month: Month | null, filters?: TxFilters) {
  const bounds = month ? monthRange(month) : null;

  return queryOptions<Transaction[]>({
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
        .select(TRANSACTION_COLUMNS)
        .from(transaction)
        .where(and(...conditions))
        .orderBy(desc(transaction.occurredAt))
        .all();
    },
  });
}

export function useTransactions(
  month: Month | null,
  filters?: TxFilters,
): QueryResult<Transaction[]> {
  const db = useDrizzle();
  const { data, isPending, error } = useQuery(
    transactionsQuery(db, month, filters),
  );

  return {
    data,
    isPending,
    error,
  };
}

function monthSummaryQuery(db: Db, month: Month) {
  return queryOptions<MonthSummary>({
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
}

export function useMonthSummary(month: Month): QueryResult<MonthSummary> {
  const db = useDrizzle();
  const { data, isPending, error } = useQuery(monthSummaryQuery(db, month));

  return {
    data,
    isPending,
    error,
  };
}

function monthTrendQuery(db: Db, months: Month[]) {
  return queryOptions<MonthPoint[]>({
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
}

export function useMonthTrend(months: Month[]): QueryResult<MonthPoint[]> {
  const db = useDrizzle();
  const { data, isPending, error } = useQuery(monthTrendQuery(db, months));

  return {
    data,
    isPending,
    error,
  };
}

function budgetsQuery(db: Db, month: Month) {
  return queryOptions<BudgetStatus[]>({
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

      // Every budget whose scope covers this month; several can, and
      // `effectiveBudgets` keeps the one most specific per category.
      const covering = db
        .select(BUDGET_COLUMNS)
        .from(budget)
        .where(
          and(
            lte(budget.startMonth, month),
            or(isNull(budget.endMonth), gte(budget.endMonth, month)),
          ),
        )
        .all();

      return effectiveBudgets(covering, month)
        .map((b) => ({ ...b, spentMinor: spent.get(b.categoryId) ?? 0 }))
        .sort(
          (a, b) =>
            (order.get(a.categoryId) ?? 0) - (order.get(b.categoryId) ?? 0),
        );
    },
  });
}

/** The budget in force for each category in a month, joined with actual
 *  spend, ordered by category. */
export function useBudgets(month: Month): QueryResult<BudgetStatus[]> {
  const db = useDrizzle();
  const { data, isPending, error } = useQuery(budgetsQuery(db, month));

  return { data, isPending, error };
}

/** Every budget row, whatever its scope — for the import preview, which needs
 *  to know what's already stored to tell a new budget from an update. */
export function useAllBudgets(): QueryResult<Budget[]> {
  const db = useDrizzle();

  const { data, isPending, error } = useQuery<Budget[]>({
    queryKey: ["budget", "all"],
    queryFn: () => db.select(BUDGET_COLUMNS).from(budget).all(),
  });

  return { data, isPending, error };
}

/**
 * Which month-scoped queries `usePrefetchAdjacentMonths` should warm. Each
 * screen passes only what it reads, so paging on Budgets doesn't also pay for
 * transaction lists nobody is looking at.
 *
 * `trendMonths` warms the trend window ending at each neighbour — it must match
 * the length the screen passes to `useMonthTrend`, or the key won't line up.
 */
export type AdjacentMonthPrefetch = {
  transactions?: boolean;
  summary?: boolean;
  budgets?: boolean;
  trendMonths?: number;
};

const HOME_PREFETCH: AdjacentMonthPrefetch = {
  transactions: true,
  summary: true,
  budgets: true,
};

/**
 * Warms the cache for the months either side of `month`, so paging with the
 * month switcher lands on data that's already there instead of rendering one
 * empty frame of zeros while the new month's queries run.
 *
 * Defaults to what the home screen reads (transactions, summary and budgets);
 * other screens pass their own selection.
 *
 * For a future neighbour only budgets are warmed — no expense can be there yet.
 */
export function usePrefetchAdjacentMonths(
  month: Month,
  what: AdjacentMonthPrefetch = HOME_PREFETCH,
): void {
  const db = useDrizzle();
  const queryClient = useQueryClient();
  const { transactions, summary, budgets, trendMonths } = what;

  useEffect(() => {
    const neighbours = [shiftMonth(month, -1), shiftMonth(month, 1)];

    for (const m of neighbours) {
      // Budgets can be set ahead, and the Budgets screen pages into the
      // future, so they're warmed either way.
      if (budgets) queryClient.prefetchQuery(budgetsQuery(db, m));
      // Everything else is about expenses, which a future month can't have.
      if (monthRange(m).from > Date.now()) continue;
      if (transactions) queryClient.prefetchQuery(transactionsQuery(db, m));
      if (summary) queryClient.prefetchQuery(monthSummaryQuery(db, m));
      if (trendMonths) {
        queryClient.prefetchQuery(
          monthTrendQuery(db, lastNMonths(trendMonths, m)),
        );
      }
    }
  }, [db, queryClient, month, transactions, summary, budgets, trendMonths]);
}

export function useTransaction(id: ID): QueryResult<Transaction | null> {
  const db = useDrizzle();

  const { data, isPending, error } = useQuery<Transaction | null>({
    queryKey: ["transaction", "one", id],
    queryFn: () =>
      db
        .select(TRANSACTION_COLUMNS)
        .from(transaction)
        .where(eq(transaction.id, id))
        .get() ??
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
        .values({
          ...input,
          id: newTransactionId(),
          ...newTransactionStamp(db),
        })
        .run(),
    onSuccess: () => {
      invalidateTransactions(queryClient);
      notifyLocalChange();
    },
  });

  return toMutationResult(mutation);
}

/** `created_at` / `created_device` are left alone on purpose: they record when
 *  and where the expense was *entered*, which an edit doesn't change. */
export function useUpdateTransaction(): MutationResult<TransactionPatch> {
  const db = useDrizzle();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ id, ...patch }: TransactionPatch) =>
      db
        .update(transaction)
        .set({ ...patch, ...editStamp() })
        .where(eq(transaction.id, id))
        .run(),
    onSuccess: () => {
      invalidateTransactions(queryClient);
      notifyLocalChange();
    },
  });

  return toMutationResult(mutation);
}

export function useDeleteTransaction(): MutationResult<ID> {
  const db = useDrizzle();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (id: ID) =>
      db.transaction((tx) => {
        tx.delete(transaction).where(eq(transaction.id, id)).run();
        recordDeletions(tx, "transaction", [id]);
      }),
    onSuccess: () => {
      invalidateTransactions(queryClient);
      notifyLocalChange();
    },
  });

  return toMutationResult(mutation);
}

/**
 * Creates or edits a budget. See `BudgetInput` for how the target row is found.
 * A limit of 0 or less deletes it instead.
 */
export function useUpsertBudget(): MutationResult<BudgetInput> {
  const db = useDrizzle();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ id, ...input }: BudgetInput) =>
      db.transaction((tx) => {
        if (id) {
          if (input.limitMinor <= 0) {
            tx.delete(budget).where(eq(budget.id, id)).run();
            recordDeletions(tx, "budget", [id]);
            return;
          }
          tx.update(budget)
            .set({ ...input, ...editStamp() })
            .where(eq(budget.id, id))
            .run();
          return;
        }

        if (input.limitMinor <= 0) {
          // Ids first: the tombstones need to name what's being deleted.
          const doomed = tx
            .select({ id: budget.id })
            .from(budget)
            .where(sameScopeWhere(input))
            .all()
            .map((row) => row.id);
          tx.delete(budget).where(sameScopeWhere(input)).run();
          recordDeletions(tx, "budget", doomed);
          return;
        }

        const existing = tx
          .select({ id: budget.id })
          .from(budget)
          .where(sameScopeWhere(input))
          .get();
        if (existing) {
          // Re-saving counts as the latest save, so it takes precedence over
          // anything overlapping — see `src/lib/budget-scope.ts`.
          tx.update(budget)
            .set({
              limitMinor: input.limitMinor,
              createdAt: Date.now(),
              ...editStamp(),
            })
            .where(eq(budget.id, existing.id))
            .run();
          return;
        }
        tx.insert(budget)
          .values({
            ...input,
            id: newBudgetId(),
            createdAt: Date.now(),
            ...editStamp(),
          })
          .run();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      notifyLocalChange();
    },
  });

  return toMutationResult(mutation);
}

/**
 * Deletes a budget outright, or — with `onlyMonth` — cuts that one month out
 * of it, leaving the months either side still budgeted. The cut is a delete
 * plus up to two inserts in one transaction, so a failure can't leave the
 * budget half-split.
 */
export function useDeleteBudget(): MutationResult<BudgetDeletion> {
  const db = useDrizzle();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ id, onlyMonth }: BudgetDeletion) =>
      db.transaction((tx) => {
        const row = tx.select().from(budget).where(eq(budget.id, id)).get();
        if (!row) return;

        tx.delete(budget).where(eq(budget.id, id)).run();
        // The original id is gone either way — a split replaces it with new
        // rows rather than editing it — so other devices must drop it too.
        recordDeletions(tx, "budget", [id]);
        if (!onlyMonth) return;

        for (const scope of withoutMonth(row, onlyMonth)) {
          tx.insert(budget)
            .values({
              ...scope,
              id: newBudgetId(),
              categoryId: row.categoryId,
              limitMinor: row.limitMinor,
              // Kept, not refreshed: the pieces are the same budget as before
              // and shouldn't start winning ties it used to lose.
              createdAt: row.createdAt,
              ...editStamp(),
            })
            .run();
        }
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      notifyLocalChange();
    },
  });

  return toMutationResult(mutation);
}

/**
 * Writes many budgets in one transaction, replacing the limit wherever a
 * budget with the same category and scope already exists. Unlike
 * `useUpsertBudget`, a zero limit is not treated as a delete — this is for
 * bulk loads (sample data), where every row is meant to exist.
 */
export function useUpsertBudgets(): MutationResult<NewBudget[]> {
  const db = useDrizzle();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: NewBudget[]) =>
      db.transaction((tx) => {
        const now = Date.now();
        input.forEach((row, index) => {
          const existing = tx
            .select({ id: budget.id })
            .from(budget)
            .where(sameScopeWhere(row))
            .get();
          if (existing) {
            tx.update(budget)
              .set({
                limitMinor: row.limitMinor,
                createdAt: now + index,
                ...editStamp(),
              })
              .where(eq(budget.id, existing.id))
              .run();
          } else {
            tx.insert(budget)
              .values({
                ...row,
                id: newBudgetId(),
                createdAt: now + index,
                ...editStamp(),
              })
              .run();
          }
        });
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      notifyLocalChange();
    },
  });

  return toMutationResult(mutation);
}

/**
 * Deletes every expense, every budget and every custom category, leaving the
 * eight default categories (protected by a trigger, and assumed to exist by
 * the rest of the app) and the user's settings. One transaction, so a failure
 * leaves the data exactly as it was. Development tooling — not exposed in
 * release builds.
 */
export function useClearAllData(): MutationResult<void> {
  const db = useDrizzle();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () =>
      db.transaction((tx) => {
        // Tombstoned like any other delete, so once sync exists a clear
        // reaches the user's other devices too (where the mass-change brake,
        // design §11.3, asks before applying it).
        const ids = (rows: { id: ID }[]) => rows.map((row) => row.id);
        const budgetIds = ids(tx.select({ id: budget.id }).from(budget).all());
        const transactionIds = ids(
          tx.select({ id: transaction.id }).from(transaction).all(),
        );
        const categoryIds = ids(
          tx
            .select({ id: category.id })
            .from(category)
            .where(eq(category.isDefault, false))
            .all(),
        );

        // Budgets and transactions first: both reference categories.
        tx.delete(budget).run();
        tx.delete(transaction).run();
        tx.delete(category).where(eq(category.isDefault, false)).run();

        recordDeletions(tx, "budget", budgetIds);
        recordDeletions(tx, "transaction", transactionIds);
        recordDeletions(tx, "category", categoryIds);
      }),
    // Everything cached is now wrong, so drop all of it rather than listing keys.
    onSuccess: () => {
      queryClient.invalidateQueries();
      notifyLocalChange();
    },
  });

  return toMutationResult(mutation);
}

export function useUpsertCategory(): MutationResult<Category> {
  const db = useDrizzle();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: Category) => {
      const stamp = editStamp();
      return db
        .insert(category)
        .values({ ...input, ...stamp })
        .onConflictDoUpdate({
          target: category.id,
          set: {
            name: input.name,
            icon: input.icon,
            color: input.color,
            sortOrder: input.sortOrder,
            ...stamp,
          },
        })
        .run();
    },
    onSuccess: () => {
      notifyLocalChange();
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
        const budgetIds = tx
          .select({ id: budget.id })
          .from(budget)
          .where(eq(budget.categoryId, id))
          .all()
          .map((row) => row.id);
        tx.delete(budget).where(eq(budget.categoryId, id)).run();
        tx.delete(category).where(eq(category.id, id)).run();
        // After both deletes: if either aborts (FK, default-category trigger),
        // the whole transaction rolls back and no tombstone is left behind.
        recordDeletions(tx, "budget", budgetIds);
        recordDeletions(tx, "category", [id]);
      }),
    onSuccess: () => {
      notifyLocalChange();
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

/**
 * Writes a whole CSV import — expenses and budgets — in one database transaction.
 *
 * All or nothing on purpose. A half-applied import is the worst possible
 * outcome here: there's no undo in this app, and "some of my file is in there
 * and I don't know which rows" is unrecoverable by hand. If the batch throws —
 * a foreign key, a full disk — nothing is written and the import screen keeps
 * the parsed file on screen to try again.
 *
 * Categories are inserted with `onConflictDoNothing` rather than an upsert:
 * `planImport` only drafts categories whose names it couldn't find, so a
 * conflict here means the id was taken by something it couldn't see, and
 * overwriting that person's icon and colour choices is not this feature's
 * business.
 */
export function useImportTransactions(): MutationResult<ImportRequest> {
  const db = useDrizzle();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ categories, transactions, budgets }: ImportRequest) =>
      db.transaction((tx) => {
        for (const row of categories) {
          tx.insert(category)
            .values({ ...row, ...editStamp() })
            .onConflictDoNothing()
            .run();
        }

        // Chunked because every row contributes nine bound parameters and a
        // multi-thousand-row file would otherwise blow SQLite's variable limit
        // in a single statement. Each row gets its own stamp: `created_at`
        // marks the import moment, which is also what lets the same file
        // imported on two phones collapse to one copy (design §12.10).
        for (let i = 0; i < transactions.length; i += IMPORT_CHUNK_ROWS) {
          const chunk = transactions
            .slice(i, i + IMPORT_CHUNK_ROWS)
            .map((input) => ({
              ...input,
              id: newTransactionId(),
              ...newTransactionStamp(tx),
            }));
          tx.insert(transaction).values(chunk).run();
        }

        // Same upsert rule as `useUpsertBudget`: an identical category + scope
        // takes the file's limit instead of gaining a duplicate. Few enough
        // rows that one statement each is fine.
        const now = Date.now();
        budgets.forEach((input, index) => {
          const existing = tx
            .select({ id: budget.id })
            .from(budget)
            .where(sameScopeWhere(input))
            .get();
          if (existing) {
            tx.update(budget)
              .set({
                limitMinor: input.limitMinor,
                createdAt: now + index,
                ...editStamp(),
              })
              .where(eq(budget.id, existing.id))
              .run();
          } else {
            // Offset by position so later rows in the file win ties, the
            // same as if they'd been added one after another by hand.
            tx.insert(budget)
              .values({
                ...input,
                id: newBudgetId(),
                createdAt: now + index,
                ...editStamp(),
              })
              .run();
          }
        });
      }),
    onSuccess: () => {
      notifyLocalChange();
      invalidateTransactions(queryClient);
      // (`invalidateTransactions` already covers ['budget'].)
      // Unlike every other transaction write, an import can create categories
      // too — without this the new ones render as "Uncategorised" until
      // something else happens to refetch them.
      queryClient.invalidateQueries({ queryKey: ["category"] });
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
 * Whole-ledger CSV: every expense, then — if there are any — every budget as a
 * second table underneath, separated by a blank row. Amounts are written as
 * decimal rupees because that's what a spreadsheet expects; everything internal
 * stays in paise.
 *
 * The column names of both tables are what `parseLedgerCsv` reads back — see
 * `BUDGET_SECTION_MARKER` and the header aliases there before renaming one.
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
    const budgets = db
      .select()
      .from(budget)
      .orderBy(budget.startMonth, budget.createdAt)
      .all();
    const categories = db.select().from(category).all();
    const names = new Map(categories.map((c) => [c.id, c.name]));
    const nameOf = (id: ID) => names.get(id) ?? "";

    const { formatAmountExact, formatISODate } = await import("@/lib/format");

    const lines = [
      formatCsvRow(["Date", "Category", "Amount", "Note"]),
      ...transactions.map((tx) =>
        formatCsvRow([
          formatISODate(tx.occurredAt),
          nameOf(tx.categoryId),
          formatAmountExact(tx.amountMinor),
          tx.note ?? "",
        ]),
      ),
    ];

    if (budgets.length > 0) {
      lines.push(
        "",
        // An empty "To" means every month from "From" onwards.
        formatCsvRow(["Budget Category", "Monthly Limit", "From", "To"]),
        ...budgets.map((b) =>
          formatCsvRow([
            nameOf(b.categoryId),
            formatAmountExact(b.limitMinor),
            b.startMonth,
            b.endMonth ?? "",
          ]),
        ),
      );
    }

    return lines.join("\n");
  } finally {
    handle.closeSync();
  }
}
