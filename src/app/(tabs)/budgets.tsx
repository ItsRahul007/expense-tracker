import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import {
  Amount,
  EmptyState,
  Footing,
  LedgerSheet,
  MonthSwitcher,
  Rule,
  ScreenHeader,
} from "@/components/ledger";
import { ProgressBar } from "@/components/progress-bar";
import { usePalette } from "@/constants/palette";
import { formatCompact } from "@/lib/format";
import { currentMonth, type Month } from "@/lib/month";
import { useBudgets, useCategories, useUpsertBudget } from "@/queries";
import type { BudgetStatus, ID } from "@/types/domain";

export default function BudgetsScreen() {
  const [month, setMonth] = useState<Month>(currentMonth());
  const [editing, setEditing] = useState<ID | null>(null);

  const { data: budgets } = useBudgets(month);
  const { data: categories } = useCategories();
  const upsertBudget = useUpsertBudget();

  const rows = budgets ?? [];
  const totalLimit = rows.reduce((sum, b) => sum + b.limitMinor, 0);
  const totalSpent = rows.reduce((sum, b) => sum + b.spentMinor, 0);

  const nameOf = (id: ID) =>
    categories?.find((c) => c.id === id)?.name ?? "Uncategorised";

  return (
    <View className="flex-1 bg-paper">
      <ScreenHeader
        title="Budgets"
        trailing={<MonthSwitcher month={month} onChange={setMonth} />}
      />

      <LedgerSheet>
        {rows.length === 0 ? (
          <EmptyState message="No limits set for this month. Budgets are set per category and only apply to the month you set them in." />
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
            {rows.map((budget, index) => (
              <BudgetRow
                key={budget.categoryId}
                budget={budget}
                name={nameOf(budget.categoryId)}
                zebra={index % 2 === 1}
                editing={editing === budget.categoryId}
                onToggleEdit={() =>
                  setEditing(editing === budget.categoryId ? null : budget.categoryId)
                }
                onCommit={(limitMinor) => {
                  upsertBudget.mutate({ ...budget, limitMinor });
                  setEditing(null);
                }}
              />
            ))}
          </ScrollView>
        )}

        <Footing
          label={`Allotted ${formatCompact(totalLimit)}`}
          amountMinor={totalSpent}
          tone={totalSpent > totalLimit ? "alert" : "ink"}
        />
      </LedgerSheet>
    </View>
  );
}

function BudgetRow({
  budget,
  name,
  zebra,
  editing,
  onToggleEdit,
  onCommit,
}: {
  budget: BudgetStatus;
  name: string;
  zebra: boolean;
  editing: boolean;
  onToggleEdit: () => void;
  onCommit: (limitMinor: number) => void;
}) {
  const palette = usePalette();
  const [draft, setDraft] = useState("");

  const over = budget.spentMinor > budget.limitMinor;
  const fraction = budget.limitMinor > 0 ? budget.spentMinor / budget.limitMinor : 0;
  const percent = Math.round(fraction * 100);

  return (
    <View className={zebra ? "bg-row-alt" : ""}>
      <Rule />
      {/* pr-7 on the container so the figure, the bar and the percentage all
          stop 12px clear of the alignment rule. */}
      <View className="pb-3 pl-4 pr-7 pt-3">
        <View className="flex-row items-baseline justify-between">
          <Text className="font-sans-medium text-row text-ink">{name}</Text>
          <Amount amountMinor={budget.spentMinor} tone={over ? "alert" : "ink"} />
        </View>

        <View className="pb-2 pt-2">
          <ProgressBar fraction={fraction} over={over} />
        </View>

        <View className="flex-row items-center justify-between">
          {editing ? (
            <TextInput
              autoFocus
              value={draft}
              onChangeText={setDraft}
              onBlur={() => {
                const rupees = Number(draft.replace(/\D/g, ""));
                if (Number.isFinite(rupees)) onCommit(rupees * 100);
              }}
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={() => {
                const rupees = Number(draft.replace(/\D/g, ""));
                if (Number.isFinite(rupees)) onCommit(rupees * 100);
              }}
              placeholder={`Limit in rupees, currently ${formatCompact(budget.limitMinor)}`}
              placeholderTextColor={palette.inkMuted}
              className="font-mono-medium flex-1 text-meta text-ink"
            />
          ) : (
            <Text
              onPress={onToggleEdit}
              accessibilityRole="button"
              className="font-sans text-meta text-ink-muted"
            >
              of {formatCompact(budget.limitMinor)} · tap to change
            </Text>
          )}
          <Text
            className={`font-mono text-margin ${over ? "text-alert" : "text-ink-muted"}`}
          >
            {percent}%
          </Text>
        </View>
      </View>
    </View>
  );
}
