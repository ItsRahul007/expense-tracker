/**
 * A real SQLite database for Jest, behind the same Drizzle driver the app uses.
 *
 * `drizzle-orm/expo-sqlite` only calls three things on its client —
 * `prepareSync`, and on the statement `executeSync` / `executeForRawResultSync`
 * — so a thin adapter over Node's built-in `node:sqlite` (Node ≥ 22.5) lets
 * tests run the app's actual schema, migrations and query code with no native
 * module and no extra dependency.
 *
 * Test files that use it need the docblock `@jest-environment node`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import * as schema from "@/db/schema/schema";
import { drizzle } from "drizzle-orm/expo-sqlite";

const MIGRATIONS_DIR = join(__dirname, "..", "db", "migrations");

type Params = SQLInputValue[];

function expoShim(raw: DatabaseSync) {
  return {
    prepareSync(sql: string) {
      const stmt = raw.prepare(sql);
      return {
        executeSync(params: Params = []) {
          // `run` for writes, `all` for reads: node:sqlite refuses neither, but
          // only `run` reports changes and only `all` returns rows.
          const reader = stmt.columns().length > 0;
          const rows = reader ? stmt.all(...params) : [];
          const info = reader ? { changes: 0, lastInsertRowid: 0 } : stmt.run(...params);
          return {
            changes: Number(info.changes),
            lastInsertRowId: Number(info.lastInsertRowid),
            getAllSync: () => rows,
            getFirstSync: () => rows[0] ?? null,
          };
        },
        executeForRawResultSync(params: Params = []) {
          stmt.setReturnArrays(true);
          try {
            const rows = stmt.all(...params);
            return { getAllSync: () => rows };
          } finally {
            stmt.setReturnArrays(false);
          }
        },
      };
    },
  };
}

/** The migration tags in journal order, e.g. "0005_sync_tracking". */
export function migrationTags(): string[] {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  return journal.entries.map((entry) => entry.tag);
}

/** Runs one migration file the way drizzle's migrator does: statement by statement. */
export function applyMigration(raw: DatabaseSync, tag: string): void {
  const source = readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), "utf8");
  for (const statement of source.split("--> statement-breakpoint")) {
    if (statement.trim()) raw.exec(statement);
  }
}

/**
 * A fresh in-memory database. By default every migration is applied; pass
 * `upTo` (exclusive tag) to stop early and test an upgrade path.
 */
export function createTestDb(options: { upTo?: string } = {}) {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");

  for (const tag of migrationTags()) {
    if (tag === options.upTo) break;
    applyMigration(raw, tag);
  }

  // The shim covers exactly the surface drizzle's expo driver uses.
  const db = drizzle(expoShim(raw) as never, { schema });
  return { raw, db };
}
