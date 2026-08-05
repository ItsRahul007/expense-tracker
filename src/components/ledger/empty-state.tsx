import { Text, View } from "react-native";

import { Rule } from "./rule";

/**
 * An empty ledger, not an empty screen.
 *
 * The ruling is drawn even with nothing on it — an unused account book has lines
 * waiting for entries, and showing them says "ready" where a centred icon and an
 * apology would say "broken". The copy gives one direction and stops.
 */
export function EmptyState({
  message,
  rows = 7,
}: {
  message: string;
  rows?: number;
}) {
  return (
    <View className="flex-1">
      <View pointerEvents="none" className="absolute inset-x-0 top-0">
        {Array.from({ length: rows }, (_, i) => (
          <View key={i}>
            <View className={`h-row ${i % 2 === 1 ? "bg-row-alt" : ""}`} />
            <Rule />
          </View>
        ))}
      </View>
      <View className="flex-1 items-center justify-center px-10">
        <Text className="font-sans text-center text-row text-ink-muted">
          {message}
        </Text>
      </View>
    </View>
  );
}
