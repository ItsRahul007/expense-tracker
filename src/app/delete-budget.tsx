import { router, useLocalSearchParams } from "expo-router";
import { View, Text } from "react-native";

import { Button, IconBadge } from "@/components/ui";
import type { Month } from "@/lib/month";
import { useBudgets, useCategories, useUpsertBudget } from "@/queries";

/** A dedicated formSheet route rather than an in-app Modal — that's the only
 *  way to get the native slide-up-from-bottom animation and drag-to-dismiss
 *  gesture that /add and /add-budget already have. */
export default function DeleteBudgetScreen() {
  const { categoryId, month } = useLocalSearchParams<{
    categoryId: string;
    month: Month;
  }>();

  const { data: categories } = useCategories();
  const { data: budgets } = useBudgets(month);
  const upsertBudget = useUpsertBudget();

  const category = categories?.find((c) => c.id === categoryId);
  const budget = budgets?.find((b) => b.categoryId === categoryId);

  const confirm = async () => {
    if (!budget) return;
    await upsertBudget.mutateAsync({ ...budget, limitMinor: 0 });
    router.back();
  };

  return (
    <View className="flex-1 bg-bg px-5 pt-2">
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
            {category?.name ?? "This category"} will have no limit for {month}.
          </Text>
        </View>
      </View>

      <View className="mt-8 gap-3">
        <Button
          label="Delete"
          variant="danger"
          onPress={confirm}
          loading={upsertBudget.isPending}
        />
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
      </View>
    </View>
  );
}
