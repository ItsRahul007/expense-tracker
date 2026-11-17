/**
 * Change tracking for local writes — what every syncable mutation in
 * src/queries/live.ts uses so the sync engine can later tell what changed,
 * when, where, and what was deleted (design §9.6).
 *
 * Nothing here talks to the network. It only records facts in SQLite, so it's
 * safe and inert while the user has never connected a Google account.
 */
import { eq } from "drizzle-orm";

import type { Db } from "@/queries/helper";
import { syncState, tombstone } from "@/db/schema/schema";
import type { ID } from "@/types/domain";

import { nextStamp } from "./clock";

/** Anything that can run Drizzle statements: the database or a transaction. */
type Writer = Pick<Db, "insert" | "select">;

export type SyncEntity = "transaction" | "category" | "budget";

// --- this install's identity -------------------------------------------------

let cachedDeviceId: string | null = null;

function makeDeviceId(): string {
  return `d-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * A random id for this install, created on first use and kept in `sync_state`.
 * It distinguishes "entered on another phone" from "entered twice on this one"
 * in duplicate detection, and breaks exact timestamp ties deterministically.
 *
 * Synchronous on purpose: mutations run it inside `db.transaction`, which in
 * drizzle's expo-sqlite driver is synchronous.
 */
export function getDeviceId(db: Writer): string {
  if (cachedDeviceId) return cachedDeviceId;

  const row = db
    .select({ value: syncState.value })
    .from(syncState)
    .where(eq(syncState.key, "device_id"))
    .get();

  if (row?.value) {
    cachedDeviceId = row.value;
    return row.value;
  }

  const id = makeDeviceId();
  // `onConflictDoNothing` + re-read: if two writes race to create it, both end
  // up using whichever landed first.
  db.insert(syncState)
    .values({ key: "device_id", value: id })
    .onConflictDoNothing()
    .run();
  const stored = db
    .select({ value: syncState.value })
    .from(syncState)
    .where(eq(syncState.key, "device_id"))
    .get();
  cachedDeviceId = stored?.value ?? id;
  return cachedDeviceId;
}

// --- stamps ---------------------------------------------------------------

/** Columns for a brand-new expense row. */
export function newTransactionStamp(db: Writer) {
  const now = nextStamp();
  return {
    createdAt: now,
    createdDevice: getDeviceId(db),
    updatedAt: now,
    syncDirty: true,
  };
}

/** Columns for any other insert or edit (categories, budgets, expense edits). */
export function editStamp() {
  return { updatedAt: nextStamp(), syncDirty: true };
}

// --- deletions ------------------------------------------------------------

/**
 * Records that rows were deleted so the deletion can reach other devices.
 * Call it in the *same* `db.transaction` as the delete itself, so a failed
 * delete (FK, the default-category trigger) leaves no tombstone behind.
 *
 * Re-deleting an id refreshes its tombstone rather than failing.
 */
export function recordDeletions(
  db: Writer,
  entity: SyncEntity,
  ids: readonly ID[],
  options: { reason?: "user" | "duplicate"; mergedInto?: ID } = {},
): void {
  if (ids.length === 0) return;

  const device = getDeviceId(db);
  const reason = options.reason ?? "user";
  const mergedInto = options.mergedInto ?? null;

  for (const id of ids) {
    const deletedAt = nextStamp();
    db.insert(tombstone)
      .values({ entity, id, deletedAt, reason, mergedInto, device, syncDirty: true })
      .onConflictDoUpdate({
        target: [tombstone.entity, tombstone.id],
        set: { deletedAt, reason, mergedInto, device, syncDirty: true },
      })
      .run();
  }
}

/** Test-only: forget the cached device id. */
export function resetDeviceIdForTests(): void {
  cachedDeviceId = null;
}
