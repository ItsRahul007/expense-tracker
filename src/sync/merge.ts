/**
 * Merging the phone's data with the sheet's. Pure — design §10.
 *
 *  1. `resolve`  — per row, last edit wins; deletes vs edits by timestamp.
 *  2. (dedupe.ts runs on the result.)
 *  3. `repair`   — re-establish the app's invariants (no orphaned expenses,
 *                  default categories never deleted).
 *  4. `diffPlan` — what has to change locally and whether the sheet needs a
 *                  write, plus `row_history` entries for every local row that
 *                  is about to be overwritten or removed.
 *
 * Determinism matters more than anything else here: two devices merging the
 * same inputs must reach the same result, or they'd overwrite each other
 * forever. Every tie is broken by content, never by "who's asking".
 */
import type { ID } from "@/types/domain";

import type {
  BudgetRecord,
  CategoryRecord,
  Dataset,
  ExceptionRecord,
  SyncEntity,
  TombstoneRecord,
  TransactionRecord,
} from "./types";

// --- helpers ------------------------------------------------------------------

/** Stable serialisation of a flat record (keys sorted), for equality and ties. */
export function canonical(record: object): string {
  const entries = Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

const same = (a: object | undefined, b: object | undefined) =>
  a !== undefined && b !== undefined && canonical(a) === canonical(b);

type Versioned = { updatedAt: number };

/** Content that counts as "the row" for conflict purposes. `firstSyncedAt` is
 *  bookkeeping, not an edit, so it never decides a winner. */
function versionKey(row: object): string {
  const { firstSyncedAt: _ignored, ...rest } = row as { firstSyncedAt?: unknown };
  return canonical(rest);
}

/** The newer of two versions; exact timestamp ties go to the greater content. */
export function newer<T extends Versioned>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return versionKey(a) >= versionKey(b) ? a : b;
}

function laterTombstone(
  a: TombstoneRecord | undefined,
  b: TombstoneRecord | undefined,
): TombstoneRecord | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.deletedAt !== b.deletedAt) return a.deletedAt > b.deletedAt ? a : b;
  return canonical(a) >= canonical(b) ? a : b;
}

const minNonNull = (...values: (number | null | undefined)[]): number | null => {
  const present = values.filter((v): v is number => typeof v === "number");
  return present.length ? Math.min(...present) : null;
};

const tombKey = (entity: SyncEntity, id: ID) => `${entity}:${id}`;
const exceptionKey = (e: ExceptionRecord) => `${e.idA}|${e.idB}`;

function byId<T extends { id: ID }>(rows: T[]): Map<ID, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

// --- 1. resolve ---------------------------------------------------------------

export type ResolveOptions = {
  /** Epoch ms of this sync, used as `firstSyncedAt` for rows first seen now. */
  now: number;
  /** Tombstones older than this with no surviving row on either side are dropped. */
  tombstoneRetentionMs: number;
};

export const DEFAULT_TOMBSTONE_RETENTION_MS = 400 * 86_400_000;

/**
 * Combines the two datasets row by row:
 *  - a row on one side only is kept;
 *  - a row on both sides: the later `updatedAt` wins (§10.1);
 *  - a row vs a tombstone: the later timestamp wins — so an edit made after
 *    another device deleted the row brings it back, and a delete made after
 *    the last edit removes it;
 *  - tombstones are kept only for rows that end up deleted.
 */
