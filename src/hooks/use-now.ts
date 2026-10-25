import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  timer ??= setInterval(() => listeners.forEach((listener) => listener()), TICK_MS);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

// Rounded so repeated reads within a tick agree, which keeps render pure.
function snapshot() {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}

/**
 * The current time in epoch ms, accurate to 30 seconds. One shared clock
 * re-renders readers as it ticks, so "has this ended?" checks stay live.
 */
export function useNow() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
