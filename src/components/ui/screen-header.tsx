import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "@/constants/palette";

export type HeaderAction = {
  /** Ionicons glyph name. */
  icon: string;
  label: string;
  onPress: () => void;
};

/** Large screen title with optional icon actions on the right. */
export function ScreenHeader({
  title,
  subtitle,
  actions = [],
  onBack,
}: {
  title: string;
  subtitle?: string;
  actions?: HeaderAction[];
  onBack?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const palette = usePalette();

  return (
    <View className="bg-bg px-4 pb-2" style={{ paddingTop: insets.top + 8 }}>
      <View className="min-h-[44px] flex-row items-center gap-3">
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={12}
            className="-ml-1 h-9 w-9 items-center justify-center rounded-full"
            style={({ pressed }) => (pressed ? { opacity: 0.5 } : undefined)}
          >
            <Ionicons name="chevron-back" size={24} color={palette.fg} />
          </Pressable>
        ) : null}

        <View className="flex-1">
          <Text className="font-sans-bold text-title text-fg">{title}</Text>
          {subtitle ? (
            <Text className="font-sans mt-0.5 text-label text-muted">{subtitle}</Text>
          ) : null}
        </View>

        {actions.map((action) => (
          <Pressable
            key={action.label}
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            hitSlop={10}
            className="h-9 w-9 items-center justify-center rounded-full bg-card border border-border"
            style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
          >
            <Ionicons name={action.icon as never} size={18} color={palette.fg} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
