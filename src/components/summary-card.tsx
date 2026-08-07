import { Text, View } from "react-native";

import { formatMoney } from "@/lib/format";

/**
 * The answer to "how am I doing this month", above everything else on Home.
 *
 * Filled with the accent rather than being another white card: it's the one
 * element that should be readable from arm's length, and giving the summary its
 * own surface means the spend figure doesn't have to compete on size alone.
 *
 * Colours here are fixed rather than themed — white-on-accent works in both
 * schemes, and a summary that inverts between themes loses the anchor role.
 */
export function SummaryCard({
  spentMinor,
  budgetMinor,
  caption,
}: {
  spentMinor: number;
  /** Total of all category budgets for the month. 0 means none are set. */
  budgetMinor: number;
  caption: string;
}) {
  const hasBudget = budgetMinor > 0;
  const fraction = hasBudget ? spentMinor / budgetMinor : 0;
  const over = hasBudget && spentMinor > budgetMinor;
  const remaining = budgetMinor - spentMinor;

  return (
    <View className="overflow-hidden rounded-3xl bg-brand p-5">
      {/* white/90 rather than /70: at 13px, /70 over the brand fill measures
          ~3.5:1, which is under AA. */}
      <Text className="font-sans-medium text-label text-white/90">{caption}</Text>
      <Text className="font-sans-bold mt-1 text-display text-white">
        {/* Paise dropped on the hero figure — exact values live in the list. */}
        {formatMoney(spentMinor, { paise: false })}
      </Text>

      {hasBudget ? (
        <View className="mt-4">
          {/* Track is white at low opacity so the bar stays legible on accent. */}
          <View className="h-2 w-full overflow-hidden rounded-full bg-white/25">
            <View
              className="h-full rounded-full bg-white"
              style={{ width: `${Math.min(1, Math.max(0, fraction)) * 100}%` }}
            />
          </View>
          <View className="mt-2.5 flex-row items-center justify-between">
            <Text className="font-sans-medium text-label text-white/90">
              {Math.round(fraction * 100)}% of {formatMoney(budgetMinor, { paise: false })}
            </Text>
            <Text className="font-sans-semibold text-label text-white">
              {over
                ? `${formatMoney(-remaining, { paise: false })} over`
                : `${formatMoney(remaining, { paise: false })} left`}
            </Text>
          </View>
        </View>
      ) : (
        <Text className="font-sans mt-3 text-label text-white/90">
          Set a budget to track how much of the month is left.
        </Text>
      )}
    </View>
  );
}
