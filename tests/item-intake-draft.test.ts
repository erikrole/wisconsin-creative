import { describe, expect, it } from "vitest";
import { readIntakeDraft, requestForPayload } from "@/lib/item-intake-draft";
describe("receiving recovery", () => {
  it("retains the same request across serialization, but assigns a new request to changed details", () => {
    const requests: Parameters<typeof requestForPayload>[0] = [];
    const first = requestForPayload(requests, "/api/bulk-skus/family/units", { count: 3 });
    const recovered = JSON.parse(JSON.stringify(requests));
    expect(requestForPayload(recovered, first.url, { count: 3 }).key).toBe(first.key);
    expect(requestForPayload(recovered, first.url, { count: 4 }).key).not.toBe(first.key);
  });
  it("restores receiving mode and remote image, and rejects corrupt, expired, or unsupported drafts", () => {
    const draft = { version: 1, kind: "units", savedAt: Date.now(), uncertain: true, requests: [], image: { kind: "remote", url: "https://static.bhphoto.com/image.jpg", previewUrl: "https://static.bhphoto.com/image.jpg" }, bulk: { bulkMode: "existing", bulkName: "FX6 Battery", categoryId: "", locationId: "", bulkQrCode: "", initialQuantity: "1", selectedBulkSkuId: "family", addQty: "3", emptyFamily: false } };
    expect(readIntakeDraft(JSON.stringify(draft))).toMatchObject({ kind: "units", uncertain: true, bulk: { selectedBulkSkuId: "family", addQty: "3" }, image: { url: draft.image.url } });
    for (const raw of ["broken", JSON.stringify({ ...draft, version: 2 }), JSON.stringify({ ...draft, savedAt: Date.now() - 8 * 86400_000 }), JSON.stringify({ ...draft, image: { kind: "file", previewUrl: "data:secret" } })]) expect(readIntakeDraft(raw)).toBeNull();
  });
});
