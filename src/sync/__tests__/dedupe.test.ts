import { dedupe, DUPLICATE_WINDOW_MS, notDuplicate } from "../dedupe";
import type { BudgetRecord, CategoryRecord, Dataset, TransactionRecord } from "../types";
import { emptyDataset } from "../types";

const MIN = 60_000;
const T0 = 1_800_000_000_000; // entry time baseline
const DAY = new Date(2026, 10, 14, 12).getTime(); // occurredAt: midday, as the add form stores it
const OPTS = { now: T0 + 60 * MIN };

let seq = 0;
const tx = (device: string, minute: number, over: Partial<TransactionRecord> = {}): TransactionRecord => {
  const createdAt = T0 + minute * MIN;
  return {
    id: `t-${device}-${minute}-${seq++}`,
    amountMinor: 25_000,
    categoryId: "c-food",
    occurredAt: DAY,
    note: null,
    createdAt,
    createdDevice: device,
    // Uploaded promptly unless a test says otherwise.
    firstSyncedAt: createdAt + 5_000,
    updatedAt: createdAt,
    ...over,
  };
};

const ds = (transactions: TransactionRecord[], over: Partial<Dataset> = {}): Dataset => ({
  ...emptyDataset(),
  transactions,
  ...over,
});

const count = (d: Dataset) => d.transactions.length;

describe("§12.3 matching table", () => {
  it("A and B each add ₹250 Food → 1", () => {
    expect(count(dedupe(ds([tx("A", 0), tx("B", 1)]), OPTS).data)).toBe(1);
  });

  it("A adds two coffees, B adds one → 2", () => {
    expect(count(dedupe(ds([tx("A", 0), tx("A", 1), tx("B", 2)]), OPTS).data)).toBe(2);
  });

  it("A adds two, B adds two → 2", () => {
    expect(count(dedupe(ds([tx("A", 0), tx("A", 1), tx("B", 0), tx("B", 2)]), OPTS).data)).toBe(2);
  });

  it("40 minutes apart → 2", () => {
    expect(count(dedupe(ds([tx("A", 0), tx("B", 40)]), OPTS).data)).toBe(2);
  });

  it("different amount → 2", () => {
    expect(count(dedupe(ds([tx("A", 0), tx("B", 1, { amountMinor: 26_000 })]), OPTS).data)).toBe(2);
  });

  it("different category → 2", () => {
    expect(count(dedupe(ds([tx("A", 0), tx("B", 1, { categoryId: "c-groc" })]), OPTS).data)).toBe(2);
  });

  it("different day → 2", () => {
    expect(count(dedupe(ds([tx("A", 0), tx("B", 1, { occurredAt: DAY + 86_400_000 })]), OPTS).data)).toBe(2);
  });

  it("the same phone twice is never a duplicate", () => {
    expect(count(dedupe(ds([tx("A", 0), tx("A", 0)]), OPTS).data)).toBe(2);
  });

  it("pre-sync (legacy) rows are never duplicates", () => {
    expect(count(dedupe(ds([tx("legacy", 0), tx("B", 0)]), OPTS).data)).toBe(2);
  });

  it("three phones at once → 1", () => {
    expect(count(dedupe(ds([tx("A", 0), tx("B", 1), tx("C", 2)]), OPTS).data)).toBe(1);
  });
});

describe("the window", () => {
  const at = (ms: number) =>
    dedupe(ds([tx("A", 0), { ...tx("B", 0), createdAt: T0 + ms, updatedAt: T0 + ms }]), OPTS).data;

  it("exactly 10 minutes is the same expense", () => {
    expect(count(at(DUPLICATE_WINDOW_MS))).toBe(1);
  });

  it("10 minutes and 1 ms is not", () => {
    expect(count(at(DUPLICATE_WINDOW_MS + 1))).toBe(2);
  });
});

describe("§12.4 survivor", () => {
  it("the first entry survives and the other becomes a duplicate tombstone", () => {
    const a = tx("A", 0);
    const b = tx("B", 1);
    const { data, merges } = dedupe(ds([b, a]), OPTS);
    expect(data.transactions.map((t) => t.id)).toEqual([a.id]);
    expect(data.tombstones).toEqual([
      expect.objectContaining({ entity: "transaction", id: b.id, reason: "duplicate", mergedInto: a.id }),
    ]);
    expect(merges).toEqual([{ entity: "transaction", survivor: a.id, duplicate: b.id }]);
  });

  it("is the same whatever order the rows arrive in", () => {
    const rows = [tx("A", 0, { note: "Lunch" }), tx("B", 0, { note: "lunch w/ team" }), tx("C", 3)];
    const one = dedupe(ds(rows), OPTS).data;
    const two = dedupe(ds([...rows].reverse()), OPTS).data;
    expect(JSON.stringify(one)).toBe(JSON.stringify({ ...two, transactions: two.transactions }));
  });

  it("adopts the duplicate's note when the survivor has none", () => {
    const a = tx("A", 0);
    const b = tx("B", 1, { note: "lunch w/ team" });
    const [survivor] = dedupe(ds([a, b]), OPTS).data.transactions;
    expect(survivor.id).toBe(a.id);
    expect(survivor.note).toBe("lunch w/ team");
    expect(survivor.updatedAt).toBe(b.updatedAt + 1);
  });

  it("keeps the survivor's own note when the duplicate's is older", () => {
    const a = tx("A", 0, { note: "Lunch", updatedAt: T0 + 5 * MIN });
    const b = tx("B", 1, { note: "other" });
    const [survivor] = dedupe(ds([a, b]), OPTS).data.transactions;
    expect(survivor).toEqual(a);
  });

  it("takes a note written later on the duplicate", () => {
    const a = tx("A", 0, { note: "Lunch" });
    const b = tx("B", 1, { note: "Lunch with Asha", updatedAt: T0 + 30 * MIN });
    const [survivor] = dedupe(ds([a, b]), OPTS).data.transactions;
    expect(survivor.note).toBe("Lunch with Asha");
  });

  it("is idempotent: running again changes nothing", () => {
    const once = dedupe(ds([tx("A", 0), tx("B", 1, { note: "x" })]), OPTS);
    const twice = dedupe(once.data, OPTS);
    expect(twice.data).toEqual(once.data);
    expect(twice.merges).toEqual([]);
  });

  it("produces identical output on two devices (no clock or device id involved)", () => {
    const rows = [tx("A", 0), tx("B", 1, { note: "n" })];
    expect(dedupe(ds(rows), { now: 1 }).data).toEqual(dedupe(ds(rows), { now: 999_999 }).data);
  });
});