export function resolve(local: Dataset, remote: Dataset, options: ResolveOptions): Dataset {
  const tombs = new Map<string, TombstoneRecord>();
  for (const t of [...local.tombstones, ...remote.tombstones]) {
    const key = tombKey(t.entity, t.id);
    tombs.set(key, laterTombstone(tombs.get(key), t)!);
  }

  const kept = new Map<string, TombstoneRecord>();

  function entity<T extends Versioned & { id: ID }>(
    name: SyncEntity,
    localRows: T[],
    remoteRows: T[],
    finish: (winner: T, localRow: T | undefined, remoteRow: T | undefined) => T,
  ): T[] {
    const l = byId(localRows);
    const r = byId(remoteRows);
    const out: T[] = [];
    for (const id of new Set([...l.keys(), ...r.keys()])) {
      const winner = newer(l.get(id), r.get(id))!;
      const tomb = tombs.get(tombKey(name, id));
      if (tomb && tomb.deletedAt >= winner.updatedAt) {
        kept.set(tombKey(name, id), tomb);
        continue;
      }
      out.push(finish(winner, l.get(id), r.get(id)));
    }
    return out;
  }

  const transactions = entity<TransactionRecord>(
    "transaction",
    local.transactions,
    remote.transactions,
    (winner, l, r) => ({
      ...winner,
      // Grow-only: the earliest time any device saw the row in the sheet. Seen
      // in this pull for the first time → now.
      firstSyncedAt: minNonNull(l?.firstSyncedAt, r?.firstSyncedAt, r ? options.now : null),
    }),
  );
  const categories = entity<CategoryRecord>("category", local.categories, remote.categories, (w) => w);
  const budgets = entity<BudgetRecord>("budget", local.budgets, remote.budgets, (w) => w);

  // Tombstones for rows neither side has any more (the normal state after a
  // delete has propagated) are kept until they age out.
  const live = new Set([
    ...transactions.map((t) => tombKey("transaction", t.id)),
    ...categories.map((c) => tombKey("category", c.id)),
    ...budgets.map((b) => tombKey("budget", b.id)),
  ]);
  for (const [key, tomb] of tombs) {
    if (kept.has(key) || live.has(key)) continue;
    if (tomb.deletedAt < options.now - options.tombstoneRetentionMs) continue;
    kept.set(key, tomb);
  }

  // Exceptions are grow-only: once the user says "not duplicates", it sticks.
  const exceptions = new Map<string, ExceptionRecord>();
  for (const e of [...local.exceptions, ...remote.exceptions]) {
    const prev = exceptions.get(exceptionKey(e));
    if (!prev || e.at < prev.at) exceptions.set(exceptionKey(e), e);
  }

  return {
    transactions,
    categories,
    budgets,
    tombstones: [...kept.values()],
    exceptions: [...exceptions.values()],
  };
}

// --- 3. repair ------------------------------------------------------------------

export const PLACEHOLDER_CATEGORY = {
  name: "Restored category",
  icon: "help-circle-outline",
  color: "#8A8F98",
};

export type RepairNote =
  | { kind: "category_resurrected"; id: ID }
  | { kind: "placeholder_category"; id: ID };

/**
 * Re-establishes invariants the database enforces, so applying the result
 * locally can't fail on a foreign key or a trigger (design §10.4):
 *
 *  - a category still referenced by an expense or budget is kept, even if a
 *    tombstone says otherwise — real spending is never orphaned;
 *  - a seeded default category is never deleted;
 *  - a reference to a category that exists nowhere gets a placeholder
 *    category under that id, rather than dropping the expense.
 *
 * `stamp` must return a fresh, increasing timestamp; it versions the repairs
 * so they win over the tombstones they override.
 */
export function repair(
  merged: Dataset,
  sources: { local: Dataset; remote: Dataset },
  stamp: () => number,
): { data: Dataset; notes: RepairNote[] } {
  const notes: RepairNote[] = [];
  const categories = byId(merged.categories);
  const tombstones = new Map(merged.tombstones.map((t) => [tombKey(t.entity, t.id), t]));

  // Every known version of a category, newest first, to resurrect from.
  const known = new Map<ID, CategoryRecord>();
  for (const c of [...sources.local.categories, ...sources.remote.categories]) {
    known.set(c.id, newer(known.get(c.id), c)!);
  }

  const revive = (id: ID, record: CategoryRecord, kind: RepairNote["kind"]) => {
    const tomb = tombstones.get(tombKey("category", id));
    const updatedAt = Math.max(stamp(), (tomb?.deletedAt ?? 0) + 1);
    categories.set(id, { ...record, updatedAt });
    tombstones.delete(tombKey("category", id));
    notes.push({ kind, id });
  };

  // Default categories: identical seeds on every device; never deleted.
  for (const c of known.values()) {
    if (c.isDefault && !categories.has(c.id)) revive(c.id, c, "category_resurrected");
  }

  const referenced = new Set<ID>([
    ...merged.transactions.map((t) => t.categoryId),
    ...merged.budgets.map((b) => b.categoryId),
  ]);
  let order = Math.max(0, ...[...categories.values()].map((c) => c.sortOrder));
  for (const id of referenced) {
    if (categories.has(id)) continue;
    const previous = known.get(id);
    if (previous) {
      revive(id, previous, "category_resurrected");
    } else {
      order += 1;
      revive(
        id,
        { id, ...PLACEHOLDER_CATEGORY, sortOrder: order, isDefault: false, updatedAt: 0 },
        "placeholder_category",
      );
    }
  }

  return {
    data: { ...merged, categories: [...categories.values()], tombstones: [...tombstones.values()] },
    notes,
  };
}

// --- 4. diff ------------------------------------------------------------------

export type HistoryEntry = {
  entity: SyncEntity;
  id: ID;
  /** The full local row before the change. */
  row: TransactionRecord | CategoryRecord | BudgetRecord;
  cause: "remote_newer" | "remote_delete" | "duplicate";
};

type EntityChanges<T> = { upsert: T[]; delete: ID[] };

