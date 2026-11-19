/**
 * The version stamp for every local write (`updated_at`, `created_at`,
 * tombstone `deleted_at`).
 *
 * Wall-clock milliseconds, but monotonic within a run: never the same value
 * twice and never smaller than the previous one, even if the system clock
 * steps backwards (NTP correction, the user changing the time). Two writes to
 * the same row in quick succession therefore always order correctly, which is
 * what "last edit wins" in the sync merge depends on (design §10.1).
 *
 * A Hybrid Logical Clock would also absorb skew *between* devices; it can
 * replace this function later without touching any caller.
 */
let last = 0;

export function nextStamp(now: number = Date.now()): number {
  last = Math.max(now, last + 1);
  return last;
}

/** Test-only: forget the last stamp handed out. */
export function resetClockForTests(): void {
  last = 0;
}
