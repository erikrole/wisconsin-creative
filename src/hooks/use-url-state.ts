"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Sync a single value to a URL search parameter via `history.replaceState`.
 *
 * Reads the initial value from the URL on mount. When the value changes,
 * the URL is updated without a navigation or re-render from Next.js router.
 *
 * @param key   - The URL search parameter name (e.g., "sport", "days", "tab")
 * @param parse - Convert the raw string (or null) from the URL to your state type.
 *                Receives null when the param is absent.
 * @param serialize - Convert the state value back to a string for the URL.
 *                    Return null/undefined to remove the parameter.
 *
 * @example
 * ```ts
 * // Simple string filter
 * const [sport, setSport] = useUrlState("sport", v => v, v => v);
 *
 * // Numeric with default
 * const [days, setDays] = useUrlState("days", v => v ? Number(v) : 30, v => v === 30 ? null : String(v));
 *
 * // Tab selection
 * const [tab, setTab] = useUrlState("tab", v => v ?? "info", v => v === "info" ? null : v);
 * ```
 */
export function useUrlState<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string | null | undefined,
): [T, (value: T | ((prev: T) => T)) => void] {
  const searchParams = useSearchParams();
  const searchSignature = searchParams.toString();
  const lastObservedSearchSignatureRef = useRef(searchSignature);
  const skipNextWriteRef = useRef(false);

  const [value, setValue] = useState<T>(() => parse(searchParams.get(key)));

  // Rehydrate when the URL changes through browser navigation or an external link.
  useEffect(() => {
    if (lastObservedSearchSignatureRef.current === searchSignature) return;
    lastObservedSearchSignatureRef.current = searchSignature;

    const nextValue = parse(searchParams.get(key));
    setValue((current) => {
      if (Object.is(current, nextValue)) return current;
      skipNextWriteRef.current = true;
      return nextValue;
    });
  }, [key, parse, searchParams, searchSignature]);

  // Sync value changes to URL
  useEffect(() => {
    if (skipNextWriteRef.current) {
      skipNextWriteRef.current = false;
      return;
    }

    const serialized = serialize(value);
    const url = new URL(window.location.href);

    if (serialized == null || serialized === "") {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, serialized);
    }

    const newUrl = url.searchParams.toString()
      ? `${url.pathname}?${url.searchParams.toString()}`
      : url.pathname;

    if (newUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", newUrl);
    }
  }, [key, value, serialize]);

  return [value, setValue];
}

/** Trim a URL param value; empty after trimming serializes as absent. */
export function serializeOptionalString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Shallow equality for two string sets (order-insensitive). */
export function setsEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

/**
 * Debounce a value by the given delay (ms). Useful for search inputs.
 *
 * @example
 * ```ts
 * const [search, setSearch] = useState("");
 * const debouncedSearch = useDebounce(search, 300);
 * ```
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}

// ── Detail-page tab URL codec ────────────────────────────

/** Resolve a `?tab=` value against the known tab defs, falling back to the default tab. */
export function parseDetailTab<K extends string>(raw: string | null, tabDefs: ReadonlyArray<{ key: K }>, fallback: K): K {
  return tabDefs.some((tab) => tab.key === raw) ? (raw as K) : fallback;
}

/** Omit the default tab from the URL so the canonical detail link stays clean. */
export function serializeDetailTab<K extends string>(tab: K, defaultTab: K): string | null {
  return tab === defaultTab ? null : tab;
}
