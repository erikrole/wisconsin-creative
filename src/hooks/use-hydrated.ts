import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False during server render and the hydration pass, true afterwards. Gate UI
 * that reads the device clock or time zone (the server runs in UTC) so the
 * first client render matches the server HTML instead of throwing React #418.
 */
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
