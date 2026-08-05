import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { FlatList, ScrollView, TextInput, View } from "react-native";

import { Chip } from "@/components/keypad/chip";
import {
  EmptyState,
  Footing,
  LedgerRow,
  LedgerSheet,
  Rule,
  ScreenHeader,
} from "@/components/ledger";
import { usePalette } from "@/constants/palette";
import { formatRelativeDay } from "@/lib/format";
import { useCategories, useTransactions } from "@/queries";
import type { ID } from "@/types/domain";

export default function SearchScreen() {
  const palette = usePalette();
  const [text, setText] = useState("");
  const [debouncedText, setDebouncedText] = useState("");
  const [categoryIds, setCategoryIds] = useState<ID[]>([]);

  /**
   * The query is keyed by its filters, so an un-debounced field would mint a new
   * cache entry on every keystroke — nine wasted queries to type "groceries".
   * 180ms is below the threshold where typing feels laggy and above the rate at
   * which anyone types.
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

  const rows = hasQuery ? (results ?? []) : [];
  const total = rows.reduce((sum, tx) => sum + tx.amountMinor, 0);

  const nameOf = (id: ID) =>
    categories?.find((c) => c.id === id)?.name ?? "Uncategorised";

  return (
    <View className="flex-1 bg-paper">
      <ScreenHeader
        title="Find"
        actions={[{ label: "Close", onPress: () => router.back() }]}
      />

      <View className="h-12 justify-center px-4">
        <TextInput
          autoFocus
          value={text}
          onChangeText={setText}
          placeholder="Search notes and categories"
          placeholderTextColor={palette.inkMuted}
          returnKeyType="search"
          clearButtonMode="while-editing"
          className="font-sans-medium text-row text-ink"
        />
      </View>
      <Rule />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 12 }}
      >
        {(categories ?? []).map((category) => (
          <Chip
            key={category.id}
            label={category.code}
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

      <LedgerSheet>
        {rows.length === 0 ? (
          <EmptyState
            message={
              hasQuery
                ? "No entries match. Try a shorter word, or clear the category filters."
                : "Search across every month. Filter by category, or type part of a note."
            }
          />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(tx) => tx.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 8 }}
            renderItem={({ item, index }) => (
              <LedgerRow
                title={item.note?.trim() || nameOf(item.categoryId)}
                meta={`${nameOf(item.categoryId)} · ${formatRelativeDay(item.occurredAt)}`}
                amountMinor={item.amountMinor}
                zebra={index % 2 === 1}
                onPress={() => router.push(`/transaction/${item.id}`)}
              />
            )}
          />
        )}

        {rows.length > 0 ? (
          <Footing
            label={`${rows.length} ${rows.length === 1 ? "entry" : "entries"}`}
            amountMinor={total}
          />
        ) : null}
      </LedgerSheet>
    </View>
  );
}
