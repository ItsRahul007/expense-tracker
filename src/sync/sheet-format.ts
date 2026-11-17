/**
 * The spreadsheet layout, and conversion between it and sync records.
 *
 * Pure: no network, no SQLite, no React. Design §13.
 *
 * Each data tab has *display* columns (for people: a real date, a category
 * name, rupees) and *machine* columns (for sync: ids, integer paise, epoch ms).
 * Columns are located by header **name**, so a user reordering columns or
 * adding their own doesn't break anything. Derived display columns (Date,
 * Category, Amount, From/To) are regenerated on every write and never read.
 * Free-text fields that need no conversion — an expense's Note, a category's
 * Name/Icon/Color — have a single column that is both shown and read.
 */
import type { ID } from "@/types/domain";

import type {
  BudgetRecord,
  CategoryRecord,
  Dataset,
  ExceptionRecord,
  QuarantinedRow,
  SyncEntity,
  TombstoneRecord,
  TransactionRecord,
} from "./types";
import { emptyDataset } from "./types";

/** Bump when the layout changes incompatibly. Older apps refuse newer sheets. */
export const SHEET_SCHEMA_VERSION = 1;

export const TAB = {
  readme: "README",
  expenses: "Expenses",
  categories: "Categories",
  budgets: "Budgets",
  tombstones: "_deleted",
  exceptions: "_not_duplicates",
  meta: "_meta",
  errors: "_errors",
} as const;

export type TabName = (typeof TAB)[keyof typeof TAB];

/** Tabs the app reads on every sync, in a stable order. */
export const READ_TABS: TabName[] = [
  TAB.meta,
  TAB.expenses,
  TAB.categories,
  TAB.budgets,
  TAB.tombstones,
  TAB.exceptions,
  TAB.errors,
];

/** Tabs hidden from the user when the sheet is created. */
export const HIDDEN_TABS: TabName[] = [TAB.tombstones, TAB.exceptions, TAB.meta];

export type Cell = string | number | boolean | null;
export type Grid = Cell[][];

// --- headers ----------------------------------------------------------------

export const HEADERS = {
  [TAB.expenses]: {
    display: ["Date", "Category", "Amount (₹)", "Note"],
    machine: [
      "id",
      "category_id",
      "amount_minor",
      "occurred_at",
      "created_at",
      "created_device",
      "first_synced_at",
      "updated_at",
    ],
  },
  [TAB.categories]: {
    display: ["Name", "Icon", "Color", "Order"],
    machine: ["id", "sort_order", "is_default", "updated_at"],
  },
  [TAB.budgets]: {
    display: ["Category", "Monthly limit (₹)", "From", "To"],
    machine: [
      "id",
      "category_id",
      "start_month",
      "end_month",
      "limit_minor",
      "created_at",
      "updated_at",
    ],
  },
  [TAB.tombstones]: {
    display: [],
    machine: ["entity", "id", "deleted_at", "reason", "merged_into", "device"],
  },
  [TAB.exceptions]: { display: [], machine: ["id_a", "id_b", "at"] },
  [TAB.errors]: { display: ["Tab", "Row", "Problem", "Original values"], machine: [] },
} as const;

type DataTab = keyof typeof HEADERS;

const headerRow = (tab: DataTab): string[] => [
  ...HEADERS[tab].display,
  ...HEADERS[tab].machine,
];

// --- meta -------------------------------------------------------------------

export type SheetMeta = {
  schemaVersion: number;
  lastWriterDevice: string | null;
  lastWriteAt: number | null;
  appVersion: string | null;
};

// --- writing ------------------------------------------------------------------

/** Days since 1899-12-30, the epoch Sheets uses for dates, for the *local* day. */
export function sheetsDateSerial(epochMs: number): number {
  const d = new Date(epochMs);
  const utcMidnight = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return utcMidnight / 86_400_000 + 25_569;
}

const rupees = (minor: number) => minor / 100;

export type EncodeOptions = {
  deviceId: string;
  appVersion: string;
  now: number;
  quarantine: QuarantinedRow[];
};

