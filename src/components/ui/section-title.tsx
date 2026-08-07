import { Pressable, Text, View } from "react-native";

/** A heading above a card, with an optional text action on the right. */
export function SectionTitle({
  title,
  action,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View className="mb-2 flex-row items-center justify-between px-1">
      <Text className="font-sans-semibold text-headline text-fg">{title}</Text>
      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => (pressed ? { opacity: 0.5 } : undefined)}
        >
          <Text className="font-sans-semibold text-label text-accent">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
