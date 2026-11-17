import {
  DEFAULT_TOMBSTONE_RETENTION_MS,
  diffPlan,
  newer,
  PLACEHOLDER_CATEGORY,
  repair,
  resolve,
  rowKey,
} from "../merge";
import type {
  CategoryRecord,
  Dataset,
  TombstoneRecord,
  TransactionRecord,
} from "../types";
import { emptyDataset } from "../types";

const NOW = 1_800_000_000_000;
const OPTS = { now: NOW, tombstoneRetentionMs: DEFAULT_TOMBSTONE_RETENTION_MS };

const tx = (id: string, over: Partial<TransactionRecord> = {}): TransactionRecord => ({
  id,
  amountMinor: 100,
  categoryId: "c-food",
  occurredAt: 1_000,
  note: null,
  createdAt: 1_000,
  createdDevice: "d-a",
  firstSyncedAt: null,
  updatedAt: 1_000,
  ...over,
});

const cat = (id: string, over: Partial<CategoryRecord> = {}): CategoryRecord => ({
  id,
  name: id,
  icon: "cart",
  color: "#000",
  sortOrder: 1,
  isDefault: false,
  updatedAt: 1_000,
  ...over,
});

const tomb = (entity: TombstoneRecord["entity"], id: string, deletedAt: number): TombstoneRecord => ({
  entity,
  id,
  deletedAt,
  reason: "user",
  mergedInto: null,
  device: "d-b",
});

const ds = (over: Partial<Dataset> = {}): Dataset => ({ ...emptyDataset(), categories: [cat("c-food")], ...over });

describe("newer", () => {
  it("prefers the later updatedAt", () => {
    expect(newer(tx("t", { updatedAt: 2, note: "a" }), tx("t", { updatedAt: 3, note: "b" }))?.note).toBe("b");
  });

  it("breaks exact ties by content, the same way from either side", () => {
    const a = tx("t", { note: "a" });
    const b = tx("t", { note: "b" });
    expect(newer(a, b)).toBe(newer(b, a));
  });

  it("ignores firstSyncedAt when breaking ties", () => {
    const a = tx("t", { firstSyncedAt: 5 });
    const b = tx("t", { firstSyncedAt: null });
    expect(newer(a, b)).toBe(a);
    expect(newer(b, a)).toBe(b);
  });
});

describe("resolve", () => {
  it("keeps rows that exist on only one side", () => {
    const out = resolve(ds({ transactions: [tx("t-local")] }), ds({ transactions: [tx("t-remote")] }), OPTS);
    expect(out.transactions.map((t) => t.id).sort()).toEqual(["t-local", "t-remote"]);
  });

  it("last edit wins, in either direction", () => {
    const local = ds({ transactions: [tx("t", { amountMinor: 1, updatedAt: 10 })] });
    const remote = ds({ transactions: [tx("t", { amountMinor: 2, updatedAt: 20 })] });
    expect(resolve(local, remote, OPTS).transactions[0].amountMinor).toBe(2);
    expect(resolve(remote, local, OPTS).transactions[0].amountMinor).toBe(2);
  });

  it("a delete newer than the last edit removes the row and keeps the tombstone", () => {
    const local = ds({ transactions: [tx("t", { updatedAt: 10 })] });
    const remote = ds({ tombstones: [tomb("transaction", "t", 20)] });
    const out = resolve(local, remote, OPTS);
    expect(out.transactions).toEqual([]);
    expect(out.tombstones).toEqual([tomb("transaction", "t", 20)]);
  });

  it("an edit newer than the delete brings the row back and drops the tombstone", () => {
    const local = ds({ transactions: [tx("t", { updatedAt: 30 })] });
    const remote = ds({ tombstones: [tomb("transaction", "t", 20)] });
    const out = resolve(local, remote, OPTS);
    expect(out.transactions.map((t) => t.id)).toEqual(["t"]);
    expect(out.tombstones).toEqual([]);
  });

  it("stamps firstSyncedAt when a row is first seen in the sheet, and keeps the earliest", () => {
    const local = ds({ transactions: [tx("seen-now"), tx("seen-before", { firstSyncedAt: 50 }), tx("local-only")] });
    const remote = ds({ transactions: [tx("seen-now"), tx("seen-before", { firstSyncedAt: 40 })] });
    const out = new Map(resolve(local, remote, OPTS).transactions.map((t) => [t.id, t.firstSyncedAt]));
    expect(out.get("seen-now")).toBe(NOW);
    expect(out.get("seen-before")).toBe(40);
    expect(out.get("local-only")).toBeNull();
  });

  it("drops tombstones past retention only when no row survives anywhere", () => {
    const old = NOW - DEFAULT_TOMBSTONE_RETENTION_MS - 1;
    const out = resolve(ds({ tombstones: [tomb("budget", "b-old", old), tomb("budget", "b-new", NOW - 1)] }), ds(), OPTS);
    expect(out.tombstones.map((t) => t.id)).toEqual(["b-new"]);
  });

  // `firstSyncedAt` is deliberately asymmetric (it records when the *sheet*
  // side was first seen), so it's left out of the symmetry check.
  it("is commutative (apart from firstSyncedAt) and idempotent", () => {
    const a = ds({
      transactions: [tx("t1", { updatedAt: 5 }), tx("t2", { updatedAt: 9, note: "a" })],
      tombstones: [tomb("transaction", "t3", NOW - 7)],
      exceptions: [{ idA: "x", idB: "y", at: 3 }],
    });
    const b = ds({
      transactions: [tx("t2", { updatedAt: 9, note: "b" }), tx("t3", { updatedAt: NOW - 8 })],
      exceptions: [{ idA: "x", idB: "y", at: 1 }],
    });
    const sort = (d: Dataset) => JSON.stringify({
      t: [...d.transactions]
        .map(({ firstSyncedAt: _f, ...rest }) => rest)
        .sort((x, y) => (x.id < y.id ? -1 : 1)),
      s: [...d.tombstones].sort((x, y) => (x.id < y.id ? -1 : 1)),
      e: d.exceptions,
    });
    const ab = resolve(a, b, OPTS);
    expect(sort(ab)).toBe(sort(resolve(b, a, OPTS)));
    expect(sort(resolve(ab, ab, OPTS))).toBe(sort(ab));
    expect(ab.exceptions).toEqual([{ idA: "x", idB: "y", at: 1 }]);
  });
});

