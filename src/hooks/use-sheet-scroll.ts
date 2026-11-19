import { useCallback, useState } from "react";
import type { LayoutChangeEvent } from "react-native";

/**
 * Makes a ScrollView inside an Android bottom sheet always hand drags to the
 * sheet, so dragging down closes it — whether or not the content scrolls.
 *
 * How the pieces fit (verified on device):
 *  - The sheet (Material BottomSheetBehavior via react-native-screens) never
 *    takes a drag that *starts on* its nested-scrolling child; it only moves
 *    when that child passes the drag on through nested scrolling.
 *  - An Android ScrollView whose content fits ignores the drag entirely, so it
 *    passes nothing on — the sheet couldn't be dragged closed when the form
 *    fit on screen (keyboard closed).
 *  - When the content overflows, the ScrollView takes the drag, scrolls to the
 *    top, then passes the rest on and the sheet closes. That's the behaviour
 *    we want everywhere.
 *
 * So the content is kept at least 1 px taller than the ScrollView: it always
 * "can scroll", always takes the drag, and always hands it on at the top. The
 * 1 px is invisible.
 *
 * Use: `nestedScrollEnabled`, `onLayout={onLayout}` on the ScrollView, and
 * `minHeight: contentMinHeight` in its `contentContainerStyle`.
 */
export function useSheetScroll() {
  const [viewport, setViewport] = useState(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setViewport(e.nativeEvent.layout.height);
  }, []);

  return { onLayout, contentMinHeight: viewport + 1 };
}
