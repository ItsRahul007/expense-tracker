import { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import {
  Card,
  EmptyState,
  IconBadge,
  MonthSwitcher,
  Progress,
  ScreenHeader,
  SectionTitle,
} from "@/components/ui";
import { usePalette } from "@/constants/palette";
import { formatMoney } from "@/lib/format";
import { currentMonth, type Month } from "@/lib/month";
import { useBudgets, useCategories, useUpsertBudget } from "@/queries";
import type { BudgetStatus, Category, ID } from "@/types/domain";

export default function BudgetsScreen() {
  const [month, setMonth] = useState<Month>(currentMonth());
  const [editing, setEditing] = useState<ID | null>(null);

  const { data: budgets } = useBudgets(month);
  const { data: categories } = useCategories();
  const upsertBudget = useUpsertBudget();

  const categoryById = useMemo(() => {
    const map = new Map<ID, Category>();
    for (const category of categories ?? []) map.set(category.id, category);
    return map;
  }, [categories]);

  const rows = budgets ?? [];
  const totalLimit = rows.reduce((sum, b) => sum + b.limitMinor, 0);
  const totalSpent = rows.reduce((sum, b) => sum + b.spentMinor, 0);
  const overCount = rows.filter((b) => b.spentMinor > b.limitMinor).length;

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Budgets" />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="pb-4">
          <MonthSwitcher month={month} onChange={setMonth} />
        </View>

        {rows.length === 0 ? (
          <EmptyState
            icon="wallet-outline"
            title="No budgets set"
            body="Budgets apply to a single month, so you can set a different limit whenever things change."
          />
        ) : (
          <>
            <Card>
              <View className="flex-row items-end justify-between">
                <View>
                  <Text className="font-sans-medium text-label text-muted">
                    Spent of {formatMoney(totalLimit)}
                  </Text>
                  <Text className="font-sans-bold mt-1 text-display text-fg">
                    {formatMoney(totalSpent, { paise: false })}
                  </Text>
                </View>
                {overCount > 0 ? (
                  <View className="rounded-full bg-danger/10 px-3 py-1.5">
                    <Text className="font-sans-semibold text-label text-danger">
                      {overCount} over
                    </Text>
                  </View>
                ) : null}
              </View>
              <View className="mt-4">
                <Progress
                  fraction={totalLimit > 0 ? totalSpent / totalLimit : 0}
                  over={totalSpent > totalLimit}
                />
              </View>
            </Card>

            <View className="mt-6">
              <SectionTitle title="By category" />
              <View className="gap-3">
                {rows.map((budget) => (
                  <BudgetCard
                    key={budget.categoryId}
                    budget={budget}
                    category={categoryById.get(budget.categoryId)}
                    editing={editing === budget.categoryId}
                    onStartEdit={() => setEditing(budget.categoryId)}
                    onCancel={() => setEditing(null)}
                    onCommit={(limitMinor) => {
                      upsertBudget.mutate({ ...budget, limitMinor });
                      setEditing(null);
                    }}
                  />
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function AddBudgetCard({
  category,
  editing,
  onStartEdit,
  onCancel,
  onCommit,
}: {
  category: Category;
  editing: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onCommit: (limitMinor: number) => void;
}) {
  const palette = usePalette();
  const [draft, setDraft] = useState("");

  const commit = () => {
    const rupees = Number(draft.replace(/\D/g, ""));
    if (Number.isFinite(rupees) && draft.trim() !== "") onCommit(rupees * 100);
    else onCancel();
  };

  return (
    <Card>
      <View className="flex-row items-center gap-3">
        <IconBadge icon={category.icon} color={category.color} />
        <View className="flex-1">
          <Text className="font-sans-semibold text-body text-fg">
            {category.name}
          </Text>
          <Text className="font-sans mt-0.5 text-label text-muted">
            No budget set
          </Text>
        </View>
      </View>

      {editing ? (
        <View className="mt-3 flex-row items-center gap-2">
          <View className="flex-1 flex-row items-center rounded-xl border border-accent bg-bg px-3">
            <Text className="font-sans-medium text-body text-muted">₹</Text>
            <TextInput
              autoFocus
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={commit}
              onBlur={commit}
              keyboardType="number-pad"
              returnKeyType="done"
              placeholder="Monthly limit"
              placeholderTextColor={palette.muted}
              className="font-sans-medium h-11 flex-1 px-1 text-body text-fg"
              style={{ minWidth: 0 }}
              accessibilityLabel={`Monthly limit for ${category.name}`}
            />
          </View>
        </View>
      ) : (
        <View className="mt-3 flex-row items-center justify-end">
          <Text
            onPress={onStartEdit}
            accessibilityRole="button"
            accessibilityLabel={`Set limit for ${category.name}`}
            className="font-sans-semibold text-label text-accent"
          >
            Set limit
          </Text>
        </View>
      )}
    </Card>
  );
}

function BudgetCard({
  budget,
  category,
  editing,
  onStartEdit,
  onCancel,
  onCommit,
}: {
  budget: BudgetStatus;
  category?: Category;
  editing: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onCommit: (limitMinor: number) => void;
}) {
  const palette = usePalette();
  const [draft, setDraft] = useState("");

  const over = budget.spentMinor > budget.limitMinor;
  const fraction =
    budget.limitMinor > 0 ? budget.spentMinor / budget.limitMinor : 0;
  const remaining = budget.limitMinor - budget.spentMinor;

  const commit = () => {
    const rupees = Number(draft.replace(/\D/g, ""));
    if (Number.isFinite(rupees) && draft.trim() !== "") onCommit(rupees * 100);
    else onCancel();
  };

  return (
    <Card>
      <View className="flex-row items-center gap-3">
        <IconBadge
          icon={category?.icon ?? "ellipsis-horizontal"}
          color={category?.color ?? "#6B7280"}
        />
        <View className="flex-1">
          <Text className="font-sans-semibold text-body text-fg">
            {category?.name ?? "Uncategorised"}
          </Text>
          <Text className="font-sans mt-0.5 text-label text-muted">
            {formatMoney(budget.spentMinor)} of {formatMoney(budget.limitMinor)}
          </Text>
        </View>
        <Text
          className={`font-sans-semibold text-body ${over ? "text-danger" : "text-fg"}`}
        >
          {Math.round(fraction * 100)}%
        </Text>
      </View>

      <View className="mt-3">
        <Progress fraction={fraction} over={over} tint={category?.color} />
      </View>

      {editing ? (
        <View className="mt-3 flex-row items-center gap-2">
          <View className="flex-1 flex-row items-center rounded-xl border border-accent bg-bg px-3">
            <Text className="font-sans-medium text-body text-muted">₹</Text>
            <TextInput
              autoFocus
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={commit}
              onBlur={commit}
              keyboardType="number-pad"
              returnKeyType="done"
              placeholder="New limit"
              placeholderTextColor={palette.muted}
              className="font-sans-medium h-11 flex-1 px-1 text-body text-fg"
              style={{ minWidth: 0 }}
              accessibilityLabel={`New monthly limit for ${category?.name ?? "category"}`}
            />
          </View>
        </View>
      ) : (
        <View className="mt-3 flex-row items-center justify-between">
          <Text
            className={`font-sans-medium text-label ${over ? "text-danger" : "text-muted"}`}
          >
            {over
              ? `${formatMoney(-remaining)} over budget`
              : `${formatMoney(remaining)} left`}
          </Text>
          {/* Accent-coloured and separated out — as muted body text inside a
              sentence it didn't read as something you could tap. */}
          <Text
            onPress={onStartEdit}
            accessibilityRole="button"
            accessibilityLabel={`Change limit for ${category?.name ?? "category"}`}
            className="font-sans-semibold text-label text-accent"
          >
            Change limit
          </Text>
        </View>
      )}
    </Card>
  );
}
