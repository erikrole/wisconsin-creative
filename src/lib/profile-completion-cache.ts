import type { QueryClient } from "@tanstack/react-query";

const epochs = new WeakMap<QueryClient, number>();
export const profileCompletionReadEpoch = (client: QueryClient) => epochs.get(client) ?? 0;

/** A read started before a confirmed mutation must never replace its receipt. */
export function advanceProfileCompletionReads(client: QueryClient) {
  epochs.set(client, profileCompletionReadEpoch(client) + 1);
}
