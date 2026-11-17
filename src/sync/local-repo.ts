/**
 * The sync engine's view of SQLite: read everything syncable, and apply a
 * merge plan atomically. Design §10.3 steps 6, 9 and 11.
 *
 * Both functions are synchronous on purpose. The engine reads, merges and
 * applies in one synchronous stretch — no `await` in between — so the user
 * can't edit a row after it was read and before the plan for it is applied.
 */
import { and, count, eq, inArray } from "drizzle-orm";

import {
  budget,
  category,
  dedupeException,
  rowHistory,
  tombstone,
  transaction,
} from "@/db/schema/schema";
import type { Db } from "@/queries/helper";
import type { ID } from "@/types/domain";

import {
  exceptionCleanKey,
  type MergePlan,
  rowKey,
  tombCleanKey,
} from "./merge";
import type { Dataset, SyncEntity } from "./types";

type Store = Pick<Db, "select" | "insert" | "update" | "delete" | "transaction">;

/** SQLite's bound-parameter limit is 999 on older builds; stay well under it. */
const IN_CHUNK = 500;

function chunks<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function readLocal(db: Store): Dataset {
  return {
    transactions: db
      .select({
        id: transaction.id,
        amountMinor: transaction.amountMinor,
        categoryId: transaction.categoryId,
        occurredAt: transaction.occurredAt,
        note: transaction.note,
        createdAt: transaction.createdAt,
        createdDevice: transaction.createdDevice,
        firstSyncedAt: transaction.firstSyncedAt,
        updatedAt: transaction.updatedAt,
      })
      .from(transaction)
      .all(),
    categories: db
      .select({
        id: category.id,
        name: category.name,
        icon: category.icon,
        color: category.color,
        sortOrder: category.sortOrder,
        isDefault: category.isDefault,
        updatedAt: category.updatedAt,
      })
      .from(category)
      .all(),
    budgets: db
      .select({
        id: budget.id,
        categoryId: budget.categoryId,
        startMonth: budget.startMonth,
        endMonth: budget.endMonth,
        limitMinor: budget.limitMinor,
        createdAt: budget.createdAt,
        updatedAt: budget.updatedAt,
      })
      .from(budget)
      .all(),
    tombstones: db
      .select({
        entity: tombstone.entity,
        id: tombstone.id,
        deletedAt: tombstone.deletedAt,
        reason: tombstone.reason,
        mergedInto: tombstone.mergedInto,
        device: tombstone.device,
      })
      .from(tombstone)
      .all(),
    exceptions: db
      .select({ idA: dedupeException.idA, idB: dedupeException.idB, at: dedupeException.at })
      .from(dedupeException)
      .all(),
  };
}

/**
 * Removes this phone's copy of the data — for "Remove this phone's data and
 * continue" when a different account signs in (design §7.7). Deliberately
 * writes **no** tombstones: this is not a deletion the sheet or other devices
 * should hear about, only this phone letting go of its copy. Refuses while
 * anything is still unsynced, so it can never destroy the only copy.
 */
export function wipeLocalData(db: Store): { ok: true } | { ok: false; unsynced: number } {
  const unsynced = countUnsynced(db);
  if (unsynced > 0) return { ok: false, unsynced };
  db.transaction((tx) => {
    tx.delete(budget).run();
    tx.delete(transaction).run();
    tx.delete(category).where(eq(category.isDefault, false)).run();
    tx.delete(tombstone).run();
    tx.delete(dedupeException).run();
    tx.delete(rowHistory).run();
  });
  return { ok: true };
}

/** Rows, tombstones and exceptions changed here and not yet seen in the sheet. */
export function countUnsynced(db: Store): number {
  const n = (rows: { n: number }[]) => rows[0]?.n ?? 0;
  return (
    n(db.select({ n: count() }).from(transaction).where(eq(transaction.syncDirty, true)).all()) +
    n(db.select({ n: count() }).from(category).where(eq(category.syncDirty, true)).all()) +
    n(db.select({ n: count() }).from(budget).where(eq(budget.syncDirty, true)).all()) +
    n(db.select({ n: count() }).from(tombstone).where(eq(tombstone.syncDirty, true)).all()) +
    n(db.select({ n: count() }).from(dedupeException).where(eq(dedupeException.syncDirty, true)).all())
  );
}

