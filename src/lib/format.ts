/**
 * Display formatting.
 *
 * Amounts live in the app as integer paise (`amountMinor`) and only become
 * decimal strings here, at the very edge. Nothing upstream of this file should
 * ever hold a fractional rupee.
 */

/**
 * Indian digit grouping: last three digits, then pairs. 1840000 → "18,40,000".
 *
 * Hand-rolled rather than `Intl.NumberFormat("en-IN")` because Intl locale data
 * availability varies across Hermes builds and platforms, and amounts must
 * format identically on both.
 */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${tail}`;
}

/**
 * The standard money string: "₹1,240", or "₹1,240.50" when there are paise.
 *
 * Trailing ".00" is dropped because most expenses are whole rupees and a column
 * of identical zeros is noise. Exact values still show in full, so nothing is
 * ever rounded away in the display.
 */
export function formatMoney(
  amountMinor: number,
  options: { sign?: boolean; symbol?: boolean; paise?: boolean } = {},
): string {
  const { sign = false, symbol = true, paise: showPaise = true } = options;
  const abs = Math.abs(Math.trunc(amountMinor));

  const rupees = groupIndian(String(Math.floor(abs / 100)));
  const paise = abs % 100;
  const body =
    paise === 0 || !showPaise
      ? rupees
      : `${rupees}.${String(paise).padStart(2, "0")}`;

  // U+2212 minus, not a hyphen — it aligns with the digits optically.
  return `${sign ? "−" : ""}${symbol ? "₹" : ""}${body}`;
}

/**
 * Live value for an amount field: grouped rupees, always two decimals.
 *
 * Distinct from `formatMoney` because a field must not drop the decimals while
 * you're typing — entering 1200 would otherwise read "12" the instant the paise
 * hit zero, which looks like the input ate two keystrokes.
 */
export function formatAmountEntry(amountMinor: number): string {
  const abs = Math.abs(Math.trunc(amountMinor));
  const rupees = groupIndian(String(Math.floor(abs / 100)));
  return `${rupees}.${String(abs % 100).padStart(2, "0")}`;
}

/** Always two decimals, ungrouped, no symbol: "1240.50". For CSV export. */
export function formatAmountExact(amountMinor: number): string {
  const abs = Math.abs(Math.trunc(amountMinor));
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Spoken form for screen readers: "1,240 rupees 50 paise". */
export function formatAmountLabel(amountMinor: number): string {
  const abs = Math.abs(Math.trunc(amountMinor));
  const rupees = groupIndian(String(Math.floor(abs / 100)));
  const paise = abs % 100;
  return paise === 0 ? `${rupees} rupees` : `${rupees} rupees ${paise} paise`;
}

/**
 * Keypad/field digits → minor units. Digits fill from the right, so "1240"
 * means ₹12.40 — the way a card terminal reads.
 */
export function digitsToMinor(digits: string): number {
  const cleaned = digits.replace(/\D/g, "").slice(0, 9);
  return cleaned === "" ? 0 : Number(cleaned);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today" / "Yesterday" / "5 Aug" / "5 Aug 2025" once the year differs. */
export function formatRelativeDay(ts: number, now: number = Date.now()): string {
  const days = Math.round(
    (startOfLocalDay(now) - startOfLocalDay(ts)) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";

  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? "" : ` ${d.getFullYear()}`}`;
}

/** "3:40 pm" — shown on the entry detail screen. */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const hours = d.getHours();
  const suffix = hours < 12 ? "am" : "pm";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${String(d.getMinutes()).padStart(2, "0")} ${suffix}`;
}

/** ISO date for CSV export: "2026-08-05". Local calendar day, not UTC. */
export function formatISODate(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}
