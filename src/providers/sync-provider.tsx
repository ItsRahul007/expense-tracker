/**
 * Runs the sync engine for the app: when to sync (design §10.6), what the UI
 * can show about it, and the user's answers to prompts (mass-change review,
 * duplicates, deleted sheet).
 *
 * Sync is strictly background work. Nothing here ever blocks a screen, and a
 * failure only changes `status` — the phone's data and the session are never
 * touched by an error (design §3).
 */
import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useSQLiteContext } from "expo-sqlite";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { googleTokens, isSignInSupported } from "@/auth/google";
import { useDrizzle } from "@/queries/helper";
import type { DuplicateMerge, DuplicateSuggestion } from "@/sync/dedupe";
import { keepBoth, mergePair, undoMerge } from "@/sync/duplicates";
import { createSyncEngine, type SyncOutcome } from "@/sync/engine";
import { createDriveClient, createHttp, createSheetsClient } from "@/sync/google-api";
import { countUnsynced } from "@/sync/local-repo";
import { onLocalChange } from "@/sync/local-changes";
import { takeSnapshot } from "@/sync/snapshots";
import {
  getState,
  isAutoSync,
  isDedupeEnabled,
  type PendingReview,
  setState,
  type StoredError,
} from "@/sync/state";

import { useSession } from "./session-provider";

/** Wait this long after the last local write before syncing (batches typing). */
const DEBOUNCE_MS = 3_000;
/** While the app is open, sync at least this often. */
const INTERVAL_MS = 5 * 60_000;
/** After a failure that will probably clear up by itself (no network, rate
 *  limit, Google having a moment), try again on this backoff: 10 s, 20 s, 40 s
 *  … capped at 2 min, until a sync succeeds. Without it, an expense saved
 *  offline would wait for the next edit, app switch or 5-minute tick. */
const RETRY_BASE_MS = 10_000;
const RETRY_MAX_MS = 2 * 60_000;
const TRANSIENT = new Set(["offline", "rate_limited", "server"]);

export type SyncStatus = {
  syncing: boolean;
  connected: boolean;
  spreadsheetId: string | null;
  lastSyncAt: number | null;
  lastError: StoredError | null;
  /** Changes on this phone not yet confirmed in the sheet. */
  unsynced: number;
  pendingReview: PendingReview | null;
  /** Possible duplicates for the user to decide on (design §12.9 B). */
  suggestions: DuplicateSuggestion[];
  /** Expense merges from the latest sync, for the "Merged · Undo" notice. */
  recentMerges: DuplicateMerge[];
  autoSync: boolean;
  dedupeEnabled: boolean;
};

type SyncContextValue = {
  status: SyncStatus;
  syncNow: () => Promise<SyncOutcome | null>;
  /** Bootstrap: find or create this account's sheet and merge with it. */
  connect: () => Promise<SyncOutcome>;
  recreateSheet: () => Promise<SyncOutcome>;
  /** Mass-change review answers. */
  applyReviewedChanges: () => Promise<SyncOutcome>;
  keepLocalRows: () => Promise<SyncOutcome>;
  undoMerges: () => void;
  dismissMerges: () => void;
  resolveSuggestion: (suggestion: DuplicateSuggestion, answer: { merge: false } | { merge: true; keepNoteFrom: string }) => void;
  setAutoSync: (on: boolean) => void;
  setDedupeEnabled: (on: boolean) => void;
};

const SyncContext = createContext<SyncContextValue | null>(null);

