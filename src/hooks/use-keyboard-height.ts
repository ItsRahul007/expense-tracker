import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

/**
 * The on-screen keyboard's height while it's open, 0 otherwise.
 *
 * Used by the form sheets (add expense, add budget) to put a spacer of this
 * height at the end of their ScrollView: inside a formSheet the window doesn't
 * resize for the keyboard, so without it the last field and the Save button
 * sit behind the keyboard with no way to scroll to them.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
