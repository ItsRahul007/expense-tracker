import { router, useLocalSearchParams } from "expo-router";
import { View, Text } from "react-native";

import { Button, IconBadge } from "@/components/ui";
import { scopeKind, scopeLabel } from "@/lib/budget-scope";
import { monthLabel, type Month } from "@/lib/month";
import { useAllBudgets, useCategories, useDeleteBudget } from "@/queries";

/** A dedicated formSheet route rather than an in-app Modal — that's the only
 *  way to get the native slide-up-from-bottom animation and drag-to-dismiss
 *  gesture that /add and /add-budget already have.
 *
 *  A budget covering several months offers two ways out: drop it entirely, or
 *  cut just the month being viewed out of it — "every month except December"
 *  without having to rebuild the budget as two ranges by hand. */
export default function DeleteBudgetScreen() {
  const { budgetId, month } = useLocalSearchParams<{
    budgetId: string;
    month: Month;
  }>();

  const { data: categories } = useCategories();
  const { data: budgets } = useAllBudgets();
  const deleteBudget = useDeleteBudget();

  const budget = budgets?.find((b) => b.id === budgetId);
  const category = categories?.find((c) => c.id === budget?.categoryId);
  const multiMonth = budget ? scopeKind(budget) !== "month" : false;

  const remove = async (onlyMonth?: Month) => {
    if (!budget) return;
    await deleteBudget.mutateAsync({ id: budget.id, onlyMonth });
    router.back();
  };

  return (
    <View className="flex-1 bg-sheet dark:border-t dark:border-border px-5 pt-2">
      <View className="flex-row items-center gap-3">
        <IconBadge
          icon={category?.icon ?? "ellipsis-horizontal"}
          color={category?.color ?? "#6B7280"}
        />
        <View className="flex-1">
          <Text className="font-sans-bold text-headline text-fg">
            Delete this budget?
          </Text>
          <Text className="font-sans mt-0.5 text-body text-muted">
            {category?.name ?? "This category"}
            {budget ? ` · ${scopeLabel(budget)}` : ""}
          </Text>
        </View>
      </View>

      <View className="mt-8 gap-3">
        {multiMonth ? (
          <>
            <Button
              label={`Remove for ${monthLabel(month)} only`}
              variant="danger"
              onPress={() => remove(month)}
              loading={deleteBudget.isPending}
            />
            <Button
              label="Delete for all months"
              variant="secondary"
              onPress={() => remove()}
              disabled={deleteBudget.isPending}
            />
          </>
        ) : (
          <Button
            label="Delete"
            variant="danger"
            onPress={() => remove()}
            loading={deleteBudget.isPending}
          />
        )}
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
      </View>
    </View>
  );
}
