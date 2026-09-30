import { BH_HERO_IMAGE_SIZE, toBhStaticImageUrl } from "@/lib/bhphoto-image";
import { buildBandHImageSearchQuery } from "@/lib/image-search-modal";
import type { ImageSearchResult } from "@/lib/image-search";
import type { DraftItemImage } from "@/lib/item-image-draft";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";

export type ItemImageSuggestionStatus = "idle" | "loading" | "ready" | "empty" | "unavailable";

type SuggestionOutcome = {
  status: "ready";
  image: DraftItemImage;
} | { status: "empty" | "unavailable"; image: null };

/** Only product-page hero photos can become an automatic catalog thumbnail. */
export function bhProductImageCandidates(results: ImageSearchResult[], query = "") {
  const words = [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])];
  // A category or brand alone cannot identify the product being received.
  if (!words.some(word => /[a-z]/.test(word) && /[0-9]/.test(word))) return [];
  const accessoryWords = ["cage", "case", "kit", "bundle", "adapter", "strap"];
  const requestedAccessories = new Set(words.filter(word => accessoryWords.includes(word)));
  return results.filter((result) => {
    try {
      const page = new URL(result.sourceUrl);
      const titleWords = new Set(result.title.toLowerCase().match(/[a-z0-9]+/g) ?? []);
      if (words.some(word => !titleWords.has(word))) return false;
      if (accessoryWords.some(word => titleWords.has(word) && !requestedAccessories.has(word))) return false;
      return (page.hostname === "bhphotovideo.com" || page.hostname.endsWith(".bhphotovideo.com"))
        && page.pathname.startsWith("/c/product/")
        && Boolean(toBhStaticImageUrl(result.url))
        && !result.url.includes("/multiple_images/");
    } catch {
      return false;
    }
  });
}

function canLoadImage(url: string, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(false); return; }
    const image = new Image();
    const finish = (loaded: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      image.onload = null;
      image.onerror = null;
      if (!loaded) image.src = "";
      resolve(loaded);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), 4000);
    signal.addEventListener("abort", onAbort, { once: true });
    image.referrerPolicy = "no-referrer";
    image.onload = () => finish(image.naturalWidth > 0);
    image.onerror = () => finish(false);
    image.src = url;
  });
}

export async function fetchFirstBhProductImage(query: string, signal: AbortSignal): Promise<SuggestionOutcome> {
  const search = buildBandHImageSearchQuery(query.replace(/\s+/g, " ").trim().slice(0, 175));
  const res = await fetch(`/api/image-search?q=${encodeURIComponent(search)}`, { signal });
  if (handleAuthRedirect(res) || !res.ok) return { status: "unavailable", image: null };
  const json = await parseJsonSafely<{ data?: { configured?: boolean; quotaExceeded?: boolean; failed?: boolean; results?: ImageSearchResult[] } }>(res);
  const data = json?.data;
  if (!data?.configured || data.quotaExceeded || data.failed || !Array.isArray(data.results)) {
    return { status: "unavailable", image: null };
  }
  // Keep provider order, skipping non-product, gallery, and broken images.
  for (const result of bhProductImageCandidates(data.results, query).slice(0, 3)) {
    if (signal.aborted) return { status: "unavailable", image: null };
    const url = toBhStaticImageUrl(result.url, BH_HERO_IMAGE_SIZE)!;
    const thumbnail = toBhStaticImageUrl(result.thumbnailUrl) ?? toBhStaticImageUrl(result.url)!;
    if (await canLoadImage(thumbnail, signal)) {
      return { status: "ready", image: { kind: "remote", url, fallbackUrl: thumbnail, previewUrl: thumbnail } };
    }
  }
  return { status: "empty", image: null };
}
