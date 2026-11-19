import { router } from "expo-router";
import { useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";

import { AccountRow } from "@/components/account-row";
import { Card, Chip, ScreenHeader, SectionTitle, SettingsRow } from "@/components/ui";
import { backupSummary } from "@/lib/backup-status";
import { exportLedgerToDownloads } from "@/lib/export-ledger";
import { showSheet } from "@/lib/sheet";
import { useSession } from "@/providers/session-provider";
import { useSync } from "@/providers/sync-provider";
import { useDrizzle } from "@/queries/helper";
import {
  useCategories,
  useKnownMonths,
  useSetSetting,
  useSetting,
  useTransactions,
} from "@/queries";
import type { ThemePreference } from "@/types/domain";

/**
 * Metro folds `__DEV__` to `false` in release builds and drops the dead
 * `require` before collecting dependencies, so the developer tools and the
 * sample data behind them never reach a preview or production bundle. A static
 * `import` would ship them even with the render wrapped in `__DEV__`.
 */
const DeveloperSection: (() => React.JSX.Element) | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@/components/developer-section").DeveloperSection
  : null;

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
  const db = useDrizzle();
  const { session } = useSession();
  const { status: backup } = useSync();
  // Web has no Google sign-in (design §2); a dev-build "skip" has no account.
  const showAccount = Platform.OS !== "web" && session.user !== null;

  const exportLedger = async () => {
    setExporting(true);
    try {
      const result = await exportLedgerToDownloads(db);
      if (result.ok) {
        showSheet("Saved", `${result.fileName} is in ${result.location}.`);
      } else if (result.reason === "failed") {
        showSheet("Export failed", result.message);
      }
      // Cancelled the folder picker: nothing to say.
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
        {showAccount ? (
          <View className="mb-6">
            <SectionTitle title="Account" />
            <Card padded={false} className="overflow-hidden">
              <AccountRow
                email={session.user?.email ?? "Google account"}
                name={session.user?.name ?? null}
                photo={session.user?.photo ?? null}
                status={backupSummary(backup)}
                needsAttention={
                  !!backup.pendingReview ||
                  (!!backup.lastError && !["offline", "rate_limited", "server"].includes(backup.lastError.code))
                }
                onPress={() => router.push("/account")}
              />
            </Card>
          </View>
        ) : null}

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
            />
            <SettingsRow
              icon="cloud-upload-outline"
              label="Import from CSV"
              onPress={() => router.push("/import")}
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

        {DeveloperSection ? <DeveloperSection /> : null}

        <Text className="font-sans mt-5 px-1 text-label text-muted">
          {backup.connected
            ? "Saved on this phone and backed up to your Google Drive."
            : "Everything is stored on this device only. Export now and then — removing the app takes the data with it."}
        </Text>
      </ScrollView>
    </View>
  );
}
