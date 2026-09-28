import { Alert, View } from "react-native";

import { Card, SectionTitle, SettingsRow } from "@/components/ui";
import { SAMPLE_MONTHS, generateSampleTransactions } from "@/lib/sample-data";
import { useImportTransactions } from "@/queries";

/**
 * Development-only tools on the Settings screen.
 *
 * ⚠️ Never import this file statically. Settings `require`s it behind
 * `__DEV__`, which is what keeps it — and the sample data it pulls in — out of
 * preview and production bundles.
 */
export function DeveloperSection() {
  const importTransactions = useImportTransactions();

  const addSampleData = () => {
    const transactions = generateSampleTransactions();
    importTransactions.mutateAsync({ categories: [], transactions }).then(
      () => Alert.alert("Sample data added", `${transactions.length} expenses across ${SAMPLE_MONTHS} months.`),
      (error: unknown) =>
        Alert.alert(
          "Could not add sample data",
          error instanceof Error ? error.message : "The write failed.",
        ),
    );
  };

  return (
    <View className="mt-6">
      <SectionTitle title="Developer" />
      <Card padded={false} className="overflow-hidden">
        <SettingsRow
          icon="flask-outline"
          label="Add sample data"
          value={importTransactions.isPending ? "Adding…" : undefined}
          onPress={importTransactions.isPending ? undefined : addSampleData}
          showSeparator={false}
        />
      </Card>
    </View>
  );
}
