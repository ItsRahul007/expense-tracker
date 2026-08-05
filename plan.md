# Expense Tracker — UI plan ("Khata")

## Context

A personal expense tracker, built partly as a real daily-use app and partly to learn a
local SQLite data layer with Drizzle. The repo is currently the unmodified Expo 55
template: two placeholder screens, `StyleSheet`-based theming, NativeWind installed but
not actually used anywhere.

**The working split, per AGENTS.md.** The entire data layer is Rahul's: Drizzle schema,
`drizzle.config.ts`, migrations, `babel-plugin-inline-import`, the Studio plugin,
TanStack Query hooks, and anything that reads or writes SQLite. I do not write that code
— I review it and answer questions. I build the UI.

To let both halves proceed in parallel instead of one blocking the other, this plan
starts by fixing a **typed contract** (§2) that the UI codes against. I ship a mock
implementation behind it so every screen is real and clickable immediately; Rahul
replaces the mock with Drizzle-backed hooks without touching a single component.

**Decisions already made:** local-only, no sync. TanStack Query is the whole data-access
surface (SQLite treated as "the backend of the frontend"), so no `useLiveQuery`.
Expenses only, single currency (INR). v1 = transactions + categories, budgets, insights,
search/filters, export/backup. Custom ruled tab bar, not `NativeTabs`. Keypad-first add
flow. Theme preference persisted in a SQLite settings table.

---

## 0. Fix what's already broken

Three things in the current setup will silently break NativeWind before any feature work
starts:

