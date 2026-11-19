/**
 * The user's answers to duplicate handling (design §12.7, §12.9 B), as local
 * writes. Each one is an ordinary stamped change, so the next sync carries it
 * to every device.
 */
import { and, desc, eq } from "drizzle-orm";

import { dedupeException, rowHistory, tombstone, transaction } from "@/db/schema/schema";
import type { Db } from "@/queries/helper";
import type { ID } from "@/types/domain";

import { nextStamp } from "./clock";
import { notDuplicate } from "./dedupe";
import { recordDeletions } from "./tracking";
import type { TransactionRecord } from "./types";

type Store = Pick<Db, "select" | "insert" | "update" | "delete" | "transaction">;

/** "Not the same expense" — never merge or suggest this pair again, anywhere. */
function addException(db: Pick<Db, "insert">, a: ID, b: ID): void {
  db.insert(dedupeException)
    .values({ ...notDuplicate(a, b, nextStamp()), syncDirty: true })
    .onConflictDoNothing()
    .run();
}

/**
 * Undo an automatic merge: bring the duplicate back exactly as it was (from
 * `row_history`, or the row the merge reported if it came from another phone),
 * newer than its tombstone, and remember the pair as distinct. The kept
 * expense gets its own note back if it adopted the duplicate's and hasn't been
 * edited since. Returns false if there's nothing to restore.
 */
export function undoMerge(
  db: Store,
  survivorId: ID,
  duplicateId: ID,
  reportedRow?: TransactionRecord,
  survivorBefore?: TransactionRecord,
): boolean {
  return db.transaction((tx) => {
    const saved = tx
      .select({ rowJson: rowHistory.rowJson })
      .from(rowHistory)
      .where(and(eq(rowHistory.entity, "transaction"), eq(rowHistory.id, duplicateId), eq(rowHistory.cause, "duplicate")))
      .orderBy(desc(rowHistory.seq))
      .get();

    const row: TransactionRecord | null = saved
      ? (JSON.parse(saved.rowJson) as TransactionRecord)
      : (reportedRow ?? null);
    if (!row) return false;

    tx.delete(tombstone).where(and(eq(tombstone.entity, "transaction"), eq(tombstone.id, duplicateId))).run();
    tx.insert(transaction)
      .values({ ...row, updatedAt: nextStamp(), syncDirty: true })
      .onConflictDoNothing()
      .run();
    addException(tx, survivorId, duplicateId);

    // Only while the note is still exactly the one adopted from the duplicate:
    // a note edited after the merge is the user's and stays.
    if (survivorBefore) {
      const current = tx
        .select({ note: transaction.note })
        .from(transaction)
        .where(eq(transaction.id, survivorId))
        .get();
      if (current && current.note !== survivorBefore.note && current.note === row.note) {
        tx.update(transaction)
          .set({ note: survivorBefore.note, updatedAt: nextStamp(), syncDirty: true })
          .where(eq(transaction.id, survivorId))
          .run();
      }
    }
    return true;
  });
}

/** "Keep both" on a possible-duplicate suggestion. */
export function keepBoth(db: Store, a: ID, b: ID): void {
  addException(db, a, b);
}

/**
 * "Merge" on a possible-duplicate suggestion: keep the earlier entry, carry the
 * chosen note over, and delete the other as a duplicate (with history).
 */
export function mergePair(db: Store, a: TransactionRecord, b: TransactionRecord, keepNoteFrom: ID): void {
  const [survivor, duplicate] =
    a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id) ? [a, b] : [b, a];
  const note = keepNoteFrom === duplicate.id ? duplicate.note : survivor.note;

  db.transaction((tx) => {
    tx.insert(rowHistory)
      .values({
        entity: "transaction",
        id: duplicate.id,
        rowJson: JSON.stringify(duplicate),
        cause: "duplicate",
        at: Date.now(),
      })
      .run();
    if (note !== survivor.note) {
      tx.update(transaction)
        .set({ note, updatedAt: nextStamp(), syncDirty: true })
        .where(eq(transaction.id, survivor.id))
        .run();
    }
    tx.delete(transaction).where(eq(transaction.id, duplicate.id)).run();
    recordDeletions(tx, "transaction", [duplicate.id], { reason: "duplicate", mergedInto: survivor.id });
  });
}

/**
 * Where an expense went if it was merged away as a duplicate — following
 * chains (a → b → c) a few hops. `null` if it wasn't merged (deleted, or never
 * existed). Lets an open detail screen move to the surviving copy (§12.9 A).
 */
export function mergedInto(db: Pick<Db, "select">, id: ID): ID | null {
  let current = id;
  for (let hop = 0; hop < 5; hop++) {
    const tomb = db
      .select({ mergedInto: tombstone.mergedInto, reason: tombstone.reason })
      .from(tombstone)
      .where(and(eq(tombstone.entity, "transaction"), eq(tombstone.id, current)))
      .get();
    if (!tomb || tomb.reason !== "duplicate" || !tomb.mergedInto) break;
    current = tomb.mergedInto;
  }
  return current === id ? null : current;
}