describe("repair", () => {
  let clock = NOW;
  const stamp = () => ++clock;

  it("resurrects a deleted category that an expense still uses", () => {
    const local = ds({ categories: [cat("c-food"), cat("c-pets")], transactions: [tx("t", { categoryId: "c-pets", updatedAt: 50 })] });
    const remote = ds({ tombstones: [tomb("category", "c-pets", 4_000)] });
    const merged = resolve(local, remote, OPTS);
    expect(merged.categories.map((c) => c.id)).toEqual(["c-food"]);

    const { data, notes } = repair(merged, { local, remote }, stamp);
    const pets = data.categories.find((c) => c.id === "c-pets");
    expect(pets?.name).toBe("c-pets");
    expect(pets!.updatedAt).toBeGreaterThan(4_000);
    expect(data.tombstones).toEqual([]);
    expect(notes).toEqual([{ kind: "category_resurrected", id: "c-pets" }]);
  });

  it("never lets a default category be deleted", () => {
    const local = ds({ categories: [cat("c-food", { isDefault: true, updatedAt: 0 })] });
    const remote = ds({ categories: [], tombstones: [tomb("category", "c-food", 99)] });
    const { data } = repair(resolve(local, remote, OPTS), { local, remote }, stamp);
    expect(data.categories.map((c) => c.id)).toEqual(["c-food"]);
  });

  it("creates a placeholder for a category that exists nowhere", () => {
    const remote = ds({ categories: [], transactions: [tx("t", { categoryId: "c-ghost" })] });
    const local = ds({ categories: [] });
    const { data, notes } = repair(resolve(local, remote, OPTS), { local, remote }, stamp);
    expect(data.categories).toEqual([
      expect.objectContaining({ id: "c-ghost", name: PLACEHOLDER_CATEGORY.name }),
    ]);
    expect(notes).toEqual([{ kind: "placeholder_category", id: "c-ghost" }]);
  });
});

describe("diffPlan", () => {
  it("applies remote-only rows locally and marks them clean", () => {
    const local = ds();
    const remote = ds({ transactions: [tx("t", { firstSyncedAt: 5 })] });
    const plan = diffPlan(local, remote, resolve(local, remote, OPTS));
    expect(plan.local.transactions.upsert.map((t) => t.id)).toEqual(["t"]);
    expect(plan.clean.has(rowKey("transaction", "t"))).toBe(true);
    expect(plan.sheetChanged).toBe(false);
  });

  it("local-only rows make the sheet dirty and are not marked clean", () => {
    const local = ds({ transactions: [tx("t")] });
    const remote = ds();
    const plan = diffPlan(local, remote, resolve(local, remote, OPTS));
    expect(plan.local.transactions.upsert).toEqual([]);
    expect(plan.clean.has(rowKey("transaction", "t"))).toBe(false);
    expect(plan.sheetChanged).toBe(true);
  });

  it("records history before overwriting a local version", () => {
    const local = ds({ transactions: [tx("t", { note: "mine", updatedAt: 1 })] });
    const remote = ds({ transactions: [tx("t", { note: "theirs", updatedAt: 2 })] });
    const plan = diffPlan(local, remote, resolve(local, remote, OPTS));
    expect(plan.history).toEqual([
      { entity: "transaction", id: "t", row: local.transactions[0], cause: "remote_newer" },
    ]);
  });

  it("does not record history for a firstSyncedAt-only change", () => {
    const local = ds({ transactions: [tx("t")] });
    const remote = ds({ transactions: [tx("t")] });
    const plan = diffPlan(local, remote, resolve(local, remote, OPTS));
    expect(plan.local.transactions.upsert).toHaveLength(1);
    expect(plan.history).toEqual([]);
    // The sheet doesn't have firstSyncedAt yet, so it needs the write.
    expect(plan.sheetChanged).toBe(true);
  });

  it("records history for a remote delete and counts it for the brake", () => {
    const local = ds({ transactions: [tx("t1"), tx("t2")] });
    const remote = ds({ transactions: [tx("t2")], tombstones: [tomb("transaction", "t1", 5_000)] });
    const plan = diffPlan(local, remote, resolve(local, remote, OPTS));
    expect(plan.local.transactions.delete).toEqual(["t1"]);
    expect(plan.history[0]).toMatchObject({ id: "t1", cause: "remote_delete" });
    expect(plan.localDeletes.transaction).toBe(1);
    expect(plan.localCounts.transaction).toBe(2);
  });

  it("nothing to do when both sides already agree", () => {
    const both = ds({ transactions: [tx("t", { firstSyncedAt: 1 })], tombstones: [tomb("budget", "b", NOW - 1)] });
    const plan = diffPlan(both, both, resolve(both, both, OPTS));
    expect(plan.sheetChanged).toBe(false);
    expect(plan.local.transactions.upsert).toEqual([]);
    expect(plan.local.tombstones.upsert).toEqual([]);
    expect(plan.history).toEqual([]);
  });
});
