/**
 * Reading and writing CSV text.
 *
 * One file owns the format in both directions, so the export can't drift from
 * what the import is prepared to read back. Nothing here knows about expenses —
 * this is cells and rows only. The ledger's own column layout lives in
 * `src/lib/csv-import.ts` and `exportAllData` in `src/queries/live.ts`.
 */

/**
 * Parses CSV text into rows of raw, unescaped cells.
 *
 * A hand-written state machine rather than a `split(",")`, because real files
 * from spreadsheets and banks contain quoted fields with commas and newlines
 * inside them — and a note is exactly the column that gets one. Follows
 * RFC 4180 with three deliberate leniencies, since the point is to read
 * whatever someone actually has rather than to police the format:
 *
 *  - a lone `"` in the middle of an unquoted cell (`5" pipe`) is kept as text
 *    instead of opening a quoted section;
 *  - CR, LF and CRLF all end a row, so a file written on Windows needs no
 *    conversion first;
 *  - a leading byte-order mark is dropped — Excel writes one, and it would
 *    otherwise become part of the first header's name.
 *
 * Blank rows are preserved so that row numbers keep matching what a
 * spreadsheet shows; the caller drops them after numbering.
 */
export function parseCsvRows(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (source[i + 1] === '"') {
        cell += '"'; // "" is one escaped quote, not the end of the field
        i++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === ",") {
      endCell();
    } else if (char === "\n") {
      endRow();
    } else if (char === "\r") {
      if (source[i + 1] === "\n") i++;
      endRow();
    } else {
      cell += char;
    }
  }

  // Only when something is actually pending, so the newline that ends a
  // well-formed file doesn't produce a phantom trailing row.
  if (cell !== "" || row.length > 0) endRow();

  return rows;
}

/** Whether a row holds nothing but empty cells — the blank line between blocks
 *  that spreadsheets are fond of, and the one at the end of a hand-edited file. */
export function isBlankRow(cells: string[]): boolean {
  return cells.every((cell) => cell.trim() === "");
}

/**
 * One row of CSV text, quoting only the cells that need it.
 *
 * Quoting everything unconditionally would also be valid, but leaves an export
 * that's harder to read in a plain text editor for no gain.
 */
export function formatCsvRow(cells: string[]): string {
  return cells
    .map((cell) =>
      /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
    )
    .join(",");
}
