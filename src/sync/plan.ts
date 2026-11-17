/**
 * One full merge, composed: resolve → dedupe → repair → diff. Pure.
 */
import { dedupe, type DuplicateMerge, type DuplicateSuggestion } from "./dedupe";
import {
  DEFAULT_TOMBSTONE_RETENTION_MS,
  diffPlan,
  type MergePlan,
  repair,
  type RepairNote,
  resolve,
} from "./merge";
import type { Dataset } from "./types";

export type BuildPlanOptions = {
  now: number;
  /** Fresh increasing timestamps (nextStamp), for repairs. */
  stamp: () => number;
  dedupe: boolean;
  windowMs?: number;
  dayKey?: (epochMs: number) => string;
  tombstoneRetentionMs?: number;
};

export type FullPlan = MergePlan & {
  merges: DuplicateMerge[];
  suggestions: DuplicateSuggestion[];
  repairs: RepairNote[];
};

export function buildPlan(local: Dataset, remote: Dataset, options: BuildPlanOptions): FullPlan {
  const resolved = resolve(local, remote, {
    now: options.now,
    tombstoneRetentionMs: options.tombstoneRetentionMs ?? DEFAULT_TOMBSTONE_RETENTION_MS,
  });

  const deduped = options.dedupe
    ? dedupe(resolved, { now: options.now, windowMs: options.windowMs, dayKey: options.dayKey })
    : { data: resolved, merges: [], suggestions: [] };

  const repaired = repair(deduped.data, { local, remote }, options.stamp);

  return {
    ...diffPlan(local, remote, repaired.data),
    merges: deduped.merges,
    suggestions: deduped.suggestions,
    repairs: repaired.notes,
  };
}

// --- mass-change brake (design §11.3) ----------------------------------------------

export const BRAKE_RATIO = 0.2;
export const BRAKE_ROWS = 50;

/**
 * True when a plan would delete an unusual share of the phone's expenses — a
 * cleared sheet, another device's "clear all", a bug. The sync stops and asks
 * instead of applying it. Duplicate merges don't count: they never lose an
 * expense's information.
 */
export function needsConfirmation(plan: FullPlan): boolean {
  const duplicateDeletes = plan.merges.filter((m) => m.entity === "transaction").length;
  const deletes = plan.localDeletes.transaction - duplicateDeletes;
  const total = plan.localCounts.transaction;
  if (deletes <= 0) return false;
  return deletes > BRAKE_ROWS || (total > 0 && deletes / total > BRAKE_RATIO);
}
