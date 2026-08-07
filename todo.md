# Your TODO — the data layer

The UI is finished and running on mock data. This file is everything **you** need to
build to make it real. Nothing here is written for you — that's the point.

Per `AGENTS.md`: the whole SQLite/Drizzle/TanStack layer is yours. I review, answer
questions, and argue with your choices, but I don't write this code.

**How to know you're done:** change one line in `src/queries/index.ts` from
`export * from "./mock"` to `export * from "./live"` and every screen keeps working.
That's the only integration point. If you find yourself editing a component to make
your data layer fit, something has drifted from the contract.

---

## 0. Install

```bash
npx expo install expo-sqlite
npm i drizzle-orm @tanstack/react-query
npm i -D drizzle-kit babel-plugin-inline-import
npm i expo-drizzle-studio-plugin
```

Two traps worth knowing before you start:

- The Studio plugin is **`expo-drizzle-studio-plugin`**. `@drizzle-team/expo-studio-plugin`
  does not exist on npm — don't lose twenty minutes to it.
- **`expo-sqlite` has no `useMigrations` hook.** The SDK 55 docs run migrations inside
  `SQLiteProvider`'s `onInit`. The `useMigrations` hook you've seen comes from
  `drizzle-orm/expo-sqlite/migrator`, a different package. Either approach works; they
  fail differently, and the hook gives you a render-time error state you can actually
  show.

Read the versioned docs, not blog posts: <https://docs.expo.dev/versions/v55.0.0/sdk/sqlite/>

### Config

- [x] `babel.config.js` — add `babel-plugin-inline-import` configured for `.sql`, so
      `drizzle-kit`'s generated migrations can be `import`ed as strings and bundled.
      Careful: this file already has `babel-preset-expo` and `nativewind/babel`. Adding
      a plugin, not replacing the presets.
- [x] `metro.config.js` — add `sql` to `resolver.sourceExts`. It already has the
      NativeWind wrapper; keep it.
- [x] `drizzle.config.ts` — `dialect: "sqlite"`, `driver: "expo"`, schema path, out dir.
- [x] Add a `db:generate` script so migration generation isn't a command you have to
      remember.

> ⚠️ Whatever you do to `babel.config.js`, clear the cache afterwards
> (`npx expo start --clear`). Babel changes are cached aggressively and you will chase a
> phantom bug otherwise.

---

## 1. Schema

Match `src/types/domain.ts` — that file is the contract the UI codes against. Reading it
first will save you a rewrite.

- [x] **`categories`** — `id` (text PK), `name` (text), `icon` (text), `color` (text),
      `sortOrder` (integer)
- [x] **`transactions`** — `id` (text PK), `amountMinor` (integer), `categoryId`
      (text, FK → categories.id), `occurredAt` (integer), `note` (text, nullable)
- [x] **`budgets`** — `categoryId` + `month` as a **composite primary key**,
      `limitMinor` (integer). `month` is the string `"2026-08"`.
- [x] **`settings`** — key/value. Currently only `theme` (`"system" | "light" | "dark"`).

### Non-negotiables

These two are baked into the UI and expensive to change once you have real expenses in
the file:

- **`amountMinor` is an INTEGER number of paise.** Never a float, never a REAL column.
  `SUM()` over floats accumulates error and a month of expenses eventually renders as
  ₹41,999.99999998. Decimals exist only in `src/lib/format.ts`.
- **`occurredAt` is epoch milliseconds** stored as INTEGER, so date filters and month
  bucketing are integer comparisons. Note the UI groups by _local_ calendar day — see
  `src/lib/month.ts`, and don't "fix" that to UTC or an 11pm expense will jump days.

### Indexes

- [x] `transactions(occurredAt)` — every list and aggregate filters on a month range.
- [x] `transactions(categoryId)` — the category filter and every budget join.

---

## 2. Migrations & seeding

- [x] Generate the initial migration with `drizzle-kit`.
- [x] Run migrations on boot (`onInit` or the Drizzle hook — your call).
- [x] Seed the eight default categories. The UI expects `icon` to be a valid **Ionicons**
      name and `color` to be a hex string; `src/queries/mock-store.ts` has the exact eight
      I used, and `src/constants/category-options.ts` has the curated icon/colour sets the
      custom-category editor offers.
