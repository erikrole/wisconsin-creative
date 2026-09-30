import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheNamespace, isolatedIntegrationValue } from "@/lib/environment-safety";
import { env } from "@/lib/env";
import { publicBlobAuth } from "@/lib/blob";
afterEach(() => vi.unstubAllEnvs());
describe("preview side-effect isolation", () => {
  it("cannot fall back to a production Blob token or automatic SDK credentials", () => {
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("BLOB_READ_WRITE_TOKEN", "production-token");
    vi.stubEnv("WC_PREVIEW_KEY", "827cf3c97bc7813dbc21"); vi.stubEnv("WC_PREVIEW_BLOB_READ_WRITE_TOKEN", "");
    expect(isolatedIntegrationValue("BLOB_READ_WRITE_TOKEN")).toBe(""); expect(() => publicBlobAuth()).toThrow("not configured");
    vi.stubEnv("WC_PREVIEW_BLOB_READ_WRITE_TOKEN", "isolated-token"); expect(publicBlobAuth()).toEqual({ token: "isolated-token" });
  });
  it("enables preview image lookup only with an isolated search key", () => {
    vi.stubEnv("WC_ENVIRONMENT", "preview");
    vi.stubEnv("WC_PREVIEW_KEY", "827cf3c97bc7813dbc21");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "production-search-key");
    vi.stubEnv("WC_PREVIEW_BRAVE_SEARCH_API_KEY", "");
    expect(env.braveSearchApiKey).toBe("");
    vi.stubEnv("WC_PREVIEW_BRAVE_SEARCH_API_KEY", "preview-search-key");
    expect(env.braveSearchApiKey).toBe("preview-search-key");
  });
  it("separates cache keys by branch and refuses malformed branch credentials", () => {
    vi.stubEnv("WC_ENVIRONMENT", "preview"); vi.stubEnv("WC_PREVIEW_KEY", "827cf3c97bc7813dbc21");
    expect(cacheNamespace("limits")).toBe("wc-preview:827cf3c97bc7813dbc21:limits");
    vi.stubEnv("WC_PREVIEW_KEY", "../production"); vi.stubEnv("WC_PREVIEW_BLOB_READ_WRITE_TOKEN", "wrong-branch");
    expect(isolatedIntegrationValue("BLOB_READ_WRITE_TOKEN")).toBe("");
  });
});
