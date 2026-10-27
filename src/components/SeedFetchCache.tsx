"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { FetchSeed, QuerySeed } from "@/lib/server-seed";

const seededKeys = new WeakMap<QueryClient, Set<string>>();

function markFor(key: readonly unknown[]) {
  return JSON.stringify(key);
}

/** True once for a query whose cached response came from the server render; the first reader takes the mark. */
export function takeSeededKey(client: QueryClient, key: readonly unknown[]) {
  return seededKeys.get(client)?.delete(markFor(key)) ?? false;
}

/** Like `takeSeededKey` for a `useFetch` URL. */
export function takeSeeded(client: QueryClient, url: string) {
  return takeSeededKey(client, ["fetch", url]);
}

/** Looks at the mark without taking it. */
export function peekSeededKey(client: QueryClient, key: readonly unknown[]) {
  return seededKeys.get(client)?.has(markFor(key)) ?? false;
}

/**
 * Puts responses the server read into the query cache before the page below renders, so the server HTML and
 * the first browser render both start with the data. Existing cache entries are never overwritten. `seeds`
 * are raw responses for `useFetch` URLs; `queries` are values for other query keys, already in the shape
 * their query function returns.
 */
export function SeedFetchCache({
  seeds = [],
  queries = [],
  children,
}: {
  seeds?: (FetchSeed | null)[];
  queries?: (QuerySeed | null)[];
  children: React.ReactNode;
}) {
  const client = useQueryClient();
  const all: QuerySeed[] = [
    ...seeds.flatMap((seed) => (seed ? [{ key: ["fetch", seed.url], data: seed.json, fetchedAt: seed.fetchedAt }] : [])),
    ...queries.flatMap((query) => (query ? [query] : [])),
  ];
  for (const seed of all) {
    if (client.getQueryData(seed.key) !== undefined) continue;
    client.setQueryData(seed.key, seed.data, { updatedAt: seed.fetchedAt });
    const marks = seededKeys.get(client) ?? new Set<string>();
    marks.add(markFor(seed.key));
    seededKeys.set(client, marks);
  }
  return children;
}