- [x] Handle failure. A migration that throws on a device holding real data is the worst
      outcome in a local-only app, and the default user experience is a white screen.

**Decide, and be able to say why:** is seeding a migration, or app code that checks for an
empty table? They behave differently on reinstall and after a user deletes a category.

---

## 3. Providers

- [x] Fill in `src/providers/app-data-providers.tsx` — it's a pass-through right now with
      notes in it. `SQLiteProvider` wrapping `QueryClientProvider` wrapping `children`.
- [x] `queryClient` must be a **stable instance** — module scope or a `useState`
      initialiser, never inline in render, or every re-render throws away the cache.
- [x] **Readiness gating.** `src/app/_layout.tsx` already holds the splash screen until
      fonts load and the theme setting resolves. Migrations are the third gate — if the app
      renders first, your opening query hits a table that doesn't exist. Export a readiness
      signal and the root layout will wait on it.

---

## 4. Query keys — read this before writing a single `queryFn`

You picked TanStack Query over SQLite ("SQLite as the backend of my frontend"). That
works, and it's the one decision that will bite you if you get it wrong, because
**nothing tells TanStack that a table changed. You are the cache-coherence layer.**

Adding one expense has to invalidate the home list, the month summary, the 6-month trend,
_and_ the affected budget's progress. Get the hierarchy right and that's one prefix call:

```
['tx']                                → everything transaction-derived
['tx', 'list',    { month, filters }]
['tx', 'summary', { month }]
['tx', 'trend',   { months }]
['tx', 'one',     id]
['tx', 'months']
['budget', { month }]
['category']
['setting', key]
```

`invalidateQueries({ queryKey: ['tx'] })` then covers list + summary + trend + detail, and
a write only names `['tx']` and `['budget']`.

- [ ] Write down your key scheme before implementing. Seriously — it's five minutes now
      versus a week of stale screens.
- [x] Wire invalidation on every mutation. `useUpsertCategory` needs `['category']` **and**
      `['tx']`, because rows render the category's name, icon and colour.

### Four questions I deliberately haven't answered

These are the interesting ones and the reason you're building this yourself:

1. **Aggregates: SQL or JS?** Should `useMonthSummary` / `useMonthTrend` be `GROUP BY`
   queries, or computed in JS from an already-cached transaction list? JS means one query
   instead of three and the numbers can never disagree with the list. SQL scales better
   and teaches you more. Which trade do you want, and why?
2. **Search churn.** `useTransactions` takes filters, so each keystroke is a new cache
   entry. The UI already debounces 180ms (`src/app/search.tsx`) — is that enough, or do you
   also want `placeholderData` to stop the list flashing empty between queries?
3. **`staleTime: Infinity`?** Nothing can mutate the DB behind your back. So is any
   refetching ever correct here — and what about when the app returns from background?
4. **Seeding**: migration or app code? (Same question as §2, listed again because it's
   easy to skip.)

---

## 5. Implement `src/queries/live.ts`

Same names, same signatures as `src/queries/mock.ts`. TypeScript will tell you the moment
one drifts. Return shapes are `QueryResult<T>` / `MutationResult<T>` from
`src/types/domain.ts` — deliberately narrow (`data`, `isPending`, `error`), so they're a
subset of what TanStack already gives you.

### Queries

- [x] `useCategories()` → `Category[]`, ordered by `sortOrder`
- [x] `useTransactions(month | null, filters?)` → `Transaction[]`, **newest first**.
      `null` month means all history — that's how search works. Filters: `text` (matches
      note _and_ category name, case-insensitive), `categoryIds`, `minMinor`, `maxMinor`,
      `from`, `to`.
- [x] `useMonthSummary(month)` → `{ totalMinor, byCategory }`, **`byCategory` sorted
      descending** — the Stats screen doesn't re-sort.
- [x] `useMonthTrend(months[])` → one point per month **in the order given**, including
      zero-spend months. Don't drop empty months or the chart's x-axis lies.
