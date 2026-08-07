import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { CategoryPicker } from "@/components/category-picker";
import { Button, Card } from "@/components/ui";
import { usePalette } from "@/constants/palette";
import { formatMoney } from "@/lib/format";
import { currentMonth } from "@/lib/month";
import { useBudgets, useCategories, useUpsertBudget } from "@/queries";
import type { ID } from "@/types/domain";

export default function AddBudgetScreen() {
  const palette = usePalette();
  const month = currentMonth();

  const { data: categories } = useCategories();
  const { data: budgets } = useBudgets(month);
  const upsertBudget = useUpsertBudget();

  const budgetedIds = useMemo(
    () => new Set((budgets ?? []).map((b) => b.categoryId)),
    [budgets],
  );
  /** Only categories without a budget this month — one that already has one
   *  is edited from the budgets list, not re-created here. */
  const available = (categories ?? []).filter((c) => !budgetedIds.has(c.id));

  const [chosenCategory, setChosenCategory] = useState<ID | null>(null);
  const [draft, setDraft] = useState("");

  const categoryId = chosenCategory ?? available[0]?.id ?? null;
  const limitMinor = Number(draft.replace(/\D/g, "")) * 100;
  const canSave = categoryId !== null && limitMinor > 0;

  const save = async () => {
    if (!canSave || categoryId === null) return;
    await upsertBudget.mutateAsync({ categoryId, month, limitMinor });
    router.back();
  };

  return (
    <View className="flex-1 bg-bg">
      <View className="flex-row items-center justify-between px-4 pb-2 pt-4">
        <Text className="font-sans-bold text-title text-fg">New budget</Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          className="h-9 w-9 items-center justify-center rounded-full border border-border bg-card active:opacity-60"
        >
          <Ionicons name="close" size={18} color={palette.fg} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Card className="py-5">
          <Text className="font-sans-medium text-label text-muted">
            Monthly limit
          </Text>
          <View className="mt-1 flex-row items-center">
            <Text className="font-sans-bold text-display text-muted">₹</Text>
            <TextInput
              autoFocus
              value={draft}
              onChangeText={(next) => setDraft(next.replace(/\D/g, ""))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={palette.muted}
              textAlign="right"
              className="font-sans-bold ml-2 flex-1 text-display text-fg"
              style={{ paddingVertical: 0, minWidth: 0 }}
              accessibilityLabel="Monthly limit in rupees"
            />
          </View>
        </Card>

        <Text className="font-sans-semibold mb-2 mt-6 px-1 text-headline text-fg">
          Category
        </Text>

        {available.length === 0 ? (
          <Card>
            <Text className="font-sans text-body text-muted">
              Every category already has a budget this month.
            </Text>
          </Card>
        ) : (
          <CategoryPicker
            categories={available}
            selectedId={categoryId}
            onSelect={setChosenCategory}
          />
        )}

        <View className="mt-8">
          <Button
            label={`Save ${limitMinor > 0 ? formatMoney(limitMinor) : "budget"}`}
            onPress={save}
            disabled={!canSave}
            loading={upsertBudget.isPending}
          />
        </View>
      </ScrollView>
    </View>
  );
}
