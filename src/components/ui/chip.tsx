import { Pressable, Text } from "react-native";

/** A pill-shaped filter or option. Selected fills with the accent. */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`h-9 justify-center rounded-full border px-4 ${
        selected ? "border-brand bg-brand" : "border-border bg-card"
      } active:opacity-70`}
    >
      <Text
        className={`font-sans-medium text-label ${selected ? "text-white" : "text-muted"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
