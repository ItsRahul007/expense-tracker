/**
 * Turning a CSV file into expenses.
 *
 * Two pure steps, deliberately separate and deliberately free of any database
 * access:
 *
 *   1. `parseLedgerCsv` — text in, candidate rows plus a reason for every row
 *      it wouldn't take. It never throws and never half-fails: a bad row is
 *      reported, not fatal, because one unreadable date in a file of three
 *      hundred shouldn't cost the other two hundred and ninety-nine.
 *   2. `planImport` — those rows against what's already stored, resolving
 *      category names to ids, drafting the categories that don't exist yet, and
 *      flagging rows that are already recorded.
 *
 * Keeping both pure is what lets the import screen show a full preview before
 * anything is written: the plan it renders is the same object it later hands to
 * `useImportTransactions`, so what you confirm is exactly what gets inserted.
 */

import { CATEGORY_COLORS } from "@/constants/category-options";
import type {
  Category,
  ID,
  ImportRequest,
  NewTransaction,
  Transaction,
} from "@/types/domain";

import { makeCategoryId } from "./category-id";
import { isBlankRow, parseCsvRows } from "./csv";

/** A row that parsed cleanly, still holding its category as written. */
export type ImportedRow = {
  /** 1-based row number in the file, header included — what a spreadsheet shows. */
  row: number;
  occurredAt: number;
  categoryName: string;
  amountMinor: number;
  note: string | null;
};

export type SkippedRow = {
  row: number;
  /** Shown to the user verbatim, so it names the offending value. */
  reason: string;
};

export type LedgerCsv =
  | { ok: true; rows: ImportedRow[]; skipped: SkippedRow[] }
  | { ok: false; error: string };

/** A candidate row paired with the expense it would become. */
export type ImportEntry = {
  row: ImportedRow;
  transaction: NewTransaction;
  /** An identical expense — same day, category, amount and note — is already
   *  recorded. Excluded by default; see `buildImportRequest`. */
  duplicate: boolean;
};

export type ImportPlan = {
  entries: ImportEntry[];
  /** Categories the file names that don't exist yet, drafted and ready to insert. */
  newCategories: Category[];
  skipped: SkippedRow[];
};

/**
 * The icon and time-of-day defaults for anything a file brings in.
 *
 * `ellipsis-horizontal` is the same "no idea what this is" glyph the
 * transaction rows already fall back to for an unknown category, so an imported
 * category looks like what it is until someone gives it a better one.
 *
 * Noon, rather than midnight, for a date with no time in it: the day is what
 * was actually recorded, and putting the timestamp in the middle of it means no
 * amount of timezone drift can slide an expense into the day before or after.
 */
const IMPORTED_CATEGORY_ICON = "ellipsis-horizontal";
const MIDDAY_HOUR = 12;

/** ₹1,00,00,00,000 in paise. Past this it's a mis-parsed column, not an expense. */
const MAX_AMOUNT_MINOR = 1_000_000_000_00;

// --- columns ----------------------------------------------------------------

type ColumnMap = { date: number; category: number; amount: number; note: number };

/**
 * Header names accepted for each column, normalised.
 *
 * Wider than our own export's four, because the file worth importing is often
 * one someone already had — a bank statement, a spreadsheet they keep, another
 * tracker's export — and "Narration" or "Particulars" is the same column as
 * "Note". Matching is on normalised text (see `normaliseHeader`), so
 * "Amount (INR)" and "amount inr" are the same key.
 */
const HEADER_ALIASES: Record<keyof ColumnMap, string[]> = {
  date: ["date", "day", "when", "occurred", "occurred at", "transaction date", "date time", "datetime", "posted"],
  category: ["category", "categories", "tag", "tags", "type", "head", "group"],
  amount: ["amount", "amount inr", "amount rs", "amount rupees", "value", "total", "spent", "debit", "price", "cost", "withdrawal"],
  note: ["note", "notes", "description", "memo", "details", "detail", "remark", "remarks", "particulars", "narration", "merchant", "payee"],
};

function normaliseHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The column layout of the first row, or null if it isn't a header at all. */
function readHeader(cells: string[]): ColumnMap | null {
  const found: Partial<Record<keyof ColumnMap, number>> = {};

  cells.forEach((cell, index) => {
    const name = normaliseHeader(cell);
    if (name === "") return;
    for (const key of Object.keys(HEADER_ALIASES) as (keyof ColumnMap)[]) {
      // First match wins: a file with both "Debit" and "Amount" columns should
      // use whichever came first rather than silently preferring the later one.
      if (found[key] === undefined && HEADER_ALIASES[key].includes(name)) {
        found[key] = index;
        return;
      }
    }
  });

  // A note is optional — plenty of exports have none, and an expense without one
  // is perfectly valid. The other three are the expense.
  if (found.date === undefined || found.category === undefined || found.amount === undefined) {
    return null;
  }
  return {
    date: found.date,
    category: found.category,
    amount: found.amount,
    note: found.note ?? -1,
  };
}

// --- values -----------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]+(.+))?$/;
const NUMERIC_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[T ]+(.+))?$/;
const DAY_MONTH_NAME = /^(\d{1,2})[ -]([A-Za-z]{3,})[ -](\d{4})(?:[T ]+(.+))?$/;
const MONTH_NAME_DAY = /^([A-Za-z]{3,})[ -](\d{1,2}),?[ -](\d{4})(?:[T ]+(.+))?$/;
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*([ap])?\.?m?\.?/i;

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function monthFromName(name: string): number | null {
  const wanted = name.trim().toLowerCase();
  const index = MONTH_NAMES.findIndex((month) => month.startsWith(wanted.slice(0, 3)));
  // `startsWith` on the first three letters accepts "Aug", "Augu" and "August"
  // alike; anything that isn't a month at all still fails here.
  return index === -1 || wanted.length < 3 ? null : index + 1;
}

type Parts = { year: number; month: number; day: number; time: string | undefined };

function splitDate(text: string): Parts | null {
  const iso = ISO_DATE.exec(text);
  if (iso) {
    return { year: +iso[1], month: +iso[2], day: +iso[3], time: iso[4] };
  }

  const numeric = NUMERIC_DATE.exec(text);
  if (numeric) {
    let day = +numeric[1];
    let month = +numeric[2];
    // Day-first, the convention this app is written for — but a first field
    // over 12 with a second field that isn't can only be month-first, and
    // guessing wrong there would file the expense in the wrong month.
    if (month > 12 && day <= 12) [day, month] = [month, day];
    return { year: +numeric[3], month, day, time: numeric[4] };
  }

  const dayFirst = DAY_MONTH_NAME.exec(text);
  if (dayFirst) {
    const month = monthFromName(dayFirst[2]);
    return month === null
      ? null
      : { year: +dayFirst[3], month, day: +dayFirst[1], time: dayFirst[4] };
  }

  const monthFirst = MONTH_NAME_DAY.exec(text);
  if (monthFirst) {
    const month = monthFromName(monthFirst[1]);
    return month === null
      ? null
      : { year: +monthFirst[3], month, day: +monthFirst[2], time: monthFirst[4] };
  }

  return null;
}

function readTime(text: string): { hour: number; minute: number; second: number } | null {
  const match = TIME.exec(text.trim());
  if (!match) return null;

  let hour = +match[1];
  const minute = +match[2];
  const second = match[3] === undefined ? 0 : +match[3];
  const meridiem = match[4]?.toLowerCase();

  if (meridiem === "a" && hour === 12) hour = 0;
  if (meridiem === "p" && hour < 12) hour += 12;
  if (hour > 23 || minute > 59 || second > 59) return null;

  return { hour, minute, second };
}

/**
 * A date cell → epoch ms on that *local* calendar day.
 *
 * Accepts, in order: `2026-08-05` (what `exportAllData` writes), `05/08/2026`
 * and `05-08-2026` and `05.08.2026`, `5 Aug 2026`, and `Aug 5, 2026`. A time of
 * day after any of them is used if it's readable and ignored if it isn't —
 * losing a time still files the expense on the right day, which is what the
 * whole app groups by.
 *
 * A trailing zone marker ("Z", "+05:30") is deliberately *not* honoured. Every
 * date in this app means a wall-clock day to the person who spent the money, so
 * a timestamp is read as local throughout; converting would let an evening
 * expense land on the following morning.
 *
 * Exported because the header sniffing needs to ask "is this first cell a
 * date?" to tell a headerless file from an unrecognised one.
 */
