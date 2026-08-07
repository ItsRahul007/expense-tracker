import { View, type ViewProps } from "react-native";

import { CARD_SHADOW, useIsDark } from "@/constants/palette";

/**
 * The surface everything sits on.
 *
 * The shadow is applied in light mode only: against a near-black background a
 * drop shadow is invisible, so dark mode gets definition from the border and the
 * card being a lighter surface than the page instead.
 */
export function Card({
  children,
  className = "",
  padded = true,
  style,
  ...rest
}: ViewProps & { padded?: boolean; className?: string }) {
  const isDark = useIsDark();

  return (
    <View
      className={`rounded-2xl border border-border bg-card ${padded ? "p-4" : ""} ${className}`}
      style={[isDark ? undefined : CARD_SHADOW, style]}
      {...rest}
    >
      {children}
    </View>
  );
}
