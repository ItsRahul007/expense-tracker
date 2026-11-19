/**
 * App variants, so a development build installs *next to* the preview /
 * production app instead of replacing it (same pattern as the video player).
 *
 *   APP_VARIANT=development → "Expense (Dev)", com.rahulghosh.expensetracker.dev
 *   APP_VARIANT=preview     → "Expense Tracker", com.rahulghosh.expensetracker
 *   APP_VARIANT=production  → same as preview
 *
 * app.json stays the base config; this only overrides what differs. Unset
 * means production, so nothing builds as the dev variant by accident — the
 * `start` / `android` scripts and the EAS `development` profile set it.
 *
 * Google sign-in matches Android apps by package name + signing SHA-1, so the
 * dev package needs its own Android OAuth client (docs/design/google-cloud-setup.md).
 */
const APP_VARIANT = process.env.APP_VARIANT ?? "production";
const IS_DEV = APP_VARIANT === "development";

module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? "Expense (Dev)" : config.name,
  scheme: IS_DEV ? "expensetracker-dev" : config.scheme,
  ios: {
    ...config.ios,
    bundleIdentifier: IS_DEV
      ? "com.rahulghosh.expensetracker.dev"
      : config.ios.bundleIdentifier,
  },
  android: {
    ...config.android,
    package: IS_DEV ? "com.rahulghosh.expensetracker.dev" : config.android.package,
  },
  updates: {
    ...config.updates,
    // Local builds don't get a channel from eas.json; this tells the installed
    // app which update channel it belongs to.
    requestHeaders: { "expo-channel-name": APP_VARIANT },
  },
  extra: { ...config.extra, appVariant: APP_VARIANT },
});
