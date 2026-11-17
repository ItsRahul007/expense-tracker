/**
 * Cross-device duplicate detection — design §12. Pure.
 *
 * Runs on the merged dataset. Everything it produces is a function of the data
 * alone (no wall clock, no device id), so every device that runs it on the same
 * data produces byte-identical results and the devices never fight over which
 * copy survives.
 */
import type { ID } from "@/types/domain";

import type {
  BudgetRecord,
  CategoryRecord,
  Dataset,
  ExceptionRecord,
  TombstoneRecord,
  TransactionRecord,
} from "./types";

/** Entries made on different phones within this long of each other are the same expense. */
export const DUPLICATE_WINDOW_MS = 10 * 60_000;

/** `device` on tombstones written by dedupe — deterministic, unlike a real device id. */
export const DEDUPE_DEVICE = "dedupe";

export type DuplicateMerge = {
  entity: "transaction" | "category" | "budget";
  survivor: ID;
  duplicate: ID;
  /** For expenses: the duplicate as it was, so "Undo" can restore it even when
   *  it arrived from another phone and was never stored on this one. */
  row?: TransactionRecord;
};

export type DuplicateSuggestion = { a: TransactionRecord; b: TransactionRecord };

export type DedupeOptions = {
  windowMs?: number;
  /** Local calendar day for an `occurredAt`; injectable for tests. */
  dayKey?: (epochMs: number) => string;
  /** For suggestions only: "now", to judge rows not uploaded yet. */
  now: number;
};

export type DedupeResult = {
  data: Dataset;
  merges: DuplicateMerge[];
  /** Same expense, entered far apart, one phone offline — for the user to decide (§12.9 B). */
  suggestions: DuplicateSuggestion[];
};

