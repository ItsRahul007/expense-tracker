import { Pressable, Text, View } from "react-native";

import { Rule } from "@/components/ledger";

/** "DEL" rather than ⌫ — the app has no icon language, and a glyph that may not
 *  exist in IBM Plex Mono would render as a tofu box on some platforms. */
const ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["00", "0", "DEL"],
] as const;

/**
 * A custom keypad rather than the OS numeric keyboard.
 *
 * Three reasons it earns the extra code: it gives a "00" key (most expenses are
 * whole rupees, so that's two keystrokes saved every time), it never resizes or
 * pushes the layout around mid-entry, and it can be set in the same monospaced
 * face as the ledger so entry and record look like the same object.
 *
 * Drawn as a ruled grid — the same hairline vocabulary as the rest of the app,
 * so it reads as part of the page rather than as a control panel.
 */
export function NumericKeypad({
  onDigits,
  onBackspace,
}: {
  onDigits: (digits: string) => void;
  onBackspace: () => void;
}) {
  return (
    <View>
      {ROWS.map((row) => (
        <View key={row.join("")}>
          <Rule />
          <View className="flex-row">
            {row.map((key, column) => {
              const isDelete = key === "DEL";
              return (
                <Pressable
                  key={key}
                  onPress={() => (isDelete ? onBackspace() : onDigits(key))}
                  accessibilityRole="button"
                  accessibilityLabel={isDelete ? "Delete last digit" : key}
                  className={`h-[58px] flex-1 items-center justify-center ${
                    column > 0 ? "border-l border-rule" : ""
                  }`}
                  style={({ pressed }) =>
                    pressed ? { opacity: 0.4 } : undefined
                  }
                >
                  {isDelete ? (
                    <Text className="font-sans-semibold text-eyebrow uppercase tracking-eyebrow text-ink-muted">
                      Del
                    </Text>
                  ) : (
                    <Text className="font-mono-medium text-[22px] leading-[26px] text-ink">
                      {key}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}
