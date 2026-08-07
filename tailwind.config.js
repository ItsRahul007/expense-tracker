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
        bg: "rgb(var(--bg) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        brand: "rgb(var(--brand) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
      },
      /**
       * React Native does not synthesise font weights — `font-semibold` on a
       * custom family silently does nothing. Each weight is therefore its own
       * registered family and its own utility. Named `font-sans-*` rather than
       * `font-medium` so these don't collide with Tailwind's fontWeight
       * utilities.
       */
      fontFamily: {
        sans: ["PlusJakartaSans_400Regular"],
        "sans-medium": ["PlusJakartaSans_500Medium"],
        "sans-semibold": ["PlusJakartaSans_600SemiBold"],
        "sans-bold": ["PlusJakartaSans_700Bold"],
      },
      fontSize: {
        display: ["34px", { lineHeight: "40px" }],
        title: ["22px", { lineHeight: "28px" }],
        headline: ["17px", { lineHeight: "22px" }],
        body: ["15px", { lineHeight: "21px" }],
        label: ["13px", { lineHeight: "18px" }],
        caption: ["11px", { lineHeight: "15px" }],
      },
    },
  },
  plugins: [],
};
