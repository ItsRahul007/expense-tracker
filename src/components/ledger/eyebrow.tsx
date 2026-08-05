import { Text } from "react-native";

/**
 * Column heads and section labels: small, uppercase, tracked, muted.
 *
 * The tracking matters more than it looks — uppercase at 11px without extra
 * letter-spacing reads as a solid block rather than as words.
 */
export function Eyebrow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Text
      className={`font-sans-semibold text-eyebrow uppercase tracking-eyebrow text-ink-muted ${className}`}
    >
      {children}
    </Text>
  );
}