const pairKey = (s: DuplicateSuggestion) => [s.a.id, s.b.id].sort().join("|");

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const db = useDrizzle();
  const raw = useSQLiteContext();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const ready = session.status === "ready";

  const engine = useMemo(() => {
    const http = createHttp(googleTokens);
    return createSyncEngine({
      db,
      drive: createDriveClient(http),
      sheets: createSheetsClient(http),
      appVersion: Constants.expoConfig?.version ?? "unknown",
      snapshot: () => takeSnapshot(raw),
    });
  }, [db, raw]);

  const readStored = useCallback(
    () => ({
      connected: !!getState(db, "spreadsheet_id"),
      spreadsheetId: getState(db, "spreadsheet_id"),
      lastSyncAt: getState(db, "last_sync_at"),
      lastError: getState(db, "last_error"),
      unsynced: countUnsynced(db),
      pendingReview: getState(db, "pending_review"),
      autoSync: isAutoSync(db),
      dedupeEnabled: isDedupeEnabled(db),
    }),
    [db],
  );

  const [status, setStatus] = useState<SyncStatus>(() => ({
    ...readStored(),
    syncing: false,
    suggestions: [],
    recentMerges: [],
  }));

  const refresh = useCallback(() => setStatus((s) => ({ ...s, ...readStored() })), [readStored]);

  const retry = useRef<{ timer: ReturnType<typeof setTimeout> | null; attempt: number }>({
    timer: null,
    attempt: 0,
  });
  const retrySync = useRef<() => void>(() => {});

  const scheduleRetry = useCallback(
    (outcome: SyncOutcome) => {
      const state = retry.current;
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      if (outcome.status !== "error" || !TRANSIENT.has(outcome.error.code)) {
        state.attempt = 0;
        return;
      }
      const delay = Math.min(RETRY_BASE_MS * 2 ** state.attempt, RETRY_MAX_MS);
      state.attempt += 1;
      state.timer = setTimeout(() => retrySync.current(), delay);
    },
    [],
  );

  useEffect(
    () => () => {
      if (retry.current.timer) clearTimeout(retry.current.timer);
    },
    [],
  );

  const afterOutcome = useCallback(
    (outcome: SyncOutcome) => {
      scheduleRetry(outcome);
      if (outcome.status === "synced") {
        // Synced rows can touch every cached query.
        if (outcome.applied > 0) queryClient.invalidateQueries();
        const merges = outcome.merges.filter((m) => m.entity === "transaction");
        setStatus((s) => ({
          ...s,
          ...readStored(),
          syncing: false,
          suggestions: outcome.suggestions,
          recentMerges: merges.length ? merges : s.recentMerges,
        }));
      } else {
        setStatus((s) => ({ ...s, ...readStored(), syncing: false }));
      }
      return outcome;
    },
    [queryClient, readStored, scheduleRetry],
  );

  const run = useCallback(
    async (task: () => Promise<SyncOutcome>) => {
      setStatus((s) => ({ ...s, syncing: true }));
      try {
        return afterOutcome(await task());
      } catch (error) {
        // The engine returns errors as values; this is only a safety net.
        console.warn("sync failed unexpectedly", error);
        setStatus((s) => ({ ...s, ...readStored(), syncing: false }));
        throw error;
      }
    },
    [afterOutcome, readStored],
  );

  const syncNow = useCallback(async () => {
    if (!ready || !isSignInSupported()) return null;
    return run(() => engine.syncOnce());
  }, [ready, run, engine]);

  // --- triggers ------------------------------------------------------------

  // Timers and listeners call the latest syncNow without re-subscribing.
  const syncRef = useRef(syncNow);
  useEffect(() => {
    syncRef.current = syncNow;
    retrySync.current = () => {
      if (isAutoSync(db)) void syncNow();
    };
  }, [syncNow, db]);

  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = onLocalChange(() => {
      setStatus((s) => ({ ...s, unsynced: countUnsynced(db) }));
      if (!isAutoSync(db)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void syncRef.current(), DEBOUNCE_MS);
    });

    const appState = AppState.addEventListener("change", (next) => {
      if (!isAutoSync(db)) return;
      if (next === "active") void syncRef.current();
      // Going to the background with unsaved changes: one attempt within the
      // grace period the OS gives us.
      if (next === "background" && countUnsynced(db) > 0) void syncRef.current();
    });

    const interval = setInterval(() => {
      if (AppState.currentState === "active" && isAutoSync(db)) void syncRef.current();
    }, INTERVAL_MS);

    // On launch (and right after bootstrap finishes).
    if (isAutoSync(db)) void syncRef.current();

    return () => {
      unsubscribe();
      appState.remove();
      clearInterval(interval);
      if (timer) clearTimeout(timer);
    };
  }, [ready, db]);

  // --- actions -------------------------------------------------------------

  const value = useMemo<SyncContextValue>(
    () => ({
      status,
      syncNow,
      connect: () => run(async () => (await engine.connect()).outcome),
      recreateSheet: () => run(() => engine.recreateSheet()),
      applyReviewedChanges: () => run(() => engine.syncOnce({ confirmMassChange: true })),
      keepLocalRows: () => run(() => engine.keepLocalRows()),
      undoMerges: () => {
        for (const merge of status.recentMerges) {
          undoMerge(db, merge.survivor, merge.duplicate, merge.row, merge.survivorBefore);
        }
        setStatus((s) => ({ ...s, recentMerges: [] }));
        queryClient.invalidateQueries();
        void syncNow();
      },
      dismissMerges: () => setStatus((s) => ({ ...s, recentMerges: [] })),
      resolveSuggestion: (suggestion, answer) => {
        if (answer.merge) mergePair(db, suggestion.a, suggestion.b, answer.keepNoteFrom);
        else keepBoth(db, suggestion.a.id, suggestion.b.id);
        setStatus((s) => ({
          ...s,
          suggestions: s.suggestions.filter((x) => pairKey(x) !== pairKey(suggestion)),
        }));
        queryClient.invalidateQueries();
        void syncNow();
      },
      setAutoSync: (on) => {
        setState(db, "auto_sync", on);
        refresh();
        if (on) void syncNow();
      },
      setDedupeEnabled: (on) => {
        setState(db, "dedupe_enabled", on);
        refresh();
      },
    }),
    [status, syncNow, run, engine, db, queryClient, refresh],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error("useSync must be used inside <SyncProvider>");
  return value;
}
