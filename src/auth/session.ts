/**
 * The app's own sign-in session (design §7.2): a record in SQLite, written once
 * at sign-in and cleared only by an explicit sign-out. The root layout's route
 * guards read it synchronously — no network, no Google SDK — which is what lets
 * a signed-in user open the app offline without ever seeing the sign-in screen.
 */
import { clearStates, getState, setStates, type SyncStateKey } from "@/sync/state";
import type { Db } from "@/queries/helper";

import type { GoogleAccount } from "./google";

type Store = Pick<Db, "select" | "insert" | "delete">;

export type SessionStatus = "signedOut" | "restoring" | "ready";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  photo: string | null;
};

export type Session = { status: SessionStatus; user: SessionUser | null };

const SESSION_KEYS: SyncStateKey[] = [
  "session_user_id",
  "session_email",
  "session_name",
  "session_photo",
  "session_signed_in_at",
];

export function readSession(db: Store): Session {
  const id = getState(db, "session_user_id");
  if (!id) return { status: "signedOut", user: null };
  return {
    status: getState(db, "bootstrap") === "ready" ? "ready" : "restoring",
    user: {
      id,
      email: getState(db, "session_email") ?? "",
      name: getState(db, "session_name"),
      photo: getState(db, "session_photo"),
    },
  };
}

/** Whose data this database holds; set at first sign-in, kept through sign-out. */
export const getOwner = (db: Store) => getState(db, "owner_user_id");

/**
 * Starts a session for `account`. Refuses (returns `owner_mismatch`) when this
 * phone already holds another account's data, so the user decides what happens
 * to it first (design §7.7) — nothing is merged or removed implicitly.
 */
export function startSession(
  db: Store,
  account: GoogleAccount,
  now: number,
  options: { adoptExistingData?: boolean } = {},
): { ok: true } | { ok: false; reason: "owner_mismatch"; ownerEmail: string | null } {
  const owner = getOwner(db);
  if (owner && owner !== account.id && !options.adoptExistingData) {
    return { ok: false, reason: "owner_mismatch", ownerEmail: getState(db, "owner_email") };
  }

  const sameOwner = owner === account.id;
  setStates(db, {
    owner_user_id: account.id,
    owner_email: account.email,
    session_user_id: account.id,
    session_email: account.email,
    session_name: account.name,
    session_photo: account.photo,
    session_signed_in_at: now,
    // Returning to the same account: the data here is already this account's,
    // so the app opens straight away and syncs in the background. Otherwise
    // the restore/merge runs first (design §8).
    bootstrap: sameOwner && getState(db, "bootstrap") === "ready" ? "ready" : "restoring",
    // A different account's sheet: forget the old one.
    ...(sameOwner ? {} : { spreadsheet_id: null, last_remote_version: null, last_sync_at: null }),
  });
  return { ok: true };
}

/** Bootstrap finished (or was skipped offline) — open the app. */
export function finishBootstrap(db: Store, options: { restorePending: boolean }): void {
  setStates(db, { bootstrap: "ready", restore_pending: options.restorePending || null });
}

/**
 * Ends the session. Local data, the owner and the sheet link stay — signing
 * back in with the same account picks up exactly where it left off (§7.6).
 */
export function endSession(db: Store): void {
  clearStates(db, SESSION_KEYS);
}
