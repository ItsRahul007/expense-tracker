import { View } from "react-native";

/**
 * Ruling. Every horizontal line in the app comes from here so there is exactly
 * one hairline weight in the design.
 *
 * 1px rather than StyleSheet.hairlineWidth: at 0.33px the rule disappears
 * entirely against the dark theme's --rule value on some panels, and an
 * intermittent line is worse than a slightly heavy one.
 */
export function Rule({ className = "" }: { className?: string }) {
  return <View className={`h-px bg-rule ${className}`} />;
}

/**
 * The accounting footing: two rules 3px apart, drawn above a total.
 *
 * This is the one piece of ornament in the design, and it is load-bearing —
 * a double rule is how a ledger says "everything above this is summed here".
 */
export function DoubleRule({ className = "" }: { className?: string }) {
  return (
    <View className={className}>
      <View className="h-px bg-rule" />
      <View className="h-[3px]" />
      <View className="h-px bg-rule" />
    </View>
  );
}

/**
 * The signature element: one continuous vertical rule at the decimal position.
 *
 * Deliberately rendered once by the *container* rather than per row — drawing it
 * inside each row produces a dashed stack of segments broken by every header and
 * separator, which is precisely the effect this design depends on avoiding.
 *
 * Wrap any scrolling list in `<LedgerSheet>` and every `<Amount>` inside it
 * lines up against this rule.
 */
export function LedgerSheet({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={`flex-1 ${className}`}>
      {children}
      <View
        pointerEvents="none"
        className="absolute bottom-0 right-4 top-0 w-px bg-rule"
      />
    </View>
  );
}
