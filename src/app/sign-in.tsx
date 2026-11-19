/**
 * The one-time sign-in (design §7, §15.1). Shown only while there is no
 * session; after that the app never shows it again until an explicit sign-out.
 */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type GoogleAccount, signIn, signOutOfGoogle } from "@/auth/google";
import { startSession } from "@/auth/session";
import { Button, Card } from "@/components/ui";
import { showSheet } from "@/lib/sheet";
import { isGoogleConfigured } from "@/constants/google";
import { usePalette } from "@/constants/palette";
import { useSession } from "@/providers/session-provider";
import { useDrizzle } from "@/queries/helper";
import { wipeLocalData } from "@/sync/local-repo";

const POINTS: { icon: string; text: string }[] = [
  { icon: "phone-portrait-outline", text: "Works offline — your phone keeps the main copy" },
  { icon: "cloud-done-outline", text: "Backed up to a Google Sheet in your own Drive" },
  { icon: "lock-closed-outline", text: "The app can only see the file it creates" },
];

const FAILURES: Record<string, string> = {
  network: "Couldn't reach Google. Check your connection and try again — signing in needs the internet once.",
  play_services: "Google Play services is missing or out of date on this phone.",
  no_drive_access:
    "Drive access is needed to back up your expenses. Please allow it when Google asks.",
  not_configured: "Google sign-in isn't set up in this build yet.",
  unknown: "Sign-in didn't work. Please try again.",
};

type Mismatch = { account: GoogleAccount; ownerEmail: string | null };

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const db = useDrizzle();
  const { refresh, skipForDevelopment } = useSession();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<Mismatch | null>(null);

  const begin = (account: GoogleAccount, adoptExistingData = false) => {
    const result = startSession(db, account, Date.now(), { adoptExistingData });
    if (!result.ok) {
      setMismatch({ account, ownerEmail: result.ownerEmail });
      return;
    }
    setMismatch(null);
    refresh(); // the route guard moves on to restore (or straight into the app)
  };

  const onContinue = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await signIn();
      if (result.ok) begin(result.account);
      else if (result.reason !== "cancelled" && result.reason !== "in_progress") {
        setError(FAILURES[result.reason] ?? FAILURES.unknown);
      }
    } finally {
      setBusy(false);
    }
  };

  const switchToOwnerAccount = async () => {
    setMismatch(null);
    await signOutOfGoogle({ revoke: false });
    await onContinue();
  };

  const removeAndContinue = (account: GoogleAccount) => {
    showSheet(
      "Remove this phone's data?",
      "It stays safe in the other account's Google Sheet. Only this phone's copy is removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove and continue",
          style: "destructive",
          onPress: () => {
            const wiped = wipeLocalData(db);
            if (!wiped.ok) {
              showSheet(
                "Not backed up yet",
                `${wiped.unsynced} change(s) on this phone haven't reached the other account's sheet. Sign in with that account first so nothing is lost.`,
              );
              return;
            }
            begin(account, true);
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + 48,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
      }}
    >
      <View className="flex-1">
        <View className="h-16 w-16 items-center justify-center rounded-2xl bg-brand">
          <Ionicons name="wallet-outline" size={32} color="#FFFFFF" />
        </View>

        <Text className="font-sans-bold mt-6 text-display text-fg">Track every rupee, safely</Text>
        <Text className="font-sans mt-2 text-body text-muted">
          Sign in once with Google. After that the app opens straight away — even offline.
        </Text>

        <View className="mt-8 gap-4">
          {POINTS.map((point) => (
            <View key={point.icon} className="flex-row items-center gap-3">
              <View className="h-9 w-9 items-center justify-center rounded-full bg-brand/10">
                <Ionicons name={point.icon as never} size={18} color={palette.brand} />
              </View>
              <Text className="font-sans-medium flex-1 text-body text-fg">{point.text}</Text>
            </View>
          ))}
        </View>

        {mismatch ? (
          <Card className="mt-8">
            <Text className="font-sans-semibold text-headline text-fg">
              This phone has someone else’s expenses
            </Text>
            <Text className="font-sans mt-1 text-body text-muted">
              The data here belongs to {mismatch.ownerEmail ?? "another Google account"}. What should
              happen to it?
            </Text>
            <View className="mt-4 gap-3">
              <Button
                label={`Sign in as ${mismatch.ownerEmail ?? "that account"}`}
                onPress={switchToOwnerAccount}
              />
              <Button
                variant="secondary"
                label={`Add it to ${mismatch.account.email}`}
                onPress={() => begin(mismatch.account, true)}
              />
              <Button
                variant="danger"
                label="Remove it from this phone"
                onPress={() => removeAndContinue(mismatch.account)}
              />
            </View>
          </Card>
        ) : null}

        {error ? (
          <View className="mt-6 flex-row items-start gap-2 rounded-2xl bg-danger/10 p-3">
            <Ionicons name="alert-circle-outline" size={18} color={palette.danger} />
            <Text className="font-sans flex-1 text-label text-danger">{error}</Text>
          </View>
        ) : null}
      </View>

      <View className="mt-10 gap-3">
        {mismatch ? null : (
          <Button label="Continue with Google" onPress={onContinue} loading={busy} />
        )}
        {__DEV__ && !isGoogleConfigured() ? (
          <Button
            variant="secondary"
            label="Skip for now (development build)"
            onPress={skipForDevelopment}
          />
        ) : null}
        <Text className="font-sans text-center text-caption text-muted">
          Your expenses are stored on this phone and in a spreadsheet in your Google Drive. They’re
          not end-to-end encrypted: Google, and anyone you share the sheet with, can read them.
        </Text>
      </View>
    </ScrollView>
  );
}