export function localDayKey(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const pairKey = (a: ID, b: ID) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const exceptionSet = (exceptions: ExceptionRecord[]) =>
  new Set(exceptions.map((e) => pairKey(e.idA, e.idB)));

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function duplicateTombstone(
  entity: TombstoneRecord["entity"],
  id: ID,
  mergedInto: ID,
  deletedAt: number,
): TombstoneRecord {
  return { entity, id, deletedAt, reason: "duplicate", mergedInto, device: DEDUPE_DEVICE };
}

// --- categories (§12.8) --------------------------------------------------------

const normaliseName = (name: string) => name.trim().toLowerCase().replace(/[\s\-_]+/g, " ");

/**
 * Categories with the same name (ignoring case and spacing) but different ids
 * become one: a default category wins, otherwise the smaller id. The other's
 * expenses and budgets are re-pointed to it.
 */
function dedupeCategories(data: Dataset, merges: DuplicateMerge[]): Dataset {
  const groups = new Map<string, CategoryRecord[]>();
  for (const c of data.categories) {
    const key = normaliseName(c.name);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  const redirect = new Map<ID, ID>();
  const tombstones: TombstoneRecord[] = [];
  const dropped = new Set<ID>();

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [survivor, ...rest] = [...group].sort(
      (a, b) => Number(b.isDefault) - Number(a.isDefault) || cmp(a.id, b.id),
    );
    for (const dup of rest) {
      if (dup.isDefault) continue; // two defaults never merge
      redirect.set(dup.id, survivor.id);
      dropped.add(dup.id);
      tombstones.push(
        duplicateTombstone("category", dup.id, survivor.id, Math.max(dup.updatedAt, survivor.updatedAt) + 1),
      );
      merges.push({ entity: "category", survivor: survivor.id, duplicate: dup.id });
    }
  }
  if (redirect.size === 0) return data;

  const repoint = <T extends { categoryId: ID; updatedAt: number }>(row: T): T => {
    const to = redirect.get(row.categoryId);
    return to ? { ...row, categoryId: to, updatedAt: row.updatedAt + 1 } : row;
  };

  return {
    ...data,
    categories: data.categories.filter((c) => !dropped.has(c.id)),
    transactions: data.transactions.map(repoint),
    budgets: data.budgets.map(repoint),
    tombstones: [...data.tombstones, ...tombstones],
  };
}

// --- budgets (§12.8) -------------------------------------------------------------

/** Budgets with the same category and scope: the most recently saved one stays. */
function dedupeBudgets(data: Dataset, merges: DuplicateMerge[]): Dataset {
  const groups = new Map<string, BudgetRecord[]>();
  for (const b of data.budgets) {
    const key = `${b.categoryId}|${b.startMonth}|${b.endMonth ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }

  const dropped = new Set<ID>();
  const tombstones: TombstoneRecord[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [survivor, ...rest] = [...group].sort(
      (a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || cmp(a.id, b.id),
    );
    for (const dup of rest) {
      dropped.add(dup.id);
      tombstones.push(
        duplicateTombstone("budget", dup.id, survivor.id, Math.max(dup.updatedAt, survivor.updatedAt) + 1),
      );
      merges.push({ entity: "budget", survivor: survivor.id, duplicate: dup.id });
    }
  }
  if (dropped.size === 0) return data;
  return {
    ...data,
    budgets: data.budgets.filter((b) => !dropped.has(b.id)),
    tombstones: [...data.tombstones, ...tombstones],
  };
}

// --- expenses (§12.2 – §12.4) -----------------------------------------------------

type Cluster = { survivor: TransactionRecord; members: TransactionRecord[]; devices: Set<string> };

const entryOrder = (a: TransactionRecord, b: TransactionRecord) =>
  a.createdAt - b.createdAt || cmp(a.createdDevice, b.createdDevice) || cmp(a.id, b.id);

function groupCandidates(
  transactions: TransactionRecord[],
  dayKey: (ms: number) => string,
): TransactionRecord[][] {
  const groups = new Map<string, TransactionRecord[]>();
  for (const t of transactions) {
    // Rule 2: pre-sync data can't have been entered on two devices.
    if (t.createdDevice === "legacy") continue;
    // Rules 3–5: same category, same amount, same calendar day.
    const key = `${t.categoryId}|${t.amountMinor}|${dayKey(t.occurredAt)}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort(entryOrder));
}

/**
 * One-to-one matching across devices within the window (§12.3): each cluster
 * holds at most one entry per device, so two coffees on one phone stay two,
 * and "A entered 2, B entered 1" gives 2.
 */
function clusterGroup(group: TransactionRecord[], windowMs: number, exceptions: Set<string>): Cluster[] {
  const clusters: Cluster[] = [];
  for (const row of group) {
    const home = clusters.find(
      (c) =>
        !c.devices.has(row.createdDevice) && // rule 1
        Math.abs(row.createdAt - c.survivor.createdAt) <= windowMs && // rule 6
        c.members.every((m) => !exceptions.has(pairKey(m.id, row.id))), // rule 7
    );
    if (home) {
      home.members.push(row);
      home.devices.add(row.createdDevice);
    } else {
      clusters.push({ survivor: row, members: [row], devices: new Set([row.createdDevice]) });
    }
  }
  return clusters;
}

/** §12.4: the survivor keeps its own fields; it adopts a note when it has none,
 *  or when a duplicate's note was written later. Versioned deterministically. */
function mergeInto(survivor: TransactionRecord, duplicates: TransactionRecord[]): TransactionRecord {
  let note = survivor.note;
  let noteAt = note ? survivor.updatedAt : -Infinity;
  for (const dup of [...duplicates].sort((a, b) => a.updatedAt - b.updatedAt || cmp(a.id, b.id))) {
    if (dup.note && dup.updatedAt > noteAt) {
      note = dup.note;
      noteAt = dup.updatedAt;
    }
  }
  if (note === survivor.note) return survivor;
  const updatedAt = Math.max(survivor.updatedAt, ...duplicates.map((d) => d.updatedAt)) + 1;
  return { ...survivor, note, updatedAt };
}

/** "Uploaded late" = its first upload came more than a window after it was
 *  entered, or it still hasn't been uploaded that long after (§12.9 B). */
function uploadedLate(t: TransactionRecord, windowMs: number, now: number): boolean {
  const seen = t.firstSyncedAt ?? now;
  return seen - t.createdAt > windowMs;
}

export function dedupe(input: Dataset, options: DedupeOptions): DedupeResult {
  const windowMs = options.windowMs ?? DUPLICATE_WINDOW_MS;
  const dayKey = options.dayKey ?? localDayKey;
  const merges: DuplicateMerge[] = [];

  let data = dedupeCategories(input, merges);
  data = dedupeBudgets(data, merges);

  const exceptions = exceptionSet(data.exceptions);
  const replaced = new Map<ID, TransactionRecord>();
  const dropped = new Set<ID>();
  const tombstones: TombstoneRecord[] = [];
  const suggestions: DuplicateSuggestion[] = [];

  for (const group of groupCandidates(data.transactions, dayKey)) {
    const clusters = clusterGroup(group, windowMs, exceptions);

    for (const cluster of clusters) {
      const duplicates = cluster.members.filter((m) => m !== cluster.survivor);
      if (duplicates.length === 0) continue;
      const survivor = mergeInto(cluster.survivor, duplicates);
      if (survivor !== cluster.survivor) replaced.set(survivor.id, survivor);
      for (const dup of duplicates) {
        dropped.add(dup.id);
        tombstones.push(
          duplicateTombstone("transaction", dup.id, survivor.id, Math.max(dup.updatedAt, survivor.updatedAt) + 1),
        );
        merges.push({ entity: "transaction", survivor: survivor.id, duplicate: dup.id, row: dup });
      }
    }

    // What's left after auto-merging: possible duplicates across devices that
    // were entered too far apart to be sure about.
    const survivors = clusters.map((c) => replaced.get(c.survivor.id) ?? c.survivor);
    for (let i = 0; i < survivors.length; i++) {
      for (let j = i + 1; j < survivors.length; j++) {
        const [a, b] = [survivors[i], survivors[j]];
        if (a.createdDevice === b.createdDevice) continue;
        if (exceptions.has(pairKey(a.id, b.id))) continue;
        if (!uploadedLate(a, windowMs, options.now) && !uploadedLate(b, windowMs, options.now)) continue;
        suggestions.push({ a, b });
      }
    }
  }

  if (dropped.size === 0 && replaced.size === 0) {
    return { data, merges, suggestions };
  }

  return {
    data: {
      ...data,
      transactions: data.transactions
        .filter((t) => !dropped.has(t.id))
        .map((t) => replaced.get(t.id) ?? t),
      tombstones: [
        // A row that was deleted as a duplicate and later edited back to life
        // may already have an older tombstone; the new one replaces it.
        ...data.tombstones.filter((t) => !(t.entity === "transaction" && dropped.has(t.id))),
        ...tombstones,
      ],
    },
    merges,
    suggestions,
  };
}

/** The exception record for "these two are not duplicates" (Undo / Keep both). */
export function notDuplicate(a: ID, b: ID, at: number): ExceptionRecord {
  return a < b ? { idA: a, idB: b, at } : { idA: b, idB: a, at };
}
