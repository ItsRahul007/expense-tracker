# Google Sign-In & Google Sheets Sync — Design

| | |
|---|---|
| **Status** | Draft v2 — for review |
| **Date** | 2026-11-16 (v1) · 2026-11-17 (v2) |
| **Author** | Rahul Ghosh |
| **Scope** | Mandatory Google sign-in, offline-safe session, restore on reinstall, local-first sync to a Google Sheet in the user's own Drive, cross-device conflict and duplicate handling |

**Implementation notes (2026-11-17), where the code differs from the text below:**
- Tab names: `README`, `Expenses`, `Categories`, `Budgets`, `_errors`, and hidden `_deleted` (tombstones), `_not_duplicates` (exceptions), `_meta`.
- No `updated_device` column. Exact `updated_at` ties are broken by comparing row content, which is just as deterministic and needs no extra column.
- `first_synced_at` is stamped when a device *uploads* a row, not when a later pull first sees it. Otherwise a row uploaded at once but re-read the next day would look "uploaded late" and trigger false duplicate suggestions.
- After every upload, `syncOnce` does one read-back pass, so uploaded rows are confirmed (marked clean) in the same sync.
- Duplicate merges version their results from the rows involved (`max(updated_at) + 1`, tombstone device `dedupe`), never the clock, so every device produces identical output.
- Development builds can "Skip for now" on the sign-in screen while Google isn't configured. This is held in memory and never shipped.
- **P7 changed (2026-11-19, at the user's request):** Sign out first syncs, and only proceeds when every change is confirmed in the sheet (0 waiting). It then clears the phone's data and all account links, with no tombstones, so signing in again restores from the sheet. If anything is unsynced (offline, error, pending review), sign-out is refused and nothing is removed.
- **Upgrading from the account-less app:** after Google sign-in, data not linked to any account triggers "sync it with <email>?". Yes merges and uploads it. No offers Export (CSV to Download/expense, then remove) or Delete (confirmed). Nothing happens until the user chooses.
- CSV export (Settings and the flow above) saves to Download/expense through the local `modules/downloads-saver` module (MediaStore: no permission, no prompt), never the share sheet.
- Code map: `src/sync/*` (engine, merge, dedupe, sheet format, clients), `src/auth/*` (sign-in, session), `src/providers/{session,sync}-provider.tsx`, screens `src/app/{sign-in,restore,account}.tsx`, `src/components/sync-notices.tsx`.

**v2 changes:** sign-in is now mandatory and survives offline cold starts (§7). Reinstall restores *before* the app opens (§8). Explicit "the phone's data is never lost" guarantees (§3, §11). Cross-device duplicate detection (§12). The backup-only mode and every "replace this device's data" option from v1 are removed.

---

## 1. Summary

The app stays **local-first**. SQLite on the phone is the primary copy of the user's data: every screen reads it, every write lands there first, and the app works fully offline. Google Sheets is a **sync copy** in the user's own Drive, used to restore after a reinstall and to share data between the user's devices. There is no server operated by the developer.

What changes for the user:

1. **First launch** shows a "Continue with Google" screen. The app can't be used without signing in once.
2. **After that, the user is never asked again**, even if they quit the app, turn off the internet and reopen it. The session lives on the device.
3. **Reinstall:** sign in → the app downloads everything from the sheet into the phone → *then* the app opens, with all data in place.
4. **Every add, edit and delete** is saved on the phone instantly and uploaded in the background a few seconds later.
5. **Two phones adding the same expense at about the same time** end up with one copy, not two.

---

## 2. Goals & non-goals

### Goals
- **G1 Local-first.** The phone's database is primary. No screen ever waits on the network.
- **G2 No local data loss.** Nothing sync does can silently destroy data on the phone (§3).
- **G3 Mandatory sign-in, once.** Signing in is required to use the app; afterwards the session survives restarts, offline launches and expired Google tokens.
- **G4 Restore before use.** On a fresh install with an existing sheet, the data is downloaded and stored locally before the main app appears.
- **G5 Fast upload.** Local changes reach the sheet within seconds when online.
- **G6 Converge, and don't duplicate.** All devices end up with the same data. The same expense entered on two devices at about the same time is kept once.
- **G7 No developer database or server.** Minimal permission: `drive.file` (only files this app created).

### Non-goals (v1)
- Shared ledgers between different Google accounts.
- End-to-end encryption (it would make the sheet unreadable).
- Web build (`@react-native-google-signin` is native-only).
- Syncing per-device preferences (`settings.theme`).
- Deduplicating repeated expenses entered on the **same** device (two coffees are two coffees; §12.3).

---

## 3. Core principles: "the phone is primary"

These are rules, and every later section follows them:

| # | Principle | What it means in practice |
|---|---|---|
| P1 | **Write locally first, always** | Mutations in `src/queries/live.ts` stay exactly as they are (plus bookkeeping columns). Sync never sits on the write path. |
| P2 | **The remote never replaces the local database** | There is no "use Google's data" or "replace this device" action anywhere. Restore and first connect are both **merges**: rows are added; nothing local is dropped. |
| P3 | **Every local row overwritten or removed by sync is kept** | Before sync overwrites or deletes a local row, the old version is copied to a local `row_history` table (§9.4). Anything can be recovered. |
| P4 | **Mass-change brake** | If a sync would delete more than 50 local expenses, or more than 20% of them when that's at least 5, it stops and asks the user (§11.3). Duplicate merges don't count. |
| P5 | **A broken sheet is never trusted** | An empty, damaged or newer-version sheet never causes local deletions; the app re-uploads from the phone or waits (§11.2). |
| P6 | **Auth problems never lock the user out** | An expired or revoked token pauses sync and shows a "Reconnect" banner. It never signs the user out or hides their data. |
| P7 | **Sign-out never deletes data automatically** | Data stays on the phone after sign-out. Removing it is a separate, explicit step that's only allowed once everything is uploaded (§7.6). |
| P8 | **Upload soon** | Uninstalling deletes the phone's copy; only uploaded rows survive that. So sync runs ~3 s after every write, and on backgrounding, and the Account screen shows "N changes not yet backed up". |

---

## 4. Why not "Sheets *as* the database"

| Concern | Detail |
|---|---|
| Latency | 300 ms–2 s per call; the screens run SQL aggregates (`useMonthSummary`, `useBudgets`, `useMonthTrend`) constantly |
| Quota | Sheets API ≈ 60 read + 60 write requests / min / user (verify against current limits) |
| Offline | No network, no app — violates G1 |
| Integrity | No transactions, foreign keys or triggers; the app relies on all three |
| Robustness | A user sorting a column would corrupt live data |

---

## 5. Architecture

```
┌──────────────────────────────── Device ────────────────────────────────┐
│                                                                        │
│  Root layout gates: fonts → theme → migrations → SESSION → BOOTSTRAP   │
│                                                                        │
│  Screens ──► src/queries/live.ts ──► SQLite  (primary copy)            │
│                    │ stamps updated_at/created_at/dirty, tombstones    │
│                    ▼ notifyLocalChange()                               │
│              src/sync/engine.ts ◄── triggers (3 s debounce, foreground,│
│                │      │              background, timer, manual)        │
│                │      └─► merge.ts + dedupe.ts   (pure, unit tested)   │
│                ▼                                                       │
│        sheets-client.ts / drive-client.ts ──► fetch + backoff          │
│                ▲                                                       │
│        src/auth/google.ts  (@react-native-google-signin)               │
│        src/auth/session.ts (session record in SQLite — offline-safe)   │
└────────────────┼───────────────────────────────────────────────────────┘
                 │ HTTPS, Bearer <user's access token>
                 ▼
   Drive API v3 (find/create file) · Sheets API v4 (rows)
                 ▼
   "Expense Tracker" spreadsheet in the USER'S Drive
```

### New modules

| Path | Responsibility | Pure? |
|---|---|---|
| `src/auth/google.ts` | configure, `signIn`, `getAccessToken()` (with a 401 retry), `signOut`, `revokeAccess`. The only file that imports the sign-in library. | no |
| `src/auth/session.ts` | read/write the **local session record** (§7.2); `useSession()` hook | no |
| `src/providers/session-provider.tsx` | exposes `{ status, user, bootstrap }` to the root layout's route guards | no |
| `src/app/sign-in.tsx` | login screen | no |
| `src/app/restore.tsx` | "Setting up your data…" bootstrap screen (§8) | no |
| `src/app/account.tsx` | account and sync status, sign out | no |
| `src/sync/clock.ts` | `nextStamp()`, a monotonic timestamp | yes |
| `src/sync/sheet-format.ts` | columns; domain row ⇄ sheet row; header validation | **yes** |
| `src/sync/merge.ts` | `merge(local, remote) → MergePlan` | **yes** |
| `src/sync/dedupe.ts` | duplicate detection and resolution (§12) | **yes** |
| `src/sync/local-repo.ts` | read syncable rows; apply a plan in one SQLite transaction; write `row_history`; mark clean | no |
| `src/sync/drive-client.ts`, `sheets-client.ts` | HTTP wrappers with retry/backoff | no |
| `src/sync/engine.ts` | `syncOnce()` (single-flight), `restore()` | no |
| `src/sync/sync-provider.tsx` | status, triggers, `syncNow()` | no |
| `src/sync/snapshots.ts` | daily on-device DB snapshot (§11.4) | no |

---

## 6. Google setup (developer side, one-time)

### 6.1 Library
Per the Expo SDK 55 Google auth guide, both supported libraries need a **development build** (not Expo Go); the project already builds with EAS.

**Proposed:** `@react-native-google-signin/google-signin` (free "original" API). It has `addScopes`, `getTokens()` (refreshes automatically on iOS), `clearCachedAccessToken()` (Android), `signInSilently`, `signOut` and `revokeAccess`. It's wrapped entirely in `src/auth/google.ts`, so moving to `react-native-nitro-google-signin` (Android Credential Manager) later touches one file.

### 6.2 Google Cloud project
1. Enable the **Drive API** and the **Sheets API**.
2. OAuth consent screen (External). Scopes: `openid email profile https://www.googleapis.com/auth/drive.file`. `drive.file` is **non-sensitive**, so publishing needs brand verification only (name, logo, homepage, **privacy policy**). While in "Testing" status, sign-in is limited to ≤100 listed test users.
3. OAuth clients:
   - **Android**: package `com.rahulghosh.expensetracker`, SHA-1 for the debug keystore, the EAS upload key **and the Play App Signing key** (a missing Play key is the classic "works in dev, `DEVELOPER_ERROR` in production" bug).
   - **iOS**: bundle id; the reversed client id goes into the config plugin's `iosUrlScheme`.
   - **Web client**: passed as `webClientId` to receive an `idToken` (used for the stable user id `sub`; §7.2).

### 6.3 `app.json`
```jsonc
"plugins": [
  // …existing
  ["@react-native-google-signin/google-signin",
   { "iosUrlScheme": "com.googleusercontent.apps.<IOS_CLIENT_ID>" }]
]
```
Client ids are public; keep them in `src/constants/google.ts`. Remove the duplicated Android permissions while editing `app.json`. This is a native change, so ship an **EAS build with a version bump** (`runtimeVersion.policy = appVersion`), not an OTA update.

---

## 7. Sign-in & session

### 7.1 Requirements
- R1. The app is unusable until the user has signed in **once** on this install.
- R2. After that, launching the app **never** shows the sign-in screen again, whatever the network, token or Google state, until the user explicitly signs out.
- R3. Opening the app must not wait on the network.

### 7.2 The session record is ours, not Google's
The route gate does **not** ask the Google SDK "is the user signed in?" at launch. That answer can depend on the network, on Play Services, or on a revoked grant, and could flip to "no" while the user is offline. Instead the app keeps its own session record in SQLite (`sync_state` keys, §9.3), written once at sign-in:

| Key | Value | Source |
|---|---|---|
| `session_user_id` | Google account id (`user.id` / idToken `sub`) | stable; used to detect account switches |
| `session_email`, `session_name`, `session_photo` | display | sign-in response |
| `session_signed_in_at` | epoch ms | |
| `bootstrap` | `restoring` \| `ready` | §8 |

**Signed in** ⇔ `session_user_id` is set. The check is a local SQLite read that runs after migrations, which already gate first paint in `AppDataProviders`. It needs no network and works identically offline.

Google tokens themselves are held by the sign-in SDK (Keychain / Android account manager) and are only needed **for sync**. If getting a token fails, sync pauses (§7.5); the session is untouched.

### 7.3 Startup sequence
`src/app/_layout.tsx` `AppGates` currently waits on fonts and the theme. Add the session as the next gate:

```
splash ─► fonts + theme + migrations ─► read session (SQLite, ~1 ms)
            │
            ├─ no session_user_id ............► sign-in screen
            ├─ session, bootstrap = restoring ► restore screen (§8)
            └─ session, bootstrap = ready ....► (tabs) immediately
                                                 └─ background: syncOnce()
```

### 7.4 Route guards (Expo Router, SDK 55)
Use `Stack.Protected`. `redirectTo` needs SDK 58+, so it isn't used; a guard that flips makes the router move to the first available screen, and its history is cleared.

```tsx
// RootNavigator in src/app/_layout.tsx (sketch)
const { status } = useSession(); // 'signedOut' | 'restoring' | 'ready'

<Stack screenOptions={…}>
  <Stack.Protected guard={status === "signedOut"}>
    <Stack.Screen name="sign-in" />
  </Stack.Protected>

  <Stack.Protected guard={status === "restoring"}>
    <Stack.Screen name="restore" options={{ gestureEnabled: false }} />
  </Stack.Protected>

  <Stack.Protected guard={status === "ready"}>
    <Stack.Screen name="(tabs)" />
    <Stack.Screen name="add" options={…} />
    {/* …every existing screen moves inside this guard… */}
    <Stack.Screen name="account" options={{ presentation: "modal" }} />
  </Stack.Protected>
</Stack>
```
Keep the splash screen up until the session status is known, so the sign-in screen never flashes for a signed-in user.

### 7.5 Token problems while signed in

| Event | Effect on session | Effect on sync | UI |
|---|---|---|---|
| Offline | none | waits | none (or "Waiting for connection" on Account) |
| Access token expired | none | `getTokens()` refreshes; Android: `clearCachedAccessToken` + retry once | none |
| Refresh fails / access revoked at myaccount.google.com / Google account removed from the device | **none: still signed in** | paused, status `needs_reauth` | banner in Settings/Account: "Reconnect Google to keep backing up" → `signIn()` |
| Reconnect with a **different** Google account | none until the user decides | paused | account-mismatch flow (§7.7) |

### 7.6 Sign-out
Only from Account → **Sign out**:
1. If online, run a final `syncOnce()` with a spinner.
2. If rows are still not uploaded: "12 changes haven't been backed up yet. They'll stay safe on this phone and upload next time you sign in with **rahul@…**." → `Sign out anyway` / `Cancel`.
3. `GoogleSignin.signOut()`; clear the `session_*` keys. **Local data and `owner_user_id` stay.**
4. The guard flips → sign-in screen.

Separately, **Remove data from this phone** (Account → Danger zone) is only enabled when there are 0 unsynced rows and the last sync succeeded, and it needs a typed confirmation. This is the only path that deletes local data in bulk.

### 7.7 Account ownership on the device
`sync_state.owner_user_id` records whose data the local database holds. It's set at first sign-in and never changed by sign-out.

| Sign-in as | Local DB | Result |
|---|---|---|
| anyone | empty (fresh install) | owner := this user → bootstrap (§8) |
| the owner | anything | straight in; sync resumes |
| someone else | has data from the owner | Choice screen: **Sign in as rahul@… instead** (default) · **Add this phone's data to new@…** (merge local into the new account's sheet; owner := new user) · **Remove this phone's data and continue**, enabled only if everything is synced to the old owner's sheet |

