import { Pressable, Text, View } from "react-native";

/** A heading above a card, with an optional text action on the right. */
export function SectionTitle({
  title,
  action,
  meta,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
  /** Muted summary text on the right, e.g. a count and total. */
  meta?: string;
}) {
  return (
    <View className="mb-2 flex-row items-center justify-between px-1">
      <Text className="font-sans-semibold text-headline text-fg">{title}</Text>
      {meta ? <Text className="font-sans text-label text-muted">{meta}</Text> : null}
      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          hitSlop={8}
          className="active:opacity-50"
        >
          <Text className="font-sans-semibold text-label text-accent">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
