import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { usePalette } from "@/constants/palette";
import { currentMonth, monthLabel, shiftMonth, type Month } from "@/lib/month";

import { MonthPickerDialog } from "./month-picker";

/** ‹ August 2026 › — a pill-shaped month pager. Tapping the month name opens
 *  a month picker for jumping further than one step at a time. */
export function MonthSwitcher({
  month,
  onChange,
  earliest,
  allowFuture = false,
  pickable = true,
}: {
  month: Month;
  onChange: (month: Month) => void;
  /** Oldest month worth paging back to. Omit for unlimited history. */
  earliest?: Month;
  /** Page past the current month — for planning, e.g. a budget's date range.
   *  Off by default, since an expense can't be in a month that hasn't started. */
  allowFuture?: boolean;
  /** Tap the label to open the month picker. Off where the switcher already
   *  sits inside a dialog (the date picker's calendar header). */
  pickable?: boolean;
}) {
  const palette = usePalette();
  const [picking, setPicking] = useState(false);
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  const canGoBack = earliest ? previous >= earliest : true;
  // Never page into a month that cannot contain expenses yet, unless asked.
  const canGoForward = allowFuture || next <= currentMonth();

  return (
    <View className="h-10 flex-row items-center justify-between self-stretch rounded-full border border-border bg-card px-1">
      <Arrow
        icon="chevron-back"
        label="Previous month"
        color={palette.fg}
        disabled={!canGoBack}
        onPress={() => onChange(previous)}
      />
      {pickable ? (
        <Pressable
          onPress={() => setPicking(true)}
          accessibilityRole="button"
          accessibilityLabel={monthLabel(month)}
          accessibilityHint="Opens a month picker"
          hitSlop={6}
          className="h-8 flex-row items-center gap-1.5 rounded-full px-3 active:opacity-50"
        >
          <Text className="font-sans-semibold text-body text-fg">{monthLabel(month)}</Text>
          <Ionicons name="chevron-down" size={14} color={palette.muted} />
        </Pressable>
      ) : (
        <Text className="font-sans-semibold text-body text-fg">{monthLabel(month)}</Text>
      )}
      <Arrow
        icon="chevron-forward"
        label="Next month"
        color={palette.fg}
        disabled={!canGoForward}
        onPress={() => onChange(next)}
      />
      {pickable ? (
        <MonthPickerDialog
          visible={picking}
          value={month}
          earliest={earliest}
          allowFuture={allowFuture}
          onChange={(picked) => {
            setPicking(false);
            if (picked !== month) onChange(picked);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
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
      // Both states in className — as a function-form `style` the disabled
      // dimming never applied, so a dead arrow looked identical to a live one.
      className={`h-8 w-8 items-center justify-center rounded-full ${
        disabled ? "opacity-25" : "active:opacity-50"
      }`}
    >
      <Ionicons name={icon as never} size={18} color={color} />
    </Pressable>
  );
}