### 7.8 Existing users upgrading (no sign-in today)
After the update they see the sign-in screen once. Their local data is untouched (owner := first account signed in). Bootstrap then **merges** with any existing sheet or creates a new one and uploads everything. The sign-in copy says: "Your expenses on this phone are safe. Sign in to back them up."

---

## 8. Bootstrap: first sign-in and reinstall

### 8.1 Flow
Runs on the `restore` screen right after a successful sign-in:

```
signed in ──► bootstrap = 'restoring' (persisted)
   │
   ├─ 1. Find the app's sheet in Drive (appProperties query)
   │      ├─ found ──► 2. Download all tabs (1 batchGet)
   │      │            3. Validate (§11.2)
   │      │            4. MERGE into local in ONE SQLite transaction
   │      │               (fresh install: local is empty → plain insert)
   │      │            5. Run dedupe (§12)
   │      │            6. Upload anything local the sheet lacks
   │      └─ not found ► create + format sheet, upload all local rows
   │
   └─ 7. bootstrap = 'ready'  ──► guard flips ──► (tabs), data already there
```

- **Step 4 is atomic.** A crash or kill mid-restore leaves the local DB as it was. `bootstrap` is still `restoring`, so the next launch reopens the restore screen and runs again. Every step is idempotent: rows are keyed by id, so a re-run is safe.
- Downloaded rows are written with their remote `updated_at` and `sync_dirty = 0`, so they aren't echoed back.
- The restore screen shows a step label and counts: "Finding your backup…" → "Downloading 1,208 expenses…" → "Setting up…".

