import { View } from "react-native";

import { showSheet } from "@/lib/sheet";

import { Card, SectionTitle, SettingsRow } from "@/components/ui";
import {
  SAMPLE_MONTHS,
  generateSampleBudgets,
  generateSampleTransactions,
} from "@/lib/sample-data";
import {
  useClearAllData,
  useImportTransactions,
  useUpsertBudgets,
} from "@/queries";

/**
 * Development-only tools on the Settings screen.
 *
 * ⚠️ Never import this file statically. Settings `require`s it behind
 * `__DEV__`, which is what keeps it — and the sample data it pulls in — out of
 * preview and production bundles.
 */
export function DeveloperSection() {
  const importTransactions = useImportTransactions();
  const upsertBudgets = useUpsertBudgets();
  const clearAllData = useClearAllData();
  const adding = importTransactions.isPending || upsertBudgets.isPending;
  const busy = adding || clearAllData.isPending;

  const addSampleData = async () => {
    const transactions = generateSampleTransactions();
    const budgets = generateSampleBudgets(transactions);

    try {
      await importTransactions.mutateAsync({ categories: [], transactions, budgets: [] });
      await upsertBudgets.mutateAsync(budgets);
      showSheet(
        "Sample data added",
        `${transactions.length} expenses and ${budgets.length} budgets across ${SAMPLE_MONTHS} months.`,
      );
    } catch (error: unknown) {
      showSheet(
        "Could not add sample data",
        error instanceof Error ? error.message : "The write failed.",
      );
    }
  };

  const confirmClearAllData = () => {
    showSheet(
      "Clear all data?",
      "Deletes every expense, budget and custom category — on this phone and, once it syncs, on every device signed in to this account. Default categories and your theme are kept. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () =>
            clearAllData.mutateAsync().then(
              () => showSheet("All data cleared"),
              (error: unknown) =>
                showSheet(
                  "Could not clear data",
                  error instanceof Error ? error.message : "The delete failed.",
                ),
            ),
        },
      ],
    );
  };

  return (
    <View className="mt-6">
      <SectionTitle title="Developer" />
      <Card padded={false} className="overflow-hidden">
        <SettingsRow
          icon="flask-outline"
          label="Add sample data"
          value={adding ? "Adding…" : undefined}
          onPress={busy ? undefined : addSampleData}
        />
        <SettingsRow
          icon="trash-outline"
          label="Clear all data"
          tone="danger"
          value={clearAllData.isPending ? "Clearing…" : undefined}
          onPress={busy ? undefined : confirmClearAllData}
          showSeparator={false}
        />
      </Card>
    </View>
  );
}
