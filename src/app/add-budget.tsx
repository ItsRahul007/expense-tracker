import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { CategoryEditor } from "@/components/category-editor";
import { CategoryPicker } from "@/components/category-picker";
import { Button, Card, Chip, MonthSwitcher } from "@/components/ui";
import { usePalette } from "@/constants/palette";
import { scopeLabel, type ScopeKind } from "@/lib/budget-scope";
import { formatMoney } from "@/lib/format";
import { currentMonth, monthLabel, shiftMonth, type Month } from "@/lib/month";
import { useCategories, useUpsertBudget } from "@/queries";
import type { BudgetScope, ID } from "@/types/domain";

const SCOPE_OPTIONS: { kind: ScopeKind; label: string }[] = [
  { kind: "month", label: "One month" },
  { kind: "ongoing", label: "Every month" },
  { kind: "range", label: "Date range" },
];

/** Where a new range ends by default: a quarter, a common thing to plan for. */
const DEFAULT_RANGE_MONTHS = 3;

export default function AddBudgetScreen() {
  const palette = usePalette();
  const navigation = useNavigation();
  // The month the Budgets screen was showing, passed through by the tab bar.
  const params = useLocalSearchParams<{ month?: Month }>();
  const month = params.month ?? currentMonth();

  const { data: categories } = useCategories();
  const upsertBudget = useUpsertBudget();

  const [chosenCategory, setChosenCategory] = useState<ID | null>(null);
  const [draft, setDraft] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [kind, setKind] = useState<ScopeKind>("month");
  const [rangeFrom, setRangeFrom] = useState<Month>(month);
  const [rangeTo, setRangeTo] = useState<Month>(
    shiftMonth(month, DEFAULT_RANGE_MONTHS - 1),
  );

  const scope: BudgetScope =
    kind === "month"
      ? { startMonth: month, endMonth: month }
      : kind === "ongoing"
        ? { startMonth: month, endMonth: null }
        : { startMonth: rangeFrom, endMonth: rangeTo };

  /**
   * The icon and colour grids need roughly a full screen, and the sheet's normal
   * 0.6 detent leaves them behind the keyboard. Detents are a navigation option,
   * so the sheet is grown for the duration of the editor and shrunk back after —
   * the alternative is making the user drag the sheet up mid-form.
   */
  useEffect(() => {
    navigation.setOptions({
      sheetAllowedDetents: creatingCategory ? [0.95] : [0.8],
    } as never);
  }, [navigation, creatingCategory]);

  const categoryId = chosenCategory ?? categories?.[0]?.id ?? null;
  const limitMinor = Number(draft.replace(/\D/g, "")) * 100;
  const canSave = categoryId !== null && limitMinor > 0;

  const save = async () => {
    if (!canSave || categoryId === null) return;
    await upsertBudget.mutateAsync({ categoryId, ...scope, limitMinor });
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
          Applies to
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {SCOPE_OPTIONS.map((option) => (
            <Chip
              key={option.kind}
              label={option.label}
              selected={kind === option.kind}
              onPress={() => setKind(option.kind)}
            />
          ))}
        </View>

        {kind === "range" ? (
          <View className="mt-3 gap-2">
            <View className="flex-row items-center gap-3">
              <Text className="font-sans-medium w-10 text-label text-muted">From</Text>
              <View className="flex-1">
                <MonthSwitcher
                  month={rangeFrom}
                  allowFuture
                  onChange={(next) => {
                    setRangeFrom(next);
                    // Drag the end along rather than allow a backwards range.
                    if (next > rangeTo) setRangeTo(next);
                  }}
                />
              </View>
            </View>
            <View className="flex-row items-center gap-3">
              <Text className="font-sans-medium w-10 text-label text-muted">To</Text>
              <View className="flex-1">
                <MonthSwitcher
                  month={rangeTo}
                  earliest={rangeFrom}
                  allowFuture
                  onChange={setRangeTo}
                />
              </View>
            </View>
          </View>
        ) : null}

        <Text className="font-sans mt-2 px-1 text-label text-muted">
          {kind === "month"
            ? `Only ${monthLabel(month)}.`
            : kind === "ongoing"
              ? `${monthLabel(month)} and every month after, until you change it.`
              : `${scopeLabel(scope)}, the same limit each month.`}{" "}
          Where budgets overlap, the one you saved last applies.
        </Text>

        <Text className="font-sans-semibold mb-2 mt-6 px-1 text-headline text-fg">
          Category
        </Text>

        {creatingCategory ? (
          <CategoryEditor
            autoFocus
            onCancel={() => setCreatingCategory(false)}
            onCreated={(newId) => {
              setChosenCategory(newId);
              setCreatingCategory(false);
            }}
          />
        ) : (
          // Same dashed "New" tile as the add-expense sheet: realising a
          // category is missing shouldn't mean abandoning this form. Picking a
          // category that already has a budget for exactly these months just
          // updates its limit.
          <CategoryPicker
            categories={categories ?? []}
            selectedId={categoryId}
            onSelect={setChosenCategory}
            onAddNew={() => setCreatingCategory(true)}
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