### 8.2 Failure during bootstrap

| Failure | Screen | Options |
|---|---|---|
| No network after sign-in | "Can't reach Google right now" | **Retry** (default) · **Continue offline**: sets `bootstrap = ready` and `restore_pending = 1`; the first successful sync later performs the same merge and shows "Restored 1,208 expenses from Google". Safe because restore is a merge (P2). |
| Sheet found but damaged / newer schema | explains the problem | Retry · Continue offline (no data is applied from a damaged sheet) |
| Several app sheets found (the user duplicated the file) | list with modified dates and row counts | pick one; the others are left untouched |

---

## 9. Data model changes

### 9.1 Columns

| Table | New columns | Purpose |
|---|---|---|
| `transactions` | `created_at INTEGER NOT NULL`, `created_device TEXT NOT NULL`, `updated_at INTEGER NOT NULL`, `sync_dirty INTEGER NOT NULL DEFAULT 1` | `created_at` is **when the row was entered**: `occurredAt` is midday of the chosen day (`src/app/add.tsx` `dayStart`), so it can't tell entries minutes apart. Needed for duplicate detection (§12). |
| `categories` | `updated_at`, `sync_dirty` | merge |
| `budgets` | `updated_at`, `sync_dirty` | merge (`created_at` already exists) |

None of these go into `src/types/domain.ts`; they're storage-only, like `isDefault`.

