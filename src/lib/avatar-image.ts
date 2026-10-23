import sharp from "sharp";
import { validateImage } from "@/lib/blob";
import { HttpError } from "@/lib/http";

/** Normalize orientation, dimensions and metadata for every avatar caller. */
export async function prepareAvatarImage(file: File): Promise<Buffer> {
  if (file.size > 4_000_000) throw new HttpError(400, "Choose a photo under 4 MB, or crop it before uploading.");
  const invalid = await validateImage(file);
  if (invalid) throw new HttpError(400, invalid);
  try {
    return await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000, failOn: "error" })
      .rotate().resize(512, 512, { fit: "cover" }).toColourspace("srgb").webp({ quality: 88 }).toBuffer();
  } catch {
    throw new HttpError(400, "This photo couldn’t be processed. Choose another JPEG, PNG, or WebP photo.");
  }
}
