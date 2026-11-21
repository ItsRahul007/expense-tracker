import { useState } from "react";
import { Keyboard, View } from "react-native";

import { Chip, DatePickerDialog } from "@/components/ui";
import { formatRelativeDay } from "@/lib/format";

/** How far back the quick day chips reach. "I forgot to log yesterday's auto"
 *  is the common case; anything older goes through the "Pick date" chip. */
const DAY_CHOICES = 3;

/** Midday, so a DST shift can't move the calendar day. */
export function atMidday(d: Date | number): number {
  const copy = new Date(d);
  copy.setHours(12, 0, 0, 0);
  return copy.getTime();
}

/** Midday of the day `offset` days before today. */
export function dayStart(offset: number): number {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return atMidday(d);
}

/**
 * The expense date control shared by the add and edit screens: quick chips for
 * the last few days plus a "Pick date" chip that opens the calendar. A date
 * older than the chips shows up on that last chip, so an old expense opened for
 * editing still shows its own date.
 *
 * Days are compared by calendar day, not timestamp: an imported or synced
 * expense can carry any time of day, and re-tapping its own day must not
 * change it.
 */
export function DateField({
  value,
  onChange,
}: {
  /** Epoch ms of the chosen moment. */
  value: number;
  /** Called with midday of the newly chosen day. Not called for the day that's already chosen. */
  onChange: (ts: number) => void;
}) {
  const [showCalendar, setShowCalendar] = useState(false);
  const chosenDay = atMidday(value);
  const pickedOlderDay = chosenDay < dayStart(DAY_CHOICES - 1);

  const choose = (day: number) => {
    if (day !== chosenDay) onChange(day);
  };

  return (
    <>
      <View className="flex-row flex-wrap gap-2">
        {Array.from({ length: DAY_CHOICES }, (_, offset) => (
          <Chip
            key={offset}
            label={formatRelativeDay(dayStart(offset))}
            selected={dayStart(offset) === chosenDay}
            onPress={() => {
              choose(dayStart(offset));
              setShowCalendar(false);
            }}
          />
        ))}
        <Chip
          label={pickedOlderDay ? formatRelativeDay(value) : "Pick date"}
          selected={pickedOlderDay}
          onPress={() => {
            Keyboard.dismiss();
            setShowCalendar(true);
          }}
        />
      </View>
      <DatePickerDialog
        visible={showCalendar}
        value={value}
        onChange={(day) => {
          choose(atMidday(day));
          setShowCalendar(false);
        }}
        onClose={() => setShowCalendar(false)}
      />
    </>
  );
}
