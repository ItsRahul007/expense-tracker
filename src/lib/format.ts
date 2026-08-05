/**
 * Display formatting for the ledger.
 *
 * Amounts live in the app as integer paise (`amountMinor`) and only become
 * decimal strings here, at the very edge. Nothing upstream of this file should
 * ever hold a fractional rupee.
 */

/**
 * Indian digit grouping: last three digits, then pairs. 1840000 → "18,40,000".
 *
 * Hand-rolled rather than `Intl.NumberFormat("en-IN")` because Intl's locale
 * data availability varies across Hermes builds and platforms, and this column
 * has to grid exactly the same on both.
 */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${tail}`;
}

/**
 * Splits an amount into the two pieces the ledger row renders separately.
 *
 * Paise are *always* returned, never dropped when zero — the alignment rule is
 * the signature of this design, and a column where some rows show decimals and
 * others don't cannot align. The row keeps the noise down by setting `paise`
 * smaller and muted rather than by omitting it.
 */
export function formatAmountParts(amountMinor: number): {
  rupees: string;
  paise: string;
} {
  const abs = Math.abs(Math.trunc(amountMinor));
  return {
    rupees: groupIndian(String(Math.floor(abs / 100))),
    paise: String(abs % 100).padStart(2, "0"),
  };
}

/** Full single-string amount: "1,240.00". For CSV export and a11y labels. */
export function formatAmount(amountMinor: number): string {
  const { rupees, paise } = formatAmountParts(amountMinor);
  return `${rupees}.${paise}`;
}

/** "₹1,240" — paise dropped. Only for headline figures where they'd be noise. */
export function formatCompact(amountMinor: number): string {
  return `₹${groupIndian(String(Math.round(Math.abs(amountMinor) / 100)))}`;
}

/** Spoken form for screen readers: "1,240 rupees 50 paise". */
export function formatAmountLabel(amountMinor: number): string {
  const { rupees, paise } = formatAmountParts(amountMinor);
  return paise === "00"
    ? `${rupees} rupees`
    : `${rupees} rupees ${Number(paise)} paise`;
}

/**
 * Keypad digits → minor units. The keypad appends digits right-to-left, so
 * "1240" means ₹12.40 — the same way a card terminal or a cash register reads.
 */
export function digitsToMinor(digits: string): number {
  const cleaned = digits.replace(/\D/g, "").slice(0, 9);
  return cleaned === "" ? 0 : Number(cleaned);
}

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Day-group heading: "TUE 05 AUG". Uppercase to match the eyebrow style. */
export function formatDayHeader(ts: number): string {
  const d = new Date(ts);
  const day = String(d.getDate()).padStart(2, "0");
  return `${DAYS[d.getDay()]} ${day} ${MONTHS[d.getMonth()]}`;
}

/** "Today" / "Yesterday" / "05 Aug 2026". Sentence case — this one is prose. */
export function formatRelativeDay(ts: number, now: number = Date.now()): string {
  const days = Math.round(
    (startOfLocalDay(now) - startOfLocalDay(ts)) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";

  const d = new Date(ts);
  const month = MONTHS[d.getMonth()];
  const cased = month[0] + month.slice(1).toLowerCase();
  return `${String(d.getDate()).padStart(2, "0")} ${cased} ${d.getFullYear()}`;
}

/** ISO date for CSV export: "2026-08-05". Local calendar day, not UTC. */
export function formatISODate(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}
