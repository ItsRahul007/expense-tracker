import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from "@expo-google-fonts/plus-jakarta-sans";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import {
  colorScheme as nativewindColorScheme,
  useColorScheme,
} from "nativewind";
import { useEffect } from "react";
import { useColorScheme as useSystemColorScheme } from "react-native";

import { PALETTE } from "@/constants/palette";
import { AppDataProviders } from "@/providers/app-data-providers";
import { useSetting } from "@/queries";

import "@/global.css";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <AppDataProviders>
      <AppGates />
    </AppDataProviders>
  );
}

function AppGates() {
  // Each weight is registered under its own family name because React Native
  // does not synthesise weights — see the fontFamily block in tailwind.config.js.
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const { data: themePreference, isPending: themePending } =
    useSetting("theme");
  const systemScheme = useSystemColorScheme();

  /**
   * "system" is resolved here rather than handed to NativeWind.
   *
   * With darkMode: "class", NativeWind only applies the `dark` class for an
   * explicit "light"/"dark" — passing "system" through leaves the class off and
   * the app silently stays light even on a dark device. So the OS scheme is read
   * from React Native's Appearance and collapsed into a concrete value, which is
   * also what makes the in-app override possible at all.
   */
  const preference = themePreference ?? "system";
  // React Native's useColorScheme can return null *or* "unspecified"; both mean
  // "no stated preference", which resolves to light.
  const resolvedScheme: "light" | "dark" =
    preference === "system"
      ? systemScheme === "dark"
        ? "dark"
        : "light"
      : preference;

  // Declared before the splash-hide effect below so the class is applied in the
  // same commit, before anything becomes visible.
  useEffect(() => {
    nativewindColorScheme.set(resolvedScheme);
  }, [resolvedScheme]);

  /**
   * Three gates before first paint: fonts, the theme preference, and (once the
   * data layer lands) migrations. Painting early means a light-themed flash on
   * every cold start in dark mode, plus a frame of fallback system type.
   *
   * A font *error* still opens the gate — shipping the app in Helvetica is a
   * worse-looking outcome than a splash screen that never goes away, but it is a
   * far better one than a blank screen.
   */
  const ready = (fontsLoaded || Boolean(fontError)) && !themePending;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return <RootNavigator />;
}

function RootNavigator() {
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === "dark";
  const palette = dark ? PALETTE.dark : PALETTE.light;

  // React Navigation needs literal colours: it paints the screen background
  // during transitions, and a default-white card behind a dark screen flashes on
  // every push.
  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(dark ? DarkTheme : DefaultTheme).colors,
      background: palette.bg,
      card: palette.card,
      text: palette.fg,
      border: palette.border,
      primary: palette.accent,
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="add"
          options={{
            presentation: "formSheet",
            sheetGrabberVisible: true,
            sheetCornerRadius: 24,
            // Nearly full height: the form has an amount field, a category
            // grid, date chips and a note, and a short sheet would make the
            // grid scroll immediately.
            sheetAllowedDetents: [0.92],
          }}
        />
        <Stack.Screen
          name="add-budget"
          options={{
            presentation: "formSheet",
            sheetGrabberVisible: true,
            sheetCornerRadius: 24,
            sheetAllowedDetents: [0.6],
          }}
        />
        <Stack.Screen name="search" options={{ presentation: "modal" }} />
        <Stack.Screen name="categories" options={{ presentation: "modal" }} />
        <Stack.Screen name="transaction/[id]" />
      </Stack>
    </ThemeProvider>
  );
}
