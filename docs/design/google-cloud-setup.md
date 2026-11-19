# Your checklist: Google Cloud & accounts setup

> **Status (2026-11-17):** steps 1–5 done. The client IDs are in `src/constants/google.ts`, and the iOS URL scheme and `ios.bundleIdentifier` (`com.rahulghosh.expensetracker`) are in `app.json`. Keep `web_client_secret` out of the app; it lives only in the gitignored `.env.local`. Remaining: step 6 (privacy policy, before publishing), step 8 decisions, step 9 (development build).

Everything here needs your Google account or your Play Console, so only you can do it.
Phase 1 (sign-in + sync) can't be tested on a device until steps 1–6 are done.
Design: [2026-11-16-google-sheets-sync.md](2026-11-16-google-sheets-sync.md) (§6).

When you finish, send me the three **client IDs** from step 5. They're public identifiers, not secrets, and go into `src/constants/google.ts`.

---

## 1. Decide the iOS bundle identifier
`app.json` has an Android `package` (`com.rahulghosh.expensetracker`) but **no `ios.bundleIdentifier`**. Pick one (suggested: the same `com.rahulghosh.expensetracker`). The iOS OAuth client needs it. Skip iOS entirely for now if you only ship Android.

## 2. Create the Google Cloud project
1. https://console.cloud.google.com → project picker → **New project** → name it `Expense Tracker`.
2. **APIs & Services → Library**: enable **Google Drive API** and **Google Sheets API**.

## 3. OAuth consent screen (Google Auth Platform → Branding / Audience / Data access)
- User type: **External**
- App name, support email, developer contact email
- App logo (optional while testing, needed for publishing)
- **Data access → Add scopes**: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `.../auth/drive.file`
  - Do **not** add `.../auth/spreadsheets` or `.../auth/drive`. `drive.file` is enough and keeps review light.
- **Audience**: leave as **Testing** and add yourself (and any test phones' Google accounts) under **Test users** (max 100).

## 4. Get the Android SHA-1 fingerprints
You need one fingerprint per signing key that will run the app:

| Key | How to get the SHA-1 |
|---|---|
| EAS build key (dev + preview builds) | `npx eas-cli credentials -p android` → pick the profile → "Keystore" shows the SHA-1 |
| Local debug key (only if you run `npx expo run:android`) | `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android` |
| **Play App Signing key** (Play Store installs) | Play Console → your app → **Test and release → App integrity → App signing** → "App signing key certificate" SHA-1 |

⚠️ Missing the Play App Signing SHA-1 is the #1 cause of "sign-in works in dev but fails in production" (`DEVELOPER_ERROR`).

## 5. Create the OAuth clients (Google Auth Platform → Clients → Create client)
| Type | Fields | Notes |
|---|---|---|
| **Android** | package `com.rahulghosh.expensetracker` + one SHA-1 | Create **one Android client per SHA-1** from step 4 |
| **iOS** | bundle id from step 1 | Note the "iOS URL scheme" (`com.googleusercontent.apps.…`) |
| **Web application** | name only, no redirect URIs | Its client ID is the `webClientId`; needed to receive an `idToken` |

Send me: **Web client ID**, **iOS client ID**, **iOS URL scheme**. The Android clients work by package + SHA-1, so no ID is needed in code.

## 6. Privacy policy page
Needed before publishing the consent screen (not for Testing mode). It must say:
- the app stores expenses on the device and in a spreadsheet **in the user's own Google Drive**
- the developer runs no server and receives no data
- it uses the `drive.file` permission (only files the app created)
- how to disconnect: in the app (Account → Sign out) or at https://myaccount.google.com/permissions

A GitHub Pages / Notion public page is fine. Put the URL on the consent screen.

## 7. Before launch (not urgent)
- Consent screen → **Publish app** → brand verification (name, logo, homepage, privacy policy). `drive.file` is non-sensitive, so no security assessment is needed.
- A homepage URL on a domain you own (verified in Google Search Console).

## 8. Decisions I need from you (design §19)
- [ ] Duplicate window: **10 minutes**?
- [ ] Mass-deletion brake: **20% or 50 rows**?
- [ ] Duplicate merging on by default (with Undo)?
- [ ] "Continue offline" allowed on the restore screen?
- [ ] Android only for now, or iOS too?

## 9. Later, when Phase 1 code lands
- Make a new development build (`npx eas-cli build --profile development -p android`): the Google sign-in library is native code, so Expo Go and OTA updates won't work for it.
- Bump the app version, because `runtimeVersion.policy` is `appVersion`.
