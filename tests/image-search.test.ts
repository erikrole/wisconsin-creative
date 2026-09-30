import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetImageSearchCacheForTests,
  type ImageSearchResult,
  getImageSearchProviderName,
  isImageSearchConfigured,
  normalizeImageSearchQuery,
  searchProductImages,
} from "@/lib/image-search";
import {
  buildBandHImageSearchQuery,
  buildBandHWebsiteSearchUrl,
  buildBiasedImageSearchQuery,
  buildImageSearchSuggestions,
  mergeImageSearchResults,
} from "@/lib/image-search-modal";

const originalBraveKey = process.env.BRAVE_SEARCH_API_KEY;
const originalUpstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const originalUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const originalKvUrl = process.env.KV_REST_API_URL;
const originalKvToken = process.env.KV_REST_API_TOKEN;

function bravePayload(results: unknown[]) {
  return { results };
}

function braveResult(overrides: Record<string, unknown> = {}) {
  return {
    title: "Sony FX3 product photo",
    url: "https://manufacturer.example/products/fx3",
    source: "Manufacturer",
    thumbnail: { src: "https://images.example/thumb-fx3.jpg" },
    properties: {
      url: "https://images.example/fx3.jpg",
      width: 1200,
      height: 800,
    },
    ...overrides,
  };
}

function mockFetch(status: number, body: unknown = {}) {
  vi.mocked(fetch).mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);
}

function imageResult(overrides: Partial<ImageSearchResult> = {}): ImageSearchResult {
  return {
    id: "result-1",
    url: "https://images.example/result-1.jpg",
    thumbnailUrl: "https://images.example/result-1-thumb.jpg",
    title: "Result 1",
    sourceUrl: "https://source.example/result-1",
    sourceDomain: "source.example",
    width: 1200,
    height: 800,
    ...overrides,
  };
}

describe("image search modal helpers", () => {
  it("opens B&H's own search with the complete model query and no injected parameters", () => {
    const link = new URL(buildBandHWebsiteSearchUrl("  Sony   FX3 & lens #1  ")!);
    expect(link.origin + link.pathname).toBe("https://www.bhphotovideo.com/c/search");
    expect(link.searchParams.get("Ntt")).toBe("Sony FX3 & lens #1");
    expect(link.searchParams.get("N")).toBe("0");
    expect(link.hash).toBe("");
    expect(buildBandHWebsiteSearchUrl("  ")).toBeNull();
  });
  it("builds a broad query with product-photo bias", () => {
    expect(buildBiasedImageSearchQuery("  Sony   FX3  ")).toBe("Sony   FX3 product photo white background");
    expect(buildBiasedImageSearchQuery("Sony FX3 product photo white background")).toBe("Sony FX3 product photo white background");
  });

  it("builds a narrower B&H query without broad white-background bias terms", () => {
    expect(buildBandHImageSearchQuery("  Sony   FX3  ")).toBe("Sony FX3 site:bhphotovideo.com");
  });

  it("builds de-duplicated quick suggestions", () => {
    expect(buildImageSearchSuggestions("Sony FX3")).toEqual([
      "Sony FX3",
      "Sony FX3 product photo",
      "Sony FX3 front",
      "Sony FX3 kit",
    ]);
  });

  it("merges B&H results ahead of broad fallback results and de-dupes", () => {
    const primary = [
      imageResult({ id: "bh-1", url: "https://images.example/bh-1.jpg", thumbnailUrl: "https://images.example/bh-1-thumb.jpg" }),
      imageResult({ id: "bh-2", url: "https://images.example/bh-2.jpg", thumbnailUrl: "https://images.example/shared-thumb.jpg" }),
    ];
    const fallback = [
      imageResult({ id: "dupe-url", url: "https://images.example/bh-1.jpg", thumbnailUrl: "https://images.example/other-thumb.jpg" }),
      imageResult({ id: "dupe-thumb", url: "https://images.example/other.jpg", thumbnailUrl: "https://images.example/shared-thumb.jpg" }),
      imageResult({ id: "broad-1", url: "https://images.example/broad-1.jpg", thumbnailUrl: "https://images.example/broad-1-thumb.jpg" }),
    ];

    expect(mergeImageSearchResults(primary, fallback).map((result) => result.id)).toEqual(["bh-1", "bh-2", "broad-1"]);
  });

  it("limits B&H results when broad fallback should fill the grid", () => {
    const primary = [
      imageResult({ id: "bh-1", url: "https://images.example/bh-1.jpg", thumbnailUrl: "https://images.example/bh-1-thumb.jpg" }),
      imageResult({ id: "bh-2", url: "https://images.example/bh-2.jpg", thumbnailUrl: "https://images.example/bh-2-thumb.jpg" }),
      imageResult({ id: "bh-3", url: "https://images.example/bh-3.jpg", thumbnailUrl: "https://images.example/bh-3-thumb.jpg" }),
      imageResult({ id: "bh-4", url: "https://images.example/bh-4.jpg", thumbnailUrl: "https://images.example/bh-4-thumb.jpg" }),
    ];
    const fallback = [
      imageResult({ id: "broad-1", url: "https://images.example/broad-1.jpg", thumbnailUrl: "https://images.example/broad-1-thumb.jpg" }),
      imageResult({ id: "broad-2", url: "https://images.example/broad-2.jpg", thumbnailUrl: "https://images.example/broad-2-thumb.jpg" }),
    ];

    expect(mergeImageSearchResults(primary, fallback, { primaryLimit: 2 }).map((result) => result.id)).toEqual(["bh-1", "bh-2", "broad-1", "broad-2"]);
  });
});

