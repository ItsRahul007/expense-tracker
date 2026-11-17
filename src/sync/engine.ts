/**
 * The sync engine: one sync, connecting to a sheet, and the recovery actions.
 * Design §8 (bootstrap) and §10.3 (syncOnce).
 *
 * Never throws for expected failures — every outcome is returned as a value
 * and the last error is stored in `sync_state`, so the UI can show it and a
 * failed sync can never take the app down with it.
 */
import { and, inArray, isNull } from "drizzle-orm";

import { budget, category, transaction } from "@/db/schema/schema";
import type { Db } from "@/queries/helper";
import type { ID } from "@/types/domain";

import { nextStamp } from "./clock";
import type { DuplicateMerge, DuplicateSuggestion } from "./dedupe";
import { a1, type DriveClient, type SheetsClient, SyncHttpError } from "./google-api";
import { applyPlan, countUnsynced, readLocal } from "./local-repo";
import { buildPlan, type FullPlan, needsConfirmation } from "./plan";
import {
  decodeMetaTab,
  decodeSheet,
  metaStamp,
  TAB,
  encodeDataset,
  type Grid,
  padGrid,
  READ_TABS,
  type TabName,
  uniqueQuarantine,
} from "./sheet-format";
import { DEFAULT_GRID_ROWS, growRequests, structureRequests } from "./sheet-setup";
import {
  getState,
  isDedupeEnabled,
  setState,
  setStates,
  type StoredError,
  type SyncErrorCode,
} from "./state";
import { getDeviceId } from "./tracking";
import type { Dataset } from "./types";

export const SPREADSHEET_NAME = "Expense Tracker";

/** Rows per write range; keeps each request body comfortably small. */
const WRITE_CHUNK_ROWS = 5_000;

export type EngineDeps = {
  db: Pick<Db, "select" | "insert" | "update" | "delete" | "transaction">;
  drive: DriveClient;
  sheets: SheetsClient;
  appVersion: string;
  now?: () => number;
  /** Called before applying a plan that overwrites or deletes local rows, at
   *  most once a day, and before every bootstrap merge (design §11.4). */
  snapshot?: () => void | Promise<void>;
};

export type SyncSummary = {
  /** Local rows added, changed or removed by this sync. */
  applied: number;
  pushed: boolean;
  merges: DuplicateMerge[];
  suggestions: DuplicateSuggestion[];
  restoredCategories: ID[];
};

export type SyncOutcome =
  | ({ status: "synced" } & SyncSummary)
  | { status: "skipped"; reason: "not_connected" | "up_to_date" }
  | { status: "needs_confirmation"; deletes: number; total: number }
  | { status: "error"; error: StoredError };

export type SyncOptions = {
  /** The user approved a large deletion (mass-change brake). */
  confirmMassChange?: boolean;
};

const today = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function toError(error: unknown, now: number): StoredError {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof SyncHttpError) {
    const code: SyncErrorCode = (
      {
        offline: "offline",
        auth: "needs_reauth",
        scope: "scope",
        not_found: "sheet_missing",
        rate_limited: "rate_limited",
        server: "server",
        bad_request: "unknown",
      } as const
    )[error.kind];
    return { code, message, at: now };
  }
  if (error instanceof EngineError) return { code: error.code, message, at: now };
  return { code: "unknown", message, at: now };
}

class EngineError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function createSyncEngine(deps: EngineDeps) {
  const { db, drive, sheets } = deps;
  const now = deps.now ?? Date.now;

  let running: Promise<SyncOutcome> | null = null;

  async function maybeSnapshot(force: boolean) {
    if (!deps.snapshot) return;
    const day = today(now());
    if (!force && getState(db, "last_snapshot_day") === day) return;
    try {
      await deps.snapshot();
      setState(db, "last_snapshot_day", day);
    } catch (error) {
      // A failed snapshot must not block sync; row_history still protects data.
      console.warn("snapshot failed", error);
    }
  }

  async function pull(spreadsheetId: string) {
    const { values, missing } = await sheets.readTabs(spreadsheetId, READ_TABS);
    const decoded = decodeSheet(values);
    if (!decoded.ok) {
      throw new EngineError(
        decoded.error === "schema_newer" ? "schema_newer" : "sheet_damaged",
        decoded.error === "schema_newer"
          ? `This sheet was written by a newer version of the app (layout ${decoded.sheetVersion}).`
          : `The "${decoded.tab}" tab is missing the column(s): ${decoded.missing.join(", ")}.`,
      );
    }
    return { decoded, missing };
  }