/**
 * Applies a plan in one transaction, in foreign-key order. If anything throws
 * (a constraint, the default-category trigger), nothing is applied — including
 * the history rows — and the caller must not push.
 *
 * Dirty flags follow "clean only when observed" (design §10.2): a row ends up
 * clean only if the sheet already holds exactly the final version.
 */
export function applyPlan(db: Store, plan: MergePlan, now: number): void {
  const isClean = (key: string) => plan.clean.has(key);

  db.transaction((tx) => {
    // P3: keep every local version we're about to overwrite or remove.
    for (const h of plan.history) {
      tx.insert(rowHistory)
        .values({ entity: h.entity, id: h.id, rowJson: JSON.stringify(h.row), cause: h.cause, at: now })
        .run();
    }

    // Parents first.
    for (const c of plan.local.categories.upsert) {
      const values = { ...c, syncDirty: !isClean(rowKey("category", c.id)) };
      tx.insert(category).values(values).onConflictDoUpdate({ target: category.id, set: values }).run();
    }
    for (const b of plan.local.budgets.upsert) {
      const values = { ...b, syncDirty: !isClean(rowKey("budget", b.id)) };
      tx.insert(budget).values(values).onConflictDoUpdate({ target: budget.id, set: values }).run();
    }
    for (const t of plan.local.transactions.upsert) {
      const values = { ...t, syncDirty: !isClean(rowKey("transaction", t.id)) };
      tx.insert(transaction).values(values).onConflictDoUpdate({ target: transaction.id, set: values }).run();
    }

    // Children before parents on the way out.
    for (const ids of chunks(plan.local.transactions.delete)) {
      tx.delete(transaction).where(inArray(transaction.id, ids)).run();
    }
    for (const ids of chunks(plan.local.budgets.delete)) {
      tx.delete(budget).where(inArray(budget.id, ids)).run();
    }
    for (const ids of chunks(plan.local.categories.delete)) {
      tx.delete(category).where(inArray(category.id, ids)).run();
    }

    for (const t of plan.local.tombstones.upsert) {
      const values = { ...t, syncDirty: !isClean(tombCleanKey(t.entity, t.id)) };
      tx.insert(tombstone)
        .values(values)
        .onConflictDoUpdate({ target: [tombstone.entity, tombstone.id], set: values })
        .run();
    }
    for (const { entity, id } of plan.local.tombstones.delete) {
      tx.delete(tombstone).where(and(eq(tombstone.entity, entity), eq(tombstone.id, id))).run();
    }

    for (const e of plan.local.exceptions.upsert) {
      tx.insert(dedupeException)
        .values({ ...e, syncDirty: !isClean(exceptionCleanKey(e)) })
        .onConflictDoNothing()
        .run();
    }

    // Rows the plan didn't touch but the sheet now confirms. Guarded on the
    // version, so only the exact version the sheet holds is marked clean.
    markClean(tx, plan);
  });
}

function markClean(tx: Pick<Db, "update">, plan: MergePlan): void {
  const finalVersion = new Map<string, number>();
  for (const t of plan.final.transactions) finalVersion.set(rowKey("transaction", t.id), t.updatedAt);
  for (const c of plan.final.categories) finalVersion.set(rowKey("category", c.id), c.updatedAt);
  for (const b of plan.final.budgets) finalVersion.set(rowKey("budget", b.id), b.updatedAt);

  const tables = { transaction, category, budget } as const;

  for (const key of plan.clean) {
    if (key.startsWith("tomb:")) {
      const [, entity, ...rest] = key.split(":");
      tx.update(tombstone)
        .set({ syncDirty: false })
        .where(and(eq(tombstone.entity, entity as SyncEntity), eq(tombstone.id, rest.join(":"))))
        .run();
      continue;
    }
    if (key.startsWith("exc:")) {
      const [idA, idB] = key.slice(4).split("|");
      tx.update(dedupeException)
        .set({ syncDirty: false })
        .where(and(eq(dedupeException.idA, idA), eq(dedupeException.idB, idB)))
        .run();
      continue;
    }
    const [entity, ...rest] = key.split(":");
    const id: ID = rest.join(":");
    const table = tables[entity as SyncEntity];
    const version = finalVersion.get(key);
    if (!table || version === undefined) continue;
    tx.update(table)
      .set({ syncDirty: false })
      .where(and(eq(table.id, id), eq(table.updatedAt, version)))
      .run();
  }
}
