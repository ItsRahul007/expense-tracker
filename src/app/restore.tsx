/**
 * Bootstrap after sign-in (design §8): find this account's backup, merge it
 * into the phone, and only then open the app — so after a reinstall everything
 * is already there on the first screen.
 */
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { signOutOfGoogle } from "@/auth/google";
import { endSession, finishBootstrap } from "@/auth/session";
import { Button } from "@/components/ui";
import { usePalette } from "@/constants/palette";
import { useSession } from "@/providers/session-provider";
import { useSync } from "@/providers/sync-provider";
import { useDrizzle } from "@/queries/helper";
import type { SyncOutcome } from "@/sync/engine";

type Phase =
  | { kind: "working" }
  | { kind: "failed"; title: string; detail: string; canContinueOffline: boolean; reauth: boolean };

function describe(outcome: SyncOutcome): Phase | null {
  if (outcome.status === "synced" || outcome.status === "skipped") return null;
  // A large deletion pending review isn't a reason to hold the user here; the
  // review is waiting on the Account screen.
  if (outcome.status === "needs_confirmation") return null;

  const { code, message } = outcome.error;
  switch (code) {
    case "offline":
      return {
        kind: "failed",
        title: "Can't reach Google right now",
        detail: "Your backup will be restored automatically as soon as you're back online.",
        canContinueOffline: true,
        reauth: false,
      };
    case "needs_reauth":
    case "scope":
      return {
        kind: "failed",
        title: "Google needs you to sign in again",
        detail: "Drive access is needed to restore your backup.",
        canContinueOffline: false,
        reauth: true,
      };
    case "schema_newer":
      return {
        kind: "failed",
        title: "Update the app to restore",
        detail: "Your backup was saved by a newer version of the app.",
        canContinueOffline: true,
        reauth: false,
      };
    default:
      return {
        kind: "failed",
        title: "Couldn't restore your backup",
        detail: message,
        canContinueOffline: true,
        reauth: false,
      };
  }
}

export default function RestoreScreen() {
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const db = useDrizzle();
  const { session, refresh } = useSession();
  const { connect } = useSync();
  const [phase, setPhase] = useState<Phase>({ kind: "working" });
  const started = useRef(false);

  const attempt = async () => {
    setPhase({ kind: "working" });
    const outcome = await connect();
    const failure = describe(outcome);
    if (failure) {
      setPhase(failure);
      return;
    }
    finishBootstrap(db, { restorePending: false });
    refresh(); // guard flips → the app opens with the data already in place
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const continueOffline = () => {
    finishBootstrap(db, { restorePending: true });
    refresh();
  };

  const signInAgain = async () => {
    await signOutOfGoogle({ revoke: false });
    endSession(db);
    refresh();
  };

  return (
    <View
      className="flex-1 bg-bg px-6"
      style={{ paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }}
    >
      <View className="flex-1 items-center justify-center">
        {phase.kind === "working" ? (
          <>
            <ActivityIndicator size="large" color={palette.brand} />
            <Text className="font-sans-semibold mt-6 text-title text-fg">Setting up your data…</Text>
            <Text className="font-sans mt-2 text-center text-body text-muted">
              Looking for your backup{session.user?.email ? ` in ${session.user.email}` : ""} and
              bringing it onto this phone.
            </Text>
          </>
        ) : (
          <>
            <View className="h-14 w-14 items-center justify-center rounded-full bg-danger/10">
              <Ionicons name="cloud-offline-outline" size={28} color={palette.danger} />
            </View>
            <Text className="font-sans-semibold mt-6 text-center text-title text-fg">
              {phase.title}
            </Text>
            <Text className="font-sans mt-2 text-center text-body text-muted">{phase.detail}</Text>
          </>
        )}
      </View>

      {phase.kind === "failed" ? (
        <View className="gap-3">
          {phase.reauth ? (
            <Button label="Sign in again" onPress={signInAgain} />
          ) : (
            <Button label="Try again" onPress={attempt} />
          )}
          {phase.canContinueOffline ? (
            <Button variant="secondary" label="Continue offline" onPress={continueOffline} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
