import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadAvatarPhoto, removeAvatarPhoto } from "@/lib/avatar-upload";

afterEach(() => vi.unstubAllGlobals());

describe("photo mutation recovery", () => {
  it("recognizes its committed upload after the POST response is lost", async () => {
    let receipt = "";
    const request = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        const id = (options.body as FormData).get("uploadId");
        receipt = `https://test.public.blob.vercel-storage.com/avatars/student/${id}-suffix.webp`;
        expect(options.headers).toMatchObject({ "x-avatar-url": "", "x-expected-actor-id": "student" });
        throw new TypeError("lost response");
      }
      return Response.json({ data: { id: "student", avatarUrl: receipt } });
    });
    vi.stubGlobal("fetch", request);
    const result = await uploadAvatarPhoto("student", new File(["fixture"], "avatar.webp"), null, "student");
    expect(result).toBe(receipt);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not mistake another device’s photo for its own successful upload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("lost response"))
      .mockResolvedValueOnce(Response.json({ data: { id: "student", avatarUrl: "https://example.test/another-photo.webp" } })));
    await expect(uploadAvatarPhoto("student", new File(["fixture"], "avatar.webp"), null, "student")).rejects.toThrow("lost response");
  });

  it("confirms a lost removal response only when the same account’s photo is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("lost response"))
      .mockResolvedValueOnce(Response.json({ data: { id: "student", avatarUrl: null } })));
    expect(await removeAvatarPhoto("student", "https://example.test/photo.webp", "student")).toBe(true);
  });
});
