/**
 * @jest-environment node
 */
import { category, rowHistory, tombstone, transaction } from "@/db/schema/schema";
import { createTestDb } from "@/test-utils/sqlite";
import { eq } from "drizzle-orm";

import { resetClockForTests } from "../clock";
import { diffPlan } from "../merge";
import { applyPlan, countUnsynced, readLocal, wipeLocalData } from "../local-repo";
import { buildPlan, needsConfirmation } from "../plan";
import { resetDeviceIdForTests } from "../tracking";
import type { Dataset, TransactionRecord } from "../types";

const NOW = 1_800_000_000_000;
let clock = NOW;
const stamp = () => ++clock;
const planOpts = { now: NOW, stamp, dedupe: true };

beforeEach(() => {
  resetClockForTests();
  resetDeviceIdForTests();
});

const tx = (id: string, over: Partial<TransactionRecord> = {}): TransactionRecord => ({
  id,
  amountMinor: 100,
  categoryId: "c-food",
  occurredAt: NOW - 86_400_000,
  note: null,
  createdAt: NOW - 1_000,
  createdDevice: "d-remote",
  firstSyncedAt: NOW - 500,
  updatedAt: NOW - 1_000,
  ...over,
});

function insertLocal(db: ReturnType<typeof createTestDb>["db"], t: TransactionRecord, dirty = true) {
  db.insert(transaction).values({ ...t, syncDirty: dirty }).run();
}

describe("readLocal", () => {
  it("reads the seeded categories with their sync versions", () => {
    const { db } = createTestDb();
    const data = readLocal(db);
    expect(data.categories).toHaveLength(8);
    expect(data.categories.every((c) => c.isDefault && c.updatedAt === 0)).toBe(true);
    expect(data.transactions).toEqual([]);
  });
});

describe("applyPlan", () => {
  it("restores a remote dataset into an empty phone, all clean", () => {
    const { db } = createTestDb();
    const local = readLocal(db);
    const remote: Dataset = { ...local, transactions: [tx("t-1"), tx("t-2", { note: "x" })] };

    const plan = buildPlan(local, remote, planOpts);
    applyPlan(db, plan, NOW);

    const rows = db.select().from(transaction).all();
    expect(rows.map((r) => r.id).sort()).toEqual(["t-1", "t-2"]);
    expect(rows.every((r) => r.syncDirty === false)).toBe(true);
    // The seeded categories were identical on both sides → now clean as well.
    expect(countUnsynced(db)).toBe(0);
  });

  it("keeps local-only rows dirty so they get uploaded", () => {
    const { db } = createTestDb();
    insertLocal(db, tx("mine", { createdDevice: "d-me", firstSyncedAt: null }));
    const local = readLocal(db);
    const remote: Dataset = { ...local, transactions: [] };

    applyPlan(db, buildPlan(local, remote, planOpts), NOW);
    expect(db.select().from(transaction).get()?.syncDirty).toBe(true);
  });

  it("writes row_history before overwriting a local edit", () => {
    const { db } = createTestDb();
    insertLocal(db, tx("t-1", { note: "mine", updatedAt: NOW - 2_000 }));
    const local = readLocal(db);
    const remote: Dataset = { ...local, transactions: [tx("t-1", { note: "theirs", updatedAt: NOW - 100 })] };

    applyPlan(db, buildPlan(local, remote, planOpts), NOW);

    expect(db.select().from(transaction).get()?.note).toBe("theirs");
    const history = db.select().from(rowHistory).all();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ entity: "transaction", id: "t-1", cause: "remote_newer" });
    expect(JSON.parse(history[0].rowJson).note).toBe("mine");
  });

  it("applies a remote delete, keeps the tombstone and the history", () => {
    const { db } = createTestDb();
    insertLocal(db, tx("t-1"), false);
    const local = readLocal(db);
    const remote: Dataset = {
      ...local,
      transactions: [],
      tombstones: [{ entity: "transaction", id: "t-1", deletedAt: NOW, reason: "user", mergedInto: null, device: "d-b" }],
    };

    applyPlan(db, buildPlan(local, remote, planOpts), NOW);

    expect(db.select().from(transaction).all()).toEqual([]);
    expect(db.select().from(tombstone).get()).toMatchObject({ id: "t-1", syncDirty: false });
    expect(db.select().from(rowHistory).get()).toMatchObject({ id: "t-1", cause: "remote_delete" });
  });

  it("merges a cross-device duplicate into one local row", () => {
    const { db } = createTestDb();
    insertLocal(db, tx("mine", { createdDevice: "d-me", createdAt: NOW - 60_000, updatedAt: NOW - 60_000, firstSyncedAt: null }));
    const local = readLocal(db);
    const remote: Dataset = {
      ...local,
      transactions: [tx("theirs", { createdDevice: "d-other", createdAt: NOW - 30_000, updatedAt: NOW - 30_000, note: "lunch" })],
    };

    const plan = buildPlan(local, remote, planOpts);
    applyPlan(db, plan, NOW);

    const rows = db.select().from(transaction).all();
    expect(rows.map((r) => r.id)).toEqual(["mine"]); // entered first
    expect(rows[0].note).toBe("lunch");
    expect(db.select().from(tombstone).get()).toMatchObject({ id: "theirs", reason: "duplicate", mergedInto: "mine" });
  });

  it("only marks a row clean at the exact version the sheet holds", () => {
    const { db } = createTestDb();
    insertLocal(db, tx("t-1", { updatedAt: NOW - 10 }));
    const local = readLocal(db);
    const remote: Dataset = { ...local };
    const plan = diffPlan(local, remote, local);

    // The user edits the row after the plan was built…
    db.update(transaction).set({ updatedAt: NOW + 5, note: "edited" }).where(eq(transaction.id, "t-1")).run();
    applyPlan(db, plan, NOW);

    // …so the edit stays dirty and will be uploaded.
    expect(db.select().from(transaction).get()?.syncDirty).toBe(true);
  });

  it("rolls everything back if one step fails", () => {
    const { db } = createTestDb();
    insertLocal(db, tx("t-1"));
    const local = readLocal(db);
    // A hand-made plan that tries to delete a default category — the trigger aborts.
    const plan = diffPlan(local, local, { ...local, transactions: [], categories: local.categories.slice(1) });
    plan.history.push({ entity: "transaction", id: "x", row: tx("x"), cause: "remote_delete" });

    expect(() => applyPlan(db, plan, NOW)).toThrow();
    expect(db.select().from(transaction).all()).toHaveLength(1);
    expect(db.select().from(rowHistory).all()).toEqual([]);
    expect(db.select().from(category).where(eq(category.isDefault, true)).all()).toHaveLength(8);
  });
});