### 9.2 New tables
```sql
-- Deletes propagate as tombstones; hard DELETEs in live.ts stay as they are,
-- so no read query needs a "deleted_at IS NULL" filter.
CREATE TABLE tombstones (
  entity      TEXT NOT NULL,            -- 'transaction' | 'category' | 'budget'
  id          TEXT NOT NULL,
  deleted_at  INTEGER NOT NULL,
  reason      TEXT NOT NULL,            -- 'user' | 'duplicate'
  merged_into TEXT,                     -- survivor id when reason = 'duplicate'
  device      TEXT NOT NULL,
  sync_dirty  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (entity, id)
);

-- P3: every row version sync overwrote or removed. Local only, never synced.
CREATE TABLE row_history (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  entity     TEXT NOT NULL,
  id         TEXT NOT NULL,
  row_json   TEXT NOT NULL,             -- full row before the change
  cause      TEXT NOT NULL,             -- 'remote_newer' | 'remote_delete' | 'duplicate'
  at         INTEGER NOT NULL
);

-- Pairs the user said are NOT duplicates (via Undo). Synced, so every device
-- respects the decision.
CREATE TABLE dedupe_exceptions (
  id_a TEXT NOT NULL, id_b TEXT NOT NULL,   -- stored with id_a < id_b
  at   INTEGER NOT NULL,
  sync_dirty INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (id_a, id_b)
);

CREATE TABLE sync_state (key TEXT PRIMARY KEY NOT NULL, value TEXT);
```

### 9.3 `sync_state` keys
`device_id` (random, once per install) · `owner_user_id` · `session_*` (§7.2) · `bootstrap` · `restore_pending` · `spreadsheet_id` · `sheet_schema_version` · `last_sync_at` · `last_remote_version` · `last_error` · `auto_sync`.

### 9.4 `row_history` retention
Keep 90 days. Phase 4 adds a small "Recently changed by sync" list on the Account screen, with restore, built on top of it.

### 9.5 Migration `0005_sync.sql` (sketch)
```sql
ALTER TABLE transactions ADD created_at integer NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD created_device text NOT NULL DEFAULT 'legacy';
ALTER TABLE transactions ADD updated_at integer NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD sync_dirty integer NOT NULL DEFAULT 1;
-- …same updated_at/sync_dirty for categories and budgets…

-- Existing rows: "entered" and "edited" at migration time.
UPDATE transactions SET created_at = <now>, updated_at = <now>;
UPDATE budgets      SET updated_at = <now>;
-- Seeded defaults stay at updated_at = 0: identical on every device, so they
-- never conflict; any real edit beats them.
UPDATE categories   SET updated_at = <now> WHERE is_default = 0;

-- tombstones, row_history, dedupe_exceptions, sync_state as in §9.2
CREATE INDEX transactions_dirty_idx ON transactions (sync_dirty) WHERE sync_dirty = 1;
CREATE INDEX transactions_dup_idx   ON transactions (category_id, amount_minor, occurred_at);
```
`created_device = 'legacy'` rows are **excluded from duplicate detection** (§12.2). Pre-sync data can't have been entered on two devices, so matching it would only produce false positives.

### 9.6 Stamping writes in `live.ts`
```ts
// src/sync/clock.ts — never repeats or goes backwards within a run
let last = 0;
export const nextStamp = () => (last = Math.max(Date.now(), last + 1));
```

| Mutation | Change |
|---|---|
| `useAddTransaction` | `createdAt = updatedAt = nextStamp()`, `createdDevice = deviceId`, `syncDirty = 1` |
| `useUpdateTransaction` | `updatedAt = nextStamp()`, `syncDirty = 1` (`created_*` never change) |
| `useDeleteTransaction` | `db.transaction`: delete + tombstone (`reason 'user'`) |
| `useUpsertBudget` | stamp on insert/update; the `limitMinor <= 0` delete paths select ids first, then delete + tombstone |
| `useDeleteBudget` | tombstone the original; the split pieces are new stamped rows |
| `useUpsertCategory` | stamp in `values` and `onConflictDoUpdate.set` |
| `useDeleteCategory` | tombstone the deleted budget ids and the category |
| `useImportTransactions` | stamp every row; `createdAt` = import time; `createdDevice` = this device |
| every `onSuccess` | also `notifyLocalChange()` → sync debounce (§10.6) |

---

## 10. Sync

### 10.1 Conflict model (same row edited in two places)
- Unit: one row `(entity, id)`. Version: `(updated_at, device)`, compared in that order; `device` only breaks exact ties, deterministically.
- **Last edit wins per row.** Different rows never conflict.
- **Edit vs. delete:** the later timestamp wins. Editing after another device deleted the row brings it back.
- The losing local version is **copied into `row_history` before being overwritten** (P3).
- Clock skew is tolerated: `nextStamp()` blocks local backwards jumps; phones sync to network time. A Hybrid Logical Clock is a drop-in upgrade inside `clock.ts`.

