"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { FetchSeed } from "@/lib/server-seed";

const seededUrls = new WeakMap<QueryClient, Set<string>>();

/** True once for a URL whose cached response came from the server render; the first reader takes the mark. */
export function takeSeeded(client: QueryClient, url: string) {
  return seededUrls.get(client)?.delete(url) ?? false;
}

/**
 * Puts responses the server read into the cache `useFetch` uses, before the page below renders, so the server
 * HTML and the first browser render both start with the data. Existing cache entries are never overwritten.
 */
export function SeedFetchCache({ seeds, children }: { seeds: (FetchSeed | null)[]; children: React.ReactNode }) {
  const client = useQueryClient();
  for (const seed of seeds) {
    if (!seed || client.getQueryData(["fetch", seed.url]) !== undefined) continue;
    client.setQueryData(["fetch", seed.url], seed.json, { updatedAt: seed.fetchedAt });
    const urls = seededUrls.get(client) ?? new Set<string>();
    urls.add(seed.url);
    seededUrls.set(client, urls);
  }
  return children;
}
