import { Pressable, Text } from "react-native";

/**
 * A selectable label. Selection inverts to solid ink rather than tinting an
 * accent colour, which keeps the palette's one accent reserved for overspending.
 *
 * Square corners, hairline border — the same ruling language as everything else.
 */
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
      className={`h-8 justify-center border px-3 ${
        selected ? "border-ink bg-ink" : "border-rule bg-transparent"
      }`}
      style={({ pressed }) => (pressed ? { opacity: 0.55 } : undefined)}
    >
      <Text
        className={`font-sans-semibold text-eyebrow uppercase tracking-eyebrow ${
          selected ? "text-paper" : "text-ink-muted"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