/**
 * The full contents of every tab the app owns, header row first. Rows are
 * sorted the way a person would want to read them: newest expenses first,
 * categories in app order, budgets by start month.
 */
export function encodeDataset(data: Dataset, options: EncodeOptions): Record<TabName, Grid> {
  const names = new Map(data.categories.map((c) => [c.id, c.name]));
  const nameOf = (id: ID) => names.get(id) ?? "";

  const expenses = [...data.transactions]
    .sort((a, b) => b.occurredAt - a.occurredAt || b.createdAt - a.createdAt || cmp(a.id, b.id))
    .map((t): Cell[] => [
      sheetsDateSerial(t.occurredAt),
      nameOf(t.categoryId),
      rupees(t.amountMinor),
      t.note ?? "",
      t.id,
      t.categoryId,
      t.amountMinor,
      t.occurredAt,
      t.createdAt,
      t.createdDevice,
      t.firstSyncedAt ?? "",
      t.updatedAt,
    ]);

  const categories = [...data.categories]
    .sort((a, b) => a.sortOrder - b.sortOrder || cmp(a.id, b.id))
    .map((c): Cell[] => [
      c.name,
      c.icon,
      c.color,
      c.sortOrder,
      c.id,
      c.sortOrder,
      c.isDefault ? 1 : 0,
      c.updatedAt,
    ]);

  const budgets = [...data.budgets]
    .sort((a, b) => cmp(a.startMonth, b.startMonth) || a.createdAt - b.createdAt || cmp(a.id, b.id))
    .map((b): Cell[] => [
      nameOf(b.categoryId),
      rupees(b.limitMinor),
      b.startMonth,
      b.endMonth ?? "",
      b.id,
      b.categoryId,
      b.startMonth,
      b.endMonth ?? "",
      b.limitMinor,
      b.createdAt,
      b.updatedAt,
    ]);

  const tombstones = [...data.tombstones]
    .sort((a, b) => cmp(a.entity, b.entity) || cmp(a.id, b.id))
    .map((t): Cell[] => [t.entity, t.id, t.deletedAt, t.reason, t.mergedInto ?? "", t.device]);

  const exceptions = [...data.exceptions]
    .sort((a, b) => cmp(a.idA, b.idA) || cmp(a.idB, b.idB))
    .map((e): Cell[] => [e.idA, e.idB, e.at]);

  const errors = options.quarantine.map((q): Cell[] => [
    q.tab,
    q.row,
    q.reason,
    JSON.stringify(q.values),
  ]);

  const meta: Grid = [
    ["key", "value"],
    ["schema_version", SHEET_SCHEMA_VERSION],
    ["last_writer_device", options.deviceId],
    ["last_write_at", options.now],
    ["app_version", options.appVersion],
  ];

  return {
    [TAB.readme]: README,
    [TAB.expenses]: [headerRow(TAB.expenses), ...expenses],
    [TAB.categories]: [headerRow(TAB.categories), ...categories],
    [TAB.budgets]: [headerRow(TAB.budgets), ...budgets],
    [TAB.tombstones]: [headerRow(TAB.tombstones), ...tombstones],
    [TAB.exceptions]: [headerRow(TAB.exceptions), ...exceptions],
    [TAB.meta]: meta,
    [TAB.errors]: [headerRow(TAB.errors), ...errors],
  };
}

export const README: Grid = [
  ["Expense Tracker — your data"],
  [""],
  ["This spreadsheet is created and kept up to date by the Expense Tracker app."],
  ["Your phone holds the main copy; this sheet is a backup that also keeps your other devices in step."],
  [""],
  ["• You can read, sort, filter, chart and copy anything here."],
  ["• Please don't edit the grey columns or the hidden tabs — the app uses them."],
  ["• Add, edit and delete expenses in the app; changes made here may be overwritten."],
  ["• Deleting this file stops backups. The app will offer to recreate it from your phone."],
  ["• Anyone you share this file with can see your expenses."],
];

// --- reading ------------------------------------------------------------------