### 10.2 "Clean only when observed"
A local row's `sync_dirty` is cleared only when a **pull** has seen the sheet hold that exact `(id, updated_at)`, never because a write returned 200. The Sheets API has no compare-and-swap, so two devices writing at once can overwrite each other. With this rule, the overwritten device's rows are still dirty, and it re-uploads them on its next sync. **The system converges without locks, and a phone's unsynced data can never be marked as safe when it isn't.**

### 10.3 `syncOnce()`
Single-flight; never throws into the UI.

1. **Preconditions:** session present, `bootstrap = ready`, a spreadsheet known, online.
2. **Token:** `getAccessToken()`; on failure → `needs_reauth` (§7.5), stop.
3. **Fast path:** if Drive `files.get(fields=version,trashed)` matches `last_remote_version` and nothing is dirty locally, stop. Cost: 1 Drive call.
4. **Pull:** one `values.batchGet` for all tabs.
5. **Validate (§11.2):** on any failure, stop without touching local data.
6. **Read local:** all syncable rows, tombstones and exceptions.
7. **Merge** (`merge.ts`) → per-row winners → **dedupe** (`dedupe.ts`, §12) → **invariant repairs** (§10.4) → `MergePlan { applyLocal, historyRows, markClean, nextSheet, sheetChanged }`.
8. **Mass-change brake (P4):** if the plan deletes > 20% of local expenses or > 50 rows, pause with status `needs_confirmation`; the Account screen shows what would change.
9. **Apply locally** in one `db.transaction`: write `row_history` → upsert categories → upsert budgets/transactions → delete transactions/budgets → delete categories. If anything throws, roll everything back and don't push.
10. **Push** (only if `sheetChanged`): one `values.batchUpdate` rewriting each tab from row 2, padded with blank rows up to the previous row count (this clears leftovers in the same request). `_meta` is updated in the same call. `valueInputOption = RAW`.
11. **Mark clean:** `UPDATE … SET sync_dirty = 0 WHERE id = ? AND updated_at = ?`. An edit made *during* the sync keeps its row dirty.
12. **Bookkeeping:** `last_sync_at`, `last_remote_version`; clear `last_error`. If `applyLocal` was non-empty, `queryClient.invalidateQueries()`.

**Cost:** ≈ 1 Drive read + 1 Sheets read + ≤ 1 Sheets write + 1 Drive read per sync, well under quota even at one sync every few seconds.

### 10.4 Invariant repairs (from existing app rules)

| Situation | Repair |
|---|---|
| Remote tombstone for a category that local expenses still use | Keep the category (re-stamp it) and drop the tombstone. Mirrors the "no action" FK: real spending is never orphaned. |
| Tombstone for a seeded default category | Ignore it (the `categories_protect_default_delete` trigger would abort anyway) |
| Expense whose `category_id` exists nowhere | Keep it locally; recreate a placeholder category "Uncategorised (restored)" rather than drop the expense |
| Budget/expense arrives before its category | Handled by the apply order in step 9 |

### 10.5 Tombstone retention
Tombstones are kept in the sheet for 400 days. A device whose `last_sync_at` is older than that **doesn't apply deletions** older than its own last sync window. It merges additions only and asks: "This phone was offline for over a year. Some items deleted on your other devices may reappear. Review?" No local data is lost (P2); at worst old deleted items come back.

### 10.6 Triggers

| Trigger | Action |
|---|---|
| Any local write (`notifyLocalChange`) | sync **3 s after the last write** (debounced; batches rapid entry) |
| App to foreground | sync (the fast path makes it cheap) |
| App to background with dirty rows | one attempt within the OS grace period |
| Foreground timer | every 5 min |
| Pull-to-refresh / "Sync now" | immediate |
| Phase 4: `expo-background-task` | periodic, OS-scheduled best effort |

---

## 11. Local data safety

### 11.1 Every way sync can change local rows, and its safeguard

| Change | When | Safeguard |
|---|---|---|
| Overwrite a local row | remote version newer | old version → `row_history` |
| Delete a local row | remote tombstone newer than the local edit | old row → `row_history`; mass brake |
| Delete as a duplicate | §12 | old row → `row_history`; tombstone with `merged_into`; Undo |
| Bulk replace | **never exists** | no code path |
| Sign-out | never deletes | §7.6 |

### 11.2 Sheet validation (P5)
Before applying anything:
- `_meta.schema_version` greater than the app supports → stop: "Update the app to keep syncing".
- Required headers missing (matched by **name**, so reordered columns are fine) → stop: "The sheet's layout was changed. Repair it from this phone?" (rewrite the sheet from local).
- **Sheet empty but local has data** (the user cleared it, or the file was replaced) → treat it as "sheet reset": push local, apply **no** deletions.
- File trashed or 404 → "Your Google Sheet was deleted. Recreate from this phone?" → create a new sheet from local. Local data is untouched.
- Rows that fail parsing are kept in an `_errors` tab, never silently dropped, and never cause local deletions.

### 11.3 Mass-change brake
Thresholds: > 50 expenses, or > 20% of local expenses when that's at least 5, deleted in one sync by a person (duplicate merges don't count; they lose no information). The pending plan is shown as "Your other device deleted 312 expenses. Apply?" with **Apply** / **Keep mine** ("Keep mine" re-stamps the local rows so they win and re-upload).

### 11.4 On-device snapshots
Once a day (on the first sync of the day) and before any bootstrap merge: `VACUUM INTO '<documentDir>/snapshots/expense-YYYY-MM-DD.db'`, keeping the last 3. These are a last-resort recovery, independent of Google. Phase 4 adds a hidden recovery action.

---

## 12. Duplicate prevention across devices

### 12.1 The problem
The same expense can be entered on two phones (or by two people sharing one account) at about the same time, e.g. both record "₹250 · Food" for lunch. Each phone creates its own row with its own id, so id-based sync would keep **both**. The goal is to keep one.

