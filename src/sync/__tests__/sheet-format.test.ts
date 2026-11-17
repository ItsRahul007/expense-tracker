import {
  type Cell,
  decodeSheet,
  encodeDataset,
  type Grid,
  HEADERS,
  padGrid,
  SHEET_SCHEMA_VERSION,
  sheetsDateSerial,
  TAB,
  type TabName,
  uniqueQuarantine,
} from "../sheet-format";
import type { Dataset } from "../types";

const OPTIONS = { deviceId: "d-a", appVersion: "1.0.0", now: 1_763_200_000_000, quarantine: [] };

function sample(): Dataset {
  return {
    categories: [
      { id: "c-food", name: "Food", icon: "restaurant", color: "#f00", sortOrder: 1, isDefault: true, updatedAt: 0 },
      { id: "c-pets", name: "Pets 🐶", icon: "🐶", color: "#0f0", sortOrder: 9, isDefault: false, updatedAt: 5 },
    ],
    transactions: [
      {
        id: "t-1",
        amountMinor: 24_950,
        categoryId: "c-food",
        occurredAt: new Date(2026, 10, 14, 12).getTime(),
        note: 'Lunch, "team", =SUM(A1)\nline two',
        createdAt: 1_763_100_000_000,
        createdDevice: "d-a",
        firstSyncedAt: null,
        updatedAt: 1_763_100_000_000,
      },
      {
        id: "t-2",
        amountMinor: 1,
        categoryId: "c-pets",
        occurredAt: new Date(2026, 10, 15, 12).getTime(),
        note: null,
        createdAt: 1_763_150_000_000,
        createdDevice: "legacy",
        firstSyncedAt: 1_763_160_000_000,
        updatedAt: 1_763_150_000_001,
      },
    ],
    budgets: [
      { id: "b-1", categoryId: "c-food", startMonth: "2026-11", endMonth: null, limitMinor: 500_000, createdAt: 1, updatedAt: 2 },
      { id: "b-2", categoryId: "c-pets", startMonth: "2026-01", endMonth: "2026-12", limitMinor: 100, createdAt: 3, updatedAt: 4 },
    ],
    tombstones: [
      { entity: "transaction", id: "t-9", deletedAt: 10, reason: "duplicate", mergedInto: "t-1", device: "d-b" },
      { entity: "budget", id: "b-9", deletedAt: 11, reason: "user", mergedInto: null, device: "d-a" },
    ],
    exceptions: [{ idA: "t-3", idB: "t-4", at: 12 }],
  };
}

/** What the Sheets API hands back: trailing empty cells dropped, like the real thing. */
function asReturned(grid: Grid): Grid {
  return grid.map((row) => {
    const copy = [...row];
    while (copy.length && (copy[copy.length - 1] === "" || copy[copy.length - 1] === null)) copy.pop();
    return copy;
  });
}

function roundTrip(data: Dataset) {
  const tabs = encodeDataset(data, OPTIONS);
  const returned = Object.fromEntries(
    Object.entries(tabs).map(([tab, grid]) => [tab, asReturned(grid)]),
  ) as Record<TabName, Grid>;
  return decodeSheet(returned);
}

const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));

describe("encode → decode round trip", () => {
  it("preserves every record exactly", () => {
    const data = sample();
    const result = roundTrip(data);
    if (!result.ok) throw new Error(JSON.stringify(result));

    expect(byId(result.data.transactions)).toEqual(byId(data.transactions));
    expect(byId(result.data.categories)).toEqual(byId(data.categories));
    expect(byId(result.data.budgets)).toEqual(byId(data.budgets));
    expect(result.data.tombstones).toHaveLength(2);
    expect(result.data.tombstones).toEqual(expect.arrayContaining(data.tombstones));
    expect(result.data.exceptions).toEqual(data.exceptions);
    expect(result.quarantine).toEqual([]);
    expect(result.isEmpty).toBe(false);
    expect(result.meta).toEqual({
      schemaVersion: SHEET_SCHEMA_VERSION,
      lastWriterDevice: "d-a",
      lastWriteAt: OPTIONS.now,
      appVersion: "1.0.0",
    });
  });

  it("writes human-readable display columns", () => {
    const tabs = encodeDataset(sample(), OPTIONS);
    const [header, newest] = tabs[TAB.expenses];
    expect(header.slice(0, 4)).toEqual(["Date", "Category", "Amount (₹)", "Note"]);
    // Newest first.
    expect(newest[1]).toBe("Pets 🐶");
    expect(newest[2]).toBe(0.01);
    expect(tabs[TAB.expenses][2][2]).toBe(249.5);
    expect(tabs[TAB.budgets][1].slice(0, 4)).toEqual(["Pets 🐶", 1, "2026-01", "2026-12"]);
  });

  it("an empty dataset decodes as empty", () => {
    const result = roundTrip({ transactions: [], categories: [], budgets: [], tombstones: [], exceptions: [] });
    expect(result.ok && result.isEmpty).toBe(true);
  });
});

