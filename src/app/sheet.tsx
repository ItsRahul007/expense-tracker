/**
 * The generic message / confirmation sheet behind `showSheet` (src/lib/sheet.ts)
 * — used everywhere the app would otherwise show an `Alert`. Same look as the
 * delete-expense sheet: a native formSheet sized to its content, themed.
 */
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui";
import { getSheetRequest, releaseSheetRequest, type SheetButton } from "@/lib/sheet";

const variantOf = (button: SheetButton, index: number) =>
  button.style === "destructive"
    ? ("danger" as const)
    : button.style === "cancel" || index > 0
      ? ("secondary" as const)
      : ("primary" as const);

export default function SheetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const request = getSheetRequest(id);
  const handled = useRef(false);

  // Forget the request once the sheet is gone, however it was closed.
  useEffect(() => () => releaseSheetRequest(id), [id]);

  // Opened without a live request (e.g. after a reload): nothing to show.
  useEffect(() => {
    if (!request) router.back();
  }, [request]);

  if (!request) return null;

  // Cancel-style buttons last, like the delete sheets ("Delete" above "Cancel").
  const buttons = [...request.buttons].sort(
    (a, b) => Number(a.style === "cancel") - Number(b.style === "cancel"),
  );

  const press = (button: SheetButton) => {
    if (handled.current) return;
    handled.current = true;
    router.back();
    // After the close animation, so an action that opens another sheet (or
    // navigates) isn't fighting this one's dismissal.
    if (button.onPress) setTimeout(button.onPress, 300);
  };

  return (
    <View className="bg-bg px-5 pt-6" style={{ paddingBottom: insets.bottom + 16 }}>
      <Text className="font-sans-bold text-title text-fg">{request.title}</Text>
      {request.message ? (
        <Text className="font-sans mt-2 text-body text-muted">{request.message}</Text>
      ) : null}

      <View className="mt-6 gap-3">
        {buttons.map((button, index) => (
          <Button
            key={`${button.text}-${index}`}
            label={button.text}
            variant={variantOf(button, index)}
            onPress={() => press(button)}
          />
        ))}
      </View>
    </View>
  );
}
