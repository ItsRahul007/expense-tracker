import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Rule } from "@/components/ledger";

/**
 * The tab bar as a ruled footer rather than a platform chrome element.
 *
 * NativeTabs was the alternative and would have given real platform behaviour,
 * but it only exposes background/indicator/label colours — the shape and the
 * iOS glass treatment stay Apple's, which reads as a stock tab bar bolted onto a
 * hand-set page. This keeps one visual language across every surface.
 *
 * Labels only, no icons: in a design carried entirely by type, an icon set would
 * be the one element not doing any work. The active tab is marked by a short ink
 * rule above its label — the same ruling vocabulary as the rest of the app.
 */
export function RuledTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View className="bg-paper" style={{ paddingBottom: insets.bottom }}>
      <Rule />
      <View className="h-12 flex-row">
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label = options.title ?? route.name;
          const focused = state.index === index;

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              onPress={() => {
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
              onLongPress={() =>
                navigation.emit({ type: "tabLongPress", target: route.key })
              }
              className="flex-1 items-center justify-center"
              style={({ pressed }) => (pressed ? { opacity: 0.5 } : undefined)}
            >
              <View
                className={`mb-[7px] h-[2px] w-5 ${focused ? "bg-ink" : "bg-transparent"}`}
              />
              <Text
                className={`font-sans-semibold text-eyebrow uppercase tracking-eyebrow ${
                  focused ? "text-ink" : "text-ink-muted"
                }`}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
