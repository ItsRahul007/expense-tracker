/**
 * The contract between the UI and the data layer.
 *
 * Deliberately plain TypeScript with no Drizzle imports. The UI codes against
 * this file; the Drizzle schema is expected to produce compatible types. That
 * seam is what lets both halves of the app be built independently, and it keeps
 * SQLite details out of every component.
 *
 * Two invariants baked in here, both expensive to change later:
 *
 *  1. Money is `amountMinor` — an *integer* number of paise. Floats accumulate
 *     error under SUM(), and a month of expenses eventually renders as
 *     ₹41,999.99999998. Decimals exist only in `src/lib/format.ts`.
 *  2. Time is epoch milliseconds, not a formatted string, so date filters and
 *     month bucketing are integer comparisons.
 */

import type { Month } from "@/lib/month";

export type ID = string;

export type Category = {
  id: ID;
  name: string;
  /** Ionicons glyph name, e.g. "restaurant" — see @expo/vector-icons. */
  icon: string;
  /** Hex colour for the icon. The UI renders its badge as this at low opacity. */
  color: string;
  sortOrder: number;
};

export type Transaction = {
  id: ID;
  /** Integer paise. Always positive — v1 tracks expenses only. */
  amountMinor: number;
  categoryId: ID;
  /** Epoch ms, UTC. Grouped by *local* calendar day — see src/lib/month.ts. */
  occurredAt: number;
  note: string | null;
};

/** What the add form submits. The data layer assigns the id. */
export type NewTransaction = Omit<Transaction, "id">;

/** What the edit form submits. Absent keys are left unchanged. */
export type TransactionPatch = Partial<Omit<Transaction, "id">> & { id: ID };

export type Budget = {
  categoryId: ID;
  month: Month;
  limitMinor: number;
};

/** A budget joined with what's actually been spent against it. */
export type BudgetStatus = Budget & { spentMinor: number };

export type CategoryTotal = { categoryId: ID; totalMinor: number };

export type MonthSummary = {
  totalMinor: number;
  /** Descending by total, so the UI never has to sort. */
  byCategory: CategoryTotal[];
};

export type MonthPoint = { month: Month; totalMinor: number };

export type TxFilters = {
  /** Matched against note and category name, case-insensitive. */
  text?: string;
  categoryIds?: ID[];
  minMinor?: number;
  maxMinor?: number;
  /** Half-open: from <= occurredAt < to. */
  from?: number;
  to?: number;
};

export type ThemePreference = "system" | "light" | "dark";

export type Settings = {
  theme: ThemePreference;
};

export type SettingKey = keyof Settings;

/**
 * The slice of TanStack Query's `UseQueryResult` the UI is allowed to touch.
 *
 * Narrowed on purpose: components that only read these three fields keep
 * working no matter how the query layer underneath is configured, and the mock
 * implementation doesn't need TanStack Query as a dependency.
 */
export type QueryResult<T> = {
  data: T | undefined;
  isPending: boolean;
  error: Error | null;
};

/** The matching slice of `UseMutationResult`. */
export type MutationResult<TArgs> = {
  mutate: (args: TArgs) => void;
  mutateAsync: (args: TArgs) => Promise<void>;
  isPending: boolean;
  error: Error | null;
};
