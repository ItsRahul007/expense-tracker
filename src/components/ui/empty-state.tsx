import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { usePalette } from "@/constants/palette";

/**
 * Empty states get a direction, not an apology — the body text says what to do
 * next rather than restating that there's nothing here.
 */
export function EmptyState({
  icon = "receipt-outline",
  title,
  body,
}: {
  icon?: string;
  title: string;
  body?: string;
}) {
  const palette = usePalette();

  return (
    <View className="flex-1 items-center justify-center px-10 py-16">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-accent/10">
        <Ionicons name={icon as never} size={28} color={palette.accent} />
      </View>
      <Text className="font-sans-semibold mt-4 text-center text-headline text-fg">
        {title}
      </Text>
      {body ? (
        <Text className="font-sans mt-1.5 text-center text-body text-muted">{body}</Text>
      ) : null}
    </View>
  );
}
