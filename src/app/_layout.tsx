import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from "@expo-google-fonts/ibm-plex-mono";
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
} from "@expo-google-fonts/instrument-sans";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { colorScheme as nativewindColorScheme, useColorScheme } from "nativewind";
import { useEffect } from "react";

import { PALETTE } from "@/constants/palette";
import { AppDataProviders } from "@/providers/app-data-providers";
import { useSetting } from "@/queries";

import "@/global.css";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Each weight is registered under its own family name because React Native
  // does not synthesise weights — see the fontFamily block in tailwind.config.js.
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
  });

  const { data: themePreference, isPending: themePending } = useSetting("theme");

  // The stored preference drives NativeWind rather than the OS directly, which
  // is why tailwind.config.js uses darkMode: "class" — it lets the in-app
  // setting override the system appearance.
  useEffect(() => {
    nativewindColorScheme.set(themePreference ?? "system");
  }, [themePreference]);

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
  // during transitions, and a default-white card behind a dark ledger flashes
  // on every push.
  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(dark ? DarkTheme : DefaultTheme).colors,
      background: palette.paper,
      card: palette.paper,
      text: palette.ink,
      border: palette.rule,
      primary: palette.ink,
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      <AppDataProviders>
        <StatusBar style={dark ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.paper },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="add"
            options={{
              presentation: "formSheet",
              sheetGrabberVisible: true,
              sheetCornerRadius: 14,
              // Tall enough for the display figure plus the full keypad, short
              // enough that the ledger stays visible behind it.
              sheetAllowedDetents: [0.72],
            }}
          />
          <Stack.Screen name="search" options={{ presentation: "modal" }} />
          <Stack.Screen name="categories" options={{ presentation: "modal" }} />
          <Stack.Screen name="transaction/[id]" />
        </Stack>
      </AppDataProviders>
    </ThemeProvider>
  );
}
