import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFirstBhProductImage } from "@/lib/item-image-suggestion";

const loaded: string[] = [];
class PreviewImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 500;
  referrerPolicy = "";
  set src(url: string) {
    if (!url) return;
    loaded.push(url);
    queueMicrotask(() => url.includes("broken") ? this.onerror?.() : this.onload?.());
  }
}
function result(file: string, source = "https://www.bhphotovideo.com/c/product/123-REG/camera.html") {
  return { id: file, title: "Sony FX3 Camera", sourceUrl: source, sourceDomain: "bhphotovideo.com", width: 500, height: 500,
    url: `https://www.bhphotovideo.com/images/images500x500/${file}.jpg`, thumbnailUrl: `https://www.bhphotovideo.com/images/images500x500/${file}.jpg` };
}
function response(data: unknown) {
  loaded.length = 0;
  vi.stubGlobal("Image", PreviewImage);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }))));
}
afterEach(() => vi.unstubAllGlobals());

describe("automatic B&H item photos", () => {
  it("leaves generic names for manual selection instead of guessing a model", async () => {
    response({ configured: true, results: [result("camera")] });
    await expect(fetchFirstBhProductImage("Sony camera", new AbortController().signal)).resolves.toEqual({ status: "empty", image: null });
    expect(loaded).toEqual([]);
  });
  it("does not automatically choose a different model or an accessory for the requested camera", async () => {
    const wrongModel = { ...result("wrong-model"), title: "Sony FX30 Camera" };
    const cage = { ...result("cage"), title: "Sony FX3 Camera Cage" };
    response({ configured: true, results: [wrongModel, cage, result("correct")] });
    const outcome = await fetchFirstBhProductImage("Sony FX3", new AbortController().signal);
    expect(outcome).toMatchObject({ status: "ready", image: { url: "https://static.bhphoto.com/images/images1000x1000/correct.jpg" } });
    expect(loaded).toEqual(["https://static.bhphoto.com/images/images500x500/correct.jpg"]);
  });
  it("selects the first usable product hero, skipping unrelated, gallery, and broken photos", async () => {
    const gallery = result("gallery"); gallery.url = "https://static.bhphoto.com/images/multiple_images/images500x500/gallery.jpg";
    response({ configured: true, results: [result("other", "https://notbhphotovideo.com/c/product/123.html"), gallery, result("broken"), result("first"), result("later")] });
    const outcome = await fetchFirstBhProductImage("Sony FX3", new AbortController().signal);
    expect(outcome).toEqual({ status: "ready", image: { kind: "remote", url: "https://static.bhphoto.com/images/images1000x1000/first.jpg", fallbackUrl: "https://static.bhphoto.com/images/images500x500/first.jpg", previewUrl: "https://static.bhphoto.com/images/images500x500/first.jpg" } });
    expect(loaded).toEqual(["https://static.bhphoto.com/images/images500x500/broken.jpg", "https://static.bhphoto.com/images/images500x500/first.jpg"]);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain("site%3Abhphotovideo.com");
  });
  it.each([{ configured: false }, { configured: true, quotaExceeded: true }, { configured: true, failed: true }])("degrades when the search cannot run: %j", async data => {
    response({ ...data, results: [result("first")] });
    await expect(fetchFirstBhProductImage("Sony FX3", new AbortController().signal)).resolves.toEqual({ status: "unavailable", image: null });
    expect(loaded).toEqual([]);
  });
  it("leaves the item without a photo when no B&H product image is found", async () => {
    response({ configured: true, results: [result("blog", "https://www.bhphotovideo.com/explora/camera")] });
    await expect(fetchFirstBhProductImage("Sony FX3", new AbortController().signal)).resolves.toEqual({ status: "empty", image: null });
    expect(loaded).toEqual([]);
  });
});
