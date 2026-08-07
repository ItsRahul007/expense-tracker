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
import { and, desc, gte, inArray, like, lte, SQL, sql } from "drizzle-orm";

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

      const totalIncome = db
        .select({
          total: transaction.amountMinor,
          categoryId: transaction.categoryId,
        })
        .from(transaction)
        .where(
          and(
            gte(transaction.occurredAt, from),
            lte(transaction.occurredAt, to),
            gte(transaction.amountMinor, 0),
          ),
        )
        .orderBy(desc(transaction.occurredAt))
        .all();

      return {
        totalMinor: totalIncome.reduce((sum, tx) => sum + tx.total, 0),
        byCategory: totalIncome.reduce(
          (acc, tx) => {
            const existing = acc.find((c) => c.categoryId === tx.categoryId);
            if (existing) {
              existing.totalMinor += tx.total;
            } else {
              acc.push({ categoryId: tx.categoryId, totalMinor: tx.total });
            }
            return acc;
          },
          [] as { categoryId: string; totalMinor: number }[],
        ),
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

      // for (const month of months) {
      //   const { from, to } = monthRange(month);

      //   const totalIncome = db
      //     .select({
      //       total: transaction.amountMinor,
      //     })
      //     .from(transaction)
      //     .where(
      //       and(
      //         gte(transaction.occurredAt, from),
      //         lte(transaction.occurredAt, to),
      //         gte(transaction.amountMinor, 0),
      //       ),
      //     )
      //     .orderBy(desc(transaction.occurredAt))
      //     .all();

      //   const totalMinor = totalIncome.reduce((sum, tx) => sum + tx.total, 0);
      //   monthPoints.push({ month, totalMinor });
      // }

      let overallFrom = Infinity;
      let overallTo = -Infinity;

      for (const month of months) {
        const { from, to } = monthRange(month);
        overallFrom = Math.min(overallFrom, from);
        overallTo = Math.max(overallTo, to);
      }

      const rows = db
        .select({
          month: sql<string>`strftime('%Y-%m', ${transaction.occurredAt} / 1000, 'unixepoch')`,
          total: sql<number>`sum(${transaction.amountMinor})`,
        })
        .from(transaction)
        .where(
          and(
            gte(transaction.occurredAt, overallFrom),
            lte(transaction.occurredAt, overallTo),
            gte(transaction.amountMinor, 0),
          ),
        )
        .groupBy(
          sql`strftime('%Y-%m', ${transaction.occurredAt} / 1000, 'unixepoch')`,
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
