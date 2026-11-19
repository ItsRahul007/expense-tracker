import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";

import { usePalette } from "@/constants/palette";

/**
 * The signed-in account at the top of Settings: photo, email, and the backup
 * status underneath it. Taps through to the Account screen.
 */
export function AccountRow({
  email,
  name,
  photo,
  status,
  needsAttention,
  onPress,
}: {
  email: string;
  name: string | null;
  photo: string | null;
  status: string;
  /** Backup needs the user (reconnect, deleted sheet, review…): status in red. */
  needsAttention: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  const initial = (name ?? email).trim().charAt(0).toUpperCase();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${email}. ${status}. Open account`}
      className="flex-row items-center gap-3 px-4 py-3.5 active:opacity-60"
    >
      {photo ? (
        <Image
          source={{ uri: photo }}
          style={{ width: 44, height: 44, borderRadius: 22 }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View className="h-11 w-11 items-center justify-center rounded-full bg-brand/15">
          <Text className="font-sans-semibold text-headline text-brand">{initial}</Text>
        </View>
      )}

      <View className="flex-1">
        <Text numberOfLines={1} className="font-sans-semibold text-headline text-fg">
          {email}
        </Text>
        <View className="mt-0.5 flex-row items-center gap-1">
          {needsAttention ? (
            <Ionicons name="alert-circle" size={14} color={palette.danger} />
          ) : null}
          <Text
            key={status}
            numberOfLines={1}
            className={`font-sans text-label ${needsAttention ? "text-danger" : "text-muted"}`}
          >
            {status}
          </Text>
        </View>
      </View>

      <Ionicons name="chevron-forward" size={16} color={palette.muted} />
    </Pressable>
  );
}
