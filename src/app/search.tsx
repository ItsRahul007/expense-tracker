import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import {
  Card,
  Chip,
  EmptyState,
  ScreenHeader,
  TransactionRow,
} from "@/components/ui";
import { usePalette } from "@/constants/palette";
import { formatMoney, formatRelativeDay } from "@/lib/format";
import { useCategories, useTransactions } from "@/queries";
import type { Category, ID } from "@/types/domain";

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

  const rows = hasQuery ? (results ?? []) : [];
  const total = rows.reduce((sum, tx) => sum + tx.amountMinor, 0);

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Search" onBack={() => router.back()} />

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
            <Text className="font-sans-medium mb-2 px-1 text-label text-muted">
              {rows.length} {rows.length === 1 ? "result" : "results"} ·{" "}
              {formatMoney(total)}
            </Text>
            <Card padded={false} className="overflow-hidden">
              {rows.map((tx, index) => {
                const category = categoryById.get(tx.categoryId);
                return (
                  <TransactionRow
                    key={tx.id}
                    title={tx.note?.trim() || category?.name || "Expense"}
                    subtitle={`${category?.name ?? "Uncategorised"} · ${formatRelativeDay(tx.occurredAt)}`}
                    amountMinor={tx.amountMinor}
                    icon={category?.icon ?? "ellipsis-horizontal"}
                    color={category?.color ?? "#6B7280"}
                    showSeparator={index < rows.length - 1}
                    onPress={() => router.push(`/transaction/${tx.id}`)}
                  />
                );
              })}
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}
