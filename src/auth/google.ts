/**
 * Google sign-in — the only file that imports the sign-in library (design §6.1),
 * so swapping libraries later touches nothing else.
 *
 * Signing in is about *identity and Drive access*, not about whether the app
 * opens: the app's own session record (src/auth/session.ts) decides that, and
 * nothing here can sign the user out of the app (design §7.2, §7.5).
 */
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
  type User,
} from "@react-native-google-signin/google-signin";
import { Platform } from "react-native";

import {
  DRIVE_FILE_SCOPE,
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
  isGoogleConfigured,
} from "@/constants/google";
import { SyncHttpError, type TokenProvider } from "@/sync/google-api";

export type GoogleAccount = {
  id: string;
  email: string;
  name: string | null;
  photo: string | null;
};

export type SignInResult =
  | { ok: true; account: GoogleAccount }
  | { ok: false; reason: "cancelled" | "in_progress" | "play_services" | "not_configured" | "no_drive_access" | "network" | "unknown"; message?: string };

let configured = false;

function configure() {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    scopes: [DRIVE_FILE_SCOPE],
    offlineAccess: false,
  });
  configured = true;
}

export const isSignInSupported = () => Platform.OS === "android" || Platform.OS === "ios";

const toAccount = (user: User): GoogleAccount => ({
  id: user.user.id,
  email: user.user.email,
  name: user.user.name,
  photo: user.user.photo,
});

/** Interactive sign-in. Makes sure Drive access was granted, asking again if the
 *  user unticked it on the consent screen. */
export async function signIn(): Promise<SignInResult> {
  if (!isGoogleConfigured()) return { ok: false, reason: "not_configured" };
  configure();
  try {
    if (Platform.OS === "android") {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return { ok: false, reason: "cancelled" };

    let user = response.data;
    if (!user.scopes.includes(DRIVE_FILE_SCOPE)) {
      const granted = await GoogleSignin.addScopes({ scopes: [DRIVE_FILE_SCOPE] });
      if (!granted || !isSuccessResponse(granted) || !granted.data.scopes.includes(DRIVE_FILE_SCOPE)) {
        return { ok: false, reason: "no_drive_access" };
      }
      user = granted.data;
    }
    return { ok: true, account: toAccount(user) };
  } catch (error) {
    if (isErrorWithCode(error)) {
      switch (error.code) {
        case statusCodes.IN_PROGRESS:
          return { ok: false, reason: "in_progress" };
        case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
          return { ok: false, reason: "play_services" };
        case statusCodes.SIGN_IN_CANCELLED:
          return { ok: false, reason: "cancelled" };
      }
      // Android reports "no network" as code 7.
      if (String(error.code) === "7") return { ok: false, reason: "network", message: error.message };
    }
    return { ok: false, reason: "unknown", message: error instanceof Error ? error.message : String(error) };
  }
}

/** Re-request Drive access for an already signed-in user (403 insufficient scope). */
export async function requestDriveAccess(): Promise<boolean> {
  configure();
  try {
    const granted = await GoogleSignin.addScopes({ scopes: [DRIVE_FILE_SCOPE] });
    return !!granted && isSuccessResponse(granted) && granted.data.scopes.includes(DRIVE_FILE_SCOPE);
  } catch {
    return false;
  }
}

/** The Google account the SDK currently holds, restoring it silently if needed.
 *  `null` means "needs reconnect" — never "signed out of the app". */
async function currentGoogleUser(): Promise<User | null> {
  configure();
  const current = GoogleSignin.getCurrentUser();
  if (current) return current;
  if (!GoogleSignin.hasPreviousSignIn()) return null;
  try {
    const response = await GoogleSignin.signInSilently();
    return response.type === "success" ? response.data : null;
  } catch {
    return null;
  }
}

/**
 * Access tokens for the Drive/Sheets clients. Failure to get one becomes an
 * `auth` error, which pauses sync and shows "Reconnect" (design §7.5).
 */
export const googleTokens: TokenProvider = {
  async getAccessToken() {
    if (!isGoogleConfigured()) throw new SyncHttpError("auth", "Google sign-in isn't configured yet.");
    const user = await currentGoogleUser();
    if (!user) throw new SyncHttpError("auth", "Google account needs to be reconnected.");
    try {
      const { accessToken } = await GoogleSignin.getTokens();
      return accessToken;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn't get a Google access token.";
      // No network while refreshing the token is "offline", not "reconnect".
      if (/network|offline|internet|timed out/i.test(message)) throw new SyncHttpError("offline", message);
      throw new SyncHttpError("auth", message);
    }
  },
  async invalidate(token) {
    try {
      await GoogleSignin.clearCachedAccessToken(token); // Android; no-op on iOS
    } catch {
      // Nothing to clear.
    }
  },
};

/** The account the Google SDK holds right now, if any (for "reconnect" checks). */
export async function getGoogleAccount(): Promise<GoogleAccount | null> {
  const user = await currentGoogleUser();
  return user ? toAccount(user) : null;
}

export async function signOutOfGoogle(options: { revoke: boolean }): Promise<void> {
  configure();
  try {
    if (options.revoke) await GoogleSignin.revokeAccess();
    await GoogleSignin.signOut();
  } catch {
    // Already signed out, or offline: the app's own session is cleared anyway.
  }
}
