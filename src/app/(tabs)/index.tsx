import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { SummaryCard } from "@/components/summary-card";
import {
  Card,
  EmptyState,
  MonthSwitcher,
  ScreenHeader,
  SectionTitle,
  TransactionRow,
} from "@/components/ui";
import { formatMoney, formatRelativeDay } from "@/lib/format";
import { currentMonth, type Month } from "@/lib/month";
import {
  useBudgets,
  useCategories,
  useKnownMonths,
  useMonthSummary,
  useTransactions,
} from "@/queries";
import type { Category, ID, Transaction } from "@/types/domain";

type DayGroup = { ts: number; totalMinor: number; items: Transaction[] };

/** Groups into local calendar days, newest first. */
function groupByDay(transactions: Transaction[]): DayGroup[] {
  const days = new Map<number, Transaction[]>();

  for (const tx of transactions) {
    const day = new Date(tx.occurredAt);
    day.setHours(0, 0, 0, 0);
    const key = day.getTime();
    const bucket = days.get(key);
    if (bucket) bucket.push(tx);
    else days.set(key, [tx]);
  }

  return [...days.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([ts, items]) => ({
      ts,
      items,
      totalMinor: items.reduce((sum, tx) => sum + tx.amountMinor, 0),
    }));
}

export default function HomeScreen() {
  const [month, setMonth] = useState<Month>(currentMonth());

  const { data: transactions } = useTransactions(month);
  const { data: categories } = useCategories();
  const { data: summary } = useMonthSummary(month);
  const { data: budgets } = useBudgets(month);
  const { data: knownMonths } = useKnownMonths();

  const groups = useMemo(() => groupByDay(transactions ?? []), [transactions]);

  const categoryById = useMemo(() => {
    const map = new Map<ID, Category>();
    for (const category of categories ?? []) map.set(category.id, category);
    return map;
  }, [categories]);

  const budgetTotal = (budgets ?? []).reduce((sum, b) => sum + b.limitMinor, 0);
  const isEmpty = transactions !== undefined && transactions.length === 0;

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader
        title="Expenses"
        actions={[{ icon: "search", label: "Search", onPress: () => router.push("/search") }]}
      />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="pb-4">
          <MonthSwitcher month={month} onChange={setMonth} earliest={knownMonths?.[0]} />
        </View>

        <SummaryCard
          spentMinor={summary?.totalMinor ?? 0}
          budgetMinor={budgetTotal}
          caption="Spent this month"
        />

        {isEmpty ? (
          <EmptyState
            icon="add-circle-outline"
            title="No expenses yet"
            body="Tap the + button to record your first one."
          />
        ) : (
          <View className="mt-6 gap-5">
            {groups.map((group) => (
              <View key={group.ts}>
                <SectionTitle title={formatRelativeDay(group.ts)} />
                <Card padded={false} className="overflow-hidden">
                  {group.items.map((tx, index) => {
                    const category = categoryById.get(tx.categoryId);
                    return (
                      <TransactionRow
                        key={tx.id}
                        title={tx.note?.trim() || category?.name || "Expense"}
                        subtitle={category?.name ?? "Uncategorised"}
                        amountMinor={tx.amountMinor}
                        icon={category?.icon ?? "ellipsis-horizontal"}
                        color={category?.color ?? "#6B7280"}
                        showSeparator={index < group.items.length - 1}
                        onPress={() => router.push(`/transaction/${tx.id}`)}
                      />
                    );
                  })}
                </Card>
                <Text className="font-sans mt-2 px-1 text-label text-muted">
                  {group.items.length}{" "}
                  {group.items.length === 1 ? "expense" : "expenses"} ·{" "}
                  {formatMoney(group.totalMinor)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