### 12.2 Definition of a duplicate pair
Two expense rows **A** and **B** are duplicates when **all** of these hold:

| # | Rule | Why |
|---|---|---|
| 1 | `A.created_device ≠ B.created_device` | Repeats on the *same* phone are deliberate (two coffees). |
| 2 | Neither is `'legacy'` (pre-sync data) | Old data can't have been entered on two devices |
| 3 | Same `category_id` | |
| 4 | Same `amount_minor` (exact paise) | |
| 5 | Same `occurred_at` **calendar day** | `occurredAt` is midday of the chosen day; compare the local date |
| 6 | `abs(A.created_at − B.created_at) ≤ DUPLICATE_WINDOW` (**10 minutes**, a constant) | "Entered at about the same time". 10 min absorbs clock skew between phones and slow typing. |
| 7 | The pair isn't in `dedupe_exceptions` | The user said they're different |

**The note doesn't matter**, as requested: "Lunch" vs "lunch with team" vs empty still counts as a duplicate.

### 12.3 Matching when there are several candidates
Rows are grouped by *(category, amount, day)*. Within a group, sorted by `created_at`, matching is **one-to-one across devices**: each row can absorb at most one row from each *other* device, and only within the window.

| Phone A enters | Phone B enters (same window) | Result |
|---|---|---|
| ₹250 Food | ₹250 Food | **1** |
| ₹250 Food ×2 (two coffees) | ₹250 Food ×1 | **2** (one of A's matched B's; A's second is A's own) |
| ₹250 Food ×2 | ₹250 Food ×2 | **2** |
| ₹250 Food | ₹250 Food 40 min later | **2** (outside the window) |
| ₹250 Food | ₹260 Food | **2** (different amount) |
| ₹250 Food | ₹250 Groceries | **2** (different category) |

So the result is the largest count any single device entered, which is the most likely truth.

### 12.4 Which copy survives
Deterministic, so every device independently picks **the same survivor**:
1. Earliest `created_at` (the first entry wins).
2. Tie → smaller `created_device`, then smaller `id`.

Merging into the survivor:
- **Note:** if the survivor's note is empty and the other has one, take it. If both have notes and they differ, keep the survivor's; the other is preserved in `row_history`.
- If the duplicate was **edited later** than the survivor (higher `updated_at`), its amount/category/date/note are copied onto the survivor, stamped as a new edit. The user's latest intent wins, and only one row remains.
- The duplicate becomes a tombstone with `reason = 'duplicate'` and `merged_into = <survivor id>`.

### 12.5 Timeline: both phones online
```
10:00:05  Phone A: add ₹250 Food "Lunch"         → local row a1 (dirty)
10:00:08  A syncs: sheet = {a1}
10:00:20  Phone B: add ₹250 Food "lunch w/ team" → local row b1 (dirty)
10:00:23  B syncs: pulls {a1}; local {b1}; dedupe → a1 survives (earlier),
          note stays "Lunch" (b1's note kept in B's row_history);
          B deletes b1 locally, writes tombstone(b1→a1); pushes {a1, tomb b1}
10:05:00  A syncs (fast path sees version changed): pulls; nothing to do
Result: both phones show one ₹250 Food "Lunch".
```

### 12.6 Timeline: both offline, then online
Both phones keep their own row while offline (each is correct locally). Whichever syncs second detects the pair and resolves it as above; the other converges on its next sync. Because the rule is deterministic and doesn't depend on who syncs first, there's no flip-flopping.

### 12.7 User control
- After a sync that merged duplicates, a toast: "Merged 1 duplicate expense from your other device · **Undo**".
- **Undo** restores the duplicate from `row_history` (re-stamped, so it wins over the tombstone) and adds the pair to `dedupe_exceptions`, which syncs so no device merges it again.
- Settings → Account → **Duplicate detection: On/Off** (default On).

