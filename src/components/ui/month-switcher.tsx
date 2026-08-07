import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { usePalette } from "@/constants/palette";
import { currentMonth, monthLabel, shiftMonth, type Month } from "@/lib/month";

/** ‹ August 2026 › — a pill-shaped month pager. */
export function MonthSwitcher({
  month,
  onChange,
  earliest,
}: {
  month: Month;
  onChange: (month: Month) => void;
  /** Oldest month worth paging back to. Omit for unlimited history. */
  earliest?: Month;
}) {
  const palette = usePalette();
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  const canGoBack = earliest ? previous >= earliest : true;
  // Never page into a month that cannot contain expenses yet.
  const canGoForward = next <= currentMonth();

  return (
    <View className="h-10 flex-row items-center justify-between self-stretch rounded-full border border-border bg-card px-1">
      <Arrow
        icon="chevron-back"
        label="Previous month"
        color={palette.fg}
        disabled={!canGoBack}
        onPress={() => onChange(previous)}
      />
      <Text className="font-sans-semibold text-body text-fg">{monthLabel(month)}</Text>
      <Arrow
        icon="chevron-forward"
        label="Next month"
        color={palette.fg}
        disabled={!canGoForward}
        onPress={() => onChange(next)}
      />
    </View>
  );
}

function Arrow({
  icon,
  label,
  color,
  disabled,
  onPress,
}: {
  icon: string;
  label: string;
  color: string;
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
      hitSlop={8}
      className="h-8 w-8 items-center justify-center rounded-full"
      style={({ pressed }) => ({ opacity: disabled ? 0.25 : pressed ? 0.5 : 1 })}
    >
      <Ionicons name={icon as never} size={18} color={color} />
    </Pressable>
  );
}
