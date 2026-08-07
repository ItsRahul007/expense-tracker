import { File, Paths } from "expo-file-system";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";

import { Card, Chip, ScreenHeader, SectionTitle, SettingsRow } from "@/components/ui";
import { formatISODate } from "@/lib/format";
import {
  exportAllData,
  useCategories,
  useKnownMonths,
  useSetSetting,
  useSetting,
  useTransactions,
} from "@/queries";
import type { ThemePreference } from "@/types/domain";

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function SettingsScreen() {
  const { data: theme } = useSetting("theme");
  const setSetting = useSetSetting();
  const { data: categories } = useCategories();
  const { data: months } = useKnownMonths();
  const { data: allEntries } = useTransactions(null);

  const [exporting, setExporting] = useState(false);

  const exportLedger = async () => {
    setExporting(true);
    try {
      const csv = await exportAllData();

      // SDK 55's object-oriented file API. The legacy `FileSystem.*` helpers now
      // throw unless imported from "expo-file-system/legacy".
      const file = new File(Paths.document, `expenses-${formatISODate(Date.now())}.csv`);
      if (file.exists) file.delete();
      file.create();
      file.write(csv);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "text/csv",
          UTI: "public.comma-separated-values-text",
          dialogTitle: "Export expenses",
        });
      } else {
        Alert.alert("Saved", `Written to ${file.uri}`);
      }
    } catch (error) {
      Alert.alert(
        "Export failed",
        error instanceof Error ? error.message : "The file could not be written.",
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Settings" />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <SectionTitle title="Appearance" />
        <Card>
          <Text className="font-sans-medium mb-3 text-body text-fg">Theme</Text>
          <View className="flex-row gap-2">
            {THEMES.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={theme === option.value}
                onPress={() => setSetting.mutate({ key: "theme", value: option.value })}
              />
            ))}
          </View>
        </Card>

        <View className="mt-6">
          <SectionTitle title="Data" />
          <Card padded={false} className="overflow-hidden">
            <SettingsRow
              icon="pricetags-outline"
              label="Categories"
              value={String(categories?.length ?? 0)}
              onPress={() => router.push("/categories")}
            />
            <SettingsRow
              icon="download-outline"
              label="Export as CSV"
              value={exporting ? "Preparing…" : undefined}
              onPress={exporting ? undefined : exportLedger}
              showSeparator={false}
            />
          </Card>
        </View>

        <View className="mt-6">
          <SectionTitle title="About" />
          <Card padded={false} className="overflow-hidden">
            <SettingsRow
              icon="receipt-outline"
              label="Expenses recorded"
              value={String(allEntries?.length ?? 0)}
            />
            <SettingsRow
              icon="calendar-outline"
              label="Months with data"
              value={String(months?.length ?? 0)}
              showSeparator={false}
            />
          </Card>
        </View>

        <Text className="font-sans mt-5 px-1 text-label text-muted">
          Everything is stored on this device only. Export now and then — removing
          the app takes the data with it.
        </Text>
      </ScrollView>
    </View>
  );
}
