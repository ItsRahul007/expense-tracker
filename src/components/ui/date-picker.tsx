import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

import { monthOf, type Month } from "@/lib/month";

import { Card } from "./card";
import { MonthSwitcher } from "./month-switcher";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * A month-grid calendar drawn with the app's own tokens. It replaces the native
 * picker, whose colours come from the OS and ignore the in-app theme setting.
 * Future days are disabled; the month pager already refuses to go past now.
 */
export function DatePicker({
  value,
  onChange,
}: {
  /** Epoch ms of the selected day. */
  value: number;
  /** Called with the tapped day at local midnight. */
  onChange: (day: Date) => void;
}) {
  const [month, setMonth] = useState<Month>(() => monthOf(value));

  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const selected = new Date(value);
  const today = new Date();

  // Leading blanks so day 1 lands under its weekday, trailing blanks to fill
  // the last week — every row keeps exactly seven cells.
  const cells: (Date | null)[] = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, i) => new Date(year, monthNumber - 1, i + 1),
    ),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = Array.from({ length: cells.length / 7 }, (_, i) =>
    cells.slice(i * 7, i * 7 + 7),
  );

  return (
    <View>
      <MonthSwitcher month={month} onChange={setMonth} />

      <View className="mt-3 flex-row">
        {WEEKDAYS.map((day, i) => (
          <Text
            key={i}
            className="font-sans-medium flex-1 text-center text-caption text-muted"
          >
            {day}
          </Text>
        ))}
      </View>

      {weeks.map((week, row) => (
        <View key={row} className="mt-1 flex-row">
          {week.map((day, col) => {
            if (!day) return <View key={col} className="h-10 flex-1" />;

            const isSelected = sameDay(day, selected);
            const isToday = sameDay(day, today);
            const isFuture = day > today && !isToday;

            return (
              <View key={col} className="h-10 flex-1 items-center justify-center">
                <Pressable
                  onPress={() => onChange(day)}
                  disabled={isFuture}
                  accessibilityRole="button"
                  accessibilityLabel={day.toDateString()}
                  accessibilityState={{ selected: isSelected, disabled: isFuture }}
                  className={`h-9 w-9 items-center justify-center rounded-full ${
                    isSelected
                      ? "bg-brand"
                      : isToday
                        ? "border border-brand"
                        : ""
                  } ${isFuture ? "opacity-25" : "active:opacity-60"}`}
                >
                  <Text
                    className={`text-body ${
                      isSelected
                        ? "font-sans-semibold text-white"
                        : "font-sans text-fg"
                    }`}
                  >
                    {day.getDate()}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/**
 * `DatePicker` as a centred dialog over a dimmed backdrop, the way the system
 * picker used to appear. Tapping a day picks it; tapping outside or Cancel
 * closes without changing anything.
 */
export function DatePickerDialog({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: number;
  onChange: (day: Date) => void;
  onClose: () => void;
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
        accessibilityLabel="Close date picker"
        className="flex-1 items-center justify-center bg-black/50 px-4"
      >
        {/* Swallows taps so pressing inside the card doesn't reach the backdrop. */}
        <Pressable onPress={() => {}} className="w-full max-w-[380px]">
          <Card>
            <Text className="font-sans-semibold mb-3 px-1 text-headline text-fg">
              Pick a date
            </Text>
            {/* Remounted on each open so the grid starts at the chosen month. */}
            {visible ? <DatePicker value={value} onChange={onChange} /> : null}
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
