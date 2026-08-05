import { useColorScheme } from "nativewind";

/**
 * The Khata palette as JS values.
 *
 * These are needed because React Navigation, the status bar, and the Android
 * navigation bar are native surfaces that take colour props — NativeWind classes
 * cannot reach them.
 *
 * ⚠️ This file mirrors the CSS variables in `src/global.css`, which is the source
 * of truth for everything rendered by NativeWind. CSS cannot import TypeScript,
 * so the duplication is unavoidable; if you change a token, change it in both.
 */
export const PALETTE = {
  light: {
    paper: "#F2F5F1",
    rowAlt: "#DCE6DC",
    ink: "#1B2A23",
    inkMuted: "#5A6E64",
    rule: "#B9CBC0",
    alert: "#A6321E",
  },
  dark: {
    paper: "#101614",
    rowAlt: "#161E1A",
    ink: "#DDE7E0",
    inkMuted: "#8A9E92",
    rule: "#2A3830",
    alert: "#E2664C",
  },
} as const;

/** Widened to `string` — `as const` above would otherwise pin each key to one
 *  theme's literal hex and make the two themes mutually unassignable. */
export type Palette = Record<keyof (typeof PALETTE)["light"], string>;

export function usePalette(): Palette {
  const { colorScheme } = useColorScheme();
  return PALETTE[colorScheme === "dark" ? "dark" : "light"];
}