export type DecodeResult =
  | {
      ok: true;
      data: Dataset;
      meta: SheetMeta | null;
      quarantine: QuarantinedRow[];
      /** No data rows in any data tab — a new, cleared or replaced sheet (design §11.2). */
      isEmpty: boolean;
      /** Data rows per tab as read, used to blank leftover rows on the next write. */
      rowCounts: Partial<Record<TabName, number>>;
    }
  | { ok: false; error: "schema_newer"; sheetVersion: number }
  | { ok: false; error: "headers_missing"; tab: TabName; missing: string[] };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const cellText = (cell: Cell | undefined): string =>
  cell === null || cell === undefined ? "" : String(cell);

class RowError extends Error {}

/** Reads a row's machine cells by header name. */
function rowReader(index: Map<string, number>, row: Cell[]) {
  const raw = (header: string) => {
    const i = index.get(header);
    return i === undefined ? undefined : row[i];
  };

  const text = (header: string): string => {
    const value = cellText(raw(header)).trim();
    if (!value) throw new RowError(`${header} is empty`);
    return value;
  };
  const optText = (header: string): string | null => {
    const value = cellText(raw(header));
    return value === "" ? null : value;
  };
  const int = (header: string): number => {
    const value = raw(header);
    const n =
      typeof value === "number"
        ? value
        : /^-?\d+$/.test(cellText(value).trim())
          ? Number(cellText(value).trim())
          : NaN;
    if (!Number.isSafeInteger(n)) throw new RowError(`${header} is not a whole number`);
    return n;
  };
  const optInt = (header: string): number | null =>
    cellText(raw(header)).trim() === "" ? null : int(header);
  const month = (header: string): string => {
    const value = text(header);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new RowError(`${header} is not a YYYY-MM month`);
    return value;
  };
  const optMonth = (header: string): string | null =>
    cellText(raw(header)).trim() === "" ? null : month(header);

  return { text, optText, int, optInt, month, optMonth };
}

function indexHeaders(header: Cell[] | undefined): Map<string, number> {
  const index = new Map<string, number>();
  (header ?? []).forEach((cell, i) => {
    const name = cellText(cell).trim();
    if (name && !index.has(name)) index.set(name, i);
  });
  return index;
}

const isBlankRow = (row: Cell[]) => row.every((cell) => cellText(cell).trim() === "");

function parseTab<R>(
  tab: DataTab & TabName,
  grid: Grid | undefined,
  parse: (r: ReturnType<typeof rowReader>) => R,
  quarantine: QuarantinedRow[],
): { rows: R[]; missing: string[]; dataRows: number } {
  if (!grid || grid.length === 0) return { rows: [], missing: [], dataRows: 0 };

  const index = indexHeaders(grid[0]);
  const missing = HEADERS[tab].machine.filter((h) => !index.has(h));
  const body = grid.slice(1);
  if (missing.length > 0) return { rows: [], missing, dataRows: body.length };

  const rows: R[] = [];
  body.forEach((row, i) => {
    if (isBlankRow(row)) return;
    try {
      rows.push(parse(rowReader(index, row)));
    } catch (error) {
      if (!(error instanceof RowError)) throw error;
      quarantine.push({
        tab,
        row: i + 2, // 1-based, after the header
        reason: error.message,
        values: row.map(cellText),
      });
    }
  });
  return { rows, missing: [], dataRows: body.length };
}

const ENTITIES: SyncEntity[] = ["transaction", "category", "budget"];

/**
 * Parses what `values.batchGet` returned (with `UNFORMATTED_VALUE`) into
 * records. A tab that's absent or empty is treated as having no rows. A row
 * that fails to parse is quarantined rather than dropped, and never causes
 * anything to be deleted locally.
 */
