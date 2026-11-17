/**
 * @jest-environment node
 *
 * End-to-end sync between simulated phones and one fake Google account.
 */
import { rowHistory, syncState, tombstone, transaction } from "@/db/schema/schema";
import { FakeGoogle } from "@/test-utils/fake-google";
import { applyMigration, createTestDb } from "@/test-utils/sqlite";
import { eq } from "drizzle-orm";

import { nextStamp } from "../clock";
import { createSyncEngine } from "../engine";
import { countUnsynced } from "../local-repo";
import { TAB } from "../sheet-format";
import { getState } from "../state";
import { newTransactionStamp, recordDeletions, resetDeviceIdForTests } from "../tracking";

type Device = ReturnType<typeof makeDevice>;

function makeDevice(google: FakeGoogle, name: string) {
  const { db } = createTestDb();
  db.insert(syncState).values({ key: "device_id", value: name }).run();
  const engine = createSyncEngine({ db, drive: google.drive, sheets: google.sheets, appVersion: "test" });

  const as = <T>(fn: () => T): T => {
    resetDeviceIdForTests();
    return fn();
  };

  return {
    name,
    db,
    engine,
    /** Same writes as useAddTransaction. */
    add(over: Partial<typeof transaction.$inferInsert> = {}) {
      return as(() => {
        const id = `t-${name}-${nextStamp()}`;
        db.insert(transaction)
          .values({
            id,
            amountMinor: 25_000,
            categoryId: "c-food",
            occurredAt: new Date(2026, 10, 14, 12).getTime(),
            note: null,
            ...newTransactionStamp(db),
            ...over,
          })
          .run();
        return id;
      });
    },
    /** Same writes as useUpdateTransaction. */
    edit(id: string, patch: Partial<typeof transaction.$inferInsert>) {
      as(() =>
        db.update(transaction).set({ ...patch, updatedAt: nextStamp(), syncDirty: true }).where(eq(transaction.id, id)).run(),
      );
    },
    /** Same writes as useDeleteTransaction. */
    remove(id: string) {
      as(() =>
        db.transaction((tx) => {
          tx.delete(transaction).where(eq(transaction.id, id)).run();
          recordDeletions(tx, "transaction", [id]);
        }),
      );
    },
    expenses() {
      return db
        .select({ id: transaction.id, amountMinor: transaction.amountMinor, note: transaction.note })
        .from(transaction)
        .all()
        .sort((a, b) => (a.id < b.id ? -1 : 1));
    },
    sync: (options = {}) => as(() => engine.syncOnce(options)),
    connect: () => as(() => engine.connect()),
  };
}

let google: FakeGoogle;
beforeEach(() => {
  google = new FakeGoogle();
});

async function connectAll(...devices: Device[]) {
  for (const d of devices) {
    const { outcome } = await d.connect();
    expect(outcome.status).toBe("synced");
  }
}

describe("connect", () => {
  it("creates the sheet on first connect and uploads everything", async () => {
    const phone = makeDevice(google, "d-a");
    phone.add();
    phone.add({ note: "dinner" });

    const { outcome, created } = await phone.connect();
    expect(created).toBe(true);
    expect(outcome.status).toBe("synced");

    const id = getState(phone.db, "spreadsheet_id")!;
    expect(google.grid(id, TAB.expenses)).toHaveLength(3); // header + 2
    expect(google.grid(id, TAB.categories)).toHaveLength(9);
    // Read back in the same sync, so nothing is left waiting.
    expect(countUnsynced(phone.db)).toBe(0);
  });

  it("restores everything onto a reinstalled phone", async () => {
    const old = makeDevice(google, "d-old");
    old.add({ note: "a" });
    old.add({ note: "b" });
    await connectAll(old);

    const reinstalled = makeDevice(google, "d-new");
    const { outcome, created } = await reinstalled.connect();
    expect(created).toBe(false);
    expect(outcome.status).toBe("synced");
    expect(reinstalled.expenses()).toEqual(old.expenses());
    expect(countUnsynced(reinstalled.db)).toBe(0);
  });

  it("merges, never replaces, when the phone already has data (upgrading user)", async () => {
    const other = makeDevice(google, "d-other");
    other.add({ amountMinor: 1, note: "from sheet" });
    await connectAll(other);

    const upgrading = makeDevice(google, "d-up");
    upgrading.add({ amountMinor: 2, note: "only on this phone" });
    await connectAll(upgrading);

    expect(upgrading.expenses().map((e) => e.note).sort()).toEqual(["from sheet", "only on this phone"]);
    await other.sync();
    expect(other.expenses()).toEqual(upgrading.expenses());
  });
});

