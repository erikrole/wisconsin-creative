/**
 * Sync filter state into the current URL via `history.replaceState`,
 * preserving other params and pruning empty / zero values.
 *
 * Client-only: callers must guard against SSR if invoked during render.
 */
export function syncUrl(params: Record<string, string | number>) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v === "" || v === 0) url.searchParams.delete(k);
    else url.searchParams.set(k, String(v));
  }
  window.history.replaceState(window.history.state, "", url.toString());
}
