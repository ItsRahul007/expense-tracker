import { router, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";

import { Button, IconBadge } from "@/components/ui";
import { useCategoryUsage } from "@/hooks/use-category-usage";
import { useCategories, useDeleteCategory } from "@/queries";

/**
 * The delete-transaction sheet's counterpart, with one extra job: a category
 * delete can be refused by the database even after the usage guard has passed,
 * so the failure has to be readable here rather than dismissed into nothing.
 *
 * Two ways that happens, neither of them visible from `Category` — which carries
 * no `isDefault`, and no reference counts:
 *
 *  - a seeded category, blocked by the `categories_protect_default_delete`
 *    trigger;
 *  - a budget in a month `useCategoryUsage` can't see, blocked by the foreign
 *    key (`PRAGMA foreign_keys = ON`) — though `useDeleteCategory` clears
 *    budgets itself, so in practice this is the transactions FK.
 */
function failureReason(error: Error): string {
  if (/default category/i.test(error.message)) {
    return "This is one of the built-in categories, so it can't be deleted. You can rename it or change its icon instead.";
  }
  if (/FOREIGN KEY/i.test(error.message)) {
    return "Something is still filed under this category. Close this and move or delete it first.";
  }
  return "That didn't work. Close this and try again.";
}

export default function DeleteCategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: categories } = useCategories();
  const usage = useCategoryUsage(id);
  const deleteCategory = useDeleteCategory();

  const category = categories?.find((c) => c.id === id);

  const confirm = async () => {
    if (!category || usage.inUse) return;
    try {
      await deleteCategory.mutateAsync(category.id);
    } catch {
      // Rendered from `deleteCategory.error` below; caught only so the rejection
      // doesn't escape, and so the sheet stays open on the reason instead of
      // popping as if it had worked.
      return;
    }

    // One back is enough: the Categories screen derives its edit state from the
    // category list, so once the row is gone `editing` resolves to null and it
    // drops back to the list on its own.
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
            Delete this category?
          </Text>
          <Text className="font-sans mt-0.5 text-body text-muted">
            {category?.name ?? "This category"} will be gone for good. Nothing
            is filed under it, so no expenses are affected — any budget you set
            for it goes too.
          </Text>
        </View>
      </View>

      <View className="mt-8 gap-3">
        <Button
          label="Delete"
          variant="danger"
          onPress={confirm}
          disabled={usage.inUse}
          loading={deleteCategory.isPending}
        />
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
      </View>

      {deleteCategory.error ? (
        <Text className="font-sans mt-4 px-1 text-center text-label text-danger">
          {failureReason(deleteCategory.error)}
        </Text>
      ) : null}
    </View>
  );
}
