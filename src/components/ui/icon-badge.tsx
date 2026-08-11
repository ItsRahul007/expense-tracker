import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { useIsDark } from "@/constants/palette";
import { isEmojiIcon } from "@/lib/emoji";

// Emoji are set smaller than the box rather than matching the Ionicons size:
// a glyph sized to the vector icons overflows the circle, because an emoji fills
// its em square while the icons carry built-in padding.
const SIZES = {
  sm: { box: 32, glyph: 16, emoji: 17 },
  md: { box: 40, glyph: 19, emoji: 21 },
  lg: { box: 48, glyph: 22, emoji: 25 },
} as const;

/**
 * A category's icon in a soft tinted circle — an Ionicons glyph or an emoji,
 * whichever the category stores (see `isEmojiIcon`).
 *
 * The tint is the category's own colour at low opacity rather than a separate
 * background value, so adding a category needs one hex and nothing else. Dark
 * mode raises the opacity — the same 12% wash that reads as a soft tint on white
 * disappears against a dark card.
 *
 * `color` still tints the circle for an emoji, it just no longer reaches the
 * glyph: emoji bring their own colours.
 */
export function IconBadge({
  icon,
  color,
  size = "md",
}: {
  icon: string;
  color: string;
  size?: keyof typeof SIZES;
}) {
  const isDark = useIsDark();
  const { box, glyph, emoji } = SIZES[size];

  return (
    <View
      className="items-center justify-center rounded-full"
      style={{
        width: box,
        height: box,
        backgroundColor: `${color}${isDark ? "33" : "1F"}`,
      }}
    >
      {isEmojiIcon(icon) ? (
        // No font class: emoji must fall through to the system emoji font, and
        // the app's sans family would substitute a worse glyph for some of them.
        <Text
          style={{
            fontSize: emoji,
            // Both of these are Android fixes. Without an explicit lineHeight the
            // glyph overflows its line box and the top of it is cut off; without
            // includeFontPadding: false the font's own ascent padding pushes it
            // off-centre in the circle. Neither affects iOS.
            lineHeight: emoji * 1.2,
            includeFontPadding: false,
            textAlign: "center",
          }}
          // The name is already read out by the row or tile around it, so the
          // badge would otherwise announce "hamburger" over the top of it.
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {icon}
        </Text>
      ) : (
        <Ionicons name={icon as never} size={glyph} color={color} />
      )}
    </View>
  );
}
