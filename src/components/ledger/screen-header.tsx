import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Rule } from "./rule";

export type HeaderAction = { label: string; onPress: () => void };

/**
 * The header every screen shares: safe-area padding, a leading element, text
 * actions on the right, and a closing rule.
 *
 * Actions are words rather than icons throughout the app. In a design carried
 * entirely by type, a glyph set would be the one visual language not doing any
 * work — and "New" is unambiguous in a way that a plus sign in a circle isn't.
 */
export function ScreenHeader({
  title,
  leading,
  trailing,
  actions = [],
}: {
  title?: string;
  /** Replaces the title — the ledger puts its month switcher here. */
  leading?: React.ReactNode;
  /** Right-hand slot before the actions — used for the month switcher on
   *  screens that also want a title. */
  trailing?: React.ReactNode;
  actions?: HeaderAction[];
}) {
  const insets = useSafeAreaInsets();

  return (
    <View className="bg-paper" style={{ paddingTop: insets.top }}>
      <View className="h-14 flex-row items-center justify-between pl-4 pr-7">
        {title ? (
          <Text className="font-sans-semibold text-screen text-ink">{title}</Text>
        ) : (
          (leading ?? <View />)
        )}
        <View className="flex-row items-center gap-5">
          {trailing}
          {actions.map((action) => (
            <Pressable
              key={action.label}
              onPress={action.onPress}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              hitSlop={10}
              style={({ pressed }) => (pressed ? { opacity: 0.5 } : undefined)}
            >
              <Text className="font-sans-semibold text-meta text-ink">
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Rule />
    </View>
  );
}