describe("§12.7 exceptions", () => {
  it("a pair marked 'not duplicates' is never merged", () => {
    const a = tx("A", 0);
    const b = tx("B", 1);
    const result = dedupe(ds([a, b], { exceptions: [notDuplicate(b.id, a.id, 1)] }), OPTS);
    expect(count(result.data)).toBe(2);
    expect(result.suggestions).toEqual([]);
  });

  it("notDuplicate orders the pair", () => {
    expect(notDuplicate("z", "a", 5)).toEqual({ idA: "a", idB: "z", at: 5 });
  });
});

describe("§12.9 one phone offline", () => {
  it("case A: entered 2 min apart, uploaded hours later → auto-merged", () => {
    const offline = tx("A", 0, { firstSyncedAt: T0 + 8 * 60 * MIN });
    const online = tx("B", 2);
    const result = dedupe(ds([offline, online]), { now: T0 + 8 * 60 * MIN });
    expect(count(result.data)).toBe(1);
    // The earlier entry — the offline one — survives.
    expect(result.data.transactions[0].id).toBe(offline.id);
  });

  it("case B: entered hours apart, one uploaded late → suggested, not merged", () => {
    const offline = tx("A", 0, { firstSyncedAt: T0 + 8 * 60 * MIN });
    const online = tx("B", 240);
    const result = dedupe(ds([offline, online]), { now: T0 + 8 * 60 * MIN });
    expect(count(result.data)).toBe(2);
    expect(result.suggestions).toHaveLength(1);
    expect(new Set([result.suggestions[0].a.id, result.suggestions[0].b.id])).toEqual(
      new Set([offline.id, online.id]),
    );
  });

  it("case B with a row not uploaded yet counts as late too", () => {
    const pending = tx("A", 0, { firstSyncedAt: null });
    const online = tx("B", 240);
    expect(dedupe(ds([pending, online]), { now: T0 + 300 * MIN }).suggestions).toHaveLength(1);
  });

  it("both phones online, hours apart → two expenses, no suggestion", () => {
    const result = dedupe(ds([tx("A", 0), tx("B", 240)]), OPTS);
    expect(count(result.data)).toBe(2);
    expect(result.suggestions).toEqual([]);
  });
});

describe("§12.8 categories and budgets", () => {
  const cat = (id: string, name: string, over: Partial<CategoryRecord> = {}): CategoryRecord => ({
    id,
    name,
    icon: "paw",
    color: "#000",
    sortOrder: 9,
    isDefault: false,
    updatedAt: 10,
    ...over,
  });

  it("same name, different ids → one category, expenses re-pointed", () => {
    const expense = tx("B", 0, { categoryId: "c-pet-care-2" });
    const { data, merges } = dedupe(
      ds([expense], { categories: [cat("c-pet-care", "Pet care"), cat("c-pet-care-2", "pet-care ")] }),
      OPTS,
    );
    expect(data.categories.map((c) => c.id)).toEqual(["c-pet-care"]);
    expect(data.transactions[0].categoryId).toBe("c-pet-care");
    expect(data.transactions[0].updatedAt).toBe(expense.updatedAt + 1);
    expect(merges).toContainEqual({ entity: "category", survivor: "c-pet-care", duplicate: "c-pet-care-2" });
  });

  it("a default category wins a name clash", () => {
    const { data } = dedupe(
      ds([], { categories: [cat("a-custom", "Food"), cat("c-food", "Food", { isDefault: true })] }),
      OPTS,
    );
    expect(data.categories.map((c) => c.id)).toEqual(["c-food"]);
  });

  it("budgets with the same category and scope → the latest save stays", () => {
    const budget = (id: string, updatedAt: number): BudgetRecord => ({
      id,
      categoryId: "c-food",
      startMonth: "2026-11",
      endMonth: null,
      limitMinor: 500_000,
      createdAt: 1,
      updatedAt,
    });
    const { data } = dedupe(ds([], { budgets: [budget("b-1", 5), budget("b-2", 9)] }), OPTS);
    expect(data.budgets.map((b) => b.id)).toEqual(["b-2"]);
    expect(data.tombstones).toEqual([expect.objectContaining({ id: "b-1", mergedInto: "b-2" })]);
  });
});
