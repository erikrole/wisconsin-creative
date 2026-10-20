import { QueryClient, type Query } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

const PERSISTED_QUERY_ROOTS = new Set(["dashboard", "booking"]);
export const QUERY_CACHE_MAX_AGE = 24 * 60 * 60_000;
export const TRANSIENT_QUERY_GC_TIME = 5 * 60_000;

export function shouldPersistQueryKey(queryKey: readonly unknown[]) {
  const rootKey = queryKey[0];
  return typeof rootKey === "string" && PERSISTED_QUERY_ROOTS.has(rootKey);
}

export function createQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        // Searches, lists and report variants should not accumulate all day.
        gcTime: TRANSIENT_QUERY_GC_TIME,
        retry: 1,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
    },
  });
  // Only the offline/return-navigation roots need to survive for 24 hours.
  for (const root of PERSISTED_QUERY_ROOTS) {
    client.setQueryDefaults([root], { gcTime: QUERY_CACHE_MAX_AGE });
  }
  return client;
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (typeof window === "undefined") return createQueryClient();
  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
}

export const QUERY_CACHE_STORAGE_KEY = "gear-tracker:query-cache";

// Persist selected queries to localStorage so returning users see instant content
// instead of a skeleton on every visit. Only dashboard + booking-detail are
// persisted; list/settings queries are cheap enough to refetch.
export function getQueryPersistOptions() {
  let storage: Storage | undefined;
  try {
    storage = typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    // Restricted browser storage must not prevent the application mounting.
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
