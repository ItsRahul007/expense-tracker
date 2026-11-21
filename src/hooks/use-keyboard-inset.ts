import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, type LayoutChangeEvent, Platform, StatusBar, type View } from "react-native";

/**
 * Keyboard positions are in screen coordinates, but on Android
 * `measureInWindow` measures from *below the status bar* (in form sheets and
 * full screens alike) — every
 * measurement came back exactly one status-bar height (42.67 dp on the test
 * phone) too high. Without this the spacer is that much too short and Save
 * stays partly behind the keyboard.
 */
const SHEET_Y_OFFSET = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

/**
 * How much of a scroll area the on-screen keyboard covers, in px — 0 when the
 * keyboard is closed.
 *
 * The form sheets (add expense, add budget) put a spacer of this height at the
 * end of their ScrollView: inside a formSheet the window doesn't resize for the
 * keyboard, so without it the last field and the Save button sit behind the
 * keyboard. It's the *overlap* — the scroll area's bottom edge minus the
 * keyboard's top edge — not the keyboard's full height: a sheet doesn't reach
 * every pixel the keyboard covers, and a full-height spacer let the content
 * scroll well past the Save button.
 *
 * Full screens (the expense detail screen) need it too: the app uses
 * `softwareKeyboardLayoutMode: "pan"`, so the window never resizes there either.
 *
 * Attach `ref` and `onLayout` to a View that wraps the ScrollView exactly.
 */
export function useKeyboardInset() {
  const ref = useRef<View>(null);
  const keyboardTop = useRef<number | null>(null);
  const [inset, setInset] = useState(0);

  const measure = useCallback(() => {
    const top = keyboardTop.current;
    const node = ref.current;
    if (top === null || !node) {
      setInset(0);
      return;
    }
    node.measureInWindow((_x, y, _width, height) => {
      setInset(Math.max(0, Math.round(y + SHEET_Y_OFFSET + height - top)));
    });
  }, []);

  useEffect(() => {
    let timers: ReturnType<typeof setTimeout>[] = [];
    const clear = () => {
      timers.forEach(clearTimeout);
      timers = [];
    };

    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      measure();
      // The sheet then slides up to sit above the keyboard. Moving the whole
      // sheet doesn't fire onLayout on anything inside it, so measure again
      // once that animation has settled — measured too early, the spacer is
      // ~190 dp too tall and the content over-scrolls past Save.
      clear();
      timers = [150, 400].map((ms) => setTimeout(measure, ms));
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      clear();
      keyboardTop.current = null;
      setInset(0);
    });
    return () => {
      clear();
      show.remove();
      hide.remove();
    };
  }, [measure]);

  // The sheet may move or resize while the keyboard is up; re-measure then.
  const onLayout = useCallback((_e: LayoutChangeEvent) => measure(), [measure]);

  return { ref, onLayout, inset };
}
