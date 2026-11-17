import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/*
 * Sync bookkeeping (see docs/design/2026-11-16-google-sheets-sync.md §9).
 *
 * Every syncable table carries `updated_at` (epoch ms, from `nextStamp()` in
 * src/sync/clock.ts — the version two copies of a row are compared by) and
 * `sync_dirty` (1 = changed locally and not yet seen in the Google Sheet).
 * All of it is storage-only, like `isDefault`: none of it appears in
 * src/types/domain.ts and the UI never reads it.
 *
 * Every live.ts write stamps these. A row written *by the sync engine* carries
 * the remote `updated_at` and `sync_dirty = 0` instead, so it isn't echoed back.
 */
const syncColumns = {
  updatedAt: integer("updated_at").notNull().default(0),
  syncDirty: integer("sync_dirty", { mode: "boolean" }).notNull().default(true),
};

/**
 * `isDefault` exists for exactly one purpose: a trigger (see
 * `0003_protect_default_categories.sql`) blocks `DELETE` on rows where it's
 * true, so the 8 seeded categories survive even a row deleted directly in
 * Drizzle Studio, not just through app code. It does *not* guard edits —
 * nothing in the UI can edit an existing category yet (see
 * `useUpsertCategory`), so there's nothing to protect against there.
 * Deliberately absent from `Category` in `src/types/domain.ts`: it's a
 * storage-layer concern the UI never needs to branch on.
 */
const category = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon").notNull(),
  color: text("color").notNull(),
  sortOrder: integer("sort_order").notNull(),
  isDefault: integer("is_default", { mode: "boolean" })
    .notNull()
    .default(false),
  // Seeded defaults keep updated_at = 0 until edited: identical on every
  // device, so they never conflict, and any real edit beats them.
  ...syncColumns,
});

const transaction = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    amountMinor: integer("amount_minor").notNull(),
    // "no action" is deliberate, not the unconsidered default: deleting a
    // category that still has expenses attached throws a constraint error
    // instead of silently reassigning or cascading them away. There's no
    // delete-category UI yet; whenever one is built, it must check for zero
    // referencing rows first rather than relying on this to fail loudly.
    categoryId: text("category_id")
      .references(() => category.id, { onDelete: "no action" })
      .notNull(),
    occurredAt: integer("occurred_at").notNull(),
    note: text("note"),
    // When the row was *entered*, and on which install — never changed by an
    // edit. `occurredAt` is midday of the chosen day (src/app/add.tsx), so it
    // can't tell two entries minutes apart; these can, and they're what
    // cross-device duplicate detection compares (design §12). Rows that
    // predate sync are 'legacy' and are never treated as duplicates.
    createdAt: integer("created_at").notNull().default(0),
    createdDevice: text("created_device").notNull().default("legacy"),
    // When a pull first saw this row in the sheet (null = never uploaded yet).
    // Lets the dedupe pass tell "one phone was offline" apart (design §12.9).
    firstSyncedAt: integer("first_synced_at"),
    ...syncColumns,
  },
  (table) => [
    index("transactions_occurred_at_idx").on(table.occurredAt),
    index("transactions_category_id_idx").on(table.categoryId),
    index("transactions_dup_idx").on(
      table.categoryId,
      table.amountMinor,
      table.occurredAt,
    ),
    index("transactions_sync_dirty_idx")
      .on(table.syncDirty)
      .where(sql`${table.syncDirty} = 1`),
  ],
);

/**
 * A monthly limit on a category, applying to every month from `startMonth`
 * to `endMonth` inclusive. `endMonth` null means "every month from the start
 * onwards"; `startMonth === endMonth` is a one-month budget.
 *
 * Budgets may overlap — "₹5,000 every month, ₹8,000 in December" is two rows.
 * Which one applies to a given month is decided in `src/lib/budget-scope.ts`,
 * not here.
 */
const budget = sqliteTable(
  "budgets",
  {
    id: text("id").primaryKey(),
    // Same "no action" reasoning as `transaction.categoryId` above.
    categoryId: text("category_id")
      .references(() => category.id, { onDelete: "no action" })
      .notNull(),
    startMonth: text("start_month").notNull(),
    endMonth: text("end_month"),
    limitMinor: integer("limit_minor").notNull(),
    createdAt: integer("created_at").notNull(),
    ...syncColumns,
  },
  (table) => [index("budgets_category_id_idx").on(table.categoryId)],
);

const settings = sqliteTable("settings", {
  theme: text("theme", { enum: ["system", "light", "dark"] }).$default(
    () => "system" as const,
  ),
});

/**
 * A record that a row was deleted, so the deletion can reach other devices.
 * The row itself is still hard-deleted — keeping deletes out of the live
 * tables means no read query in live.ts needs a "not deleted" filter.
 */
const tombstone = sqliteTable(
  "tombstones",
  {
    entity: text("entity", {
      enum: ["transaction", "category", "budget"],
    }).notNull(),
    id: text("id").notNull(),
    deletedAt: integer("deleted_at").notNull(),
    reason: text("reason", { enum: ["user", "duplicate"] }).notNull(),
    /** The surviving row's id when `reason` is 'duplicate'. */
    mergedInto: text("merged_into"),
    device: text("device").notNull(),
    syncDirty: integer("sync_dirty", { mode: "boolean" })
      .notNull()
      .default(true),
  },
  (table) => [primaryKey({ columns: [table.entity, table.id] })],
);

/**
 * Every row version the sync engine overwrote or removed on this device, kept
 * so nothing local is ever unrecoverable (design §3, P3). Local only — never
 * synced. `row_json` is the full row as it was before the change.
 */
const rowHistory = sqliteTable("row_history", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  entity: text("entity").notNull(),
  id: text("id").notNull(),
  rowJson: text("row_json").notNull(),
  cause: text("cause", {
    enum: ["remote_newer", "remote_delete", "duplicate"],
  }).notNull(),
  at: integer("at").notNull(),
});

/**
 * Expense pairs the user said are *not* duplicates. Synced, so no device
 * suggests or merges the pair again. Stored with `idA < idB`.
 */
const dedupeException = sqliteTable(
  "dedupe_exceptions",
  {
    idA: text("id_a").notNull(),
    idB: text("id_b").notNull(),
    at: integer("at").notNull(),
    syncDirty: integer("sync_dirty", { mode: "boolean" })
      .notNull()
      .default(true),
  },
  (table) => [primaryKey({ columns: [table.idA, table.idB] })],
);

/**
 * Key/value store for this install's identity, the signed-in session, and
 * sync bookkeeping. Keys are listed in `SyncStateKey` (src/sync/state.ts).
 */
const syncState = sqliteTable("sync_state", {
  key: text("key").primaryKey(),
  value: text("value"),
});

export {
  budget,
  category,
  dedupeException,
  rowHistory,
  settings,
  syncState,
  tombstone,
  transaction,
};
