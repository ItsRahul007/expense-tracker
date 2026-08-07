import { useColorScheme } from "nativewind";
import { Platform, type ViewStyle } from "react-native";

/**
 * The palette as JS values.
 *
 * Needed because React Navigation, the status bar, `placeholderTextColor` and
 * vector icons are native surfaces that take colour props — NativeWind classes
 * cannot reach them.
 *
 * ⚠️ Mirrors the CSS variables in `src/global.css`, which is the source of truth
 * for anything rendered by NativeWind. CSS cannot import TypeScript, so the
 * duplication is unavoidable; change a token in both places.
 */
export const PALETTE = {
  light: {
    bg: "#F5F6F8",
    card: "#FFFFFF",
    fg: "#14151A",
    muted: "#6B7280",
    border: "#E8EAEE",
    accent: "#5B5BD6",
    brand: "#5B5BD6",
    danger: "#E5484D",
    success: "#10B981",
  },
  dark: {
    bg: "#0E0F13",
    card: "#191B21",
    fg: "#F2F3F5",
    muted: "#9AA0AA",
    border: "#262932",
    accent: "#7C7CE8",
    // Same in both themes — see the note on --brand in global.css.
    brand: "#5B5BD6",
    danger: "#FF6369",
    success: "#34D399",
  },
} as const;

/** Widened to `string` — `as const` would otherwise pin each key to one theme's
 *  literal hex and make the two themes mutually unassignable. */
export type Palette = Record<keyof (typeof PALETTE)["light"], string>;

export function usePalette(): Palette {
  const { colorScheme } = useColorScheme();
  return PALETTE[colorScheme === "dark" ? "dark" : "light"];
}

export function useIsDark(): boolean {
  const { colorScheme } = useColorScheme();
  return colorScheme === "dark";
}

/**
 * Card lift. Only applied in light mode — a drop shadow against a near-black
 * background is invisible, so dark mode relies on the card's border and its
 * lighter surface instead.
 */
export const CARD_SHADOW: ViewStyle =
  Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#0B0F1A",
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 2 },
    default: {},
  }) ?? {};
