import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

import { usePalette } from "@/constants/palette";
import { currentMonth, monthLabel, monthShort, type Month } from "@/lib/month";

import { Card } from "./card";

/** How far ahead the year pager goes when future months are allowed. */
const FUTURE_YEARS = 5;

/**
 * Jump straight to a month: a year pager over a 4×3 grid of months, as a
 * centred dialog like `DatePickerDialog`. Months after the current one are
 * disabled unless `allowFuture`; months before `earliest` always are.
 */
export function MonthPickerDialog({
  visible,
  value,
  onChange,
  onClose,
  earliest,
  allowFuture = false,
}: {
  visible: boolean;
  value: Month;
  onChange: (month: Month) => void;
  onClose: () => void;
  earliest?: Month;
  allowFuture?: boolean;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close month picker"
        className="flex-1 items-center justify-center bg-black/50 px-4"
      >
        {/* Swallows taps so pressing inside the card doesn't reach the backdrop. */}
        <Pressable onPress={() => {}} className="w-full max-w-[380px]">
          <Card>
            <Text className="font-sans-semibold mb-3 px-1 text-headline text-fg">
              Pick a month
            </Text>
            {/* Remounted on each open so the pager starts at the chosen year. */}
            {visible ? (
              <MonthGrid
                value={value}
                onChange={onChange}
                earliest={earliest}
                allowFuture={allowFuture}
              />
            ) : null}
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              hitSlop={8}
              className="mt-3 self-end px-2 py-1 active:opacity-50"
            >
              <Text className="font-sans-semibold text-label text-accent">Cancel</Text>
            </Pressable>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MonthGrid({
  value,
  onChange,
  earliest,
  allowFuture,
}: {
  value: Month;
  onChange: (month: Month) => void;
  earliest?: Month;
  allowFuture: boolean;
}) {
  const palette = usePalette();
  const now = currentMonth();
  const thisYear = Number(now.slice(0, 4));
  const [year, setYear] = useState(() => Number(value.slice(0, 4)));

  const minYear = earliest ? Number(earliest.slice(0, 4)) : -Infinity;
  const maxYear = allowFuture ? thisYear + FUTURE_YEARS : thisYear;
  const canGoBack = year - 1 >= minYear;
  const canGoForward = year + 1 <= maxYear;

  const months: Month[] = Array.from(
    { length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`,
  );

  return (
    <View>
      <View className="h-10 flex-row items-center justify-between rounded-full border border-border bg-card px-1">
        <YearArrow
          icon="chevron-back"
          label="Previous year"
          color={palette.fg}
          disabled={!canGoBack}
          onPress={() => setYear(year - 1)}
        />
        <Text className="font-sans-semibold text-body text-fg">{year}</Text>
        <YearArrow
          icon="chevron-forward"
          label="Next year"
          color={palette.fg}
          disabled={!canGoForward}
          onPress={() => setYear(year + 1)}
        />
      </View>

      <View className="mt-3 flex-row flex-wrap">
        {months.map((month) => {
          const selected = month === value;
          const isCurrent = month === now;
          const disabled =
            (!allowFuture && month > now) || (earliest !== undefined && month < earliest);

          return (
            <View key={month} className="w-1/3 p-1">
              <Pressable
                onPress={() => onChange(month)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={monthLabel(month)}
                accessibilityState={{ selected, disabled }}
                className={`h-11 items-center justify-center rounded-full ${
                  selected ? "bg-brand" : isCurrent ? "border border-brand" : ""
                } ${disabled ? "opacity-25" : "active:opacity-60"}`}
              >
                <Text
                  className={`text-body ${
                    selected ? "font-sans-semibold text-white" : "font-sans text-fg"
                  }`}
                >
                  {monthShort(month)}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function YearArrow({
  icon,
  label,
  color,
  disabled,
  onPress,
}: {
  icon: "chevron-back" | "chevron-forward";
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
      className={`h-8 w-8 items-center justify-center rounded-full ${
        disabled ? "opacity-25" : "active:opacity-50"
      }`}
    >
      <Ionicons name={icon} size={18} color={color} />
    </Pressable>
  );
}
