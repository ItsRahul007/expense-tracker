import { View } from "react-native";

import { formatDayHeader } from "@/lib/format";

import { Amount } from "./amount";
import { Eyebrow } from "./eyebrow";
import { Rule } from "./rule";

/**
 * A day's heading inside the ledger, carrying that day's subtotal.
 *
 * The subtotal isn't decoration — grouping without a group total is the one
 * thing a paper ledger would never do, and "what did today cost me" is a
 * question worth answering without arithmetic.
 */
export function DayHeader({
  ts,
  subtotalMinor,
}: {
  ts: number;
  subtotalMinor: number;
}) {
  return (
    <View className="bg-paper">
      <Rule />
      <View className="h-8 flex-row items-center justify-between pl-4 pr-7">
        <Eyebrow>{formatDayHeader(ts)}</Eyebrow>
        <Amount amountMinor={subtotalMinor} size="margin" tone="muted" />
      </View>
      <Rule />
    </View>
  );
}
