import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prepareAvatarImage } from "@/lib/avatar-image";

describe("avatar image processing", () => {
  it("normalizes a rotated phone JPEG into a square WebP without location metadata", async () => {
    const source = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#bb2233" } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const result = await prepareAvatarImage(new File([new Uint8Array(source)], "phone.jpg", { type: "image/jpeg" }));
    const metadata = await sharp(result).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 512, height: 512 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(result.length).toBeLessThan(100_000);
  });

  it("rejects a truncated image whose header alone passes the raster check", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await expect(prepareAvatarImage(new File([bytes], "broken.jpg", { type: "image/jpeg" }))).rejects.toMatchObject({ status: 400 });
  });

  it("rejects direct uploads above the multipart-safe size limit", async () => {
    await expect(prepareAvatarImage(new File([new Uint8Array(4_000_001)], "large.png", { type: "image/png" }))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("4 MB") });
  });
});
