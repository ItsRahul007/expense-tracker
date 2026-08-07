import { category, transaction } from "@/db/schema/schema";
import {
  Category,
  MonthPoint,
  MonthSummary,
  QueryResult,
  Transaction,
  TxFilters,
} from "@/types/domain";
import { useQuery } from "@tanstack/react-query";
import { and, desc, gte, inArray, like, lt, lte, SQL, sql } from "drizzle-orm";

import { Month, monthRange } from "@/lib/month";
import { useDrizzle } from "./helper";

export function useCategories(): QueryResult<Category[]> {
  const db = useDrizzle();

  const { data, isPending, error } = useQuery<Category[]>({
    queryKey: ["category"],
    queryFn: () => db.select().from(category).orderBy(category.sortOrder).all(),
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
          lte(transaction.occurredAt, bounds?.to ?? filters?.to ?? 0),
        );
        if (dateCondition) {
          conditions.push(dateCondition);
        }
      }

      const filterConditions: SQL<unknown>[] = [];
      if (filters?.text) {
        filterConditions.push(like(transaction.note, `%${filters.text}%`));
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
            lte(transaction.occurredAt, to),
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
