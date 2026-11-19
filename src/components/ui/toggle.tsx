import { Switch } from "react-native";

import { usePalette } from "@/constants/palette";

/**
 * A Switch in the app's colours. The bare RN Switch uses the platform's own
 * accent for the thumb (teal on this Android), which clashed with the brand
 * purple track — most visibly in dark mode.
 */
export function Toggle({
  value,
  onValueChange,
  disabled,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const palette = usePalette();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      // Off track in the muted grey at half strength: `border` is almost the
      // card's own colour in dark mode, which made an off switch vanish.
      trackColor={{ false: `${palette.muted}80`, true: palette.brand }}
      thumbColor="#FFFFFF"
      ios_backgroundColor={`${palette.muted}80`}
    />
  );
}
