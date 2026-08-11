/**
 * Telling an emoji apart from an Ionicons glyph name, and validating typed input.
 *
 * `Category.icon` holds either kind — "restaurant" or "🍔" — and the schema
 * deliberately doesn't record which: every Ionicons name is ASCII (lowercase
 * letters and hyphens) and every emoji is outside ASCII entirely, so the string
 * says what it is. That's what lets emoji ship without a migration, and what lets
 * the seeded default categories keep their Ionicons names indefinitely.
 */

/** Zero-width joiner: glues 👨 + 👩 + 👧 into one family glyph. */
const ZWJ = 0x200d;

/**
 * Codepoints that modify the glyph before them rather than adding another one.
 * Checked before the base ranges below, since the skin-tone modifiers sit inside
 * them and would otherwise count as emoji in their own right.
 */
const MODIFIERS: [number, number][] = [
  [0xfe0e, 0xfe0f], // variation selectors — text vs emoji presentation
  [0x1f3fb, 0x1f3ff], // skin tones
  [0x20e3, 0x20e3], // combining enclosing keycap
  [0x1f9b0, 0x1f9b3], // hair components (red, curly, white, bald)
];

/**
 * Where emoji live. Not the complete Unicode emoji set — a pragmatic list
 * covering the blocks anything usable as a category icon comes from. Something
 * outside these ranges is rejected as typed input, which is the point: the check
 * exists to stop a bare word being stored as an icon.
 */
const EMOJI_RANGES: [number, number][] = [
  [0x1f000, 0x1faff], // the bulk: pictographs, emoticons, transport, supplemental
  [0x2600, 0x27bf], // misc symbols and dingbats — ☕ ⚡ ✂ ✈ ✅
  [0x231a, 0x23fa], // ⌚ ⌛ ⏰ ⏳
  [0x25a0, 0x25ff], // ▶ ◼
  [0x2b00, 0x2bff], // ⭐ ⬆
  [0x2190, 0x21ff], // arrows
  [0x00a9, 0x00ae], // © ®
  [0x2122, 0x2139], // ™ ℹ
];

/** Regional indicators: a pair of them is one flag. */
const REGIONAL_FIRST = 0x1f1e6;
const REGIONAL_LAST = 0x1f1ff;

const inRanges = (point: number, ranges: [number, number][]) =>
  ranges.some(([first, last]) => point >= first && point <= last);

const codePoints = (value: string) =>
  [...value].map((char) => char.codePointAt(0) ?? 0);

/**
 * Whether this icon value is an emoji rather than an Ionicons name.
 *
 * Intentionally the loose "is it non-ASCII" test rather than full emoji
 * validation: at render time the only question is which component to hand the
 * string to, and anything already stored deserves to be shown as-is. Strictness
 * belongs at the input boundary — see `isSingleEmoji`.
 */
export function isEmojiIcon(icon: string): boolean {
  return codePoints(icon).some((point) => point > 0x7f);
}

/**
 * Whether typed input is exactly one emoji.
 *
 * Guards the free-entry field in the category editor, where the keyboard can't be
 * forced into emoji mode on Android — without this, "food" would be accepted and
 * then rendered as clipped text inside a 40pt circle.
 *
 * One *glyph*, not one codepoint: a family emoji is several codepoints held
 * together by joiners and a flag is two regional indicators, and both read as a
 * single icon. Two unrelated emoji ("🍔🍟") do not.
 *
 * Keycap sequences ("1️⃣") are rejected, since their base digit is ASCII — no
 * loss for a category icon, and it keeps the ASCII/non-ASCII split above clean.
 */
export function isSingleEmoji(value: string): boolean {
  const points = codePoints(value);
  if (points.length === 0) return false;

  let glyphs = 0;
  let regionals = 0;
  let afterJoiner = false;

  for (const point of points) {
    if (point === ZWJ) {
      if (glyphs === 0) return false; // nothing to join onto
      afterJoiner = true;
      continue;
    }

    if (inRanges(point, MODIFIERS)) {
      afterJoiner = false;
      continue;
    }

    if (!inRanges(point, EMOJI_RANGES)) return false;

    if (point >= REGIONAL_FIRST && point <= REGIONAL_LAST) regionals++;
    // A joined codepoint extends the glyph before it instead of starting a new one.
    if (!afterJoiner) glyphs++;
    afterJoiner = false;
  }

  if (afterJoiner) return false; // trailing joiner — an incomplete sequence

  if (regionals === 2 && glyphs === 2) return true; // a flag
  return glyphs === 1;
}
