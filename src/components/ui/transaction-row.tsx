import { Pressable, Text, View } from "react-native";

import { formatAmountLabel, formatMoney } from "@/lib/format";

import { IconBadge } from "./icon-badge";

/**
 * One expense in a list: tinted category icon, title, sub-label, amount.
 *
 * Amounts carry an explicit minus. Every row in a v1 ledger is money out, so the
 * sign is technically redundant — but it makes the number unmistakable at a
 * glance, and it means income can be added later without the existing rows
 * suddenly becoming ambiguous.
 */
export function TransactionRow({
  title,
  subtitle,
  amountMinor,
  icon,
  color,
  onPress,
  showSeparator = true,
}: {
  title: string;
  subtitle: string;
  amountMinor: number;
  icon: string;
  color: string;
  onPress?: () => void;
  showSeparator?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${title}, ${subtitle}, ${formatAmountLabel(amountMinor)}`}
      style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
    >
      <View className="flex-row items-center gap-3 px-4 py-3">
        <IconBadge icon={icon} color={color} />

        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans-semibold text-body text-fg">
            {title}
          </Text>
          <Text numberOfLines={1} className="font-sans mt-0.5 text-label text-muted">
            {subtitle}
          </Text>
        </View>

        <Text className="font-sans-semibold text-body text-fg">
          {formatMoney(amountMinor, { sign: true })}
        </Text>
      </View>

      {/* Inset so the rule starts under the text, not under the icon — it reads
          as grouping the rows rather than cutting the card in half. */}
      {showSeparator ? <View className="ml-[68px] h-px bg-border" /> : null}
    </Pressable>
  );
}
