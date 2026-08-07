import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "@/constants/palette";

/**
 * Outline when inactive, filled when active — the standard iOS/Android pairing,
 * which signals selection without relying on colour alone.
 */
const ICONS: Record<string, { active: string; inactive: string }> = {
  index: { active: "home", inactive: "home-outline" },
  stats: { active: "stats-chart", inactive: "stats-chart-outline" },
  budgets: { active: "wallet", inactive: "wallet-outline" },
  settings: { active: "settings", inactive: "settings-outline" },
};

/**
 * Bottom navigation with a raised add button in the middle.
 *
 * The add button is an action, not a route, so it isn't a `Tabs.Screen` — it's
 * spliced into the centre of the four real tabs and pushes the /add sheet. That
 * keeps logging an expense one tap from anywhere in the app, which matters more
 * than tab-bar purity for something used several times a day.
 */
export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const palette = usePalette();

  const left = state.routes.slice(0, 2);
  const right = state.routes.slice(2);

  const renderTab = (route: (typeof state.routes)[number]) => {
    const index = state.routes.findIndex((r) => r.key === route.key);
    const focused = state.index === index;
    const label = descriptors[route.key].options.title ?? route.name;
    const glyphs = ICONS[route.name] ?? { active: "ellipse", inactive: "ellipse-outline" };

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
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        }}
        className="flex-1 items-center justify-center gap-1 pt-1 active:opacity-60"
      >
        <Ionicons
          name={(focused ? glyphs.active : glyphs.inactive) as never}
          size={23}
          color={focused ? palette.accent : palette.muted}
        />
        <Text
          className={`font-sans-medium text-caption ${focused ? "text-accent" : "text-muted"}`}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      className="border-t border-border bg-card"
      style={{ paddingBottom: insets.bottom }}
    >
      <View className="h-[58px] flex-row items-center">
        {left.map(renderTab)}

        {/* Raised, so it reads as an action rather than a fifth destination. */}
        <View className="w-[76px] items-center">
          <Pressable
            onPress={() => router.push("/add")}
            accessibilityRole="button"
            accessibilityLabel="Add expense"
            className="-mt-6 h-14 w-14 items-center justify-center rounded-full bg-brand active:opacity-80"
            // Object style: the shadow was previously inside a function-form
            // `style`, which NativeWind drops when className is present — so the
            // button's lift never rendered at all.
            style={{
              shadowColor: palette.brand,
              shadowOpacity: 0.35,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              elevation: 6,
            }}
          >
            <Ionicons name="add" size={30} color="#FFFFFF" />
          </Pressable>
        </View>

        {right.map(renderTab)}
      </View>
    </View>
  );
}
