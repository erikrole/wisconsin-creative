import { QueryClient } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  invalidateSignatureCollectionCaches,
  signatureCollectionListQueryKeys,
  signatureCollectionQueryKey,
} from "@/lib/signatures/client-cache";

describe("Signature client cache freshness", () => {
  it("invalidates shared roster and capture reads without touching unrelated app queries", async () => {
    const queryClient = new QueryClient();
    const detailKey = signatureCollectionQueryKey("collection-a");
    const otherDetailKey = signatureCollectionQueryKey("collection-b");

    const bootstrapKey = ["fetch", "/api/signatures/collections/collection-b/members/member-b"];
    const unrelatedKey = ["fetch", "/api/bookings"];
    queryClient.setQueryData(bootstrapKey, { captureVersion: 0 });
    queryClient.setQueryData(unrelatedKey, { bookings: [] });
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
    expect(queryClient.getQueryState(otherDetailKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(bootstrapKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
  });

  it("wires successful Signature mutations into cache invalidation", () => {
    const capturePage = readFileSync(
      "src/app/(app)/signatures/[id]/capture/[memberId]/SignatureCapturePage.tsx",
      "utf8",
    );
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

    expect(capturePage).toContain("invalidateSignatureCollectionCaches");
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

    expect(landingPage).toContain("if (!isIpad)");
    expect(landingPage).toContain("<Button type=\"button\" size=\"sm\" className=\"h-10\" disabled>");
    expect(detailPage).toContain("Replace on iPad");
    expect(detailPage).toContain("Boolean(member.artifact)");
    expect(detailPage).toContain('aria-label={`${signatureCollectionTitle(collection.sportCode)} student-athlete readiness`}');
    expect(progress).toContain("value={value}");
  });
});
