import { Redis } from "@upstash/redis";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { BH_HERO_IMAGE_SIZE, isBlockedBhImageUrl, toBhStaticImageUrl } from "@/lib/bhphoto-image";
import { env } from "@/lib/env";

type ImageSearchProvider = "brave" | "none";

export type ImageSearchResult = {
  id: string;
  url: string;
  thumbnailUrl: string;
  title: string;
  sourceUrl: string;
  sourceDomain: string;
  width: number | null;
  height: number | null;
};

type ImageSearchOutcome =
  | { status: "ok"; provider: "brave"; results: ImageSearchResult[] }
  | { status: "unconfigured"; provider: "none"; results: [] }
  | { status: "quota"; provider: "brave"; results: [] }
  | { status: "failed"; provider: "brave"; results: [] };

type CacheEntry = {
  expiresAt: number;
  outcome: ImageSearchOutcome;
};

// Bump when result mapping changes: cached outcomes store mapped URLs, so old
// entries would otherwise keep serving pre-fix results until their TTL expires.
const CACHE_VERSION = 2;
const SEARCH_CACHE_TTL_MS = 60 * 60 * 1000;
const QUOTA_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS = 8;
const MIN_LONG_EDGE = 300;

const memoryCache = new Map<string, CacheEntry>();
let redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

export function normalizeImageSearchQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
}

export function getImageSearchProviderName(): ImageSearchProvider {
  return env.braveSearchApiKey ? "brave" : "none";
}

export function isImageSearchConfigured(): boolean {
  return getImageSearchProviderName() !== "none";
}

function getProviderOrNone(): "brave" | null {
  const provider = getImageSearchProviderName();
  return provider === "none" ? null : provider;
}

function cacheKey(provider: "brave", query: string) {
  return `image-search:v${CACHE_VERSION}:${provider}:${query.toLowerCase()}`;
}

async function readCache(key: string): Promise<ImageSearchOutcome | null> {
  const now = Date.now();
  const cached = memoryCache.get(key);
  if (cached) {
    if (cached.expiresAt > now) return cached.outcome;
    memoryCache.delete(key);
  }

  const client = getRedis();
  if (!client) return null;

  try {
    const value = await client.get<CacheEntry>(key);
    if (!value || value.expiresAt <= now) return null;
    memoryCache.set(key, value);
    return value.outcome;
  } catch {
    return null;
  }
}

async function writeCache(key: string, outcome: ImageSearchOutcome): Promise<void> {
  if (outcome.status === "failed" || outcome.status === "unconfigured") return;
  const ttlMs = outcome.status === "quota" ? QUOTA_CACHE_TTL_MS : SEARCH_CACHE_TTL_MS;
  const entry: CacheEntry = { expiresAt: Date.now() + ttlMs, outcome };
  memoryCache.set(key, entry);

  const client = getRedis();
  if (!client) return;

  try {
    await client.set(key, entry, { ex: Math.ceil(ttlMs / 1000) });
  } catch {
    // Cache failure should never make image search fail.
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hostFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isUsableImageUrl(value: string): boolean {
  return value.startsWith("https://");
}

function isLargeEnough(width: number | null, height: number | null): boolean {
  if (width === null && height === null) return true;
  return Math.max(width ?? 0, height ?? 0) >= MIN_LONG_EDGE;
}

function finishResults(candidates: ImageSearchResult[]): ImageSearchResult[] {
  const seenUrls = new Set<string>();
  const seenThumbnails = new Set<string>();
  const results: ImageSearchResult[] = [];

  for (const candidate of candidates) {
    if (!isUsableImageUrl(candidate.url)) continue;
    if (!isLargeEnough(candidate.width, candidate.height)) continue;
    if (seenUrls.has(candidate.url) || seenThumbnails.has(candidate.thumbnailUrl)) continue;
    seenUrls.add(candidate.url);
    if (candidate.thumbnailUrl) seenThumbnails.add(candidate.thumbnailUrl);
    results.push(candidate);
    if (results.length >= MAX_RESULTS) break;
  }

  return results;
}

function mapBraveResults(payload: unknown): ImageSearchResult[] {
  const root = readObject(payload);
  const items = Array.isArray(root.results) ? root.results : [];

  return finishResults(items.map((item, index) => {
    const row = readObject(item);
    const properties = readObject(row.properties);
    const thumbnail = readObject(row.thumbnail);
    const source = readString(row.source);
    const sourceUrl = readString(row.url) || source;
    const rawUrl = readString(properties.url) || readString(row.image) || readString(thumbnail.src);
    // B&H image URLs are Cloudflare-blocked for hotlinking, rehosting, and
    // Brave's thumbnail proxy alike. Product photos get served from the open
    // static.bhphoto.com host instead; B&H images with no open equivalent
    // (Explora blog stills) can never render, so blank the URL and let
    // finishResults' https filter drop the candidate.
    const url = isBlockedBhImageUrl(rawUrl)
      ? ""
      : toBhStaticImageUrl(rawUrl, BH_HERO_IMAGE_SIZE) ?? rawUrl;
    const thumbnailUrl = toBhStaticImageUrl(rawUrl) ?? (readString(thumbnail.src) || url);
    const width = readNumber(properties.width) ?? readNumber(row.width);
    const height = readNumber(properties.height) ?? readNumber(row.height);
    const sourceDomain = hostFromUrl(sourceUrl) || source || hostFromUrl(url);

    return {
      id: `brave-${index}-${url}`,
      url,
      thumbnailUrl,
      title: readString(row.title) || sourceDomain || "Image result",
      sourceUrl,
      sourceDomain,
      width,
      height,
    };
  }));
}

async function searchBrave(query: string): Promise<ImageSearchOutcome> {
  const url = new URL("https://api.search.brave.com/res/v1/images/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "12");
  url.searchParams.set("country", "US");
  url.searchParams.set("search_lang", "en");
  url.searchParams.set("safesearch", "strict");
  url.searchParams.set("spellcheck", "1");

  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": env.braveSearchApiKey,
      },
    });

    if (res.status === 429) return { status: "quota", provider: "brave", results: [] };
    if (!res.ok) return { status: "failed", provider: "brave", results: [] };

    return { status: "ok", provider: "brave", results: mapBraveResults(await res.json()) };
  } catch {
    return { status: "failed", provider: "brave", results: [] };
  }
}

export async function searchProductImages(query: string): Promise<ImageSearchOutcome> {
  const normalizedQuery = normalizeImageSearchQuery(query);
  const provider = getProviderOrNone();

  if (!provider || !normalizedQuery) {
    return { status: "unconfigured", provider: "none", results: [] };
  }

  const key = cacheKey(provider, normalizedQuery);
  const cached = await readCache(key);
  if (cached) return cached;

  const outcome = await searchBrave(normalizedQuery);
  await writeCache(key, outcome);
  return outcome;
}

export function __resetImageSearchCacheForTests() {
  memoryCache.clear();
  redis = undefined;
}
