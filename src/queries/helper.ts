import * as schema from "@/db/schema/schema";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { useSQLiteContext } from "expo-sqlite";
import { useMemo } from "react";

/** The Drizzle wrapper is cheap but not free — memoized per underlying connection
 *  so every query hook doesn't re-wrap it on each render. */
export function useDrizzle() {
  const db = useSQLiteContext();
  return useMemo(() => drizzle(db, { schema }), [db]);
}
