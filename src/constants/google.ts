/**
 * Google OAuth client ids — public identifiers, not secrets (design §6.2).
 *
 * Fill these from Google Cloud Console → Google Auth Platform → Clients
 * (docs/design/google-cloud-setup.md, step 5). Android needs no id here: it's
 * matched by package name + signing-key SHA-1. The iOS URL scheme also goes in
 * app.json, in the `@react-native-google-signin/google-signin` plugin options.
 */
export const GOOGLE_WEB_CLIENT_ID =
  "289338048967-bft0edgchnbjqnfprem7ni9qb4l6cjma.apps.googleusercontent.com";
export const GOOGLE_IOS_CLIENT_ID =
  "289338048967-ejv6bunpmgfi06k3ee1n4l6ip5eg1tgg.apps.googleusercontent.com";
// The Android client (…-s6c136r407ngg72hlo9u97m0t1stj7e1) needs no entry here:
// Google matches it by package name + SHA-1. Never put the *web client secret*
// in the app — native sign-in doesn't use it, and anything in a build is public.

/** Only files this app created — never the rest of the user's Drive. */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export const isGoogleConfigured = () => !GOOGLE_WEB_CLIENT_ID.startsWith("REPLACE-");