describe("image search provider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.BRAVE_SEARCH_API_KEY = "";
    process.env.UPSTASH_REDIS_REST_URL = "";
    process.env.UPSTASH_REDIS_REST_TOKEN = "";
    process.env.KV_REST_API_URL = "";
    process.env.KV_REST_API_TOKEN = "";
    __resetImageSearchCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalBraveKey === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = originalBraveKey;
    if (originalUpstashUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUpstashUrl;
    if (originalUpstashToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalUpstashToken;
    if (originalKvUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = originalKvUrl;
    if (originalKvToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = originalKvToken;
    __resetImageSearchCacheForTests();
  });

  it("normalizes query whitespace and caps length", () => {
    expect(normalizeImageSearchQuery("  Sony   FX3\ncamera  ")).toBe("Sony FX3 camera");
    expect(normalizeImageSearchQuery("a".repeat(250))).toHaveLength(200);
  });

  it("reports unconfigured state without calling Brave", async () => {
    await expect(searchProductImages("Sony FX3")).resolves.toEqual({
      status: "unconfigured",
      provider: "none",
      results: [],
    });

    expect(getImageSearchProviderName()).toBe("none");
    expect(isImageSearchConfigured()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps Brave image results and filters unusable candidates", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";
    mockFetch(200, bravePayload([
      braveResult(),
      braveResult({
        title: "duplicate image",
        thumbnail: { src: "https://images.example/other-thumb.jpg" },
        properties: { url: "https://images.example/fx3.jpg", width: 1600, height: 900 },
      }),
      braveResult({
        title: "duplicate thumbnail",
        thumbnail: { src: "https://images.example/thumb-fx3.jpg" },
        properties: { url: "https://images.example/other.jpg", width: 1600, height: 900 },
      }),
      braveResult({
        title: "tiny image",
        thumbnail: { src: "https://images.example/tiny-thumb.jpg" },
        properties: { url: "https://images.example/tiny.jpg", width: 120, height: 120 },
      }),
      braveResult({
        title: "http image",
        thumbnail: { src: "https://images.example/http-thumb.jpg" },
        properties: { url: "http://images.example/http.jpg", width: 1600, height: 900 },
      }),
      braveResult({
        title: "fallback thumbnail image",
        url: "https://retailer.example/fx3",
        source: "",
        thumbnail: { src: "https://images.example/fallback-thumb.jpg" },
        properties: { width: 900, height: 900 },
      }),
    ]));

    const outcome = await searchProductImages("Sony FX3");

    expect(outcome.status).toBe("ok");
    expect(outcome.provider).toBe("brave");
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results[0]).toMatchObject({
      url: "https://images.example/fx3.jpg",
      thumbnailUrl: "https://images.example/thumb-fx3.jpg",
      title: "Sony FX3 product photo",
      sourceUrl: "https://manufacturer.example/products/fx3",
      sourceDomain: "manufacturer.example",
      width: 1200,
      height: 800,
    });
    expect(outcome.results[1]).toMatchObject({
      url: "https://images.example/fallback-thumb.jpg",
      sourceDomain: "retailer.example",
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining("q=Sony+FX3"),
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Subscription-Token": "brave-key",
        }),
      }),
    );
  });

  it("rewrites Cloudflare-blocked B&H image URLs to the open static host", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";
    mockFetch(200, bravePayload([
      braveResult({
        title: "Sony a7 IV at B&H",
        url: "https://www.bhphotovideo.com/c/product/1234-REG/camera.html",
        thumbnail: { src: "https://imgs.search.brave.com/abc/rs:fit:500:0:1:0/g:ce/encoded" },
        properties: {
          url: "https://www.bhphotovideo.com/cdn-cgi/image/fit=scale-down,width=500,quality=95/https://www.bhphotovideo.com/images/images500x500/sony_a7_iv_1722271225_1681602.jpg",
          width: 500,
          height: 500,
        },
      }),
    ]));

    const outcome = await searchProductImages("Sony a7 IV");

    expect(outcome.status).toBe("ok");
    expect(outcome.results[0]).toMatchObject({
      url: "https://static.bhphoto.com/images/images1000x1000/sony_a7_iv_1722271225_1681602.jpg",
      thumbnailUrl: "https://static.bhphoto.com/images/images500x500/sony_a7_iv_1722271225_1681602.jpg",
      sourceDomain: "bhphotovideo.com",
    });
  });

  it("drops B&H Explora images that are blocked on every host", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";
    mockFetch(200, bravePayload([
      braveResult({
        title: "",
        url: "https://www.bhphotovideo.com/explora/photography/hands-on-review",
        thumbnail: { src: "https://imgs.search.brave.com/abc/rs:fit:500:0:1:0/g:ce/encoded" },
        properties: {
          url: "https://static.bhphotovideo.com/explora/sites/default/files/video/_sony-lens-a1.jpg",
          width: 960,
          height: 540,
        },
      }),
      braveResult(),
    ]));

    const outcome = await searchProductImages("Sony FE 70-200mm");

    expect(outcome.status).toBe("ok");
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]).toMatchObject({ url: "https://images.example/fx3.jpg" });
  });

  it("classifies Brave quota responses", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";
    mockFetch(429);

    await expect(searchProductImages("Sony FX3")).resolves.toEqual({
      status: "quota",
      provider: "brave",
      results: [],
    });
  });

  it("serves repeated queries from cache", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";
    mockFetch(200, bravePayload([braveResult()]));

    const first = await searchProductImages("Sony FX3");
    const second = await searchProductImages("Sony   FX3");

    expect(first).toEqual(second);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
