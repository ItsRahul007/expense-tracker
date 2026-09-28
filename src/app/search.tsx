import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";

import {
  Card,
  Chip,
  EmptyState,
  ScreenHeader,
  SectionTitle,
  TransactionRow,
} from "@/components/ui";
import { usePalette } from "@/constants/palette";
import { formatMoney, formatRelativeDay } from "@/lib/format";
import { currentMonth, monthOf, monthShort, type Month } from "@/lib/month";
import { useCategories, useTransactions } from "@/queries";
import type { Category, ID, Transaction } from "@/types/domain";

type MonthGroup = { month: Month; totalMinor: number; items: Transaction[] };

/** Groups into local calendar months, newest first. */
function groupByMonth(transactions: Transaction[]): MonthGroup[] {
  const months = new Map<Month, Transaction[]>();

  for (const tx of transactions) {
    const key = monthOf(tx.occurredAt);
    const bucket = months.get(key);
    if (bucket) bucket.push(tx);
    else months.set(key, [tx]);
  }

  // "YYYY-MM" sorts lexically, so a plain string compare orders the months.
  return [...months.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, items]) => ({
      month,
      items,
      totalMinor: items.reduce((sum, tx) => sum + tx.amountMinor, 0),
    }));
}

/** "Sep" this year, "Sep 2025" for earlier years. */
function monthHeading(month: Month): string {
  const year = month.slice(0, 4);
  return year === currentMonth().slice(0, 4)
    ? monthShort(month)
    : `${monthShort(month)} ${year}`;
}

export default function SearchScreen() {
  const palette = usePalette();
  const [text, setText] = useState("");
  const [debouncedText, setDebouncedText] = useState("");
  const [categoryIds, setCategoryIds] = useState<ID[]>([]);

  /**
   * The query is keyed by its filters, so an un-debounced field would mint a new
   * cache entry per keystroke — nine wasted queries to type "groceries". 180ms is
   * below the threshold where typing feels laggy and above normal typing speed.
   */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedText(text), 180);
    return () => clearTimeout(timer);
  }, [text]);

  const filters = useMemo(
    () => ({
      text: debouncedText.trim() || undefined,
      categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
    }),
    [debouncedText, categoryIds],
  );

  const hasQuery = Boolean(filters.text || filters.categoryIds);
  // `null` month searches all history rather than the current one.
  const { data: results } = useTransactions(null, filters);
  const { data: categories } = useCategories();

  const categoryById = useMemo(() => {
    const map = new Map<ID, Category>();
    for (const category of categories ?? []) map.set(category.id, category);
    return map;
  }, [categories]);

  const rows = useMemo(
    () => (hasQuery ? (results ?? []) : []),
    [hasQuery, results],
  );
  const total = rows.reduce((sum, tx) => sum + tx.amountMinor, 0);
  const groups = useMemo(() => groupByMonth(rows), [rows]);

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader
        title="Search"
        onBack={() => router.back()}
        aside={
          rows.length > 0
            ? {
                value: formatMoney(total),
                caption: `${rows.length} ${rows.length === 1 ? "result" : "results"}`,
              }
            : undefined
        }
      />

      <View className="px-4 pb-3">
        <View className="flex-row items-center gap-2 rounded-2xl border border-border bg-card px-3">
          <Ionicons name="search" size={18} color={palette.muted} />
          <TextInput
            autoFocus
            value={text}
            onChangeText={setText}
            placeholder="Search notes and categories"
            placeholderTextColor={palette.muted}
            returnKeyType="search"
            clearButtonMode="while-editing"
            className="font-sans h-12 flex-1 text-body text-fg"
            style={{ minWidth: 0 }}
          />
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}
        // A ScrollView ships with flexGrow: 1, so this row of chips was claiming
        // an equal share of the column's height and pushing the results down to
        // the middle of the screen. It should only be as tall as one chip.
        style={{ flexGrow: 0 }}
      >
        {(categories ?? []).map((category) => (
          <Chip
            key={category.id}
            label={category.name}
            selected={categoryIds.includes(category.id)}
            onPress={() =>
              setCategoryIds((current) =>
                current.includes(category.id)
                  ? current.filter((id) => id !== category.id)
                  : [...current, category.id],
              )
            }
          />
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 32,
          // Results read top-down from under the filters; the empty state is the
          // one thing that should sit centred in the space that's left.
          flexGrow: rows.length === 0 ? 1 : undefined,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={hasQuery ? "search-outline" : "funnel-outline"}
            title={hasQuery ? "No matches" : "Search every month"}
            body={
              hasQuery
                ? "Try a shorter word, or clear the category filters."
                : "Type part of a note, or pick a category to filter by."
            }
          />
        ) : (
          <>
            <View className="gap-5">
              {groups.map((group) => (
                <View key={group.month}>
                  <SectionTitle
                    title={monthHeading(group.month)}
                    meta={`${formatMoney(group.totalMinor)} (${group.items.length} ${group.items.length === 1 ? "result" : "results"})`}
                  />
                  <Card padded={false} className="overflow-hidden">
                    {group.items.map((tx, index) => {
                      const category = categoryById.get(tx.categoryId);
                      return (
                        <TransactionRow
                          key={tx.id}
                          title={tx.note?.trim() || category?.name || "Expense"}
                          subtitle={`${category?.name ?? "Uncategorised"} · ${formatRelativeDay(tx.occurredAt)}`}
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
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