describe("syncOnce", () => {
  it("is a cheap no-op when nothing changed (fast path)", async () => {
    const phone = makeDevice(google, "d-a");
    phone.add();
    await connectAll(phone);
    const reads = google.calls.reads;

    await expect(phone.sync()).resolves.toEqual({ status: "skipped", reason: "up_to_date" });
    // Exactly one tiny read of `_meta`; no full pull, no write.
    expect(google.calls.reads).toBe(reads + 1);
  });

  it("a phone with nothing to upload still notices the other phone's write", async () => {
    // Regression: the fast path used Drive's file version, which real Drive
    // doesn't bump for Sheets cell edits — so the idle phone never pulled.
    const a = makeDevice(google, "d-a");
    const b = makeDevice(google, "d-b");
    await connectAll(a, b);
    a.add({ note: "from a" });
    await a.sync();

    const outcome = await b.sync();
    expect(outcome.status).toBe("synced");
    expect(b.expenses().map((e) => e.note)).toEqual(["from a"]);
  });

  it("propagates adds, edits and deletes between two phones", async () => {
    const a = makeDevice(google, "d-a");
    const b = makeDevice(google, "d-b");
    await connectAll(a, b);

    const id = a.add({ note: "first" });
    await a.sync();
    await b.sync();
    expect(b.expenses()).toEqual(a.expenses());

    b.edit(id, { note: "edited on b" });
    await b.sync();
    await a.sync();
    expect(a.expenses()[0].note).toBe("edited on b");

    a.remove(id);
    await a.sync();
    await b.sync();
    expect(b.expenses()).toEqual([]);
    expect(b.db.select().from(rowHistory).all().map((h) => h.cause)).toContain("remote_delete");
  });

  it("the same expense added on two phones at the same time ends up once", async () => {
    const a = makeDevice(google, "d-a");
    const b = makeDevice(google, "d-b");
    await connectAll(a, b);

    a.add({ note: "Lunch" });
    b.add({ note: "lunch w/ team" });
    await a.sync();
    const outcome = await b.sync();
    await a.sync();

    expect(outcome.status === "synced" && outcome.merges).toHaveLength(1);
    expect(a.expenses()).toHaveLength(1);
    expect(b.expenses()).toEqual(a.expenses());
  });

  it("§12.9 A: phone offline adds, other online adds 2 min later → one copy", async () => {
    const a = makeDevice(google, "d-a");
    const b = makeDevice(google, "d-b");
    await connectAll(a, b);

    google.online = false;
    const t = Date.now();
    a.add({ createdAt: t, updatedAt: t });
    expect((await a.sync()).status).toBe("error");
    google.online = true;

    b.add({ createdAt: t + 2 * 60_000, updatedAt: t + 2 * 60_000 });
    await b.sync();

    await a.sync(); // back online, hours later in real life
    await b.sync();
    expect(a.expenses()).toHaveLength(1);
    expect(b.expenses()).toEqual(a.expenses());
  });

  it("brakes before applying a mass deletion, and 'keep mine' restores the sheet", async () => {
    const a = makeDevice(google, "d-a");
    const b = makeDevice(google, "d-b");
    for (let i = 0; i < 10; i++) a.add({ amountMinor: 100 + i });
    await connectAll(a, b);
    expect(b.expenses()).toHaveLength(10);

    for (const e of a.expenses().slice(0, 5)) a.remove(e.id);
    await a.sync();

    const outcome = await b.sync();
    expect(outcome).toEqual({ status: "needs_confirmation", deletes: 5, total: 10 });
    expect(b.expenses()).toHaveLength(10); // nothing applied
    expect(getState(b.db, "pending_review")).toMatchObject({ deletes: 5, total: 10 });

    const kept = await b.engine.keepLocalRows();
    expect(kept.status).toBe("synced");
    await a.sync();
    expect(a.expenses()).toHaveLength(10);
  });

  it("applies the deletion when the user confirms it", async () => {
    const a = makeDevice(google, "d-a");
    const b = makeDevice(google, "d-b");
    for (let i = 0; i < 10; i++) a.add({ amountMinor: 100 + i });
    await connectAll(a, b);
    for (const e of a.expenses().slice(0, 5)) a.remove(e.id);
    await a.sync();

    await b.sync();
    const outcome = await b.sync({ confirmMassChange: true });
    expect(outcome.status).toBe("synced");
    expect(b.expenses()).toHaveLength(5);
  });

  it("a cleared sheet never deletes anything on the phone", async () => {
    const a = makeDevice(google, "d-a");
    a.add();
    a.add();
    await connectAll(a);
    const id = getState(a.db, "spreadsheet_id")!;

    google.clearTab(id, TAB.expenses);
    google.deleteTab(id, TAB.tombstones);
    a.add(); // something to sync
    await a.sync();

    expect(a.expenses()).toHaveLength(3);
    expect(google.grid(id, TAB.expenses)).toHaveLength(4);
    expect(google.grid(id, TAB.tombstones).length).toBeGreaterThan(0); // tab recreated
  });

  it("reports a deleted sheet and recreates it from the phone", async () => {
    const a = makeDevice(google, "d-a");
    a.add();
    await connectAll(a);
    google.trash(getState(a.db, "spreadsheet_id")!);

    const outcome = await a.sync();
    expect(outcome.status === "error" && outcome.error.code).toBe("sheet_missing");
    expect(a.expenses()).toHaveLength(1);

    expect((await a.engine.recreateSheet()).status).toBe("synced");
    const fresh = getState(a.db, "spreadsheet_id")!;
    expect(google.grid(fresh, TAB.expenses)).toHaveLength(2);
  });

  it("offline sync fails quietly and keeps changes waiting", async () => {
    const a = makeDevice(google, "d-a");
    await connectAll(a);
    a.add();
    google.online = false;
    const outcome = await a.sync();
    expect(outcome.status === "error" && outcome.error.code).toBe("offline");
    expect(countUnsynced(a.db)).toBe(1);
    expect(getState(a.db, "last_error")?.code).toBe("offline");
  });

  it("concurrent calls share one sync", async () => {
    const a = makeDevice(google, "d-a");
    await connectAll(a);
    a.add();
    const [x, y] = await Promise.all([a.engine.syncOnce(), a.engine.syncOnce()]);
    expect(x).toBe(y);
  });

  it("stamps firstSyncedAt at upload time", async () => {
    const a = makeDevice(google, "d-a");
    await connectAll(a);
    const before = Date.now();
    const id = a.add();
    await a.sync();
    const row = a.db.select().from(transaction).where(eq(transaction.id, id)).get()!;
    expect(row.firstSyncedAt).toBeGreaterThanOrEqual(before);
    expect(row.syncDirty).toBe(false);
  });
});

