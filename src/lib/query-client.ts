import { QueryClient, type Query } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

const PERSISTED_QUERY_ROOTS = new Set(["dashboard", "booking"]);

export function shouldPersistQueryKey(queryKey: readonly unknown[]) {
  const rootKey = queryKey[0];
  return typeof rootKey === "string" && PERSISTED_QUERY_ROOTS.has(rootKey);
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        // Browsers keep persisted data for 24h. Server clients are request-local:
        // no GC timer should retain a completed request's cache for that long.
        gcTime: typeof window === "undefined" ? Infinity : 24 * 60 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (typeof window === "undefined") return createQueryClient();
  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
}

const QUERY_CACHE_MAX_AGE = 24 * 60 * 60_000;

export const QUERY_CACHE_STORAGE_KEY = "gear-tracker:query-cache";

// Persist selected queries to localStorage so returning users see instant content
// instead of a skeleton on every visit. Only dashboard + booking-detail are
// persisted; list/settings queries are cheap enough to refetch.
export function getQueryPersistOptions() {
  let storage: Storage | undefined;
  try {
    if (typeof window !== "undefined") storage = window.localStorage;
  } catch {
    // Browsers can deny storage access. The persister's no-storage behavior
    // still completes restoration, leaving ordinary in-memory queries usable.
  }
  return {
    persister: createSyncStoragePersister({
      storage,
      key: QUERY_CACHE_STORAGE_KEY,
      throttleTime: 1_000, // write at most once per second
    }),
    maxAge: QUERY_CACHE_MAX_AGE,
    dehydrateOptions: {
      shouldDehydrateQuery: (query: Query) =>
        query.state.status === "success" && shouldPersistQueryKey(query.queryKey),
    },
  };
}
