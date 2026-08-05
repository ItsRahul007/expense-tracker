import { Pressable, Text, View } from "react-native";

import { Amount } from "./amount";

/**
 * One entry in the account book.
 *
 * Metrics are fixed rather than content-driven: 52px tall, 16px in from the
 * left, stopping at 28px from the right so the figure clears the alignment rule
 * by a 12px gutter. No radius, no shadow, no separator between rows — the zebra
 * banding does that job, the way green-bar accounting paper does.
 */
export function LedgerRow({
  title,
  meta,
  amountMinor,
  zebra = false,
  tone = "ink",
  onPress,
}: {
  title: string;
  meta?: string;
  amountMinor: number;
  zebra?: boolean;
  tone?: "ink" | "alert";
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      className={`h-row flex-row items-center pl-4 pr-7 ${zebra ? "bg-row-alt" : ""}`}
      style={({ pressed }) => (pressed ? { opacity: 0.55 } : undefined)}
    >
      <View className="flex-1 pr-3">
        <Text numberOfLines={1} className="font-sans-medium text-row text-ink">
          {title}
        </Text>
        {meta ? (
          <Text numberOfLines={1} className="font-sans text-meta text-ink-muted">
            {meta}
          </Text>
        ) : null}
      </View>
      <Amount amountMinor={amountMinor} tone={tone} />
    </Pressable>
  );
}