export function decodeSheet(tabs: Partial<Record<TabName, Grid>>): DecodeResult {
  // Meta first: a newer layout means this app must not interpret anything.
  const meta = decodeMeta(tabs[TAB.meta]);
  if (meta && meta.schemaVersion > SHEET_SCHEMA_VERSION) {
    return { ok: false, error: "schema_newer", sheetVersion: meta.schemaVersion };
  }

  const quarantine: QuarantinedRow[] = decodeErrors(tabs[TAB.errors]);
  const data = emptyDataset();
  const rowCounts: Partial<Record<TabName, number>> = {};

  const expenses = parseTab(
    TAB.expenses,
    tabs[TAB.expenses],
    (r): TransactionRecord => {
      const amountMinor = r.int("amount_minor");
      if (amountMinor <= 0) throw new RowError("amount_minor must be positive");
      return {
        id: r.text("id"),
        categoryId: r.text("category_id"),
        amountMinor,
        occurredAt: r.int("occurred_at"),
        note: r.optText("Note"),
        createdAt: r.int("created_at"),
        createdDevice: r.text("created_device"),
        firstSyncedAt: r.optInt("first_synced_at"),
        updatedAt: r.int("updated_at"),
      };
    },
    quarantine,
  );
  if (expenses.missing.length) return headersMissing(TAB.expenses, expenses.missing);
  data.transactions = expenses.rows;
  rowCounts[TAB.expenses] = expenses.dataRows;

  const categories = parseTab(
    TAB.categories,
    tabs[TAB.categories],
    (r): CategoryRecord => ({
      id: r.text("id"),
      name: r.text("Name"),
      icon: r.text("Icon"),
      color: r.text("Color"),
      sortOrder: r.int("sort_order"),
      isDefault: r.int("is_default") === 1,
      updatedAt: r.int("updated_at"),
    }),
    quarantine,
  );
  if (categories.missing.length) return headersMissing(TAB.categories, categories.missing);
  data.categories = categories.rows;
  rowCounts[TAB.categories] = categories.dataRows;

  const budgets = parseTab(
    TAB.budgets,
    tabs[TAB.budgets],
    (r): BudgetRecord => {
      const startMonth = r.month("start_month");
      const endMonth = r.optMonth("end_month");
      if (endMonth !== null && endMonth < startMonth) throw new RowError("end_month is before start_month");
      const limitMinor = r.int("limit_minor");
      if (limitMinor <= 0) throw new RowError("limit_minor must be positive");
      return {
        id: r.text("id"),
        categoryId: r.text("category_id"),
        startMonth,
        endMonth,
        limitMinor,
        createdAt: r.int("created_at"),
        updatedAt: r.int("updated_at"),
      };
    },
    quarantine,
  );
  if (budgets.missing.length) return headersMissing(TAB.budgets, budgets.missing);
  data.budgets = budgets.rows;
  rowCounts[TAB.budgets] = budgets.dataRows;

  const tombstones = parseTab(
    TAB.tombstones,
    tabs[TAB.tombstones],
    (r): TombstoneRecord => {
      const entity = r.text("entity") as SyncEntity;
      if (!ENTITIES.includes(entity)) throw new RowError(`unknown entity "${entity}"`);
      const reason = r.text("reason");
      if (reason !== "user" && reason !== "duplicate") throw new RowError(`unknown reason "${reason}"`);
      return {
        entity,
        id: r.text("id"),
        deletedAt: r.int("deleted_at"),
        reason,
        mergedInto: r.optText("merged_into"),
        device: r.text("device"),
      };
    },
    quarantine,
  );
  if (tombstones.missing.length) return headersMissing(TAB.tombstones, tombstones.missing);
  data.tombstones = tombstones.rows;
  rowCounts[TAB.tombstones] = tombstones.dataRows;

  const exceptions = parseTab(
    TAB.exceptions,
    tabs[TAB.exceptions],
    (r): ExceptionRecord => {
      const a = r.text("id_a");
      const b = r.text("id_b");
      return { idA: a < b ? a : b, idB: a < b ? b : a, at: r.int("at") };
    },
    quarantine,
  );
  if (exceptions.missing.length) return headersMissing(TAB.exceptions, exceptions.missing);
  data.exceptions = exceptions.rows;
  rowCounts[TAB.exceptions] = exceptions.dataRows;

  rowCounts[TAB.errors] = Math.max(0, (tabs[TAB.errors]?.length ?? 1) - 1);
  rowCounts[TAB.meta] = Math.max(0, (tabs[TAB.meta]?.length ?? 1) - 1);
  rowCounts[TAB.readme] = tabs[TAB.readme]?.length ?? 0;

  const isEmpty =
    data.transactions.length === 0 &&
    data.categories.length === 0 &&
    data.budgets.length === 0 &&
    data.tombstones.length === 0 &&
    quarantine.length === 0;

  return { ok: true, data, meta, quarantine, isEmpty, rowCounts };
}