describe("needsConfirmation (mass-change brake)", () => {
  const datasetWith = (n: number): Dataset => ({
    transactions: Array.from({ length: n }, (_, i) => tx(`t-${i}`)),
    categories: [],
    budgets: [],
    tombstones: [],
    exceptions: [],
  });
  const deleting = (n: number, of: number) => {
    const local = datasetWith(of);
    const remote: Dataset = {
      ...local,
      transactions: local.transactions.slice(n),
      tombstones: local.transactions
        .slice(0, n)
        .map((t) => ({ entity: "transaction" as const, id: t.id, deletedAt: NOW, reason: "user" as const, mergedInto: null, device: "d" })),
    };
    return buildPlan(local, remote, { ...planOpts, dedupe: false });
  };

  it("lets small deletions through", () => {
    expect(needsConfirmation(deleting(1, 10))).toBe(false);
    expect(needsConfirmation(deleting(20, 100))).toBe(false);
  });

  it("stops at more than 20% once at least 5 are deleted", () => {
    expect(needsConfirmation(deleting(6, 20))).toBe(true);
    expect(needsConfirmation(deleting(4, 4))).toBe(false);
  });

  it("stops at more than 50 rows even if under 20%", () => {
    expect(needsConfirmation(deleting(51, 1_000))).toBe(true);
  });
});

describe("wipeLocalData", () => {
  it("refuses while anything is unsynced", () => {
    const { db } = createTestDb();
    insertLocal(db, tx("t-1"));
    expect(wipeLocalData(db)).toEqual({ ok: false, unsynced: expect.any(Number) });
    expect(db.select().from(transaction).all()).toHaveLength(1);
  });

  it("removes the local copy without writing tombstones", () => {
    const { db } = createTestDb();
    insertLocal(db, tx("t-1"), false);
    db.update(category).set({ syncDirty: false }).run();
    expect(wipeLocalData(db)).toEqual({ ok: true });
    expect(db.select().from(transaction).all()).toEqual([]);
    expect(db.select().from(tombstone).all()).toEqual([]);
    expect(db.select().from(category).all()).toHaveLength(8);
  });
});
