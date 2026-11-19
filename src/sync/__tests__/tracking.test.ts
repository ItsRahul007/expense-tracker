/**
 * @jest-environment node
 */
import { budget, category, syncState, tombstone, transaction } from "@/db/schema/schema";
import { createTestDb } from "@/test-utils/sqlite";
import { eq } from "drizzle-orm";

import { resetClockForTests } from "../clock";
import {
  editStamp,
  getDeviceId,
  newTransactionStamp,
  recordDeletions,
  resetDeviceIdForTests,
} from "../tracking";

beforeEach(() => {
  resetClockForTests();
  resetDeviceIdForTests();
});

describe("getDeviceId", () => {
  it("creates one id per install and keeps returning it", () => {
    const { db } = createTestDb();
    const first = getDeviceId(db);
    expect(first).toMatch(/^d-[a-z0-9]+$/);
    expect(getDeviceId(db)).toBe(first);

    const stored = db.select().from(syncState).where(eq(syncState.key, "device_id")).get();
    expect(stored?.value).toBe(first);
  });

  it("reuses the stored id after a restart (cache cleared)", () => {
    const { db } = createTestDb();
    const first = getDeviceId(db);
    resetDeviceIdForTests();
    expect(getDeviceId(db)).toBe(first);
  });
});

describe("stamps", () => {
  it("a new expense records when and where it was entered, and is dirty", () => {
    const { db } = createTestDb();
    const stamp = newTransactionStamp(db);
    expect(stamp.createdAt).toBe(stamp.updatedAt);
    expect(stamp.createdDevice).toBe(getDeviceId(db));
    expect(stamp.syncDirty).toBe(true);
  });

  it("successive stamps are strictly increasing", () => {
    const a = editStamp().updatedAt;
    const b = editStamp().updatedAt;
    expect(b).toBeGreaterThan(a);
  });

  it("an inserted expense round-trips its stamp columns", () => {
    const { db } = createTestDb();
    db.insert(transaction)
      .values({
        id: "t-1",
        amountMinor: 25_000,
        categoryId: "c-food",
        occurredAt: 1_763_000_000_000,
        note: null,
        ...newTransactionStamp(db),
      })
      .run();

    const row = db.select().from(transaction).where(eq(transaction.id, "t-1")).get();
    expect(row?.syncDirty).toBe(true);
    expect(row?.createdDevice).toBe(getDeviceId(db));
    expect(row?.firstSyncedAt).toBeNull();
  });
});

describe("recordDeletions", () => {
  it("writes one dirty tombstone per id", () => {
    const { db } = createTestDb();
    recordDeletions(db, "transaction", ["t-1", "t-2"]);

    const rows = db.select().from(tombstone).all();
    expect(rows.map((r) => r.id).sort()).toEqual(["t-1", "t-2"]);
    expect(rows.every((r) => r.entity === "transaction" && r.reason === "user")).toBe(true);
    expect(rows.every((r) => r.syncDirty && r.device === getDeviceId(db))).toBe(true);
  });

  it("re-deleting the same id refreshes the tombstone instead of failing", () => {
    const { db } = createTestDb();
    recordDeletions(db, "budget", ["b-1"]);
    const first = db.select().from(tombstone).get()!;

    db.update(tombstone).set({ syncDirty: false }).run();
    recordDeletions(db, "budget", ["b-1"], { reason: "duplicate", mergedInto: "b-2" });

    const rows = db.select().from(tombstone).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeGreaterThan(first.deletedAt);
    expect(rows[0].reason).toBe("duplicate");
    expect(rows[0].mergedInto).toBe("b-2");
    expect(rows[0].syncDirty).toBe(true);
  });

  it("is a no-op for an empty list", () => {
    const { db } = createTestDb();
    recordDeletions(db, "category", []);
    expect(db.select().from(tombstone).all()).toHaveLength(0);
  });

  it("rolls back with the delete when the delete is rejected", () => {
    const { db } = createTestDb();
    // c-food is a seeded default: the 0003 trigger aborts deleting it.
    expect(() =>
      db.transaction((tx) => {
        tx.delete(category).where(eq(category.id, "c-food")).run();
        recordDeletions(tx, "category", ["c-food"]);
      }),
    ).toThrow(/default category/);

    expect(db.select().from(tombstone).all()).toHaveLength(0);
    expect(db.select().from(category).where(eq(category.id, "c-food")).get()).toBeDefined();
  });

  it("rolls back when an expense still uses the category (FK)", () => {
    const { db } = createTestDb();
    db.insert(category)
      .values({ id: "c-pets", name: "Pets", icon: "paw", color: "#000", sortOrder: 9, ...editStamp() })
      .run();
    db.insert(budget)
      .values({
        id: "b-1",
        categoryId: "c-pets",
        startMonth: "2026-11",
        endMonth: null,
        limitMinor: 100,
        createdAt: 1,
        ...editStamp(),
      })
      .run();
    db.insert(transaction)
      .values({
        id: "t-1",
        amountMinor: 1,
        categoryId: "c-pets",
        occurredAt: 1,
        note: null,
        ...newTransactionStamp(db),
      })
      .run();

    // Same shape as useDeleteCategory.
    expect(() =>
      db.transaction((tx) => {
        tx.delete(budget).where(eq(budget.categoryId, "c-pets")).run();
        tx.delete(category).where(eq(category.id, "c-pets")).run();
        recordDeletions(tx, "budget", ["b-1"]);
        recordDeletions(tx, "category", ["c-pets"]);
      }),
    ).toThrow();

    expect(db.select().from(tombstone).all()).toHaveLength(0);
    expect(db.select().from(budget).all()).toHaveLength(1);
  });
});