describe("convergence under random interleavings", () => {
  // Small deterministic PRNG so failures are reproducible.
  function prng(seed: number) {
    return () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
  }

  it.each([1, 2, 3, 4, 5])("seed %i: every phone ends with the same data, nothing silently lost", async (seed) => {
    const rand = prng(seed);
    const phones = [makeDevice(google, "d-a"), makeDevice(google, "d-b"), makeDevice(google, "d-c")];
    await connectAll(...phones);

    for (let step = 0; step < 60; step++) {
      const phone = phones[Math.floor(rand() * phones.length)];
      const roll = rand();
      const mine = phone.expenses();
      google.online = rand() > 0.2;
      if (roll < 0.4 || mine.length === 0) {
        // Varying amounts so most adds aren't duplicates of each other.
        phone.add({ amountMinor: 100 + Math.floor(rand() * 5) * 100 });
      } else if (roll < 0.6) {
        phone.edit(mine[Math.floor(rand() * mine.length)].id, { note: `n${step}` });
      } else if (roll < 0.7) {
        phone.remove(mine[Math.floor(rand() * mine.length)].id);
      } else {
        await phone.sync({ confirmMassChange: true });
      }
    }

    // Quiet period: everyone online, two rounds.
    google.online = true;
    for (let round = 0; round < 3; round++) {
      for (const phone of phones) await phone.sync({ confirmMassChange: true });
    }

    const [first, ...rest] = phones.map((p) => p.expenses());
    for (const other of rest) expect(other).toEqual(first);
    for (const phone of phones) expect(countUnsynced(phone.db)).toBe(0);

    // Anything a phone lost was either deleted on purpose (tombstone) or is in
    // its row_history — never silently gone.
    for (const phone of phones) {
      const ids = new Set(phone.expenses().map((e) => e.id));
      const tombs = new Set(phone.db.select().from(tombstone).all().map((t) => t.id));
      for (const h of phone.db.select().from(rowHistory).all()) {
        if (h.entity !== "transaction") continue;
        expect(ids.has(h.id) || tombs.has(h.id)).toBe(true);
      }
    }
  });
});