describe("sheetsDateSerial", () => {
  it("matches Sheets' epoch for the local calendar day", () => {
    expect(sheetsDateSerial(new Date(1970, 0, 1, 12).getTime())).toBe(25_569);
    expect(sheetsDateSerial(new Date(2026, 10, 14, 0, 1).getTime())).toBe(
      sheetsDateSerial(new Date(2026, 10, 14, 23, 59).getTime()),
    );
  });
});

describe("decodeSheet robustness", () => {
  const expensesHeader = [...HEADERS[TAB.expenses].display, ...HEADERS[TAB.expenses].machine];

  it("finds columns by name, whatever their order", () => {
    const header = [...expensesHeader].reverse();
    const values: Record<string, Cell> = {
      id: "t-1",
      category_id: "c-food",
      amount_minor: 100,
      occurred_at: 5,
      created_at: 6,
      created_device: "d-a",
      first_synced_at: "",
      updated_at: 7,
      Note: "hi",
      "My own column": "ignored",
    };
    const result = decodeSheet({
      [TAB.expenses]: [[...header, "My own column"], [...header.map((h) => values[h] ?? ""), "ignored"]],
    });
    expect(result.ok && result.data.transactions).toEqual([
      {
        id: "t-1",
        categoryId: "c-food",
        amountMinor: 100,
        occurredAt: 5,
        note: "hi",
        createdAt: 6,
        createdDevice: "d-a",
        firstSyncedAt: null,
        updatedAt: 7,
      },
    ]);
  });

  it("accepts numbers that come back as numeric strings", () => {
    const result = decodeSheet({
      [TAB.expenses]: [
        expensesHeader,
        ["", "", "", "", "t-1", "c-food", "100", "5", "6", "d-a", "", "7"],
      ],
    });
    expect(result.ok && result.data.transactions[0].amountMinor).toBe(100);
  });

  it("quarantines bad rows instead of dropping or failing", () => {
    const result = decodeSheet({
      [TAB.expenses]: [
        expensesHeader,
        ["", "", "", "", "t-1", "c-food", "abc", 5, 6, "d-a", "", 7],
        ["", "", "", "", "t-2", "c-food", -5, 5, 6, "d-a", "", 7],
        ["", "", "", "", "", "c-food", 1, 5, 6, "d-a", "", 7],
        ["", "", "", "", "t-4", "c-food", 1, 5, 6, "d-a", "", 7],
        [],
      ],
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.transactions.map((t) => t.id)).toEqual(["t-4"]);
    expect(result.quarantine.map((q) => [q.row, q.reason])).toEqual([
      [2, "amount_minor is not a whole number"],
      [3, "amount_minor must be positive"],
      [4, "id is empty"],
    ]);
  });

  it("rejects bad budget months", () => {
    const header = [...HEADERS[TAB.budgets].display, ...HEADERS[TAB.budgets].machine];
    const result = decodeSheet({
      [TAB.budgets]: [header, ["", "", "", "", "b-1", "c-food", "2026-13", "", 100, 1, 2]],
    });
    expect(result.ok && result.quarantine[0].reason).toBe("start_month is not a YYYY-MM month");
  });

  it("refuses a sheet with a missing machine column", () => {
    const result = decodeSheet({
      [TAB.expenses]: [expensesHeader.filter((h) => h !== "updated_at"), []],
    });
    expect(result).toEqual({ ok: false, error: "headers_missing", tab: TAB.expenses, missing: ["updated_at"] });
  });

  it("refuses a sheet written by a newer app", () => {
    const result = decodeSheet({
      [TAB.meta]: [["key", "value"], ["schema_version", SHEET_SCHEMA_VERSION + 1]],
    });
    expect(result).toEqual({ ok: false, error: "schema_newer", sheetVersion: SHEET_SCHEMA_VERSION + 1 });
  });

  it("carries existing _errors rows forward", () => {
    const tabs = encodeDataset(sample(), {
      ...OPTIONS,
      quarantine: [{ tab: TAB.expenses, row: 7, reason: "bad", values: ["a", "b"] }],
    });
    const result = decodeSheet(tabs);
    expect(result.ok && result.quarantine).toEqual([{ tab: TAB.expenses, row: 7, reason: "bad", values: ["a", "b"] }]);
    expect(result.ok && result.isEmpty).toBe(false);
  });
});

describe("helpers", () => {
  it("padGrid blanks leftover rows from a longer previous write", () => {
    const grid: Grid = [["h1", "h2"], ["a", "b"]];
    expect(padGrid(grid, 3)).toEqual([["h1", "h2"], ["a", "b"], ["", ""], ["", ""]]);
    expect(padGrid(grid, 0)).toBe(grid);
  });

  it("uniqueQuarantine drops repeats", () => {
    const q = { tab: "Expenses", row: 2, reason: "x", values: ["1"] };
    expect(uniqueQuarantine([q, { ...q, row: 9 }])).toHaveLength(1);
  });
});
