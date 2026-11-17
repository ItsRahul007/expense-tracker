/** Short, human descriptions of the backup state for the Settings row and Account screen. */
import type { SyncStatus } from "@/providers/sync-provider";

export function timeAgo(ms: number | null, now = Date.now()): string {
  if (!ms) return "never";
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** One line that sums up the backup, for here and the Settings row. */
export function backupSummary(status: SyncStatus): string {
  if (status.syncing) return "Backing up…";
  if (status.pendingReview) return "Needs your review";
  switch (status.lastError?.code) {
    case undefined:
      break;
    case "offline":
      return status.unsynced > 0 ? `${status.unsynced} waiting for connection` : "Waiting for connection";
    case "needs_reauth":
    case "scope":
      return "Reconnect needed";
    case "sheet_missing":
      return "Sheet deleted";
    default:
      return "Backup problem";
  }
  if (!status.connected) return "Not set up yet";
  if (status.unsynced > 0) return `${status.unsynced} change${status.unsynced === 1 ? "" : "s"} waiting`;
  return `Backed up ${timeAgo(status.lastSyncAt)}`;
}
