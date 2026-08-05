import { View } from "react-native";

import { Amount } from "./amount";
import { DoubleRule } from "./rule";
import { Eyebrow } from "./eyebrow";

/**
 * The closing total, ruled off the way a ledger page is footed.
 *
 * Pinned rather than scrolled: the answer to "how much this month" should never
 * require reaching the bottom of a two-hundred-row list.
 */
export function Footing({
  label,
  amountMinor,
  tone = "ink",
}: {
  label: string;
  amountMinor: number;
  tone?: "ink" | "alert";
}) {
  return (
    <View className="bg-paper">
      <DoubleRule />
      <View className="h-12 flex-row items-baseline justify-between pl-4 pr-7">
        <Eyebrow className="pb-[2px]">{label}</Eyebrow>
        <Amount amountMinor={amountMinor} tone={tone} />
      </View>
    </View>
  );
}