  async function push(
    spreadsheetId: string,
    data: Dataset,
    previousRows: Partial<Record<TabName, number>>,
    quarantine: ReturnType<typeof uniqueQuarantine>,
    missingTabs: TabName[],
  ) {
    if (missingTabs.length > 0) {
      await sheets.batchUpdate(spreadsheetId, structureRequests(await sheets.tabs(spreadsheetId)));
    }

    // Rows going up for the first time are stamped as uploaded now; this is
    // what tells "entered offline, uploaded late" apart later (design §12.9).
    const uploadAt = now();
    const firstUploads = data.transactions.filter((t) => t.firstSyncedAt === null).map((t) => t.id);
    const outgoing: Dataset = {
      ...data,
      transactions: data.transactions.map((t) => (t.firstSyncedAt === null ? { ...t, firstSyncedAt: uploadAt } : t)),
    };

    const grids = encodeDataset(outgoing, {
      deviceId: getDeviceId(db),
      appVersion: deps.appVersion,
      now: uploadAt,
      quarantine,
    });

    const writes: { range: string; values: Grid }[] = [];
    const neededRows: Partial<Record<TabName, number>> = {};
    for (const [tab, grid] of Object.entries(grids) as [TabName, Grid][]) {
      const padded = padGrid(grid, previousRows[tab] ?? 0);
      neededRows[tab] = padded.length;
      for (let start = 0; start < padded.length; start += WRITE_CHUNK_ROWS) {
        writes.push({ range: a1(tab, `A${start + 1}`), values: padded.slice(start, start + WRITE_CHUNK_ROWS) });
      }
    }

    // Tabs start with a 1,000-row grid and the API won't write past it. Only
    // look up the real sizes once something might not fit.
    if (Math.max(0, ...Object.values(neededRows).map((n) => n ?? 0)) > DEFAULT_GRID_ROWS) {
      await sheets.batchUpdate(spreadsheetId, growRequests(await sheets.tabs(spreadsheetId), neededRows));
    }

    await sheets.writeRanges(spreadsheetId, writes);

    // Mirror the stamp locally without touching the version or dirty flag —
    // the next pull confirms it and marks the row clean.
    for (let i = 0; i < firstUploads.length; i += 500) {
      db.update(transaction)
        .set({ firstSyncedAt: uploadAt })
        .where(and(inArray(transaction.id, firstUploads.slice(i, i + 500)), isNull(transaction.firstSyncedAt)))
        .run();
    }
  }

  /** One pull → merge → apply → (push) pass. */
  async function pass(spreadsheetId: string, options: SyncOptions, allowPush: boolean) {
    const { decoded, missing } = await pull(spreadsheetId);

    // Read, merge and apply with no await in between (see local-repo.ts).
    const local = readLocal(db);
    const plan: FullPlan = buildPlan(local, decoded.data, {
      now: now(),
      stamp: nextStamp,
      dedupe: isDedupeEnabled(db),
    });

    if (needsConfirmation(plan) && !options.confirmMassChange) {
      const review = {
        deletes: plan.localDeletes.transaction,
        total: plan.localCounts.transaction,
        at: now(),
      };
      setState(db, "pending_review", review);
      return { kind: "brake" as const, review };
    }

    const touchesLocalData = plan.history.length > 0;
    if (touchesLocalData) await maybeSnapshot(false);

    try {
      applyPlan(db, plan, now());
    } catch (error) {
      throw new EngineError(
        "local_apply_failed",
        error instanceof Error ? error.message : "Could not apply changes on this phone.",
      );
    }

    const quarantine = uniqueQuarantine(decoded.quarantine);
    const needsPush =
      plan.sheetChanged ||
      missing.length > 0 ||
      quarantine.length !== decoded.quarantine.length ||
      plan.final.transactions.some((t) => t.firstSyncedAt === null);

    let pushed = false;
    if (needsPush && allowPush) {
      await push(spreadsheetId, plan.final, decoded.rowCounts, quarantine, missing);
      pushed = true;
    }

    const applied =
      plan.local.transactions.upsert.length +
      plan.local.transactions.delete.length +
      plan.local.categories.upsert.length +
      plan.local.categories.delete.length +
      plan.local.budgets.upsert.length +
      plan.local.budgets.delete.length;

    return { kind: "done" as const, plan, pushed, applied, meta: decoded.meta };
  }