function headersMissing(tab: TabName, missing: string[]): DecodeResult {
  return { ok: false, error: "headers_missing", tab, missing };
}

/**
 * A fingerprint of the last write to the sheet, from `_meta`. Every push
 * rewrites `last_write_at` / `last_writer_device`, so if this matches what a
 * device saw after its own last sync, nobody has written since — the fast
 * path (design §7.4). Drive's file `version` can't be used for this: it
 * doesn't move when cells change through the Sheets API.
 */
export function metaStamp(meta: SheetMeta | null): string | null {
  if (!meta || meta.lastWriteAt === null) return null;
  return `${meta.lastWriteAt}:${meta.lastWriterDevice ?? ""}`;
}

/** `_meta` alone, for the fast path. */
export function decodeMetaTab(grid: Grid | undefined): SheetMeta | null {
  return decodeMeta(grid);
}

function decodeMeta(grid: Grid | undefined): SheetMeta | null {
  if (!grid || grid.length < 2) return null;
  const map = new Map<string, Cell>();
  for (const row of grid.slice(1)) map.set(cellText(row[0]).trim(), row[1] ?? null);

  const num = (key: string) => {
    const n = Number(cellText(map.get(key)));
    return cellText(map.get(key)) !== "" && Number.isFinite(n) ? n : null;
  };
  return {
    schemaVersion: num("schema_version") ?? SHEET_SCHEMA_VERSION,
    lastWriterDevice: cellText(map.get("last_writer_device")) || null,
    lastWriteAt: num("last_write_at"),
    appVersion: cellText(map.get("app_version")) || null,
  };
}

/** Existing `_errors` rows are carried forward so nothing a person typed is lost. */
function decodeErrors(grid: Grid | undefined): QuarantinedRow[] {
  if (!grid || grid.length < 2) return [];
  return grid
    .slice(1)
    .filter((row) => !isBlankRow(row))
    .map((row) => {
      let values: string[] = [];
      try {
        const parsed: unknown = JSON.parse(cellText(row[3]));
        if (Array.isArray(parsed)) values = parsed.map((v) => cellText(v as Cell));
      } catch {
        values = [cellText(row[3])];
      }
      return {
        tab: cellText(row[0]),
        row: Number(cellText(row[1])) || 0,
        reason: cellText(row[2]),
        values,
      };
    });
}

/** Removes duplicates by content, so re-reading the same bad row doesn't stack copies. */
export function uniqueQuarantine(rows: QuarantinedRow[]): QuarantinedRow[] {
  const seen = new Set<string>();
  return rows.filter((q) => {
    const key = JSON.stringify([q.tab, q.reason, q.values]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Pads a tab's grid with blank rows up to `previousRows` data rows, so a single
 * write also clears leftovers from a longer previous version (design §10.3 step
 * 10) — no separate clear request.
 */
export function padGrid(grid: Grid, previousDataRows: number): Grid {
  const width = Math.max(1, ...grid.map((row) => row.length));
  const target = previousDataRows + 1; // + header
  if (grid.length >= target) return grid;
  const blank = (): Cell[] => Array.from({ length: width }, () => "");
  return [...grid, ...Array.from({ length: target - grid.length }, blank)];
}

/** Number of display columns at the start of a tab — the rest are machine columns. */
export function displayColumnCount(tab: TabName): number {
  return tab in HEADERS ? HEADERS[tab as DataTab].display.length : 0;
}

/** Total header width of a tab. */
export function columnCount(tab: TabName): number {
  return tab in HEADERS ? headerRow(tab as DataTab).length : 2;
}
