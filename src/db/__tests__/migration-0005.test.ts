/**
 * @jest-environment node
 *
 * A migration that throws on a real phone with real data is the worst outcome
 * in a local-first app, so 0005 is tested on a database that already holds
 * data from before it — the path every existing user takes.
 */
import { applyMigration, createTestDb } from "@/test-utils/sqlite";

const TAG = "0005_sync_tracking";

function seedPre0005(raw: ReturnType<typeof createTestDb>["raw"]) {
  raw.exec(`
    INSERT INTO categories (id, name, icon, color, sort_order) VALUES ('c-pets', 'Pets', 'paw', '#000', 9);
    INSERT INTO transactions (id, amount_minor, category_id, occurred_at, note)
      VALUES ('t-1', 24950, 'c-food', 1763107200000, 'Lunch'),
             ('t-2', 1000,  'c-pets', 1763193600000, NULL);
    INSERT INTO budgets (id, category_id, start_month, end_month, limit_minor, created_at)
      VALUES ('b-1', 'c-food', '2026-11', NULL, 500000, 1);
  `);
}

describe("migration 0005 (sync tracking) on existing data", () => {
  function upgraded() {
    const { raw } = createTestDb({ upTo: TAG });
    seedPre0005(raw);
    const before = Date.now();
    applyMigration(raw, TAG);
    return { raw, before };
  }

  it("keeps every existing row and value", () => {
    const { raw } = upgraded();
    const rows = raw
      .prepare("SELECT id, amount_minor, category_id, occurred_at, note FROM transactions ORDER BY id")
      .all();
    expect(rows).toEqual([
      { id: "t-1", amount_minor: 24950, category_id: "c-food", occurred_at: 1763107200000, note: "Lunch" },
      { id: "t-2", amount_minor: 1000, category_id: "c-pets", occurred_at: 1763193600000, note: null },
    ]);
    expect(raw.prepare("SELECT count(*) n FROM budgets").get()).toEqual({ n: 1 });
  });

  it("marks existing expenses legacy, stamped, and waiting to upload", () => {
    const { raw, before } = upgraded();
    const rows = raw
      .prepare("SELECT created_device, created_at, updated_at, sync_dirty, first_synced_at FROM transactions")
      .all() as { created_device: string; created_at: number; updated_at: number; sync_dirty: number; first_synced_at: number | null }[];

    for (const row of rows) {
      expect(row.created_device).toBe("legacy");
      // strftime('%s') has 1 s resolution.
      expect(row.created_at).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
      expect(row.updated_at).toBe(row.created_at);
      expect(row.sync_dirty).toBe(1);
      expect(row.first_synced_at).toBeNull();
    }
  });

  it("leaves seeded default categories at updated_at = 0 and stamps custom ones", () => {
    const { raw } = upgraded();
    const defaults = raw
      .prepare("SELECT DISTINCT updated_at FROM categories WHERE is_default = 1")
      .all();
    expect(defaults).toEqual([{ updated_at: 0 }]);

    const custom = raw
      .prepare("SELECT updated_at FROM categories WHERE id = 'c-pets'")
      .get() as { updated_at: number };
    expect(custom.updated_at).toBeGreaterThan(0);
  });

  it("stamps existing budgets", () => {
    const { raw } = upgraded();
    const row = raw.prepare("SELECT updated_at, sync_dirty FROM budgets").get() as {
      updated_at: number;
      sync_dirty: number;
    };
    expect(row.updated_at).toBeGreaterThan(0);
    expect(row.sync_dirty).toBe(1);
  });

  it("creates the sync tables empty", () => {
    const { raw } = upgraded();
    for (const table of ["tombstones", "row_history", "dedupe_exceptions", "sync_state"]) {
      expect(raw.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({ n: 0 });
    }
  });

  it("keeps the default-category delete guard working", () => {
    const { raw } = upgraded();
    expect(() => raw.exec("DELETE FROM categories WHERE id = 'c-food'")).toThrow(/default category/);
  });
});

describe("a fresh install", () => {
  it("applies every migration cleanly", () => {
    const { raw } = createTestDb();
    expect(raw.prepare("SELECT count(*) n FROM categories").get()).toEqual({ n: 8 });
  });
});
