import { describe, expect, it, vi } from "vitest";
import { avatarDataUrl } from "@/lib/wrapped/share-image";

const BLOB = "https://abc.public.blob.vercel-storage.com/avatars/me-1.jpg";

function response(init: { ok?: boolean; type?: string; body?: string }) {
  return {
    ok: init.ok ?? true,
    headers: new Headers({ "content-type": init.type ?? "image/jpeg" }),
    arrayBuffer: async () => new TextEncoder().encode(init.body ?? "img").buffer,
  } as unknown as Response;
}

describe("Wrapped share image avatar", () => {
  it("inlines a hosted photo as a data URL", async () => {
    const fetcher = vi.fn(async () => response({ body: "img"}));
    await expect(avatarDataUrl(BLOB, fetcher as unknown as typeof fetch)).resolves.toBe(`data:image/jpeg;base64,${Buffer.from("img").toString("base64")}`);
    expect(fetcher).toHaveBeenCalledWith(BLOB, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("falls back to initials for no photo, a foreign host, a bad reply, or a timeout", async () => {
    const fetcher = vi.fn();
    await expect(avatarDataUrl(null, fetcher)).resolves.toBeNull();
    await expect(avatarDataUrl("https://example.com/me.jpg", fetcher)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(response({ ok: false }));
    await expect(avatarDataUrl(BLOB, fetcher)).resolves.toBeNull();
    fetcher.mockResolvedValueOnce(response({ type: "text/html" }));
    await expect(avatarDataUrl(BLOB, fetcher)).resolves.toBeNull();
    fetcher.mockRejectedValueOnce(new Error("timeout"));
    await expect(avatarDataUrl(BLOB, fetcher)).resolves.toBeNull();
  });
});