- [x] `useBudgets(month)` → `BudgetStatus[]` — budgets joined with actual spend, ordered by
      category `sortOrder`
- [x] `useTransaction(id)` → `Transaction | null`
- [x] `useSetting(key)` → typed by key
- [x] `useKnownMonths()` → `Month[]` ascending, months containing ≥1 expense (drives how
      far back the month pager lets you go)

### Mutations

- [x] `useAddTransaction()` — takes `NewTransaction`; **you** assign the id
- [x] `useUpdateTransaction()` — takes `TransactionPatch`
- [x] `useDeleteTransaction()` — takes an `ID`
- [x] `useUpsertBudget()` — note the mock treats `limitMinor: 0` as "remove the budget"
- [x] `useUpsertCategory()` — insert **or** update on `id`. This is what custom categories
      call.
- [x] `useSetSetting()` — takes `{ key, value }`

### One-shot

- [x] `exportAllData(): Promise<string>` — CSV, columns `Date,Category,Amount,Note`,
      oldest first, amounts as decimal rupees via `formatAmountExact`, and quote-escape
      anything containing a comma or quote. The UI owns the file write and share sheet;
      you own the string.

Not a hook — the Settings screen `await`s it directly.

---

## 6. Custom categories — what this means for you

The UI can now create categories from three places: Settings → Categories, and inline in
both the add and edit expense screens (the dashed **New** tile). All three go through
`useUpsertCategory`. Consequences for your schema:

- [x] Ids are **slugs generated from the name** (`"Pet care"` → `c-pet-care`), with a
      numeric suffix on collision. So ids are text, not integers, and not sequential.
      `src/components/category-editor.tsx` has the logic.
- [x] Seeded and user-created categories are **the same table**. If you want to protect the
      defaults from editing, you need a flag — decide whether you care.
      Decided: no flag, for now. Nothing in the UI can edit or delete an existing
      category yet, so there's nothing to protect a default *against*. Add
      `isDefault` when an edit/delete screen actually ships.
- [x] **Deletion is deliberately not in the UI.** Deleting a category with expenses
      attached needs a rule: reassign to "Other", block it, or cascade. That's a data
      decision, so it's yours. Pick one before you add a delete button, and make sure the
      FK constraint agrees with whatever you pick.
      Decided: block it. Both FKs stay `ON DELETE no action` (made explicit and
      documented in `src/db/schema/schema.ts`) — deleting a referenced category
      throws instead of silently reassigning or cascading expense history away.
      A future delete button must check for zero referencing rows first.

---

## 7. Verify

- [ ] `npx expo start` on a **real device** — the `formSheet` detent on `/add`, the raised
      add button's shadow, and safe-area insets have only ever been checked in a browser.
- [ ] Add an expense → it appears on Home, the summary total moves, the budget bar moves,
      and Stats updates. **All four**, without a manual refresh. This is the real test of
      your invalidation.
- [ ] Create a custom category mid-expense → it's selected immediately and the expense
      saves against it.
- [ ] Edit an expense two months old → the date doesn't silently jump to today.
- [ ] Kill and relaunch → data is still there (the thing the mock could never prove).
- [ ] Cold start in dark mode → no white flash before first paint.
- [ ] Set a budget below current spend → the card turns red and Home shows "over".
- [ ] Export → the CSV opens in a spreadsheet with amounts as proper decimals.
- [ ] Open Drizzle Studio from Expo CLI and confirm the rows look like you expect.
- [ ] `npx tsc --noEmit` and `npx expo lint` stay clean.

---

## Notes

- **You are local-only by choice.** No sync, so no conflict resolution — but also no
  backup. If you ever feel the pull toward a server, say so _before_ you have months of
  real expenses, because retrofitting sync means migrating live data (client-generated
  UUIDs, `updated_at`, soft deletes).
- Currency is **INR, single-currency**. A `currency` column added later needs a backfill.
- **Expenses only.** Adding income means signed amounts or a `type` column, and it changes
  every total in the app.
- `src/queries/mock-store.ts` and `mock.ts` can be **deleted** once `live.ts` works. Until
  then they're the reference implementation of the behaviour your version has to match —
  when unsure what a hook should return, read the mock.
