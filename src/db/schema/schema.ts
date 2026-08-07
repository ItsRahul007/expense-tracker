import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Seeded and user-created rows live in this same table with no flag
 * distinguishing them (see `0001_seed_default_categories.sql`). Deliberate:
 * nothing in the UI can edit or delete an existing category yet, so there's
 * nothing to protect a default *against*. Add an `isDefault` column when an
 * edit/delete affordance actually ships, not before.
 */
const category = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon").notNull(),
  color: text("color").notNull(),
  sortOrder: integer("sort_order").notNull(),
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
  },
  (table) => [
    index("transactions_occurred_at_idx").on(table.occurredAt),
    index("transactions_category_id_idx").on(table.categoryId),
  ],
);

const budget = sqliteTable(
  "budgets",
  {
    // Same "no action" reasoning as `transaction.categoryId` above.
    categoryId: text("category_id")
      .references(() => category.id, { onDelete: "no action" })
      .notNull(),
    month: text("month").notNull(),
    limitMinor: integer("limit_minor").notNull(),
  },
  (table) => [primaryKey({ columns: [table.categoryId, table.month] })],
);

const settings = sqliteTable("settings", {
  theme: text("theme", { enum: ["system", "light", "dark"] }).$default(
    () => "system" as const,
  ),
});

export { budget, category, settings, transaction };
