/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/app/**/*.{js,jsx,ts,tsx}",
    "./src/components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  // "class" rather than "media" so the in-app System/Light/Dark setting can
  // override the OS. NativeWind's colorScheme.set() drives it.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        paper: "rgb(var(--paper) / <alpha-value>)",
        "row-alt": "rgb(var(--row-alt) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-muted": "rgb(var(--ink-muted) / <alpha-value>)",
        rule: "rgb(var(--rule) / <alpha-value>)",
        alert: "rgb(var(--alert) / <alpha-value>)",
      },
      // React Native does not synthesise font weights: `font-semibold` on a
      // custom family silently does nothing. So each weight is its own
      // registered family and its own utility.
      fontFamily: {
        mono: ["IBMPlexMono_400Regular"],
        "mono-medium": ["IBMPlexMono_500Medium"],
        "mono-semibold": ["IBMPlexMono_600SemiBold"],
        sans: ["InstrumentSans_400Regular"],
        "sans-medium": ["InstrumentSans_500Medium"],
        "sans-semibold": ["InstrumentSans_600SemiBold"],
      },
      // Named after their role in the ledger, not their size, so the type scale
      // stays enforced at the callsite.
      fontSize: {
        figure: ["56px", { lineHeight: "56px" }],
        amount: ["17px", { lineHeight: "24px" }],
        margin: ["12px", { lineHeight: "16px" }],
        row: ["16px", { lineHeight: "22px" }],
        meta: ["13px", { lineHeight: "18px" }],
        eyebrow: ["11px", { lineHeight: "14px" }],
        screen: ["22px", { lineHeight: "28px" }],
      },
      // letterSpacing is px in React Native, not em. 0.9px ≈ 0.08em at 11px.
      letterSpacing: {
        eyebrow: "0.9px",
      },
      spacing: {
        // Ledger row height. The rule sits at right-4 (16px) and row content
        // stops at pr-7 (28px), leaving a 12px gutter between figure and rule.
        row: "52px",
      },
    },
  },
  plugins: [],
};
