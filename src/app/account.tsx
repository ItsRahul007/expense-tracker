/**
 * Account & backup (design §15.4): who's signed in, how the backup is doing,
 * the fixes for anything that went wrong, and sign-out.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";

import { requestDriveAccess, signIn, signOutOfGoogle } from "@/auth/google";
import { signOutAndClear } from "@/auth/session";
import { Button, Card, ScreenHeader, SectionTitle, SettingsRow, Toggle } from "@/components/ui";
import { showSheet } from "@/lib/sheet";
import { usePalette } from "@/constants/palette";
import { useSession } from "@/providers/session-provider";
import { useSync } from "@/providers/sync-provider";
import { backupSummary, timeAgo } from "@/lib/backup-status";
import { useDrizzle } from "@/queries/helper";
import { spreadsheetUrl } from "@/sync/google-api";
import { countUnsynced } from "@/sync/local-repo";

type Fix = { title: string; detail: string; action?: { label: string; run: () => void } };

export default function AccountScreen() {
  const palette = usePalette();
  const db = useDrizzle();
  const { session, refresh } = useSession();
  const sync = useSync();
  const { status } = sync;
  const [signingOut, setSigningOut] = useState(false);
  const queryClient = useQueryClient();
  const user = session.user;

  const reconnect = async () => {
    const result = await signIn();
    if (!result.ok) return;
    if (user && result.account.id !== user.id) {
      showSheet(
        "Different account",
        `This phone backs up to ${user.email}. Choose that account to reconnect, or sign out first to switch accounts.`,
      );
      await signOutOfGoogle({ revoke: false });
      return;
    }
    void sync.syncNow();
  };

  const fix: Fix | null = (() => {
    const error = status.lastError;
    if (!error) return null;
    switch (error.code) {
      case "offline":
        return null; // shown in the status line; nothing to do
      case "needs_reauth":
        return {
          title: "Reconnect Google to keep backing up",
          detail: "Your expenses are safe on this phone. Backups resume once you reconnect.",
          action: { label: "Reconnect", run: reconnect },
        };
      case "scope":
        return {
          title: "Allow Drive access",
          detail: "Backups need access to the app's own spreadsheet in your Drive.",
          action: {
            label: "Allow access",
            run: async () => {
              if (await requestDriveAccess()) void sync.syncNow();
            },
          },
        };
      case "sheet_missing":
        return {
          title: "Your backup sheet was deleted",
          detail: "Everything is still on this phone. Create a new sheet from it?",
          action: { label: "Recreate from this phone", run: () => void sync.recreateSheet() },
        };
      case "sheet_damaged":
        return {
          title: "The backup sheet's layout was changed",
          detail: `${error.message} Start a fresh sheet from this phone? The old one is left as it is.`,
          action: { label: "Start a fresh sheet", run: () => void sync.recreateSheet() },
        };
      case "schema_newer":
        return {
          title: "Update the app to keep backing up",
          detail: "Your backup was saved by a newer version of the app on another device.",
        };
      default:
        return {
          title: "Backup didn't finish",
          detail: error.message,
          action: { label: "Try again", run: () => void sync.syncNow() },
        };
    }
  })();

  /**
   * Sign out = back everything up, then clear this phone. Nothing is removed
   * unless the sheet has confirmed every change (0 waiting); otherwise the
   * user is told why and stays signed in.
   */
  const signOut = () => {
    showSheet(
      "Sign out?",
      "Your expenses will be backed up to your Google Sheet first, then removed from this phone. Signing in again brings them back.",
      [
        { text: "Sign out", style: "destructive", onPress: () => void backUpThenSignOut(false) },
        {
          text: "Sign out and remove access",
          style: "destructive",
          onPress: () => void backUpThenSignOut(true),
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  };

  const backUpThenSignOut = async (revoke: boolean) => {
    setSigningOut(true);
    let outcome: Awaited<ReturnType<typeof sync.syncNow>> = null;
    try {
      outcome = await sync.syncNow();
    } catch {
      // Reported through the checks below.
    }
    const waiting = countUnsynced(db);
    setSigningOut(false);

    if (outcome?.status === "needs_confirmation") {
      showSheet(
        "Can’t sign out yet",
        "Another device made a big change that needs your review first. Review it on this screen, then sign out.",
      );
      return;
    }
    if (waiting > 0 || outcome?.status === "error") {
      const reason =
        outcome?.status === "error" && outcome.error.code === "offline"
          ? "You’re offline."
          : outcome?.status === "error"
            ? `The backup didn’t finish (${outcome.error.message}).`
            : "The backup didn’t finish.";
      showSheet(
        "Can’t sign out yet",
        `${reason} ${waiting} change${waiting === 1 ? " isn’t" : "s aren’t"} backed up, and signing out would remove ${waiting === 1 ? "it" : "them"} from this phone. Nothing has been removed — connect to the internet and try again.`,
      );
      return;
    }

    await signOutOfGoogle({ revoke });
    signOutAndClear(db);
    queryClient.invalidateQueries();
    refresh(); // the route guard moves to the sign-in screen
  };

  const openSheet = () => {
    if (status.spreadsheetId) void Linking.openURL(spreadsheetUrl(status.spreadsheetId));
  };

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Account" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
        <Card className="flex-row items-center gap-3">
          {user?.photo ? (
            <Image source={{ uri: user.photo }} style={{ width: 48, height: 48, borderRadius: 24 }} />
          ) : (
            <View className="h-12 w-12 items-center justify-center rounded-full bg-brand/10">
              <Ionicons name="person-outline" size={22} color={palette.brand} />
            </View>
          )}
          <View className="flex-1">
            <Text className="font-sans-semibold text-headline text-fg">
              {user?.name ?? user?.email ?? "Not signed in"}
            </Text>
            {user?.name ? <Text className="font-sans text-label text-muted">{user.email}</Text> : null}
          </View>
        </Card>

        {fix ? (
          <Card className="mt-4 border-danger/40">
            <Text className="font-sans-semibold text-headline text-fg">{fix.title}</Text>
            <Text className="font-sans mt-1 text-body text-muted">{fix.detail}</Text>
            {fix.action ? (
              <View className="mt-4">
                <Button label={fix.action.label} onPress={fix.action.run} />
              </View>
            ) : null}
          </Card>
        ) : null}

        {status.pendingReview ? (
          <Card className="mt-4">
            <Text className="font-sans-semibold text-headline text-fg">
              Another device deleted {status.pendingReview.deletes} expenses
            </Text>
            <Text className="font-sans mt-1 text-body text-muted">
              That’s {Math.round((status.pendingReview.deletes / Math.max(1, status.pendingReview.total)) * 100)}% of
              what’s on this phone, so nothing has been removed yet. Apply the deletion here too, or
              keep this phone’s copy and put the expenses back everywhere?
            </Text>
            <View className="mt-4 gap-3">
              <Button label="Keep mine" onPress={() => void sync.keepLocalRows()} />
              <Button
                variant="danger"
                label="Apply the deletion"
                onPress={() => void sync.applyReviewedChanges()}
              />
            </View>
          </Card>
        ) : null}

        <View className="mt-6">
          <SectionTitle title="Backup" />
          <Card padded={false} className="overflow-hidden">
            <SettingsRow icon="cloud-outline" label="Status" value={backupSummary(status)} />
            <SettingsRow
              icon="time-outline"
              label="Last backed up"
              value={timeAgo(status.lastSyncAt)}
            />
            <SettingsRow
              icon="refresh-outline"
              label="Back up now"
              value={status.syncing ? "Working…" : undefined}
              onPress={status.syncing ? undefined : () => void sync.syncNow()}
            />
            <SettingsRow
              icon="grid-outline"
              label="Open in Google Sheets"
              onPress={status.spreadsheetId ? openSheet : undefined}
              showSeparator={false}
            />
          </Card>
        </View>

        <View className="mt-6">
          <SectionTitle title="Options" />
          <Card padded={false} className="overflow-hidden">
            <View className="min-h-[52px] flex-row items-center gap-3 px-4 py-3">
              <Ionicons name="sync-outline" size={20} color={palette.muted} />
              <View className="flex-1">
                <Text className="font-sans-medium text-body text-fg">Back up automatically</Text>
                <Text className="font-sans text-label text-muted">A few seconds after each change</Text>
              </View>
              <Toggle value={status.autoSync} onValueChange={sync.setAutoSync} />
            </View>
            <View className="ml-[52px] h-px bg-border" />
            <View className="min-h-[52px] flex-row items-center gap-3 px-4 py-3">
              <Ionicons name="copy-outline" size={20} color={palette.muted} />
              <View className="flex-1">
                <Text className="font-sans-medium text-body text-fg">Merge duplicates</Text>
                <Text className="font-sans text-label text-muted">
                  Same expense entered on two phones within 10 minutes
                </Text>
              </View>
              <Toggle value={status.dedupeEnabled} onValueChange={sync.setDedupeEnabled} />
            </View>
          </Card>
        </View>

        <View className="mt-6">
          <Card padded={false} className="overflow-hidden">
            <SettingsRow
              icon="log-out-outline"
              label={signingOut ? "Backing up before sign-out…" : "Sign out"}
              tone="danger"
              onPress={signingOut ? undefined : signOut}
              showSeparator={false}
            />
          </Card>
        </View>

        <Text className="font-sans mt-5 px-1 text-label text-muted">
          Your phone keeps the main copy of your expenses. The backup lives in a spreadsheet in your
          own Google Drive; the app can only access that one file. You can also remove access at
          myaccount.google.com/permissions.
        </Text>
      </ScrollView>
    </View>
  );
}
