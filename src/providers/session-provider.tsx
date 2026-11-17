/**
 * Exposes the app's sign-in session (src/auth/session.ts) to the route guards
 * in the root layout. The first value is read synchronously from SQLite during
 * the first render — there is never a "loading session" state to flash the
 * sign-in screen during, and no network is involved (design §7.3).
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { readSession, type Session } from "@/auth/session";
import { useDrizzle } from "@/queries/helper";

type SessionContextValue = {
  session: Session;
  /** Re-read after sign-in, bootstrap or sign-out changed the stored session. */
  refresh: () => void;
  /**
   * Development builds only, while the Google client ids aren't filled in:
   * open the app without signing in. Held in memory, never stored, and a
   * no-op in release builds.
   */
  skipForDevelopment: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const db = useDrizzle();
  const [session, setSession] = useState<Session>(() => readSession(db));
  const [devSkip, setDevSkip] = useState(false);
  const refresh = useCallback(() => setSession(readSession(db)), [db]);
  const skipForDevelopment = useCallback(() => {
    if (__DEV__) setDevSkip(true);
  }, []);

  const value = useMemo(
    () => ({
      session:
        devSkip && session.status === "signedOut"
          ? ({ status: "ready", user: null } satisfies Session)
          : session,
      refresh,
      skipForDevelopment,
    }),
    [session, devSkip, refresh, skipForDevelopment],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}
