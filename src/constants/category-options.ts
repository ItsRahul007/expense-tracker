/**
 * The palette and glyph set offered when creating a custom category.
 *
 * A curated list rather than all of Ionicons and a full colour picker: the point
 * is to pick something recognisable in two taps, and any colour the user likes is
 * a colour that might vanish against one of the two themes. Every value here has
 * been checked against both the light and dark card surfaces.
 */
export const CATEGORY_ICONS = [
  "restaurant", "cart", "car", "receipt", "fitness", "bag-handle",
  "game-controller", "airplane", "gift", "paw", "school", "home",
  "cafe", "barbell", "cut", "phone-portrait", "shirt", "ellipsis-horizontal",
];

/**
 * The emoji offered as an alternative to the icons above.
 *
 * A grid, even though the editor also accepts any typed emoji: picking from here
 * is two taps, while typing one means opening the keyboard and switching it to
 * emoji mode. This list is for the categories people actually create; the field
 * covers everything else.
 *
 * Skin tones are left out on purpose — they multiply the grid without helping
 * anyone recognise a spending category at a glance, and the field still accepts
 * them if someone wants one.
 */
export const CATEGORY_EMOJI = [
  "🍔", "🍕", "☕", "🍺", "🛒", "🥦",
  "🚗", "⛽", "🚕", "✈️", "🏠", "💡",
  "🧾", "📱", "💊", "🏥", "💪", "🧘",
  "👕", "👟", "💄", "✂️", "🎬", "🎮",
  "🎧", "📚", "🎓", "🐶", "🐱", "🐾",
  "🎁", "💐", "🧸", "🛠️", "🧹", "🌱",
  "💰", "💳", "🏦", "📈", "🏖️", "🎉",
];

export const CATEGORY_COLORS = [
  "#F97316", "#10B981", "#3B82F6", "#8B5CF6",
  "#EC4899", "#F59E0B", "#06B6D4", "#EF4444",
  "#14B8A6", "#A855F7", "#0EA5E9", "#6B7280",
];