  async function run(options: SyncOptions): Promise<SyncOutcome> {
    const spreadsheetId = getState(db, "spreadsheet_id");
    if (!spreadsheetId) return { status: "skipped", reason: "not_connected" };

    try {
      const file = await drive.getFile(spreadsheetId);
      if (file.trashed) throw new EngineError("sheet_missing", "The spreadsheet is in the Drive trash.");

      // Fast path (design §7.4): nothing changed on either side. "Remote
      // unchanged" is judged from `_meta`'s last-write stamp — one tiny read —
      // not Drive's version, which ignores Sheets cell edits.
      const dirty = countUnsynced(db) > 0;
      const seen = getState(db, "last_remote_version");
      if (!dirty && !getState(db, "restore_pending") && seen) {
        const { values } = await sheets.readTabs(spreadsheetId, [TAB.meta]);
        if (metaStamp(decodeMetaTab(values[TAB.meta])) === seen) {
          setState(db, "last_sync_at", now());
          return { status: "skipped", reason: "up_to_date" };
        }
      }

      const first = await pass(spreadsheetId, options, true);
      if (first.kind === "brake") {
        return { status: "needs_confirmation", deletes: first.review.deletes, total: first.review.total };
      }

      // Verify: read back what we wrote, so pushed rows are confirmed (and
      // marked clean) now rather than on the next sync. No second push —
      // if another device raced us, the next sync settles it (design §10.2).
      let last = first;
      if (first.pushed) {
        const verify = await pass(spreadsheetId, { confirmMassChange: true }, false);
        if (verify.kind === "done") last = { ...verify, pushed: true, applied: first.applied + verify.applied };
      }

      setStates(db, {
        last_sync_at: now(),
        // The sheet as this device last saw it — after its own write, if any.
        last_remote_version: metaStamp(last.meta),
        last_error: null,
        pending_review: null,
        restore_pending: null,
      });

      return {
        status: "synced",
        applied: last.applied,
        pushed: last.pushed,
        merges: first.plan.merges,
        suggestions: last.plan.suggestions,
        restoredCategories: first.plan.repairs.map((r) => r.id),
      };
    } catch (error) {
      const stored = toError(error, now());
      setState(db, "last_error", stored);
      return { status: "error", error: stored };
    }
  }

  /** Single-flight: concurrent callers share the sync already running. */
  function syncOnce(options: SyncOptions = {}): Promise<SyncOutcome> {
    if (!running) {
      running = run(options).finally(() => {
        running = null;
      });
    }
    return running;
  }

  /**
   * After sign-in: find this account's sheet, or create one, then merge.
   * Restoring onto a fresh install is just this merge with an empty phone —
   * nothing local is ever replaced (design §3, P2).
   */
  async function connect(): Promise<{ outcome: SyncOutcome; created: boolean; otherSheets: number }> {
    try {
      const found = await drive.findAppSpreadsheets();
      let spreadsheetId: string;
      let created = false;

      if (found.length > 0) {
        spreadsheetId = found[0].id;
      } else {
        const file = await drive.createSpreadsheet(SPREADSHEET_NAME);
        spreadsheetId = file.id;
        created = true;
        await sheets.batchUpdate(spreadsheetId, structureRequests(await sheets.tabs(spreadsheetId)));
      }

      setStates(db, { spreadsheet_id: spreadsheetId, last_remote_version: null });
      await maybeSnapshot(true);
      const outcome = await syncOnce({});
      return { outcome, created, otherSheets: Math.max(0, found.length - 1) };
    } catch (error) {
      const stored = toError(error, now());
      setState(db, "last_error", stored);
      return { outcome: { status: "error", error: stored }, created: false, otherSheets: 0 };
    }
  }

  /** The sheet was deleted or damaged: start a fresh one from this phone. */
  async function recreateSheet(): Promise<SyncOutcome> {
    try {
      const file = await drive.createSpreadsheet(SPREADSHEET_NAME);
      await sheets.batchUpdate(file.id, structureRequests(await sheets.tabs(file.id)));
      setStates(db, { spreadsheet_id: file.id, last_remote_version: null, last_error: null });
      return syncOnce({});
    } catch (error) {
      const stored = toError(error, now());
      setState(db, "last_error", stored);
      return { status: "error", error: stored };
    }
  }

  /**
   * "Keep mine" on the mass-change prompt: re-stamp every local row so it wins
   * over the incoming deletions, then sync — the rows go back up to the sheet.
   */
  function keepLocalRows(): Promise<SyncOutcome> {
    db.transaction((tx) => {
      const stampAll = (table: typeof transaction | typeof budget | typeof category) =>
        tx.update(table).set({ updatedAt: nextStamp(), syncDirty: true }).run();
      stampAll(transaction);
      stampAll(budget);
      stampAll(category);
    });
    setState(db, "pending_review", null);
    return syncOnce({});
  }

  return { syncOnce, connect, recreateSheet, keepLocalRows };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
