/**
 * ===========================================================================
 * RAHUL — this file is yours. It is currently a pass-through.
 * ===========================================================================
 *
 * This is the seam where the data layer mounts. Everything above it in the tree
 * is presentation; everything below it can assume a database and a query client
 * exist. Roughly what belongs here:
 *
 *   <SQLiteProvider databaseName="khata.db" onInit={...}>   // expo-sqlite
 *     <QueryClientProvider client={queryClient}>            // @tanstack/react-query
 *       {children}
 *     </QueryClientProvider>
 *   </SQLiteProvider>
 *
 * Things worth deciding before you write it:
 *
 * 1. Migrations. `expo-sqlite` has no `useMigrations` hook — the SDK 55 docs run
 *    migrations inside `SQLiteProvider`'s `onInit`. The `useMigrations` hook is
 *    from `drizzle-orm/expo-sqlite/migrator`, a different package. Either works;
 *    they fail differently, and the hook gives you a render-time error state you
 *    can actually show the user.
 *
 * 2. Gating. `src/app/_layout.tsx` already holds the splash screen until fonts
 *    load and the theme setting resolves. Migrations are the third gate — if the
 *    app renders before they finish, the first query hits a table that does not
 *    exist yet. Export a readiness signal from here and the root layout will
 *    wait on it.
 *
 * 3. Failure. A migration that throws on a real device with real data is the
 *    worst outcome in a local-only app. Decide now what the user sees, because
 *    the default is a white screen.
 *
 * 4. `queryClient` needs to be a stable instance — created at module scope or in
 *    a `useState` initialiser, never inline in the render, or every re-render
 *    throws away the cache.
 */

export function AppDataProviders({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