describe("upgrading an existing install", () => {
  it("uploads 150 pre-sync expenses on first sign-in, merging with what the sheet has", async () => {
    // The preview app today: data from before migration 0005, no sync yet.
    const { raw, db } = createTestDb({ upTo: "0005_sync_tracking" });
    const insert = raw.prepare(
      "INSERT INTO transactions (id, amount_minor, category_id, occurred_at, note) VALUES (?, ?, ?, ?, ?)",
    );
    const day = new Date(2026, 10, 14, 12).getTime();
    // Many identical-looking rows (same amount, category and day) on purpose:
    // legacy rows must never be treated as duplicates of each other.
    for (let i = 0; i < 150; i++) insert.run(`t-old-${i}`, 25_000, "c-food", day, null);
    applyMigration(raw, "0005_sync_tracking");
    db.insert(syncState).values({ key: "device_id", value: "d-preview" }).run();

    // The account already has a sheet with one expense from another phone.
    const other = makeDevice(google, "d-other");
    other.add({ note: "already in the sheet" });
    await connectAll(other);

    resetDeviceIdForTests();
    const engine = createSyncEngine({ db, drive: google.drive, sheets: google.sheets, appVersion: "t" });
    const { outcome, created } = await engine.connect();

    expect(created).toBe(false);
    expect(outcome.status).toBe("synced");
    expect(db.select().from(transaction).all()).toHaveLength(151);
    expect(countUnsynced(db)).toBe(0);
    const sheet = google.grid(getState(db, "spreadsheet_id")!, TAB.expenses);
    expect(sheet).toHaveLength(152); // header + 151

    await other.sync();
    expect(other.expenses()).toHaveLength(151);
  });
});

describe("large ledgers", () => {
  it("grows the sheet past its 1,000-row grid instead of failing", async () => {
    const a = makeDevice(google, "d-a");
    await connectAll(a);
    const day = new Date(2026, 10, 14, 12).getTime();
    for (let i = 0; i < 1_200; i++) a.add({ amountMinor: 100 + i, occurredAt: day - i * 3_600_000 });

    const outcome = await a.sync();
    expect(outcome.status).toBe("synced");
    expect(countUnsynced(a.db)).toBe(0);
    expect(google.grid(getState(a.db, "spreadsheet_id")!, TAB.expenses)).toHaveLength(1_201);

    // And a reinstall gets all of them back.
    const b = makeDevice(google, "d-b");
    await connectAll(b);
    expect(b.expenses()).toHaveLength(1_200);
  });
});
