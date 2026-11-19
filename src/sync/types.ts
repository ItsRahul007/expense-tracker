/**
 * The shapes the sync engine moves between SQLite and the Google Sheet.
 *
 * These are *storage* records — the domain fields plus the bookkeeping columns
 * from migration 0005 — not the UI types in src/types/domain.ts. Plain data
 * only, so merge.ts and dedupe.ts stay pure and testable.
 */
import type { ID } from "@/types/domain";

export type TransactionRecord = {
  id: ID;
  amountMinor: number;
  categoryId: ID;
  occurredAt: number;
  note: string | null;
  createdAt: number;
  createdDevice: string;
  firstSyncedAt: number | null;
  updatedAt: number;
};

export type CategoryRecord = {
  id: ID;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  isDefault: boolean;
  updatedAt: number;
};

export type BudgetRecord = {
  id: ID;
  categoryId: ID;
  startMonth: string;
  endMonth: string | null;
  limitMinor: number;
  createdAt: number;
  updatedAt: number;
};

export type SyncEntity = "transaction" | "category" | "budget";

export type TombstoneRecord = {
  entity: SyncEntity;
  id: ID;
  deletedAt: number;
  reason: "user" | "duplicate";
  mergedInto: ID | null;
  device: string;
};

/** A pair of expenses the user said are not duplicates; `idA < idB`. */
export type ExceptionRecord = { idA: ID; idB: ID; at: number };

/** Everything that syncs, from either side. */
export type Dataset = {
  transactions: TransactionRecord[];
  categories: CategoryRecord[];
  budgets: BudgetRecord[];
  tombstones: TombstoneRecord[];
  exceptions: ExceptionRecord[];
};

export const emptyDataset = (): Dataset => ({
  transactions: [],
  categories: [],
  budgets: [],
  tombstones: [],
  exceptions: [],
});

/** A sheet row that couldn't be parsed — kept in the `_errors` tab, never dropped. */
export type QuarantinedRow = {
  tab: string;
  /** 1-based row number in the tab it came from, or 0 if unknown. */
  row: number;
  reason: string;
  values: string[];
};
