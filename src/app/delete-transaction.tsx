import { router, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";

import { Button, IconBadge } from "@/components/ui";
import { formatMoney, formatRelativeDay } from "@/lib/format";
import { useCategories, useDeleteTransaction, useTransaction } from "@/queries";

/** The delete-budget sheet's twin. A native formSheet rather than Alert.alert:
 *  the OS alert looks nothing like the rest of the app, and a destructive
 *  confirmation is the one place where a stray tap costs data — the sheet's
 *  larger, further-apart buttons make that harder to do by accident. */
export default function DeleteTransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: transaction } = useTransaction(id);
  const { data: categories } = useCategories();
  const deleteTransaction = useDeleteTransaction();

  const category = categories?.find((c) => c.id === transaction?.categoryId);

  const confirm = async () => {
    if (!transaction) return;
    await deleteTransaction.mutateAsync(transaction.id);
    // Two screens, not one: this sheet *and* the detail screen behind it, which
    // would otherwise be left sitting on a record that no longer exists.
    router.dismiss(2);
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
            Delete this expense?
          </Text>
          <Text className="font-sans mt-0.5 text-body text-muted">
            {transaction
              ? `${formatMoney(transaction.amountMinor)} · ${category?.name ?? "Uncategorised"} · ${formatRelativeDay(transaction.occurredAt)}`
              : "This cannot be undone."}
          </Text>
        </View>
      </View>

      <View className="mt-8 gap-3">
        <Button
          label="Delete"
          variant="danger"
          onPress={confirm}
          loading={deleteTransaction.isPending}
        />
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
      </View>
    </View>
  );
}