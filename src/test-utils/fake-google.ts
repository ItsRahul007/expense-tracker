/**
 * An in-memory Google Drive + Sheets account for engine tests. Implements the
 * same `DriveClient` / `SheetsClient` surface as src/sync/google-api.ts, with
 * the real API's quirks that matter to sync:
 *
 *  - values come back with trailing empty cells and rows trimmed;
 *  - reading a tab that doesn't exist fails the whole batchGet (the client's
 *    fallback is reproduced by `readTabs`);
 *  - Drive's file `version` does NOT move when cells change through the
 *    Sheets API (observed on a real account) — only structural changes bump
 *    it here, so nothing can lean on it to detect another device's writes.
 */
import type { DriveClient, DriveFile, SheetProperties, SheetsClient } from "@/sync/google-api";
import { SyncHttpError } from "@/sync/google-api";
import type { Cell, Grid, TabName } from "@/sync/sheet-format";

type Spreadsheet = {
  file: DriveFile & { tagged: boolean };
  tabs: Map<string, { sheetId: number; grid: Grid }>;
  version: number;
};

const trim = (grid: Grid): Grid => {
  const rows = grid.map((row) => {
    const copy = [...row];
    while (copy.length && (copy[copy.length - 1] === "" || copy[copy.length - 1] === null)) copy.pop();
    return copy;
  });
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
};

export class FakeGoogle {
  readonly files = new Map<string, Spreadsheet>();
  online = true;
  calls = { reads: 0, writes: 0, drive: 0 };
  private nextId = 1;

  private check() {
    if (!this.online) throw new SyncHttpError("offline", "Network request failed");
  }

  private sheet(id: string): Spreadsheet {
    const s = this.files.get(id);
    if (!s) throw new SyncHttpError("not_found", "File not found", 404);
    return s;
  }

  private touch(s: Spreadsheet) {
    s.version += 1;
    s.file.version = String(s.version);
  }

  /** Test helpers: look at or tamper with the sheet like a user would. */
  grid(id: string, tab: string): Grid {
    return trim(this.sheet(id).tabs.get(tab)?.grid ?? []);
  }
  deleteTab(id: string, tab: string) {
    const s = this.sheet(id);
    s.tabs.delete(tab);
    this.touch(s);
  }
  clearTab(id: string, tab: string) {
    const s = this.sheet(id);
    const t = s.tabs.get(tab);
    if (t) t.grid = t.grid.slice(0, 1);
    this.touch(s);
  }
  trash(id: string) {
    this.sheet(id).file.trashed = true;
  }

  drive: DriveClient = {
    findAppSpreadsheets: async () => {
      this.check();
      this.calls.drive++;
      return [...this.files.values()]
        .filter((s) => s.file.tagged && !s.file.trashed)
        .map((s) => ({ id: s.file.id, name: s.file.name, version: s.file.version }))
        .reverse();
    },
    getFile: async (id) => {
      this.check();
      this.calls.drive++;
      const s = this.sheet(id);
      return { ...s.file };
    },
    createSpreadsheet: async (name) => {
      this.check();
      this.calls.drive++;
      const id = `sheet-${this.nextId++}`;
      const s: Spreadsheet = {
        file: { id, name, version: "1", tagged: true },
        tabs: new Map([["Sheet1", { sheetId: 0, grid: [] }]]),
        version: 1,
      };
      this.files.set(id, s);
      return { id, name, version: "1" };
    },
  };

  sheets: SheetsClient = {
    tabs: async (id) => {
      this.check();
      return [...this.sheet(id).tabs.entries()].map(([title, t]): SheetProperties => ({ sheetId: t.sheetId, title }));
    },
    readTabs: async (id, titles) => {
      this.check();
      this.calls.reads++;
      const s = this.sheet(id);
      const values: Partial<Record<TabName, Grid>> = {};
      const missing: TabName[] = [];
      for (const title of titles) {
        const tab = s.tabs.get(title);
        if (tab) values[title] = trim(tab.grid).map((row) => [...row]);
        else missing.push(title);
      }
      return { values, missing };
    },
    writeRanges: async (id, data) => {
      this.check();
      this.calls.writes++;
      const s = this.sheet(id);
      for (const { range, values } of data) {
        const match = /^'((?:[^']|'')+)'!A(\d+)$/.exec(range);
        if (!match) throw new Error(`fake only supports 'Tab'!A<n> ranges, got ${range}`);
        const title = match[1].replace(/''/g, "'");
        const tab = s.tabs.get(title);
        if (!tab) throw new SyncHttpError("bad_request", `Unable to parse range: ${range}`, 400);
        const start = Number(match[2]) - 1;
        values.forEach((row, i) => {
          const target = (tab.grid[start + i] ??= []);
          row.forEach((cell: Cell, j) => {
            target[j] = cell;
          });
        });
      }
      // Deliberately no version bump — see the header comment.
    },
    batchUpdate: async (id, requests) => {
      this.check();
      this.calls.writes++;
      const s = this.sheet(id);
      for (const request of requests as Record<string, { properties?: SheetProperties }>[]) {
        if (request.addSheet?.properties) {
          const { title, sheetId } = request.addSheet.properties;
          s.tabs.set(title, { sheetId, grid: [] });
        }
        if (request.updateSheetProperties?.properties) {
          const { sheetId, title } = request.updateSheetProperties.properties;
          // Snapshot first: re-inserting into a Map while iterating it would
          // visit the renamed entry again, forever.
          const match = [...s.tabs].find(([, tab]) => tab.sheetId === sheetId);
          if (match) {
            s.tabs.delete(match[0]);
            s.tabs.set(title, match[1]);
          }
        }
      }
      this.touch(s);
    },
  };
}
