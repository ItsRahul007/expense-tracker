/**
 * Spreadsheet structure: the tabs, and how they look. Pure — produces Sheets
 * API `batchUpdate` requests. Design §13 ("On creation").
 *
 * Used both when the sheet is first created and when a sync finds tabs missing
 * (a user deleted one), so the layout can always be restored.
 */
import type { SheetProperties } from "./google-api";
import {
  columnCount,
  displayColumnCount,
  HIDDEN_TABS,
  TAB,
  type TabName,
} from "./sheet-format";

/** Tab order as the user sees it; hidden ones go last. */
export const TAB_ORDER: TabName[] = [
  TAB.readme,
  TAB.expenses,
  TAB.categories,
  TAB.budgets,
  TAB.errors,
  TAB.tombstones,
  TAB.exceptions,
  TAB.meta,
];

const GREY = { red: 0.55, green: 0.57, blue: 0.6 };

const DATA_TABS = new Set<TabName>([TAB.expenses, TAB.categories, TAB.budgets]);

/** Number formats for display columns: [tab, 0-based column, pattern, type]. */
const FORMATS: [TabName, number, string, "DATE" | "NUMBER"][] = [
  [TAB.expenses, 0, "yyyy-mm-dd", "DATE"],
  [TAB.expenses, 2, "#,##0.00", "NUMBER"],
  [TAB.budgets, 1, "#,##0.00", "NUMBER"],
];

function formatTab(tab: TabName, sheetId: number): object[] {
  const requests: object[] = [];
  const width = columnCount(tab);
  const display = displayColumnCount(tab);

  if (tab === TAB.readme) {
    requests.push(
      {
        updateDimensionProperties: {
          range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 720 },
          fields: "pixelSize",
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } },
          fields: "userEnteredFormat.textFormat",
        },
      },
    );
    return requests;
  }

  // Bold header.
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: width },
      cell: { userEnteredFormat: { textFormat: { bold: true } } },
      fields: "userEnteredFormat.textFormat.bold",
    },
  });

  for (const [formatTabName, column, pattern, type] of FORMATS) {
    if (formatTabName !== tab) continue;
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: column, endColumnIndex: column + 1 },
        cell: { userEnteredFormat: { numberFormat: { type, pattern } } },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  }

  if (DATA_TABS.has(tab) && width > display) {
    const machine = { sheetId, dimension: "COLUMNS", startIndex: display, endIndex: width };
    requests.push(
      // Grey text marks the columns the app owns…
      {
        repeatCell: {
          range: { sheetId, startColumnIndex: display, endColumnIndex: width },
          cell: { userEnteredFormat: { textFormat: { foregroundColor: GREY } } },
          fields: "userEnteredFormat.textFormat.foregroundColor",
        },
      },
      // …folded away in a collapsed group…
      { addDimensionGroup: { range: machine } },
      {
        updateDimensionGroup: {
          dimensionGroup: { range: machine, depth: 1, collapsed: true },
          fields: "collapsed",
        },
      },
      // …and editing them asks "are you sure?" first.
      {
        addProtectedRange: {
          protectedRange: {
            range: { sheetId, startColumnIndex: display, endColumnIndex: width },
            description: "Used by the Expense Tracker app — please don't edit.",
            warningOnly: true,
          },
        },
      },
    );
  }

  if (HIDDEN_TABS.includes(tab)) {
    requests.push({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId },
          description: "Used by the Expense Tracker app — please don't edit.",
          warningOnly: true,
        },
      },
    });
  }

  return requests;
}

/**
 * Requests that bring a spreadsheet's structure up to date: add (and format)
 * whichever app tabs are missing. Nothing existing is touched or deleted.
 *
 * A brand-new spreadsheet has one default tab ("Sheet1", or a localised name)
 * that nobody has used yet — when the README is missing and that tab is the
 * only one, it's renamed to README instead of leaving an empty tab behind.
 */
export function structureRequests(existing: SheetProperties[]): object[] {
  const titles = new Set(existing.map((s) => s.title));
  const missing = TAB_ORDER.filter((tab) => !titles.has(tab));
  if (missing.length === 0) return [];

  const requests: object[] = [];
  let nextId = Math.max(1000, ...existing.map((s) => s.sheetId + 1));

  const isFresh = existing.length === 1 && !TAB_ORDER.includes(existing[0].title as TabName);

  for (const tab of missing) {
    let sheetId: number;
    if (tab === TAB.readme && isFresh) {
      sheetId = existing[0].sheetId;
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, title: TAB.readme },
          fields: "title",
        },
      });
    } else {
      sheetId = nextId++;
      requests.push({
        addSheet: {
          properties: {
            sheetId,
            title: tab,
            index: TAB_ORDER.indexOf(tab),
            hidden: HIDDEN_TABS.includes(tab),
            gridProperties: {
              frozenRowCount: tab === TAB.readme ? 0 : 1,
              columnCount: Math.max(columnCount(tab), 4),
            },
          },
        },
      });
    }
    requests.push(...formatTab(tab, sheetId));
  }

  return requests;
}

/** A new tab's grid is this many rows; writing past it is an API error. */
export const DEFAULT_GRID_ROWS = 1000;
/** Extra rows added when a tab grows, so it doesn't have to grow every sync. */
export const GROW_HEADROOM_ROWS = 1000;

/**
 * Requests that make each tab's grid tall enough for the rows about to be
 * written. The Sheets API rejects writes past the last row ("exceeds grid
 * limits") rather than resizing, so without this a ledger stops syncing at
 * about a thousand expenses.
 */
export function growRequests(existing: SheetProperties[], neededRows: Partial<Record<string, number>>): object[] {
  const requests: object[] = [];
  for (const sheet of existing) {
    const needed = neededRows[sheet.title];
    if (needed === undefined) continue;
    const current = sheet.gridProperties?.rowCount ?? DEFAULT_GRID_ROWS;
    if (needed <= current) continue;
    requests.push({
      appendDimension: {
        sheetId: sheet.sheetId,
        dimension: "ROWS",
        length: needed - current + GROW_HEADROOM_ROWS,
      },
    });
  }
  return requests;
}
