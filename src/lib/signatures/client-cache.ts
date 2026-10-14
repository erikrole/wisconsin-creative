import type { QueryClient } from "@tanstack/react-query";

export const signatureCollectionListQueryKeys = [
  ["fetch", "/api/signatures/collections"],
  ["fetch", "/api/signatures/collections?includeArchived=true"],
] as const;

export function signatureCollectionQueryKey(collectionId: string) {
  return ["fetch", `/api/signatures/collections/${collectionId}`] as const;
}

export async function invalidateSignatureCollectionCaches(
  queryClient: QueryClient,
  collectionId: string,
) {
  // A team member can resolve a Creative Staff capture. The cache does not
  // carry that ownership graph, so stale every Signature roster/bootstrap,
  // without fetching inactive pages or invalidating unrelated app queries.
  await queryClient.invalidateQueries({
    predicate: ({ queryKey }) => queryKey[0] === "fetch"
      && typeof queryKey[1] === "string"
      && (queryKey[1] === signatureCollectionQueryKey(collectionId)[1]
        || /^\/api\/signatures\/collections(?:[/?]|$)/.test(queryKey[1])),
    refetchType: "none",
  });
}
