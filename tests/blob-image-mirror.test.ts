import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  del: vi.fn(),
  fetchPublicUrl: vi.fn(),
  token: "blob-token" as string | undefined,
}));

vi.mock("@vercel/blob", () => ({ put: mocks.put, del: mocks.del }));
vi.mock("@/lib/security/ssrf", () => ({ fetchPublicUrl: mocks.fetchPublicUrl }));
vi.mock("@/lib/env", () => ({ env: { get blobReadWriteToken() { return mocks.token; } } }));

import { deleteImage, downloadImageToBlob, imageExtensionForType, publicBlobAuth, uploadImage } from "@/lib/blob";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1]);
const reply = (body: BodyInit | null, contentType: string | null, status = 200) =>
  new Response(body, { status, headers: contentType ? { "content-type": contentType } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.token = "blob-token";
  mocks.put.mockImplementation(async (pathname: string) => ({ url: `https://x.public.blob.vercel-storage.com/${pathname}` }));
});

describe("downloadImageToBlob", () => {
  it("re-hosts a real image under its detected type", async () => {
    mocks.fetchPublicUrl.mockResolvedValue(reply(PNG, "image/png; charset=binary"));

    const url = await downloadImageToBlob("https://cdn.example.com/lens", "a1");

    expect(url).toMatch(/^https:\/\/x\.public\.blob\.vercel-storage\.com\/assets\/a1\/\d+\.png$/);
    expect(mocks.put).toHaveBeenCalledWith(expect.stringMatching(/^assets\/a1\/\d+\.png$/), expect.any(Buffer), { token: "blob-token", access: "public", contentType: "image/png" });
  });

  it("trusts the bytes over a wrong Content-Type", async () => {
    mocks.fetchPublicUrl.mockResolvedValue(reply(JPEG, "image/png"));

    await downloadImageToBlob("https://cdn.example.com/a.png", "a1");

    expect(mocks.put).toHaveBeenCalledWith(expect.stringMatching(/\.jpg$/), expect.anything(), expect.objectContaining({ contentType: "image/jpeg" }));
  });

  it("refuses a page that only looks like an image by its URL", async () => {
    mocks.fetchPublicUrl.mockResolvedValue(reply("<html><script>alert(1)</script></html>", "text/html"));

    expect(await downloadImageToBlob("https://cdn.example.com/photo.png", "a1")).toBeNull();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("refuses an unknown type with no image extension before reading the body", async () => {
    mocks.fetchPublicUrl.mockResolvedValue(reply(PNG, "application/octet-stream"));

    expect(await downloadImageToBlob("https://cdn.example.com/download", "a1")).toBeNull();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("refuses an error, an empty body and an oversized body", async () => {
    mocks.fetchPublicUrl.mockResolvedValueOnce(reply(PNG, "image/png", 404));
    expect(await downloadImageToBlob("https://cdn.example.com/a.png", "a1")).toBeNull();

    mocks.fetchPublicUrl.mockResolvedValueOnce(reply(new Uint8Array(), "image/png"));
    expect(await downloadImageToBlob("https://cdn.example.com/a.png", "a1")).toBeNull();

    mocks.fetchPublicUrl.mockResolvedValueOnce(reply(PNG, "image/png"));
    expect(await downloadImageToBlob("https://cdn.example.com/a.png", "a1", 8000, 4)).toBeNull();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("asks for images with a browser user agent", async () => {
    mocks.fetchPublicUrl.mockResolvedValue(reply(PNG, "image/png"));

    await downloadImageToBlob("https://cdn.example.com/a.png", "a1");

    const [, init] = mocks.fetchPublicUrl.mock.calls[0]!;
    expect(init.headers.Accept).toMatch(/^image\/jpeg/);
    expect(init.headers["User-Agent"]).toMatch(/^Mozilla\/5\.0/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("logs and returns null when the fetch or upload fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.fetchPublicUrl.mockRejectedValue(new Error("blocked host"));

    expect(await downloadImageToBlob("https://cdn.example.com/a.png", "a1")).toBeNull();
    expect(error).toHaveBeenCalledWith("[blob] Failed to mirror image for asset", "a1", expect.any(Error));
  });
});

describe("blob storage setup", () => {
  it("refuses to store anything without a token", async () => {
    mocks.token = undefined;

    expect(() => publicBlobAuth()).toThrow("Image storage is not configured.");
    await expect(deleteImage("https://x.public.blob.vercel-storage.com/a.png")).rejects.toMatchObject({ status: 503 });
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("uploads under the asset with an extension from the type", async () => {
    const file = new File([PNG], "../../evil.html", { type: "image/webp" });

    await uploadImage(file, "a1");

    expect(mocks.put).toHaveBeenCalledWith(expect.stringMatching(/^assets\/a1\/\d+\.webp$/), expect.anything(), expect.objectContaining({ contentType: "image/webp", access: "public" }));
    expect(imageExtensionForType("image/tiff")).toBe("jpg");
  });

  it("deletes with the token", async () => {
    await deleteImage("https://x.public.blob.vercel-storage.com/a.png");

    expect(mocks.del).toHaveBeenCalledWith("https://x.public.blob.vercel-storage.com/a.png", { token: "blob-token" });
  });
});