export type LocalChanges = {
  transactions: EntityChanges<TransactionRecord>;
  categories: EntityChanges<CategoryRecord>;
  budgets: EntityChanges<BudgetRecord>;
  tombstones: { upsert: TombstoneRecord[]; delete: { entity: SyncEntity; id: ID }[] };
  exceptions: { upsert: ExceptionRecord[] };
};

/** Keys (`entity:id`, `tomb:entity:id`, `exc:a|b`) the sheet already holds at
 *  exactly the final version — those local rows can be marked clean. */
export type CleanSet = Set<string>;

export type MergePlan = {
  final: Dataset;
  local: LocalChanges;
  history: HistoryEntry[];
  clean: CleanSet;
  /** The sheet differs from `final` and needs a write. */
  sheetChanged: boolean;
  /** Local rows this plan deletes, per entity, and how many there were — for the
   *  mass-change brake (design §11.3). */
  localDeletes: Record<SyncEntity, number>;
  localCounts: Record<SyncEntity, number>;
};

export const rowKey = (entity: SyncEntity, id: ID) => `${entity}:${id}`;
export const tombCleanKey = (entity: SyncEntity, id: ID) => `tomb:${entity}:${id}`;
export const exceptionCleanKey = (e: ExceptionRecord) => `exc:${exceptionKey(e)}`;

export function diffPlan(local: Dataset, remote: Dataset, final: Dataset): MergePlan {
  const history: HistoryEntry[] = [];
  const clean: CleanSet = new Set();
  let sheetChanged = false;

  const finalTombs = new Map(final.tombstones.map((t) => [tombKey(t.entity, t.id), t]));

  function entity<T extends { id: ID }>(name: SyncEntity, l: T[], r: T[], f: T[]): EntityChanges<T> {
    const lm = byId(l);
    const rm = byId(r);
    const fm = byId(f);
    const changes: EntityChanges<T> = { upsert: [], delete: [] };

    for (const [id, row] of fm) {
      const localRow = lm.get(id);
      if (!same(localRow, row)) {
        changes.upsert.push(row);
        // Overwriting a real local version (not just stamping firstSyncedAt).
        if (localRow && versionKey(localRow) !== versionKey(row)) {
          history.push({ entity: name, id, row: localRow as never, cause: "remote_newer" });
        }
      }
      if (same(rm.get(id), row)) clean.add(rowKey(name, id));
      else sheetChanged = true;
    }

    for (const [id, row] of lm) {
      if (fm.has(id)) continue;
      changes.delete.push(id);
      const tomb = finalTombs.get(tombKey(name, id));
      history.push({
        entity: name,
        id,
        row: row as never,
        cause: tomb?.reason === "duplicate" ? "duplicate" : "remote_delete",
      });
    }

    for (const id of rm.keys()) if (!fm.has(id)) sheetChanged = true;
    return changes;
  }

  const transactions = entity("transaction", local.transactions, remote.transactions, final.transactions);
  const categories = entity("category", local.categories, remote.categories, final.categories);
  const budgets = entity("budget", local.budgets, remote.budgets, final.budgets);

  // Tombstones.
  const lt = new Map(local.tombstones.map((t) => [tombKey(t.entity, t.id), t]));
  const rt = new Map(remote.tombstones.map((t) => [tombKey(t.entity, t.id), t]));
  const tombstones: LocalChanges["tombstones"] = { upsert: [], delete: [] };
  for (const [key, t] of finalTombs) {
    if (!same(lt.get(key), t)) tombstones.upsert.push(t);
    if (same(rt.get(key), t)) clean.add(tombCleanKey(t.entity, t.id));
    else sheetChanged = true;
  }
  for (const [key, t] of lt) if (!finalTombs.has(key)) tombstones.delete.push({ entity: t.entity, id: t.id });
  for (const key of rt.keys()) if (!finalTombs.has(key)) sheetChanged = true;

  // Exceptions (grow-only).
  const le = new Set(local.exceptions.map(exceptionKey));
  const re = new Map(remote.exceptions.map((e) => [exceptionKey(e), e]));
  const exceptions: LocalChanges["exceptions"] = { upsert: [] };
  for (const e of final.exceptions) {
    if (!le.has(exceptionKey(e))) exceptions.upsert.push(e);
    if (same(re.get(exceptionKey(e)), e)) clean.add(exceptionCleanKey(e));
    else sheetChanged = true;
  }

  return {
    final,
    local: { transactions, categories, budgets, tombstones, exceptions },
    history,
    clean,
    sheetChanged,
    localDeletes: {
      transaction: transactions.delete.length,
      category: categories.delete.length,
      budget: budgets.delete.length,
    },
    localCounts: {
      transaction: local.transactions.length,
      category: local.categories.length,
      budget: local.budgets.length,
    },
  };
}