export function parseCsvDate(value: string): number | null {
  const text = value.trim();
  if (text === "") return null;

  const parts = splitDate(text);
  if (!parts) return null;

  const time = parts.time ? readTime(parts.time) : null;
  const { hour, minute, second } = time ?? { hour: MIDDAY_HOUR, minute: 0, second: 0 };

  const date = new Date(parts.year, parts.month - 1, parts.day, hour, minute, second, 0);
  // The Date constructor rolls 31 February forward to 3 March rather than
  // failing, so the only way to reject an impossible date is to read it back.
  if (
    date.getFullYear() !== parts.year ||
    date.getMonth() !== parts.month - 1 ||
    date.getDate() !== parts.day
  ) {
    return null;
  }
  return date.getTime();
}

/**
 * An amount cell → signed minor units, or null if it isn't a number.
 *
 * Tolerant of the decoration a real file carries: a currency symbol or "Rs",
 * digit grouping in either the Indian or the Western style, and stray spaces.
 * The sign is kept rather than taken as an absolute value — this app records
 * expenses only, and the caller reports a zero or negative row as skipped
 * instead of quietly filing a refund as money spent.
 */
export function parseCsvAmount(value: string): number | null {
  const cleaned = value
    .trim()
    .replace(/[₹$€£]/g, "")
    .replace(/\b(?:inr|rs|rupees?)\b\.?/gi, "")
    // \u00a0 and \u202f: the no-break and narrow no-break spaces some locales
    // group digits with, which \s does not cover in every engine.
    .replace(/[,\s\u00a0\u202f]/g, "");

  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;

  const rupees = Number(cleaned);
  if (!Number.isFinite(rupees)) return null;

  const minor = Math.round(rupees * 100);
  if (!Number.isSafeInteger(minor) || Math.abs(minor) > MAX_AMOUNT_MINOR) return null;
  return minor;
}

// --- step one: text → rows --------------------------------------------------

/**
 * Reads a whole file into candidate expenses.
 *
 * Fails outright — `ok: false` — only when there's nothing to work with at all:
 * an empty file, or one whose columns can't be identified. Everything else is
 * per-row, so the caller can show what came through alongside what didn't.
 */
export function parseLedgerCsv(text: string): LedgerCsv {
  const records = parseCsvRows(text)
    // Numbered before the blanks are dropped, so a reported row number still
    // matches the line the user is looking at in their spreadsheet.
    .map((cells, index) => ({ row: index + 1, cells }))
    .filter((record) => !isBlankRow(record.cells));

  if (records.length === 0) {
    return { ok: false, error: "That file has nothing in it." };
  }

  const header = readHeader(records[0].cells);
  let columns: ColumnMap;
  let body: typeof records;

  if (header) {
    columns = header;
    body = records.slice(1);
  } else if (records[0].cells.length >= 3 && parseCsvDate(records[0].cells[0]) !== null) {
    // No header, but the first row starts with a date — assume the column order
    // this app's own export writes, which is also the obvious one to write by
    // hand. Nothing is guessed here that the preview won't show before it's saved.
    columns = { date: 0, category: 1, amount: 2, note: 3 };
    body = records;
  } else {
    return {
      ok: false,
      error:
        "Couldn’t find Date, Category and Amount columns in that file. Check the first row names them, or that it starts straight in with a date.",
    };
  }

  if (body.length === 0) {
    return { ok: false, error: "That file has a header row and nothing under it." };
  }

  const rows: ImportedRow[] = [];
  const skipped: SkippedRow[] = [];
  const cellAt = (cells: string[], index: number) =>
    index < 0 ? "" : (cells[index] ?? "").trim();

  for (const { row, cells } of body) {
    const dateText = cellAt(cells, columns.date);
    const categoryText = cellAt(cells, columns.category);
    const amountText = cellAt(cells, columns.amount);
    const noteText = cellAt(cells, columns.note);

    const occurredAt = parseCsvDate(dateText);
    if (occurredAt === null) {
      skipped.push({
        row,
        reason: dateText === "" ? "No date" : `Couldn’t read the date “${dateText}”`,
      });
      continue;
    }

    if (categoryText === "") {
      skipped.push({ row, reason: "No category" });
      continue;
    }

    const amountMinor = parseCsvAmount(amountText);
    if (amountMinor === null) {
      skipped.push({
        row,
        reason: amountText === "" ? "No amount" : `Couldn’t read the amount “${amountText}”`,
      });
      continue;
    }
    if (amountMinor <= 0) {
      // Not a silent absolute value: a negative row in a bank export is usually
      // money coming *in*, and this app tracks spending only.
      skipped.push({ row, reason: `Amount isn’t an expense (“${amountText}”)` });
      continue;
    }

    rows.push({
      row,
      occurredAt,
      categoryName: categoryText,
      amountMinor,
      note: noteText === "" ? null : noteText,
    });
  }

  return { ok: true, rows, skipped };
}