### 12.8 Categories and budgets
- **Categories:** two devices creating "Pet care" usually produce the same id (`makeCategoryId` slugs the name), which merges naturally. If the ids differ but the names are equal ignoring case and spacing, the category survivor is the default category if either is one, otherwise the smaller id. The other category's expenses and budgets are re-pointed to it (stamped edits) and the duplicate is tombstoned.
- **Budgets:** the same `(category_id, start_month, end_month)` with different ids → keep the newest `updated_at`, tombstone the others (`useUpsertBudget`'s same-scope match only sees local rows, so offline devices can each create one).

### 12.9 One phone offline, the other online
**Case A: entered at about the same time (auto-merge).**
```
10:00  Phone A (OFFLINE): add ₹250 Food → a1 { created_at 10:00 } stays dirty on A
10:02  Phone B (online):  add ₹250 Food → b1 { created_at 10:02 } uploaded at 10:02
...    sheet and every other device show b1
18:00  Phone A back online → syncs: pulls {b1}, has {a1}
       created_at difference = 2 min ≤ 10 min → duplicate pair
       survivor = a1 (earlier entry); b1 → tombstone(merged_into a1)
18:00+ Phone B's next sync: b1 replaced by a1. Same amount, category and date,
       so on screen nothing visibly changes.
```
The upload delay doesn't matter: `created_at` is stamped by `useAddTransaction` at entry time and never changes, and a phone's clock keeps running offline. The only visible effect is the row id changing on B. If the user happens to have b1's detail screen (`transaction/[id]`) open, it should follow `merged_into` to a1 rather than show "not found". **Implementation note:** the detail screen checks `tombstones.merged_into` when its id disappears.

**Case B: entered far apart (suggest, never auto-merge).**
```
10:00  Phone A (OFFLINE): add ₹250 Food
14:00  Phone B (online):  add ₹250 Food      ← 4 hours later
18:00  Phone A syncs → outside the 10-min window → NOT auto-merged
```
This is ambiguous: it may be one lunch entered twice (the user forgot they'd entered it on the offline phone), or two real ₹250 Food expenses that day. Deleting real spending silently is worse than showing a duplicate (P2), so the app **doesn't decide; it asks**:

- A **possible duplicate** = rules 1–5 and 7 of §12.2 hold (different devices, same category, same amount, same day, not dismissed) but rule 6 (the 10-min window) does not.
- These are computed locally after each sync (no new synced state) and shown as a dismissible card on Home: "2 possible duplicates from your other phone · Review".
- The review sheet shows each pair side by side (amount, category, day, both notes, "entered 10:00 on this phone (offline)" / "entered 14:00 on Pixel"):
  - **Merge**: the same merge as §12.4, with the user choosing which note to keep. Recorded as a normal edit + tombstone, so it syncs.
  - **Keep both**: adds the pair to `dedupe_exceptions` (synced), so it's never suggested again on any device.
- Suggestions are made only for pairs where at least one row was **uploaded late**, i.e. its first upload happened more than 10 min after `created_at`. That is exactly the "one phone was offline" situation. Two phones online that each enter ₹250 Food hours apart are clearly two expenses and aren't suggested. This needs one new column, `transactions.first_synced_at`: set by whichever device first observes the row in the sheet during a pull (§10.2), then synced as a machine column so every device sees the same value.

**Why not just leave it as the user's fault?** Partly it is. But the cost is asymmetric: an extra row inflates the month's total and budget progress (`useMonthSummary`, `useBudgets`) without the user noticing, while a wrongly deleted expense is data loss. A one-tap review fixes the first and avoids the second. A suggestion is the cheapest fair middle ground, and it never runs without the user.

### 12.10 CSV import on two devices
Importing the same file on both phones within 10 minutes gives pairs that match all the rules, so they collapse to one. A single file containing identical rows comes from one device, so all its rows are kept.

---

## 13. Spreadsheet layout

Found by Drive `appProperties { app: 'expense-tracker', role: 'primary' }`, which works under `drive.file`.

**`transactions`**

| Display (user-facing) | Machine (grey, grouped, warning-protected) |
|---|---|
| Date · Category · Amount (₹) · Note | id · category_id · amount_minor · occurred_at · created_at · created_device · updated_at · updated_device · row_hash |

**`categories`**: Name · Icon · Color · Order | id · sort_order · updated_at · updated_device · row_hash
**`budgets`**: Category · Monthly limit (₹) · From · To | id · category_id · start_month · end_month · limit_minor · created_at · updated_at · updated_device · row_hash
Hidden tabs: **`tombstones`** (entity · id · deleted_at · reason · merged_into · device) · **`dedupe_exceptions`** · **`_meta`** (`schema_version`, `last_writer_device`, `last_write_at`, `app_version`) · **`_errors`** (only when non-empty) · **`README`**: "Managed by the Expense Tracker app. Grey columns are used by the app — please don't edit them."

On creation: freeze the header row; collapse the machine column group; warning-only protection on the machine columns and hidden tabs; `#,##0.00` on amounts, `yyyy-mm-dd` on dates. Writes use `valueInputOption = RAW` (a note starting with `=` stays text). The display columns are regenerated on each push. In Phase 3 they become editable through `row_hash` change detection.

Size: ~1,800 rows/year × 13 columns ≈ 24k cells/year against a 10M-cell limit. Writes are chunked at 5,000 rows per range.

---

## 14. Error handling (summary)

| Error | Behaviour | User sees |
|---|---|---|
| Offline / timeout | retry on the next trigger | "Waiting for connection" (Account only) |
| 401 | refresh + 1 retry → `needs_reauth` | Reconnect banner; app fully usable |
| 403 insufficient scope | `addScopes(['drive.file'])` | "Allow Drive access to keep backing up" |
| 429 / 5xx | backoff 1-2-4-8-16 s with jitter | nothing unless persistent |
| 404 / trashed | stop | "Sheet deleted — recreate from this phone?" |
| Newer schema / damaged headers | stop, no local changes | update or repair prompt |
| Mass-change brake | pause | review prompt |
| Local apply fails | roll back, no push | "Sync failed" + details |

---

## 15. UI (NativeWind, existing `src/components/ui` primitives)

### 15.1 Sign-in (`src/app/sign-in.tsx`)
App icon · "Track every rupee, safely" · three bullets (*Works offline · Backed up to your own Google Drive · Only this app's file is accessed*) · **Continue with Google** `Button` · small print on what's stored where. Errors appear inline (cancelled → nothing; network → "Check your connection"). Sign-in genuinely needs the network the first time; say so when offline.

### 15.2 Restore (`src/app/restore.tsx`)
Centered progress with a step label and counts (§8.1). Failure states as in §8.2. No back gesture.

### 15.3 Settings
A new **Account** section at the top: avatar · email · "Backed up 2 min ago" / "3 changes waiting" / ⚠ "Reconnect needed" → opens Account. The footer "Everything is stored on this device only…" changes to "Saved on this phone and backed up to your Google Drive."

### 15.4 Account (`src/app/account.tsx`)
- Profile card
- **Backup** card: status, unsynced count, last synced, **Sync now**, *Open in Google Sheets*, **Sync automatically** toggle, **Duplicate detection** toggle
- Pending review (mass-change brake) card when present
- **Sign out** (§7.6)
- Danger zone: **Remove data from this phone** (§7.6)

### 15.5 Tab bar
A dot on the Settings tab in `tab-bar.tsx` when the status is `needs_reauth`, `needs_confirmation` or `error`.

---

## 16. Security & privacy
- No developer server; data lives on the phone and in the user's own Drive.
- `drive.file` only: the app can't see any other file.
- Tokens stay in the sign-in SDK (Keychain / account manager); never written to SQLite, logs or AsyncStorage. The session record holds only id, email, name and photo URL.
- Not end-to-end encrypted: Google, and anyone the user shares the sheet with, can read it. Say so in the sign-in small print.
- Logs carry counts and error codes only, never notes, amounts or emails.
- A privacy policy is required for OAuth verification (Google API Services User Data Policy, Limited Use).
- `Stack.Protected` is a UI gate, not a security boundary (per the Expo docs). That's fine: the data is the user's own on their own device.

---

## 17. Testing

Add `jest-expo` and an `npm test` script (the project has no test runner yet).

**Unit (pure):**
- `merge.ts`: newer wins both ways, ties deterministic, edit-vs-delete both orders, `row_history` produced for every overwrite/delete, idempotent, commutative (A→B and B→A converge).
- `dedupe.ts`: every row in §12.3's table; legacy rows excluded; same-device repeats kept; window edges (exactly 10 min, 10 min + 1 ms); survivor deterministic regardless of input order; note adoption; a later-edited duplicate carries its edit over; exceptions respected; category name merge re-points expenses.
- `sheet-format.ts`: round trips including `null` notes and `endMonth`, emoji icons, commas, quotes, newlines and a leading `=`; header reordering.
- `clock.ts`: monotonic under a mocked clock that goes backwards.

**Engine (fakes):** two fake devices + a fake sheet, property-based random interleavings (`fast-check`) of add/edit/delete/sync/offline. Assert that (1) all devices converge, (2) no row that existed only on a device is lost without a `row_history` entry, and (3) no duplicate pairs (per §12.2) remain.

**Session/gating:** a component test that the sign-in screen never renders when the `session_user_id` key exists, with the network and the Google module mocked to fail.

**Manual QA (dev build, then Play internal track):**

| # | Scenario | Expected |
|---|---|---|
| 1 | Fresh install, new user | sign-in → empty app → add → appears in the sheet within ~5 s |
| 2 | Uninstall → reinstall → sign in | restore screen → app opens with all data already present |
| 3 | Signed in → force quit → airplane mode → open | opens straight to Home, no sign-in screen |
| 4 | Revoke at myaccount.google.com, then open | app opens normally; Reconnect banner; reconnect resumes sync |
| 5 | Two phones, same ₹250 Food within a minute | one row on both after syncs; toast with Undo |
| 6 | Same as 5, 30 min apart, both online | two rows, no suggestion |
| 6a | A offline adds ₹250 Food at 10:00; B online adds the same at 10:02; A reconnects at 18:00 | one row on both (auto-merged) |
| 6b | Same as 6a but B adds at 14:00 | two rows + "possible duplicate" card; Merge → one row everywhere; Keep both → never asked again |
| 7 | Two coffees on one phone | two rows |
| 8 | Delete 100 rows on A | B pauses with the review prompt |
| 9 | User clears the sheet | next sync re-uploads; no local deletions |
| 10 | Kill the app mid-restore | reopen → restore resumes → correct data |
| 11 | Existing (pre-update) user installs the update | sign-in once; all old data still there and uploaded |
| 12 | Sign out with unsynced changes offline | warning; data kept; sign back in → uploaded |
| 13 | Sign in as a different account | ownership choice screen (§7.7) |
| 14 | 10k rows | restore < 10 s; idle sync uses the fast path |

---

## 18. Rollout & effort

| Phase | Contents | Est. |
|---|---|---|
| **0 Groundwork** | migration `0005`; `clock.ts`; stamping + tombstones in every `live.ts` mutation; `sync_state` helpers; jest setup. Invisible; shippable alone. | 2 days |
| **1 Sign-in + restore + sync** | Google Cloud setup; config plugin + EAS build; `auth/*`; session gate with `Stack.Protected`; sign-in & restore screens; `drive/sheets` clients; `sheet-format`; `merge`; `syncOnce`; triggers; Account screen; safety (§11); privacy policy | 7–9 days |
| **2 Duplicates & multi-device hardening** | `dedupe.ts` + tests; Undo + exceptions; category/budget merges; mass-change brake UI; property tests | 4–5 days |
| **3 Edits in the sheet** | `row_hash`; parse display columns (share code with `src/lib/csv-import.ts`); `_errors` | 2–3 days |
| **4 Polish** | background task; tab dot; snapshot recovery UI; "Recently changed by sync" list | 2–3 days |

Phases 1 and 2 should ship **together** if the app is expected to run on more than one device from day one. Phase 1 alone is safe for single-device users.

---

## 19. Open decisions

| # | Question | Recommendation |
|---|---|---|
| D1 | Sign-in library | `@react-native-google-signin/google-signin`, isolated in `src/auth/google.ts` |
| D2 | Duplicate window | 10 minutes (constant `DUPLICATE_WINDOW_MS`) |
| D3 | Dedupe on by default? | Yes, with Undo and a toggle |
| D4 | Mass-change brake thresholds | 20% or 50 rows |
| D5 | "Continue offline" during bootstrap | Allow (restore is a merge, so it's safe) |
| D6 | Who may edit the sheet | Phases 1–2: no (warning-protected). Phase 3: display columns. |
| D7 | Tombstone retention | 400 days |
| D8a | Entries far apart, one phone was offline (§12.9 case B) | Don't auto-merge; show a "possible duplicates" review card (Merge / Keep both) |
| D8 | Should same-device identical entries ever be flagged? | No auto-merge; maybe a gentle "Looks like a repeat — add anyway?" prompt in the add form (out of scope here) |

---

## 20. References
- Expo SDK 55 docs — https://docs.expo.dev/versions/v55.0.0/
- Expo Google authentication — https://docs.expo.dev/guides/google-authentication/
- Expo Router protected routes — https://docs.expo.dev/router/advanced/protected/
- React Native Google Sign-In — https://react-native-google-signin.github.io/docs/original
- Sheets API reference / limits — https://developers.google.com/sheets/api/reference/rest · https://developers.google.com/sheets/api/limits
- Drive `appProperties` — https://developers.google.com/drive/api/guides/properties
- Drive scopes — https://developers.google.com/drive/api/guides/api-specific-auth
- Google API Services User Data Policy — https://developers.google.com/terms/api-services-user-data-policy
