/**
 * Google OAuth client ids — public identifiers, not secrets (design §6.2).
 *
 * Fill these from Google Cloud Console → Google Auth Platform → Clients
 * (docs/design/google-cloud-setup.md, step 5). Android needs no id here: it's
 * matched by package name + signing-key SHA-1. The iOS URL scheme also goes in
 * app.json, in the `@react-native-google-signin/google-signin` plugin options.
 */
export const GOOGLE_WEB_CLIENT_ID = "REPLACE-WITH-WEB-CLIENT-ID.apps.googleusercontent.com";
export const GOOGLE_IOS_CLIENT_ID = "REPLACE-WITH-IOS-CLIENT-ID.apps.googleusercontent.com";

/** Only files this app created — never the rest of the user's Drive. */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export const isGoogleConfigured = () => !GOOGLE_WEB_CLIENT_ID.startsWith("REPLACE-");
