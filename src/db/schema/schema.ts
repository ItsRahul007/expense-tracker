import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

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
  },
  (table) => [index("budgets_category_id_idx").on(table.categoryId)],
);

const settings = sqliteTable("settings", {
  theme: text("theme", { enum: ["system", "light", "dark"] }).$default(
    () => "system" as const,
  ),
});

export { budget, category, settings, transaction };
