import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { usePalette } from "@/constants/palette";

/** A label/value row inside a card, with an optional chevron when tappable. */
export function SettingsRow({
  icon,
  label,
  value,
  onPress,
  showSeparator = true,
  tone = "default",
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  showSeparator?: boolean;
  tone?: "default" | "danger";
}) {
  const palette = usePalette();
  const color = tone === "danger" ? palette.danger : palette.fg;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={value ? `${label}: ${value}` : label}
      className="active:opacity-60"
    >
      <View className="min-h-[52px] flex-row items-center gap-3 px-4 py-3">
        <Ionicons name={icon as never} size={20} color={palette.muted} />
        <Text
          className="font-sans-medium flex-1 text-body"
          style={{ color }}
        >
          {label}
        </Text>
        {value ? (
          <Text className="font-sans text-body text-muted">{value}</Text>
        ) : null}
        {onPress ? (
          <Ionicons name="chevron-forward" size={16} color={palette.muted} />
        ) : null}
      </View>
      {showSeparator ? <View className="ml-[52px] h-px bg-border" /> : null}
    </Pressable>
  );
}
