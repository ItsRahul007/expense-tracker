/**
 * On-device database snapshots — a last-resort copy that doesn't depend on
 * Google at all (design §11.4). Taken before the first sync of the day that
 * changes local rows, and before every bootstrap merge. The newest three are
 * kept in the app's documents folder.
 */
import { Directory, File, Paths } from "expo-file-system";
import type { SQLiteDatabase } from "expo-sqlite";

const KEEP = 3;
const PREFIX = "expense-snapshot-";

function snapshotDir(): Directory {
  const dir = new Directory(Paths.document, "snapshots");
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/** Plain filesystem path from a `file://` URI — what SQLite's VACUUM INTO wants. */
const toPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ""));

export function takeSnapshot(db: SQLiteDatabase, now = new Date()): void {
  const dir = snapshotDir();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const target = new File(dir, `${PREFIX}${stamp}.db`);
  if (target.exists) target.delete();

  // VACUUM INTO writes a consistent, compacted copy without closing the database.
  db.execSync(`VACUUM INTO '${toPath(target.uri).replace(/'/g, "''")}'`);

  const snapshots = dir
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.startsWith(PREFIX))
    .sort((a, b) => (a.name < b.name ? 1 : -1));
  for (const old of snapshots.slice(KEEP)) old.delete();
}
