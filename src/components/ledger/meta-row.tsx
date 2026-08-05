import { Pressable, Text, View } from "react-native";

import { Eyebrow } from "./eyebrow";
import { Rule } from "./rule";

/**
 * A ruled label/value row — the statement-style pairing used by the add sheet,
 * the entry detail screen, and settings.
 *
 * Values sit at pr-7 like every other right-hand element, so on screens wrapped
 * in a LedgerSheet they line up against the same vertical rule as the figures.
 */
export function MetaRow({
  label,
  value,
  onPress,
  tone = "ink",
  expanded,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  tone?: "ink" | "alert" | "muted";
  /** Revealed beneath the row when it acts as a disclosure — chip pickers. */
  expanded?: React.ReactNode;
}) {
  const valueTone =
    tone === "alert" ? "text-alert" : tone === "muted" ? "text-ink-muted" : "text-ink";

  return (
    <View>
      <Rule />
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityLabel={value ? `${label}: ${value}` : label}
        className="h-12 flex-row items-center justify-between pl-4 pr-7"
        style={({ pressed }) => (pressed ? { opacity: 0.55 } : undefined)}
      >
        <Eyebrow>{label}</Eyebrow>
        {value ? (
          <Text className={`font-sans-medium text-row ${valueTone}`}>{value}</Text>
        ) : null}
      </Pressable>
      {expanded ? <View className="pb-3 pl-4 pr-7">{expanded}</View> : null}
    </View>
  );
}
