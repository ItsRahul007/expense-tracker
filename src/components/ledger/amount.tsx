import { Text, View } from "react-native";

import { formatAmountLabel, formatAmountParts } from "@/lib/format";

type Size = "row" | "display" | "margin";

const RUPEE_CLASS: Record<Size, string> = {
  row: "font-mono-medium text-amount",
  display: "font-mono-semibold text-figure",
  margin: "font-mono text-margin",
};

const PAISE_CLASS: Record<Size, string> = {
  row: "font-mono text-margin",
  display: "font-mono text-amount",
  margin: "font-mono text-[10px] leading-[14px]",
};

/**
 * A money figure, split into rupees and paise.
 *
 * Paise are always rendered, never dropped when zero. That's what keeps the
 * decimal point at an identical x-position on every row, which is the entire
 * premise of the alignment rule — a column that sometimes shows ".50" and
 * sometimes shows nothing cannot align. The noise is managed typographically
 * instead: paise are smaller and muted, so the eye reads the rupee figure and
 * the decimals recede without lying about the value.
 *
 * Because both faces are monospaced, the paise block is a fixed three
 * characters wide and everything grids for free.
 */
export function Amount({
  amountMinor,
  size = "row",
  tone = "ink",
  className = "",
}: {
  amountMinor: number;
  size?: Size;
  tone?: "ink" | "alert" | "muted";
  className?: string;
}) {
  const { rupees, paise } = formatAmountParts(amountMinor);

  const rupeeTone =
    tone === "alert" ? "text-alert" : tone === "muted" ? "text-ink-muted" : "text-ink";
  const paiseTone = tone === "alert" ? "text-alert/70" : "text-ink-muted";

  return (
    <View
      className={`flex-row items-baseline ${className}`}
      accessibilityLabel={formatAmountLabel(amountMinor)}
    >
      <Text className={`${RUPEE_CLASS[size]} ${rupeeTone}`}>{rupees}</Text>
      <Text className={`${PAISE_CLASS[size]} ${paiseTone}`}>.{paise}</Text>
    </View>
  );
}
