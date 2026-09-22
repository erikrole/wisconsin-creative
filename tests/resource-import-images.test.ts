import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@vercel/blob", async (original) => ({ ...await original<typeof import("@vercel/blob")>(), head: vi.fn(), put: vi.fn() }));
import { BlobNotFoundError, head, put } from "@vercel/blob";
import { downloadImportImage, uploadImportImage, validateImportImage, validateImportImageUrl, MAX_IMPORT_IMAGE_BYTES } from "@/lib/resource-import-images";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const file = () => new File([png], "test.png", { type: "image/png" });
const signal = () => AbortSignal.timeout(1000);
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-public-store"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("image origin restrictions", () => {
  it.each([
    "https://evil.example/?x=.public.blob.vercel-storage.com",
    "https://good.public.blob.vercel-storage.com.evil.example/a",
    "https://good.public.blob.vercel-storage.com@127.0.0.1/a",
    "http://lh3.googleusercontent.com/a", "https://lh3.googleusercontent.com:444/a",
    "https://user:pass@lh3.googleusercontent.com/a", "https://127.0.0.1/a",
    "https://googleusercontent.com.evil.example/a", "https://[::1]/a",
  ])("rejects %s", (url) => expect(() => validateImportImageUrl(url)).toThrow());
  it.each(["https://lh3.googleusercontent.com/a", "https://store.public.blob.vercel-storage.com/a"])("accepts %s", (url) => expect(validateImportImageUrl(url).href).toBe(url));
  it("rejects redirect escapes before fetching the next host", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(downloadImportImage("https://lh3.googleusercontent.com/a", "test", signal())).rejects.toThrow("HTTPS");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not trust even a valid Blob URL without checking bytes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<script>bad</script>", { headers: { "content-type": "image/png" } })));
    await expect(downloadImportImage("https://store.public.blob.vercel-storage.com/a", "test", signal())).rejects.toThrow("matching");
  });
});

describe("bounded raster storage", () => {
  it("matches declared MIME to signature", async () => {
    await expect(validateImportImage(file(), "test")).resolves.toBeUndefined();
    await expect(validateImportImage(new File([png], "test.jpg", { type: "image/jpeg" }), "test")).rejects.toThrow("matching");
  });
  it("bounds streamed bytes even without Content-Length", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(MAX_IMPORT_IMAGE_BYTES + 1), { headers: { "content-type": "image/png" } })));
    await expect(downloadImportImage("https://lh3.googleusercontent.com/a", "test", signal())).rejects.toThrow("exceeds");
  });
  it("passes the shared abort signal to each fetch", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(png, { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetcher);
    const abort = signal();
    expect((await downloadImportImage("https://lh3.googleusercontent.com/a", "test", abort)).size).toBe(png.length);
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ signal: abort, redirect: "manual" }));
  });
  it("reuses an existing content-addressed image without uploading", async () => {
    vi.mocked(head).mockResolvedValue({ url: "https://store.public.blob.vercel-storage.com/a", size: png.length, contentType: "image/png" } as never);
    await uploadImportImage(file(), "source:1", "image", signal());
    expect(put).not.toHaveBeenCalled();
  });
  it("uploads on not-found only, not authentication failures", async () => {
    vi.mocked(head).mockRejectedValueOnce(new BlobNotFoundError());
    vi.mocked(put).mockResolvedValue({ url: "https://store.public.blob.vercel-storage.com/a" } as never);
    await uploadImportImage(file(), "source:1", "image", signal());
    expect(put).toHaveBeenCalledTimes(1);
    vi.mocked(head).mockRejectedValueOnce(new Error("Forbidden"));
    await expect(uploadImportImage(file(), "source:1", "image", signal())).rejects.toThrow("Forbidden");
    expect(put).toHaveBeenCalledTimes(1);
  });
});
