import { Pressable, Text, View } from "react-native";

import { currentMonth, monthLabel, shiftMonth, type Month } from "@/lib/month";

/**
 * ‹ AUG 2026 ›
 *
 * Chevrons are text glyphs rather than icons, which keeps the header a purely
 * typographic object and means they inherit ink colour and optical weight from
 * the type scale automatically.
 */
export function MonthSwitcher({
  month,
  onChange,
  earliest,
}: {
  month: Month;
  onChange: (month: Month) => void;
  /** Oldest month worth paging back to. Omit to allow unlimited history. */
  earliest?: Month;
}) {
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  const canGoBack = earliest ? previous >= earliest : true;
  // Never page into a month that cannot contain expenses yet.
  const canGoForward = next <= currentMonth();

  return (
    <View className="flex-row items-center gap-1">
      <Arrow
        glyph="‹"
        label="Previous month"
        disabled={!canGoBack}
        onPress={() => onChange(previous)}
      />
      <Text className="font-sans-semibold min-w-[104px] text-center text-eyebrow uppercase tracking-eyebrow text-ink">
        {monthLabel(month)}
      </Text>
      <Arrow
        glyph="›"
        label="Next month"
        disabled={!canGoForward}
        onPress={() => onChange(next)}
      />
    </View>
  );
}

function Arrow({
  glyph,
  label,
  disabled,
  onPress,
}: {
  glyph: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={12}
      className="h-8 w-6 items-center justify-center"
      style={({ pressed }) => ({ opacity: disabled ? 0.25 : pressed ? 0.5 : 1 })}
    >
      <Text className="font-sans text-[20px] leading-[24px] text-ink">{glyph}</Text>
    </Pressable>
  );
}
