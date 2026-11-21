import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, Text } from "react-native";

import { usePalette } from "@/constants/palette";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** A pill-shaped filter or option. Selected fills with the accent. */
export function Chip({
  label,
  selected,
  onPress,
  icon,
  trailingIcon,
  accessibilityHint,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Glyph before the label. Accent-coloured when unselected, so it reads as an action. */
  icon?: IconName;
  /** Glyph after the label, e.g. a chevron for a chip that opens a picker. */
  trailingIcon?: IconName;
  accessibilityHint?: string;
}) {
  const palette = usePalette();
  const iconColor = selected ? "#FFFFFF" : palette.muted;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityHint={accessibilityHint}
      className={`h-9 flex-row items-center gap-1.5 rounded-full border px-4 ${
        selected ? "border-brand bg-brand" : "border-border bg-card"
      } active:opacity-70`}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={15}
          color={selected ? "#FFFFFF" : palette.brand}
        />
      ) : null}
      <Text
        className={`font-sans-medium text-label ${selected ? "text-white" : "text-muted"}`}
      >
        {label}
      </Text>
      {trailingIcon ? (
        <Ionicons name={trailingIcon} size={13} color={iconColor} />
      ) : null}
    </Pressable>
  );
}
