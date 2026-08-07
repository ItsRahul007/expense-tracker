import { ActivityIndicator, Pressable, Text } from "react-native";

import { usePalette } from "@/constants/palette";

/**
 * The primary action. Full-width by default because it's almost always the last
 * thing on a form sheet, where a narrow centred button just wastes reach.
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  loading?: boolean;
}) {
  const palette = usePalette();
  const inactive = disabled || loading;

  const surface =
    variant === "primary"
      ? "bg-brand"
      : variant === "danger"
        ? "bg-danger/10"
        : "bg-card border border-border";

  const text =
    variant === "primary"
      ? "text-white"
      : variant === "danger"
        ? "text-danger"
        : "text-fg";

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      // Disabled dimming and press feedback both live in className: a
      // function-form `style` is dropped when className is present, so the
      // disabled state was rendering at full strength.
      className={`min-h-[52px] w-full flex-row items-center justify-center gap-2 rounded-2xl ${surface} ${
        inactive ? "opacity-45" : "active:opacity-80"
      }`}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? "#FFFFFF" : palette.fg}

        />
      ) : null}
      <Text className={`font-sans-semibold text-headline ${text}`}>{label}</Text>
    </Pressable>
  );
}
