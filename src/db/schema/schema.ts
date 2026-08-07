import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

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
    categoryId: text("category_id")
      .references(() => category.id)
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
    categoryId: text("category_id")
      .references(() => category.id)
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
