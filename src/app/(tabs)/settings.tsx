import { File, Paths } from "expo-file-system";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";

import { Chip } from "@/components/keypad/chip";
import {
  Eyebrow,
  LedgerSheet,
  MetaRow,
  Rule,
  ScreenHeader,
} from "@/components/ledger";
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

  const [picker, setPicker] = useState<"theme" | null>(null);
  const [exporting, setExporting] = useState(false);

  const exportLedger = async () => {
    setExporting(true);
    try {
      const csv = await exportAllData();

      // SDK 55's object-oriented file API. The legacy `FileSystem.*` helpers now
      // throw unless imported from "expo-file-system/legacy".
      const file = new File(Paths.document, `khata-${formatISODate(Date.now())}.csv`);
      if (file.exists) file.delete();
      file.create();
      file.write(csv);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "text/csv",
          UTI: "public.comma-separated-values-text",
          dialogTitle: "Export ledger",
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
    <View className="flex-1 bg-paper">
      <ScreenHeader title="Settings" />

      <LedgerSheet>
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <SectionLabel>Appearance</SectionLabel>
          <MetaRow
            label="Theme"
            value={THEMES.find((t) => t.value === theme)?.label ?? "System"}
            onPress={() => setPicker(picker === "theme" ? null : "theme")}
            expanded={
              picker === "theme" ? (
                <View className="flex-row gap-2">
                  {THEMES.map((option) => (
                    <Chip
                      key={option.value}
                      label={option.label}
                      selected={theme === option.value}
                      onPress={() => {
                        setSetting.mutate({ key: "theme", value: option.value });
                        setPicker(null);
                      }}
                    />
                  ))}
                </View>
              ) : null
            }
          />

          <SectionLabel>Ledger</SectionLabel>
          <MetaRow
            label="Categories"
            value={String(categories?.length ?? 0)}
            onPress={() => router.push("/categories")}
          />
          <MetaRow
            label="Export"
            value={exporting ? "Preparing…" : "CSV"}
            onPress={exporting ? undefined : exportLedger}
          />

          <SectionLabel>This ledger</SectionLabel>
          <MetaRow label="Entries" value={String(allEntries?.length ?? 0)} tone="muted" />
          <MetaRow
            label="Months recorded"
            value={String(months?.length ?? 0)}
            tone="muted"
          />
          <Rule />

          <View className="px-4 pt-6">
            <Text className="font-sans text-meta text-ink-muted">
              Everything lives on this device. Export regularly — an uninstall
              takes the ledger with it.
            </Text>
          </View>
        </ScrollView>
      </LedgerSheet>
    </View>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <View className="h-10 justify-end pb-2 pl-4">
      <Eyebrow>{children}</Eyebrow>
    </View>
  );
}
