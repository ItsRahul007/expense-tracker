import { View } from "react-native";

/**
 * A budget's fill, drawn as a rule that thickens rather than as a rounded pill.
 *
 * 3px and square-ended so it belongs to the same family as every other line in
 * the app. Over 100% the whole bar turns to alert ink — a partial overflow
 * segment would need a second colour stop and say less at a glance than the
 * entire line changing colour.
 */
export function ProgressBar({
  fraction,
  over,
}: {
  /** 0–1. Values above 1 are clamped; `over` carries the overspend instead. */
  fraction: number;
  over: boolean;
}) {
  const width = `${Math.min(1, Math.max(0, fraction)) * 100}%` as const;

  return (
    <View className="h-[3px] bg-rule/50">
      <View className={`h-full ${over ? "bg-alert" : "bg-ink"}`} style={{ width }} />
    </View>
  );
}
