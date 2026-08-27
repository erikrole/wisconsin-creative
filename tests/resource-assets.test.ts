import { describe, expect, it } from "vitest";
import {
  RESOURCE_ASSET_MAX_BYTES,
  normalizeResourceAssetContentType,
  normalizeResourceAssetName,
  normalizedResourceAssetName,
  validateResourceAssetFile,
} from "@/lib/resource-assets";

describe("Brand asset file validation", () => {
  it("normalizes a safe display name without allowing a path", () => {
    expect(normalizeResourceAssetName("exports\\Motion W Primary.pdf")).toBe("Motion W Primary.pdf");
    expect(normalizedResourceAssetName("Motion W Primary.PDF")).toBe("motion w primary.pdf");
  });

  it("normalizes content types and infers a PDF when the browser omits it", () => {
    expect(normalizeResourceAssetContentType("application/pdf; charset=binary")).toBe("application/pdf");
    expect(validateResourceAssetFile({ name: "brand-guide.pdf", sizeBytes: 128 }).contentType).toBe("application/pdf");
  });

  it("accepts supported brand files and rejects unsupported extensions or size", () => {
    expect(validateResourceAssetFile({ name: "Wisconsin-Regular.woff2", contentType: "font/woff2", sizeBytes: 2048 })).toMatchObject({
      name: "Wisconsin-Regular.woff2",
      normalizedName: "wisconsin-regular.woff2",
      contentType: "font/woff2",
    });
    expect(() => validateResourceAssetFile({ name: "secrets.exe", contentType: "application/octet-stream", sizeBytes: 10 })).toThrow(
      "file type is not supported",
    );
    expect(() => validateResourceAssetFile({ name: "large.pdf", contentType: "application/pdf", sizeBytes: RESOURCE_ASSET_MAX_BYTES + 1 })).toThrow(
      "too large",
    );
  });
});

