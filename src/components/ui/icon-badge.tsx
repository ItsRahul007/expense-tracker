import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import { useIsDark } from "@/constants/palette";

const SIZES = {
  sm: { box: 32, glyph: 16 },
  md: { box: 40, glyph: 19 },
  lg: { box: 48, glyph: 22 },
} as const;

/**
 * A category's icon in a soft tinted circle.
 *
 * The tint is the category's own colour at low opacity rather than a separate
 * background value, so adding a category needs one hex and nothing else. Dark
 * mode raises the opacity — the same 12% wash that reads as a soft tint on white
 * disappears against a dark card.
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
  const { box, glyph } = SIZES[size];

  return (
    <View
      className="items-center justify-center rounded-full"
      style={{
        width: box,
        height: box,
        backgroundColor: `${color}${isDark ? "33" : "1F"}`,
      }}
    >
      <Ionicons name={icon as never} size={glyph} color={color} />
    </View>
  );
}