| File                                                                                            | Problem                                                                                                     | Fix                                       |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [metro.config.js:7](/Users/rahul/development/personal/expense-tracker/metro.config.js#L7)       | `input: "./global.css"` — file is at `src/global.css`                                                       | `"./src/global.css"`                      |
| [tailwind.config.js:5](/Users/rahul/development/personal/expense-tracker/tailwind.config.js#L5) | `"/src/app/**/..."` — leading slash makes it an absolute filesystem path, so no `app/` file is ever scanned | `"./src/app/**/..."`                      |
| [app.json](/Users/rahul/development/personal/expense-tracker/app.json)                          | `userInterfaceStyle: "automatic"` is right, but no `expo-file-system` plugin — needed for export            | add plugin with `enableFileSharing: true` |

### Packages to add

UI side (mine):

```
@expo-google-fonts/ibm-plex-mono  @expo-google-fonts/instrument-sans
expo-sharing  react-native-svg
```

Data side (Rahul's — **note the corrected package name**):

```
expo-sqlite  drizzle-orm@0.45.2  @tanstack/react-query@5.101.4
drizzle-kit@0.31.10  babel-plugin-inline-import@3.0.0  expo-drizzle-studio-plugin@0.2.1
```

> `@drizzle-team/expo-studio-plugin` — the name in the original brief — **does not exist
> on npm.** The published package is `expo-drizzle-studio-plugin`. Verified against the
> registry, and the SDK 55 SQLite docs point at the same repo
> (`drizzle-team/drizzle-studio-expo`).

Also worth knowing before you start: **`expo-sqlite` has no `useMigrations` hook.** The
SDK 55 docs are explicit that migrations run inside `SQLiteProvider`'s `onInit`. The
`useMigrations` hook you may have seen in the video comes from
`drizzle-orm/expo-sqlite/migrator`, which is a different package.

---

## 1. Design system — "Khata"

The app _is_ an account book, so it stops pretending to be a dashboard. Ruled rows,
tabular figures, no cards, no shadows, no rounded corners in lists. Colour is reserved
almost entirely for one thing: money going wrong.

**Signature element:** a single hairline vertical rule at the decimal position, running
continuously down every list screen. Every amount in the app hangs off that one line, and
month totals sit beneath a double rule like a real ledger footing. The alignment _is_ the
design — which is also why it's the right choice ergonomically: scanning two hundred
small numbers is the actual daily task.

### Tokens — `src/global.css`

Semantic CSS variables as space-separated RGB triplets (required for Tailwind's
`<alpha-value>` to work), with `.dark:root` overrides:

| Token         | Light         | Dark          | Role                     |
| ------------- | ------------- | ------------- | ------------------------ |
| `--paper`     | `242 245 241` | `16 22 20`    | app background           |
| `--row-alt`   | `220 230 220` | `22 30 26`    | alternating ledger row   |
| `--ink`       | `27 42 35`    | `221 231 224` | primary text, amounts    |
| `--ink-muted` | `90 110 100`  | `138 158 146` | labels, dates, meta      |
| `--rule`      | `185 203 192` | `42 56 48`    | all hairlines            |
| `--red`       | `166 50 30`   | `226 102 76`  | over-budget, destructive |

All six pairs clear WCAG AA against their backgrounds in both themes. `tailwind.config.js`
gets `darkMode: "class"` and maps these to `bg-paper`, `text-ink`, `border-rule`, etc.

### Type

Two families, loaded via `useFonts` from `expo-font`.

- **IBM Plex Mono** — every figure in the app. Monospaced, so decimal alignment is free;
  no `tabular-nums` needed.
- **Instrument Sans** — labels, titles, body.

| Role                  | Face                | Size / line | Notes                        |
| --------------------- | ------------------- | ----------- | ---------------------------- |
| Display figure        | Plex Mono 600       | 56 / 56     | keypad amount, month total   |
| Row amount            | Plex Mono 500       | 17 / 24     | right-aligned to the rule    |
| Margin figure         | Plex Mono 400       | 12 / 16     | running balance, `ink-muted` |
| Row title             | Instrument Sans 500 | 16 / 22     | merchant or note             |
| Row meta              | Instrument Sans 400 | 13 / 18     | category · date, `ink-muted` |
| Eyebrow / column head | Instrument Sans 600 | 11 / 14     | uppercase, tracking `0.08em` |
| Screen title          | Instrument Sans 600 | 22 / 28     |                              |

> **RN gotcha to plan around:** React Native does not synthesise font weights. Each
> weight is a separately registered family name, so `font-semibold` on a custom font does
> nothing. The Tailwind config therefore declares one utility _per weight_ —
> `font-mono` / `font-mono-medium` / `font-mono-semibold`, `font-sans` /
> `font-sans-medium` / `font-sans-semibold` — mapped to `IBMPlexMono_400Regular`,
> `InstrumentSans_600SemiBold`, and so on.

### Layout rules

- Row height 52. Padding: 16 left, 44 right (clears the rule).
- The alignment rule is one absolutely-positioned 1px `View` in the _list container_, not
  per row — that's what makes it continuous rather than a stack of dashes.
- Alternating `bg-row-alt` by index parity.
- Border radius: `0` everywhere except the keypad sheet's top corners. No shadows, no
  elevation, anywhere.
- Footings: two 1px rules, 3px apart.
- Motion stays minimal — sheet entry, budget bar fill, list item removal. Nothing
  ambient. Reanimated 4 is already installed.

---

## 2. The contract (build this first)

`src/types/domain.ts` — plain TypeScript, no Drizzle imports, owned jointly. This is the
seam that lets UI and data layer proceed independently.

```ts
type ID = string;

type Category = { id: ID; name: string; icon: string; sortOrder: number };
type Transaction = {
  id: ID;
  amountMinor: number; // integer paise. never a float.
  categoryId: ID;
  occurredAt: number; // epoch ms, UTC
  note: string | null;
};
type Budget = { categoryId: ID; month: string; limitMinor: number }; // month = "2026-08"
type BudgetStatus = Budget & { spentMinor: number };
type MonthSummary = {
  totalMinor: number;
  byCategory: { categoryId: ID; totalMinor: number }[];
};
type TxFilters = {
  text?: string;
  categoryIds?: ID[];
  minMinor?: number;
  maxMinor?: number;
  from?: number;
  to?: number;
};
```

Two things baked in deliberately, both painful to change later:

- **`amountMinor` is an integer.** Sum floats in SQLite and a month of expenses
  eventually renders as `₹41,999.99999998`. Format at the edge, never store decimals.
- **`occurredAt` is epoch ms**, not a formatted string — so range filters and
  month-grouping are integer comparisons.

`src/queries/index.ts` re-exports the hooks below. I ship `src/queries/mock.ts`
implementing all of them over in-memory fixtures; Rahul writes `src/queries/live.ts`
against Drizzle and flips the re-export. No component changes.

```ts
useTransactions(month: string, filters?: TxFilters)  // → Transaction[]
useCategories()                                      // → Category[]
useMonthSummary(month: string)                       // → MonthSummary
useMonthTrend(months: number)                        // → { month: string; totalMinor: number }[]
useBudgets(month: string)                            // → BudgetStatus[]
useSetting<K>(key: K)                                // → theme etc.

useAddTransaction() / useUpdateTransaction() / useDeleteTransaction()
useUpsertBudget() / useUpsertCategory() / useSetSetting()
exportAllData(): Promise<string>                     // CSV text; plain async fn, not a hook
```

### Mentor note — query keys are now your invalidation engine

This is the one thing that will make or break the TanStack-over-SQLite approach, and it's
worth deciding before you write the first `queryFn`. Nothing tells TanStack that a table
changed, so _you_ are the cache-coherence layer. Adding one transaction has to invalidate
the ledger list, the month summary, the trend, and the affected budget's progress.

A hierarchy that makes that a single prefix call rather than four hand-maintained ones:

```
['tx']                            → everything transaction-derived
['tx', 'list',    { month, filters }]
['tx', 'summary', { month }]
['tx', 'trend',   { months }]
['budget', { month }]
['category']
['setting', key]
```

`invalidateQueries({ queryKey: ['tx'] })` then covers list + summary + trend in one line,
and a write only needs to name `['tx']` and `['budget']`.

**Questions for you to answer rather than answers from me** — these are the interesting
ones:

1. Should aggregates (`useMonthSummary`, `useMonthTrend`) be SQL `GROUP BY` queries, or
   computed in JS from an already-cached transaction list? The second means one query
   instead of three and no chance of the numbers disagreeing. The first scales better and
   teaches you more SQL. Which trade would you rather make, and why?
2. `useTransactions` takes filters, which means every keystroke in search mints a new
   cache entry. What's your plan — debounce, `placeholderData`, or a separate
   non-cached search key?
3. Does `staleTime: Infinity` make sense here, given nothing can mutate the DB behind
   your back?
4. Categories are seeded on first launch. Is that a migration, or app-level code that
   checks for an empty table? They behave differently on reinstall.

---

## 3. Screens

Routes under `src/app/`, expo-router. Four tabs, two modals, one pushed screen.

```
_layout.tsx          root: fonts → theme → <AppDataProviders> (Rahul's) → tabs
(tabs)/_layout.tsx   custom ruled tab bar
(tabs)/index.tsx     Ledger      — the month, grouped by day, footing at bottom
(tabs)/insights.tsx  Insights    — by-category breakdown + month trend
(tabs)/budgets.tsx   Budgets     — per-category limits and progress
(tabs)/settings.tsx  Settings    — theme, categories, export
add.tsx              modal       — keypad-first entry
transaction/[id].tsx pushed      — detail / edit / delete
search.tsx           modal       — text + filters over all history
```

**Ledger** — day-grouped ruled rows, sticky month header with a `‹ AUG 2026 ›` switcher,
running total in the right margin, and a footing (`MONTH TO DATE`, double rule) pinned
above the tab bar. Empty state is an invitation, not an apology: a blank ruled page with
one line of direction.

**Add (keypad-first)** — a `formSheet` where the amount is initially the only thing on
screen, set in Plex Mono at 56px. A custom 10-key pad below (not the OS keyboard — gives
us `00`, correct glyphs, and no layout jump). Category and date collapse into one meta
row underneath with defaults of "last used" and "today", so a typical expense is two
taps. Note is optional and reveals on tap.

**Insights** — horizontal category bars ranked by spend, using the one place colour is
allowed to appear; below it a 6-month trend as a bar row. Built with `react-native-svg`.
No donut chart.

**Budgets** — one ruled row per category: limit, spent, and a hairline-thin progress bar
that switches to `--red` past 100%. Over-budget rows get the ledger-red figure, which is
the whole reason red exists in the palette.

**Settings** — theme (System / Light / Dark), manage categories, export, and an
"about this ledger" row showing row counts. Deliberately the only screen allowed to use
grouped rows with labels on the left, statement-style.

**Search** — text field pinned at top, filter chips (category, amount range, date range)
on one line, results as standard ledger rows so the visual language never changes.

### Theme wiring

`darkMode: "class"` plus `colorScheme.set()` from `nativewind`. Rahul's
`useSetting('theme')` returns `'system' | 'light' | 'dark'`; a small effect in the root
layout pushes that into `colorScheme.set()`.

**Coordination point worth designing for:** the theme preference now lives behind a DB
read, so there are three gates before first paint — fonts loaded, migrations complete,
theme setting read. Hold the splash screen until all three resolve, otherwise the app
flashes light-then-dark on every cold start in dark mode. Default to `'system'` if the
read fails.

### Export

Clean boundary: `exportAllData()` returns a CSV string (Rahul's — it's a DB read). I own
everything after that — `new File(Paths.document, 'khata-2026-08.csv')`, `.create()`,
`.write()`, then `expo-sharing` for the share sheet. SDK 55 uses the object-oriented
`File`/`Paths` API; the old `FileSystem.*` calls now throw unless imported from
`expo-file-system/legacy`.

**Import/restore is yours entirely** — it writes to the DB. Worth thinking about whether
v1 needs it at all, given that on a local-only app an export nobody can restore is a
backup in name only.

---

## 4. Files

**Delete** (template placeholders, all superseded):
`src/app/explore.tsx`, `src/components/hint-row.tsx`, `src/components/web-badge.tsx`,
`src/components/animated-icon.{tsx,web.tsx,module.css}`,
`src/components/app-tabs.{tsx,web.tsx}`, `src/components/ui/collapsible.tsx`,
`src/components/external-link.tsx`.

**Replace** — [src/constants/theme.ts](/Users/rahul/development/personal/expense-tracker/src/constants/theme.ts),
[src/components/themed-text.tsx](/Users/rahul/development/personal/expense-tracker/src/components/themed-text.tsx),
[src/components/themed-view.tsx](/Users/rahul/development/personal/expense-tracker/src/components/themed-view.tsx),
[src/hooks/use-theme.ts](/Users/rahul/development/personal/expense-tracker/src/hooks/use-theme.ts),
[src/hooks/use-color-scheme.ts](/Users/rahul/development/personal/expense-tracker/src/hooks/use-color-scheme.ts).
These are the `StyleSheet` theming layer the template ships; with NativeWind + CSS
variables they're all dead weight. Their `Spacing` scale (`4/8/16/24/32/64`) is sound and
carries over as Tailwind spacing.

**New** — `src/components/ledger/` (`ledger-row`, `alignment-rule`, `footing`,
`day-header`, `rule`, `eyebrow`), `src/components/keypad/`, `src/components/charts/`,
`src/lib/format.ts` (minor-units → `₹1,240`, relative dates), `src/lib/month.ts`.

**Mine to build, yours to fill** — `src/queries/index.ts` and `src/queries/mock.ts` are
mine; `src/queries/live.ts`, `src/db/**` and `drizzle.config.ts` are yours.

---

## 5. Order of work

1. Config fixes + packages + fonts loading. Verify one `className` actually applies —
   nothing below works if NativeWind is silently dead.
2. Tokens in `global.css`, Tailwind mapping, `format.ts`. Theme toggle driven by local
   state, temporarily.
3. Contract in `src/types/domain.ts` + `src/queries/mock.ts`. **From here you can build
   the Drizzle layer in parallel.**
4. Ledger primitives, then the Ledger screen. This proves the design system — if the
   alignment rule doesn't feel right here, the direction changes before it spreads.
5. Custom tab bar + route shells.
6. Add-expense keypad modal, then transaction detail/edit.
7. Budgets, then Insights.
8. Search + filters.
9. Settings, export, real theme persistence wired to your `useSetting`.
10. Swap `mock.ts` → `live.ts`. Splash-gating for the three-gate cold start.

Steps 4–9 don't depend on your DB work at any point.

---

## 6. Verification

- `npx expo start`, run on iOS and Android. `npm run lint` clean.
- **NativeWind is live**: a `bg-red-500` on any view actually turns red. Do this first.
- **Both themes**: toggle System / Light / Dark in Settings and flip the OS appearance
  while the app is open. Every screen, both states. Check the `--rule` hairline is still
  visible in dark (thin low-contrast lines are the first thing to disappear).
- **The signature holds**: scroll the ledger with mixed amounts (`60` through `1,84,000`)
  and confirm the rule stays unbroken and every figure aligns. Across day-group headers
  too.
- **Add flow**: log an expense in under three taps. Confirm `₹0.01` and `₹9,99,999`
  both render without breaking the row, and that no decimal drift appears in the footing
  after ~20 entries.
- **Budgets**: a category at 99% / 100% / 140% shows the correct colour transition.
- **Export**: share sheet opens, resulting CSV opens in a spreadsheet with amounts as
  proper decimals.
- **Cold start in dark mode**: no light flash before first paint.
- Reduced-motion respected; keyboard/screen-reader labels present on the keypad.
