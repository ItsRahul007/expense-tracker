/**
 * `showSheet` — the app's replacement for `Alert.alert`.
 *
 * Same arguments as `Alert.alert(title, message, buttons)`, but shown as the
 * app's own themed bottom sheet (the `sheet` route, a native formSheet like the
 * delete-expense/budget sheets) instead of the OS dialog, which ignores the
 * app's theme and looks nothing like the rest of the app.
 *
 * Buttons carry callbacks, which can't travel through route params, so a
 * request is parked here under an id and the route looks it up. Nothing is
 * persisted: a request lives only until its sheet closes.
 */
import { router } from "expo-router";

export type SheetButton = {
  text: string;
  /** Like Alert: "cancel" is the quiet option, "destructive" is shown in red. */
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
};

export type SheetRequest = {
  title: string;
  message?: string;
  /** Defaults to a single "OK". */
  buttons: SheetButton[];
};

const requests = new Map<string, SheetRequest>();
let nextId = 1;

export function showSheet(title: string, message?: string, buttons?: SheetButton[]): void {
  const id = String(nextId++);
  requests.set(id, { title, message, buttons: buttons?.length ? buttons : [{ text: "OK" }] });
  router.push({ pathname: "/sheet", params: { id } });
}

/** For the sheet route: the request behind an id, or undefined if it's gone. */
export function getSheetRequest(id: string | undefined): SheetRequest | undefined {
  return id ? requests.get(id) : undefined;
}

export function releaseSheetRequest(id: string | undefined): void {
  if (id) requests.delete(id);
}
