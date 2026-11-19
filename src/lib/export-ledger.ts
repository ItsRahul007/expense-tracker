/**
 * Saves the whole ledger as a CSV in the phone's Download/expense folder — used
 * by Settings → "Export as CSV" and by the sign-in screen when the user exports
 * data they chose not to link to their account.
 *
 * Normal route: the local `downloads-saver` module (modules/), which saves
 * through Android's MediaStore like a browser download — no permission, no
 * prompt, and it can create the `expense` sub-folder. (expo-file-system can't:
 * it refuses to create a folder outside the app's own storage.) Only if that
 * isn't available does it fall back to the system folder picker, opened at
 * Download; the folder chosen there is remembered with a persistable grant so
 * it's asked at most once.
 */
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import { isDownloadsSaverAvailable, saveTextToDownloads } from "../../modules/downloads-saver";
import { formatISODate } from "@/lib/format";
import type { Db } from "@/queries/helper";
import { exportAllData } from "@/queries";
import { getState, setState } from "@/sync/state";

/** Where the fallback picker opens: a *document* URI (a tree URI is ignored). */
const DOWNLOAD_DOCUMENT_URI =
  "content://com.android.externalstorage.documents/document/primary%3ADownload";
const FOLDER_NAME = "expense";

type Store = Pick<Db, "select" | "insert" | "delete">;

export type ExportResult =
  | { ok: true; fileName: string; location: string }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "failed"; message: string };

const lastSegment = (uri: string) => decodeURIComponent(uri).split(/[/:]/).filter(Boolean).pop() ?? "";

function findChildDirectory(parent: Directory, name: string): Directory | null {
  for (const entry of parent.list()) {
    if (entry instanceof Directory && lastSegment(entry.uri) === name) return entry;
  }
  return null;
}

/** The remembered export folder, if it's still there and still ours to write. */
function rememberedFolder(db: Store): Directory | null {
  const uri = getState(db, "export_dir_uri");
  if (!uri) return null;
  try {
    const dir = new Directory(uri);
    return dir.exists ? dir : null;
  } catch {
    return null;
  }
}

async function chooseFolder(db: Store): Promise<Directory | null> {
  let picked: Directory;
  try {
    picked = await Directory.pickDirectoryAsync(DOWNLOAD_DOCUMENT_URI);
  } catch {
    return null; // closed the picker
  }
  // Picked "expense" itself → use it; picked Download (or anything else) →
  // use or create "expense" inside it.
  const folder =
    lastSegment(picked.uri) === FOLDER_NAME
      ? picked
      : (findChildDirectory(picked, FOLDER_NAME) ?? picked.createDirectory(FOLDER_NAME));
  setState(db, "export_dir_uri", folder.uri);
  return folder;
}

function writeCsv(folder: Directory, csv: string): File {
  const base = `expenses-${formatISODate(Date.now())}`;
  // Same-day exports get -2, -3… rather than overwriting.
  const taken = new Set(folder.list().map((entry) => lastSegment(entry.uri)));
  let name = `${base}.csv`;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}.csv`;
  // SAF appends the extension from the MIME type, so pass the bare name.
  const file = folder.createFile(name.replace(/\.csv$/, ""), "text/csv");
  file.write(csv);
  return file;
}

export async function exportLedgerToDownloads(db: Store): Promise<ExportResult> {
  try {
    const csv = await exportAllData();

    if (Platform.OS !== "android") {
      // iOS has no shared Downloads folder; keep a copy in the app's documents.
      const file = new File(Paths.document, `expenses-${formatISODate(Date.now())}.csv`);
      if (file.exists) file.delete();
      file.create();
      file.write(csv);
      return { ok: true, fileName: lastSegment(file.uri), location: "Files → Expense Tracker" };
    }

    // 1. Like a browser download: MediaStore, no permission, no prompt.
    //    Download/expense, or plain Download if a device refuses the folder.
    if (isDownloadsSaverAvailable()) {
      const name = `expenses-${formatISODate(Date.now())}.csv`;
      try {
        const saved = await saveTextToDownloads(FOLDER_NAME, name, "text/csv", csv);
        return { ok: true, fileName: saved, location: `Download/${FOLDER_NAME}` };
      } catch {
        try {
          const saved = await saveTextToDownloads("", name, "text/csv", csv);
          return { ok: true, fileName: saved, location: "Download" };
        } catch {
          // Fall through to the picker.
        }
      }
    }

    // 2. A folder the user approved earlier, else ask once.
    let folder = rememberedFolder(db);
    let file: File | null = null;
    if (folder) {
      try {
        file = writeCsv(folder, csv);
      } catch {
        folder = null; // grant revoked or folder moved — ask again below
      }
    }
    if (!file) {
      folder = await chooseFolder(db);
      if (!folder) return { ok: false, reason: "cancelled" };
      file = writeCsv(folder, csv);
    }
    return { ok: true, fileName: lastSegment(file.uri), location: `Download/${FOLDER_NAME}` };
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      message: error instanceof Error ? error.message : "The file could not be written.",
    };
  }
}
