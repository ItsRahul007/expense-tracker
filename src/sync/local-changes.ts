/**
 * A tiny signal from the data layer to the (future) sync engine: "something
 * syncable was just written locally". `live.ts` calls `notifyLocalChange()` from
 * every syncable mutation's `onSuccess`; the sync provider subscribes and runs a
 * debounced sync (design §10.6).
 *
 * Deliberately not React state: a write must never re-render anything just to
 * tell sync about it, and with no subscriber (Phase 0, signed out, tests) it's
 * a no-op.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function notifyLocalChange(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      // A broken listener must never fail the write that triggered it.
      console.warn("local-change listener threw", error);
    }
  }
}

/** Returns an unsubscribe function. */
export function onLocalChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
