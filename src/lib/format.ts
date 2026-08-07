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
 * Cleans whatever the amount `TextInput` reports on each keystroke into a
 * valid rupee-decimal string: digits, at most one ".", at most two digits
 * after it. Commas come from `formatAmountFieldValue`'s own grouping, so
 * they're stripped before anything else — they're never meaningful input.
 *
 * Typing "90" now means ninety rupees, full stop; a decimal only appears if
 * the person types "." themselves, via the field's own dot key.
 */
export function sanitizeAmountInput(raw: string): string {
  const cleaned = raw.replace(/,/g, "").replace(/[^0-9.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned.slice(0, 7);
  const rupees = cleaned.slice(0, dot).slice(0, 7);
  const paise = cleaned.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  return `${rupees}.${paise}`;
}

/** Amount field text → minor units. "90" → 9000, "90.5" → 9050, "" → 0. */
export function amountTextToMinor(text: string): number {
  const [rupeesPart, paisePart = ""] = text.split(".");
  const rupees = rupeesPart === "" ? 0 : Number(rupeesPart);
  const paise = paisePart === "" ? 0 : Number(paisePart.padEnd(2, "0").slice(0, 2));
  return rupees * 100 + paise;
}

/**
 * Live display for the amount field: grouped rupees, decimals shown only as
 * far as the person has actually typed them — no forced ".00" the way
 * `formatAmountExact` has, since here it would look like a phantom keystroke.
 */
export function formatAmountFieldValue(text: string): string {
  if (text === "") return "";
  const [rupeesPart, paisePart] = text.split(".");
  const rupees = groupIndian(rupeesPart === "" ? "0" : rupeesPart);
  return paisePart === undefined ? rupees : `${rupees}.${paisePart}`;
}

/** Minor units → amount field text, for seeding the field from a saved
 *  expense: "9000" → "90", "9050" → "90.5". Whole rupees stay undecorated,
 *  matching how the field looks once a person has actually typed a value. */
export function minorToAmountText(amountMinor: number): string {
  if (amountMinor === 0) return "";
  const abs = Math.abs(Math.trunc(amountMinor));
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  return paise === 0 ? String(rupees) : `${rupees}.${String(paise).padStart(2, "0")}`;
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
