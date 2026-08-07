import { View } from "react-native";

/**
 * A rounded progress bar. Turns danger-red once spend passes the limit rather
 * than drawing an overflow segment — the whole bar changing colour is readable
 * in peripheral vision, a second colour stop isn't.
 */
export function Progress({
  fraction,
  over = false,
  tint,
  height = 8,
}: {
  /** 0–1. Above 1 is clamped; pass `over` to signal the overspend. */
  fraction: number;
  over?: boolean;
  /** Overrides the fill colour — used to match a category's own colour. */
  tint?: string;
  height?: number;
}) {
  const clamped = Math.min(1, Math.max(0, fraction));

  return (
    <View
      className="w-full overflow-hidden rounded-full bg-border"
      style={{ height }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <View
        className={`h-full rounded-full ${over ? "bg-danger" : tint ? "" : "bg-accent"}`}
        style={{
          width: `${clamped * 100}%`,
          ...(tint && !over ? { backgroundColor: tint } : null),
        }}
      />
    </View>
  );
}
