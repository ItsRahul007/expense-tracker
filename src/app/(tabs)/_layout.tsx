import { Tabs } from "expo-router";

import { RuledTabBar } from "@/components/ruled-tab-bar";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <RuledTabBar {...props} />}
      screenOptions={{ headerShown: false, animation: "none" }}
    >
      <Tabs.Screen name="index" options={{ title: "Ledger" }} />
      <Tabs.Screen name="insights" options={{ title: "Insights" }} />
      <Tabs.Screen name="budgets" options={{ title: "Budgets" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
