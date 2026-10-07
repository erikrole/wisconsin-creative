import { QueryClient } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  invalidateSignatureCollectionCaches,
  signatureCollectionListQueryKeys,
  signatureCollectionQueryKey,
} from "@/lib/signatures/client-cache";

describe("Signature client cache freshness", () => {
  it("invalidates the exact detail and both roster-list views without touching other collections", async () => {
    const queryClient = new QueryClient();
    const detailKey = signatureCollectionQueryKey("collection-a");
    const otherDetailKey = signatureCollectionQueryKey("collection-b");

    queryClient.setQueryData(detailKey, { id: "collection-a", complete: 0 });
    queryClient.setQueryData(otherDetailKey, { id: "collection-b", complete: 3 });
    for (const key of signatureCollectionListQueryKeys) {
      queryClient.setQueryData(key, { collections: [] });
    }

    await invalidateSignatureCollectionCaches(queryClient, "collection-a");

    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
    for (const key of signatureCollectionListQueryKeys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(queryClient.getQueryState(otherDetailKey)?.isInvalidated).toBe(false);
  });

  it("wires successful Signature mutations into cache invalidation", () => {
    const detailPage = readFileSync(
      "src/app/(app)/signatures/[id]/SignatureCollectionPage.tsx",
      "utf8",
    );
    const landingPage = readFileSync(
      "src/app/(app)/signatures/SignatureCollectionsPage.tsx",
      "utf8",
    );
    const bootstrapRoute = readFileSync(
      "src/app/api/signatures/collections/[id]/members/[memberId]/route.ts",
      "utf8",
    );

    expect(detailPage).toContain("invalidateSignatureCollectionCaches");
    expect(landingPage).toContain("invalidateSignatureCollectionCaches");
    expect(detailPage).toContain("await invalidateSignatureCollectionCaches(queryClient, collection.id)");
    expect(landingPage).toContain("await invalidateSignatureCollectionCaches(queryClient, preview.collectionId)");
    expect(bootstrapRoute).toContain('requirePermission(user.role, "signature", "capture")');
  });

  it("keeps unsupported actions disabled and readiness bars truthful", () => {
    const landingPage = readFileSync(
      "src/app/(app)/signatures/SignatureCollectionsPage.tsx",
      "utf8",
    );
    const detailPage = readFileSync(
      "src/app/(app)/signatures/[id]/SignatureCollectionPage.tsx",
      "utf8",
    );
    const progress = readFileSync("src/components/ui/progress.tsx", "utf8");

    // Web capture is retired: no iPad gate, no Replace link on the web.
    expect(landingPage).not.toContain("isIpad");
    expect(detailPage).not.toContain("Replace on iPad");
    expect(detailPage).toContain("Boolean(member.artifact)");
    expect(detailPage).toContain('aria-label={`${signatureCollectionTitle(collection.sportCode)} student-athlete readiness`}');
    expect(progress).toContain("value={value}");
  });
});
