import { useEffect, useState } from "react";

/** Runs `run` once the browser is idle (or after `timeoutMs`), so ambient work does not compete with the page's own data on a slow connection. Returns a cancel function. */
export function runWhenIdle(run: () => void, timeoutMs = 2500) {
  // Safari has no requestIdleCallback.
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(run, { timeout: timeoutMs });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(run, 1200);
  return () => clearTimeout(id);
}

/** False through first paint, true once the browser is idle. Gates requests the page does not need to render. */
export function useIdleReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => runWhenIdle(() => setReady(true)), []);
  return ready;
}
