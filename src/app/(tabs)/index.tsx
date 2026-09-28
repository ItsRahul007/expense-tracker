import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, View } from "react-native";

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
  usePrefetchAdjacentMonths,
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

/** The 20px gap between day cards that `gap-5` gave the old ScrollView. */
function DaySpacer() {
  return <View className="h-5" />;
}

export default function HomeScreen() {
  const [month, setMonth] = useState<Month>(currentMonth());

  const { data: transactions } = useTransactions(month);
  const { data: categories } = useCategories();
  const { data: summary } = useMonthSummary(month);
  const { data: budgets } = useBudgets(month);
  const { data: knownMonths } = useKnownMonths();
  // Loads the neighbouring months ahead of time so switching never flashes zeros.
  usePrefetchAdjacentMonths(month);

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

      {/* A FlatList rather than a ScrollView: a month can hold a hundred-plus
          expenses, and mounting every row up front made each month switch
          block the JS thread for ~300ms. Only the first few day cards render
          now; the rest fill in as they scroll into view.
          `key={month}` remounts it per month on purpose: `initialNumToRender`
          only applies to a fresh list, so a reused one re-rendered the whole
          previous month's window (~100ms) on every switch. */}
      <FlatList
        key={month}
        data={isEmpty ? [] : groups}
        keyExtractor={(group) => String(group.ts)}
        initialNumToRender={4}
        windowSize={7}
        maxToRenderPerBatch={3}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View className={isEmpty ? "" : "mb-6"}>
            <View className="pb-4">
              <MonthSwitcher month={month} onChange={setMonth} earliest={knownMonths?.[0]} />
            </View>

            <SummaryCard
              spentMinor={summary?.totalMinor ?? 0}
              budgetMinor={budgetTotal}
              caption="Spent this month"
            />
          </View>
        }
        ListEmptyComponent={
          isEmpty ? (
            <EmptyState
              icon="add-circle-outline"
              title="No expenses yet"
              body="Tap the + button to record your first one."
            />
          ) : null
        }
        ItemSeparatorComponent={DaySpacer}
        renderItem={({ item: group }) => (
          <View>
            <SectionTitle
              title={formatRelativeDay(group.ts)}
              // A lone expense's row already shows the same amount.
              meta={
                group.items.length > 1
                  ? `${formatMoney(group.totalMinor)} (${group.items.length} expenses)`
                  : undefined
              }
            />
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
          </View>
        )}
      />
    </View>
  );
}
