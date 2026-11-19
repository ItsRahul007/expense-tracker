/**
 * Typed access to the `sync_state` key/value table: the signed-in session,
 * which spreadsheet this install syncs with, and sync bookkeeping. Design §9.3.
 *
 * Synchronous (drizzle's expo-sqlite driver is), so the root layout can read
 * the session during startup without waiting on anything.
 */
import { eq, inArray } from "drizzle-orm";

import { syncState } from "@/db/schema/schema";
import type { Db } from "@/queries/helper";

type Store = Pick<Db, "select" | "insert" | "delete">;

export type SyncErrorCode =
  | "offline"
  | "needs_reauth"
  | "scope"
  | "sheet_missing"
  | "schema_newer"
  | "sheet_damaged"
  | "rate_limited"
  | "server"
  | "local_apply_failed"
  | "unknown";

export type StoredError = { code: SyncErrorCode; message: string; at: number };

export type PendingReview = { deletes: number; total: number; at: number };

/** Every key, with its decoded type. Absent keys read as `null`. */
export type SyncStateValues = {
  device_id: string;
  /** Whose data this database holds — survives sign-out (design §7.7). */
  owner_user_id: string;
  owner_email: string;
  session_user_id: string;
  session_email: string;
  session_name: string;
  session_photo: string;
  session_signed_in_at: number;
  /** 'restoring' until the first restore/merge has been applied (design §8). */
  bootstrap: "restoring" | "ready";
  /** Bootstrap was skipped offline; the next successful sync is the restore. */
  restore_pending: boolean;
  spreadsheet_id: string;
  last_sync_at: number;
  /** `_meta` last-write stamp the sheet had after this device's last sync
   *  (see `metaStamp`); the fast path compares against it. */
  last_remote_version: string;
  last_error: StoredError;
  auto_sync: boolean;
  dedupe_enabled: boolean;
  pending_review: PendingReview;
  /** The Download/expense folder the user approved for CSV exports (an
   *  Android content URI with a persistable grant). Device-local. */
  export_dir_uri: string;
  /** yyyy-mm-dd of the last on-device snapshot (design §11.4). */
  last_snapshot_day: string;
};

export type SyncStateKey = keyof SyncStateValues;

const NUMBER_KEYS = new Set<SyncStateKey>(["session_signed_in_at", "last_sync_at"]);
const BOOLEAN_KEYS = new Set<SyncStateKey>(["restore_pending", "auto_sync", "dedupe_enabled"]);
const JSON_KEYS = new Set<SyncStateKey>(["last_error", "pending_review"]);

function decode<K extends SyncStateKey>(key: K, raw: string | null): SyncStateValues[K] | null {
  if (raw === null) return null;
  if (NUMBER_KEYS.has(key)) {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : null) as SyncStateValues[K] | null;
  }
  if (BOOLEAN_KEYS.has(key)) return (raw === "1") as SyncStateValues[K];
  if (JSON_KEYS.has(key)) {
    try {
      return JSON.parse(raw) as SyncStateValues[K];
    } catch {
      return null;
    }
  }
  return raw as SyncStateValues[K];
}

function encode<K extends SyncStateKey>(key: K, value: SyncStateValues[K]): string {
  if (BOOLEAN_KEYS.has(key)) return value ? "1" : "0";
  if (JSON_KEYS.has(key)) return JSON.stringify(value);
  return String(value);
}

export function getState<K extends SyncStateKey>(db: Store, key: K): SyncStateValues[K] | null {
  const row = db.select({ value: syncState.value }).from(syncState).where(eq(syncState.key, key)).get();
  return decode(key, row?.value ?? null);
}

/** `null` deletes the key. */
export function setState<K extends SyncStateKey>(db: Store, key: K, value: SyncStateValues[K] | null): void {
  if (value === null) {
    db.delete(syncState).where(eq(syncState.key, key)).run();
    return;
  }
  const encoded = encode(key, value);
  db.insert(syncState)
    .values({ key, value: encoded })
    .onConflictDoUpdate({ target: syncState.key, set: { value: encoded } })
    .run();
}

export function setStates(db: Store, values: Partial<{ [K in SyncStateKey]: SyncStateValues[K] | null }>): void {
  for (const [key, value] of Object.entries(values)) {
    setState(db, key as SyncStateKey, value as never);
  }
}

export function clearStates(db: Store, keys: SyncStateKey[]): void {
  if (keys.length) db.delete(syncState).where(inArray(syncState.key, keys)).run();
}

/** Defaults for keys that have one. */
export const isAutoSync = (db: Store) => getState(db, "auto_sync") ?? true;
export const isDedupeEnabled = (db: Store) => getState(db, "dedupe_enabled") ?? true;