// --- step two: rows → a plan ------------------------------------------------

/** Category names are matched on this: case and inner spacing don't make two
 *  categories out of "Eating out" and "eating  out". */
function categoryKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function startOfLocalDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * What makes two expenses "the same one".
 *
 * The day rather than the timestamp, because a CSV usually carries no time and
 * an imported row lands at noon — comparing timestamps would call every
 * re-import a new expense and quietly double the ledger.
 */
function fingerprint(tx: {
  occurredAt: number;
  categoryId: ID;
  amountMinor: number;
  note: string | null;
}): string {
  const note = (tx.note ?? "").trim().toLowerCase();
  return `${startOfLocalDay(tx.occurredAt)}|${tx.categoryId}|${tx.amountMinor}|${note}`;
}

/**
 * Resolves parsed rows against what's stored: category names become ids, names
 * with no category yet get one drafted, and rows already in the ledger are
 * flagged.
 *
 * `existing` is the whole transaction table. That's the point of doing this
 * here rather than in SQL — the screen already holds every transaction for its
 * counts, and re-importing the same file is the single most likely thing anyone
 * does with this feature, so the check has to be in front of them *before* they
 * confirm, not a constraint that fires afterwards.
 */
export function planImport({
  rows,
  skipped,
  categories,
  existing,
}: {
  rows: ImportedRow[];
  skipped: SkippedRow[];
  categories: Category[];
  existing: Transaction[];
}): ImportPlan {
  const idByName = new Map<string, ID>();
  for (const category of categories) idByName.set(categoryKey(category.name), category.id);

  const takenIds = new Set(categories.map((category) => category.id));
  const newCategories: Category[] = [];

  const resolveCategory = (name: string): ID => {
    const key = categoryKey(name);
    const existingId = idByName.get(key);
    if (existingId) return existingId;

    const position = categories.length + newCategories.length;
    const draft: Category = {
      id: makeCategoryId(name, takenIds),
      name: name.trim().replace(/\s+/g, " "),
      icon: IMPORTED_CATEGORY_ICON,
      // Walked round the palette from where the existing categories left off,
      // so a file that adds five categories doesn't make five identical badges.
      color: CATEGORY_COLORS[position % CATEGORY_COLORS.length],
      sortOrder: position + 1,
    };

    newCategories.push(draft);
    takenIds.add(draft.id);
    idByName.set(key, draft.id);
    return draft.id;
  };

  // A count per fingerprint, not a set: a file that genuinely holds two
  // identical expenses on one day should match only the first against the one
  // already recorded, and import the second.
  const unmatched = new Map<string, number>();
  for (const tx of existing) {
    const key = fingerprint(tx);
    unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
  }

  const entries = rows.map((row): ImportEntry => {
    const transaction: NewTransaction = {
      amountMinor: row.amountMinor,
      categoryId: resolveCategory(row.categoryName),
      occurredAt: row.occurredAt,
      note: row.note,
    };

    const key = fingerprint(transaction);
    const remaining = unmatched.get(key) ?? 0;
    if (remaining > 0) unmatched.set(key, remaining - 1);

    return { row, transaction, duplicate: remaining > 0 };
  });

  return { entries, newCategories, skipped };
}

/**
 * The plan narrowed to what's actually being written.
 *
 * Drops the categories nothing left in the list refers to. In practice a new
 * category can't be reached by a duplicate row — a duplicate implies an
 * existing expense filed under that category, which implies the category
 * exists — but deriving the set from the transactions rather than assuming that
 * keeps the two from being able to disagree.
 */
export function buildImportRequest(
  plan: ImportPlan,
  includeDuplicates: boolean,
): ImportRequest {
  const transactions = plan.entries
    .filter((entry) => includeDuplicates || !entry.duplicate)
    .map((entry) => entry.transaction);

  const used = new Set(transactions.map((tx) => tx.categoryId));
  return {
    categories: plan.newCategories.filter((category) => used.has(category.id)),
    transactions,
  };
}
