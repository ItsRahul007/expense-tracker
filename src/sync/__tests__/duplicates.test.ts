/**
 * @jest-environment node
 */
import { dedupeException, syncState, tombstone, transaction } from "@/db/schema/schema";
import { eq } from "drizzle-orm";
import { FakeGoogle } from "@/test-utils/fake-google";
import { createTestDb } from "@/test-utils/sqlite";

import { nextStamp } from "../clock";
import { keepBoth, mergedInto, mergePair, undoMerge } from "../duplicates";
import { createSyncEngine } from "../engine";
import { readLocal } from "../local-repo";
import { newTransactionStamp, resetDeviceIdForTests } from "../tracking";

function phone(google: FakeGoogle, name: string) {
  const { db } = createTestDb();
  db.insert(syncState).values({ key: "device_id", value: name }).run();
  const engine = createSyncEngine({ db, drive: google.drive, sheets: google.sheets, appVersion: "t" });
  const add = (over: Partial<typeof transaction.$inferInsert> = {}) => {
    resetDeviceIdForTests();
    const id = `t-${name}-${nextStamp()}`;
    db.insert(transaction)
      .values({ id, amountMinor: 500, categoryId: "c-food", occurredAt: new Date(2026, 10, 14, 12).getTime(), note: null, ...newTransactionStamp(db), ...over })
      .run();
    return id;
  };
  const sync = () => {
    resetDeviceIdForTests();
    return engine.syncOnce();
  };
  const connect = () => {
    resetDeviceIdForTests();
    return engine.connect();
  };
  return { db, add, sync, connect };
}

describe("undoMerge", () => {
  it("brings the duplicate back on every phone and never merges the pair again", async () => {
    const google = new FakeGoogle();
    const a = phone(google, "d-a");
    const b = phone(google, "d-b");
    await a.connect();
    await b.connect();

    const mine = a.add();
    await a.sync();
    const theirs = b.add();
    const outcome = await b.sync(); // b merges its own row into a's
    expect(outcome.status === "synced" && outcome.merges).toEqual([
      expect.objectContaining({ entity: "transaction", survivor: mine, duplicate: theirs }),
    ]);

    expect(undoMerge(b.db, mine, theirs)).toBe(true);
    await b.sync();
    await a.sync();
    await b.sync();

    for (const p of [a, b]) {
      expect(p.db.select().from(transaction).all().map((t) => t.id).sort()).toEqual([mine, theirs].sort());
      expect(p.db.select().from(dedupeException).all()).toHaveLength(1);
    }
  });

  it("also gives the kept expense its own note back (it had adopted the duplicate's)", async () => {
    const google = new FakeGoogle();
    const a = phone(google, "d-a");
    const b = phone(google, "d-b");
    await a.connect();
    await b.connect();

    const mine = a.add({ note: null });
    await a.sync();
    const theirs = b.add({ note: "Snacks" });
    const outcome = await b.sync();
    if (outcome.status !== "synced") throw new Error(outcome.status);
    const merge = outcome.merges[0];
    const noteOf = (id: string) => b.db.select().from(transaction).all().find((t) => t.id === id)?.note;
    expect(noteOf(mine)).toBe("Snacks"); // adopted during the merge

    expect(undoMerge(b.db, merge.survivor, merge.duplicate, merge.row, merge.survivorBefore)).toBe(true);
    expect(noteOf(mine)).toBeNull();
    expect(noteOf(theirs)).toBe("Snacks");

    await b.sync();
    await a.sync();
    expect(a.db.select().from(transaction).all().find((t) => t.id === mine)?.note).toBeNull();
  });

  it("leaves the kept expense alone if its note was edited after the merge", async () => {
    const google = new FakeGoogle();
    const a = phone(google, "d-a");
    const b = phone(google, "d-b");
    await a.connect();
    await b.connect();
    const mine = a.add({ note: null });
    await a.sync();
    b.add({ note: "Snacks" });
    const outcome = await b.sync();
    if (outcome.status !== "synced") throw new Error(outcome.status);
    const merge = outcome.merges[0];

    b.db.update(transaction).set({ note: "Edited later" }).where(eq(transaction.id, mine)).run();
    undoMerge(b.db, merge.survivor, merge.duplicate, merge.row, merge.survivorBefore);
    expect(b.db.select().from(transaction).all().find((t) => t.id === mine)?.note).toBe("Edited later");
  });

  it("restores a duplicate that arrived from another phone (no local history)", async () => {
    const google = new FakeGoogle();
    const a = phone(google, "d-a");
    const b = phone(google, "d-b");
    await a.connect();
    await b.connect();

    // b's entry is the earlier one this time, so b keeps its own row and the
    // duplicate is a's — which b only ever saw in the sheet.
    const mine = b.add();
    const theirs = a.add();
    await a.sync();
    const outcome = await b.sync();
    if (outcome.status !== "synced") throw new Error(outcome.status);
    const merge = outcome.merges[0];
    expect(merge).toMatchObject({ survivor: mine, duplicate: theirs });

    expect(undoMerge(b.db, merge.survivor, merge.duplicate, merge.row)).toBe(true);
    await b.sync();
    await a.sync();
    expect(a.db.select().from(transaction).all()).toHaveLength(2);
  });

  it("returns false when there's nothing to restore", () => {
    const { db } = createTestDb();
    expect(undoMerge(db, "x", "y")).toBe(false);
  });
});

describe("suggestion actions", () => {
  it("keepBoth records the pair as distinct", () => {
    const { db } = createTestDb();
    keepBoth(db, "t-z", "t-a");
    expect(db.select().from(dedupeException).get()).toMatchObject({ idA: "t-a", idB: "t-z", syncDirty: true });
  });

  it("mergePair keeps the earlier entry with the chosen note", () => {
    const { db } = createTestDb();
    resetDeviceIdForTests();
    const stamp = (createdAt: number) => ({ ...newTransactionStamp(db), createdAt });
    db.insert(transaction).values({ id: "early", amountMinor: 1, categoryId: "c-food", occurredAt: 1, note: "a", ...stamp(1) }).run();
    db.insert(transaction).values({ id: "late", amountMinor: 1, categoryId: "c-food", occurredAt: 1, note: "b", ...stamp(2) }).run();
    const [early, late] = ["early", "late"].map((id) => readLocal(db).transactions.find((t) => t.id === id)!);

    mergePair(db, late, early, "late");

    expect(db.select().from(transaction).all()).toEqual([
      expect.objectContaining({ id: "early", note: "b", syncDirty: true }),
    ]);
    expect(db.select().from(tombstone).get()).toMatchObject({ id: "late", reason: "duplicate", mergedInto: "early" });
  });
});

describe("mergedInto", () => {
  it("follows duplicate tombstones to the surviving expense", () => {
    const { db } = createTestDb();
    const t = (id: string, into: string) => ({ entity: "transaction" as const, id, deletedAt: 1, reason: "duplicate" as const, mergedInto: into, device: "d" });
    db.insert(tombstone).values([t("a", "b"), t("b", "c")]).run();
    expect(mergedInto(db, "a")).toBe("c");
    expect(mergedInto(db, "c")).toBeNull();
  });
});
