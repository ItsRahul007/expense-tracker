import React, { Component, type ReactNode } from "react";
import { Text, View } from "react-native";

import { PALETTE } from "@/constants/palette";
import { colorScheme as nativewindColorScheme } from "nativewind";

type Props = {
  children: ReactNode;
  fallback?: (error: Error) => ReactNode;
};

type State = { error: Error | null };

/**
 * Class component because `getDerivedStateFromError`/`componentDidCatch` have
 * no hook equivalent — this is the one place in the tree that still has to be
 * a class.
 *
 * Rendered before `RootNavigator`, so React Navigation's `ThemeProvider` isn't
 * mounted yet; the fallback reads NativeWind's colour scheme directly instead
 * of the `usePalette` hook.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("Uncaught error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error);

    const palette =
      nativewindColorScheme.get() === "dark" ? PALETTE.dark : PALETTE.light;

    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.bg,
          padding: 24,
          gap: 8,
        }}
      >
        <Text
          style={{ color: palette.fg, fontSize: 18, fontWeight: "600" }}
        >
          Something went wrong
        </Text>
        <Text style={{ color: palette.muted, textAlign: "center" }}>
          The app couldn&apos;t start. Try closing and reopening it.
        </Text>
      </View>
    );
  }
}
