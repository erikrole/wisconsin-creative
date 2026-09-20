"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  classifyError,
  handleAuthRedirect,
  parseJsonSafely,
  type FetchErrorKind,
} from "@/lib/errors";

type UseFetchOptions<T> = {
  /** The URL to fetch. When it changes, a new request is made. */
  url: string;
  /**
   * Optional path within `window.location.pathname` used for the `returnTo`
   * query param on 401 redirects. Defaults to current pathname.
   */
  returnTo?: string;
  /**
   * Transform the raw JSON response before storing in state.
   * Defaults to `json => json.data ?? json`.
   */
  transform?: (json: Record<string, unknown>) => T;
  /** If true, refetch when the browser tab becomes visible again. Default: true. */
  refetchOnFocus?: boolean;
  /** If false, the query will not execute. Useful for conditional fetching. Default: true. */
  enabled?: boolean;
  /** Keep the previous response visible while a changed URL is refetching. */
  keepPreviousData?: boolean;
  /** Refetch when this consumer mounts, even if its cached response is still fresh. */
  refetchOnMount?: boolean | "always";
};

type UseFetchResult<T> = {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: FetchErrorKind | false;
  lastRefreshed: Date | null;
  /** Trigger a manual reload. Preserves existing data on failure. */
  reload: () => void;
};

/** Fetch JSON with auth redirect handling. Throws on non-ok responses. */
async function fetchJson(url: string, returnTo?: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal });
  if (handleAuthRedirect(res, returnTo)) {
    throw new DOMException("Auth redirect", "AbortError");
  }
  if (!res.ok) throw new Error("server");
  const json = await parseJsonSafely<Record<string, unknown>>(res);
  if (!json) throw new Error("server");
  return json;
}

/**
 * Shared data-fetching hook backed by React Query.
 *
 * Provides cross-page caching (stale-while-revalidate) while preserving:
 * - Initial load vs refresh distinction (refresh keeps data visible)
 * - 401 → redirect to /login
 * - Classified error state (network / server)
 * - Visibility-based auto-refresh (configurable per consumer)
 * - Last refreshed timestamp
 * - Manual reload trigger
 */
export function useFetch<T = unknown>(options: UseFetchOptions<T>): UseFetchResult<T> {
  const { url, returnTo, refetchOnFocus = true, enabled = true, keepPreviousData = false, refetchOnMount } = options;
  const transformRef = useRef(options.transform);
  transformRef.current = options.transform;

  const {
    data,
    isLoading,
    isFetching,
    error: queryError,
    dataUpdatedAt,
    refetch,
  } = useQuery<Record<string, unknown>, Error, T>({
    queryKey: ["fetch", url],
    queryFn: ({ signal }) => fetchJson(url, returnTo, signal),
    select: (json) => {
      const transform = transformRef.current;
      if (transform) return transform(json);
      return (json.data ?? json) as T;
    },
    refetchOnWindowFocus: refetchOnFocus,
    refetchOnMount,
    enabled,
    placeholderData: keepPreviousData ? (previousData) => previousData : undefined,
  });

  // Toast on background refresh failure (preserves existing behavior)
  const prevFetchingRef = useRef(false);
  useEffect(() => {
    if (prevFetchingRef.current && !isFetching && queryError && data !== undefined) {
      toast.error("Failed to refresh. Your data may be stale.");
    }
    prevFetchingRef.current = isFetching;
  }, [isFetching, queryError, data]);

  return {
    data: data ?? null,
    loading: isLoading,
    refreshing: isFetching && !isLoading,
    error: queryError ? classifyError(queryError) : false,
    lastRefreshed: dataUpdatedAt ? new Date(dataUpdatedAt) : null,
    reload: () => { refetch(); },
  };
}
