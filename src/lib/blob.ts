import { put, del } from "@vercel/blob";
import { toBhStaticImageUrl } from "@/lib/bhphoto-image";
import { fetchPublicUrl } from "@/lib/security/ssrf";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";

export function publicBlobAuth(): { token: string } {
  const token = env.blobReadWriteToken;
  if (!token) throw new HttpError(503, "Image storage is not configured.");
  return { token };
}

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_SIZE = 4.5 * 1024 * 1024; // 4.5 MB (Vercel serverless body limit)

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function isAllowedImageType(type: string): boolean {
  return ALLOWED_TYPES.has(type);
}

/**
 * The image type a file's leading bytes actually carry, or null. Lets uploads
 * and mirrored downloads trust the content rather than a client-supplied
 * `file.type` or a remote server's Content-Type, so HTML/SVG/script can't be
 * stored under an image name. Covers the four types we accept.
 */
function imageTypeFromMagic(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  // GIF: 47 49 46 38 ("GIF8")
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  // WebP: "RIFF"...."WEBP"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** Verify the file's leading bytes match a real raster-image signature. */
export async function hasValidImageMagic(file: File): Promise<boolean> {
  return imageTypeFromMagic(new Uint8Array(await file.slice(0, 12).arrayBuffer())) !== null;
}

export async function validateImage(file: File): Promise<string | null> {
  if (!ALLOWED_TYPES.has(file.type)) {
    return "File must be JPEG, PNG, WebP, or GIF";
  }
  if (file.size > MAX_SIZE) {
    return "File must be under 4.5 MB";
  }
  if (!(await hasValidImageMagic(file))) {
    return "File contents are not a valid image";
  }
  return null;
}

export function isBlobUrl(url: string): boolean {
  return url.includes(".public.blob.vercel-storage.com");
}

/**
 * Extension for a validated upload, derived from the (already whitelisted)
 * MIME type. Never derive it from `file.name` — the multipart filename is
 * client-controlled and would flow into the blob pathname.
 */
export function imageExtensionForType(type: string): string {
  return CONTENT_TYPE_TO_EXT[type] ?? "jpg";
}

export async function uploadImage(
  file: File,
  assetId: string
): Promise<string> {
  const ext = imageExtensionForType(file.type);
  const pathname = `assets/${assetId}/${Date.now()}.${ext}`;

  const blob = await put(pathname, file.stream(), {
    ...publicBlobAuth(),
    access: "public",
    contentType: file.type,
  });

  return blob.url;
}

/**
 * Download an external image and re-host it on Vercel Blob.
 * Returns the blob URL, or null if download fails.
 */
export async function downloadImageToBlob(
  url: string,
  assetId: string,
  timeoutMs = 8000,
  maxBytes = MAX_SIZE
): Promise<string | null> {
  // Already hosted — nothing to do
  if (isBlobUrl(url)) return url;

  // B&H image hosts 403 server-side fetches; the same files are open on
  // static.bhphoto.com.
  url = toBhStaticImageUrl(url) ?? url;

  try {
    // SSRF guard: only http(s), and reject hosts that resolve to private,
    // loopback, or link-local (incl. cloud metadata) addresses before fetching.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Some image CDNs reject the default undici user agent outright.
    const res = await fetchPublicUrl(url, {
      signal: controller.signal,
      headers: {
        Accept: "image/jpeg,image/png,image/webp,image/gif,image/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    const ext = CONTENT_TYPE_TO_EXT[contentType] ?? extFromUrl(url);
    if (!ext) return null; // unrecognised image type

    const body = await res.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > maxBytes) return null;
    // Store what the bytes are, not what the remote server claims.
    const detectedType = imageTypeFromMagic(new Uint8Array(body, 0, Math.min(12, body.byteLength)));
    if (!detectedType) return null;

    const pathname = `assets/${assetId}/${Date.now()}.${CONTENT_TYPE_TO_EXT[detectedType]}`;
    const blob = await put(pathname, Buffer.from(body), {
      ...publicBlobAuth(),
      access: "public",
      contentType: detectedType,
    });

    return blob.url;
  } catch (err) {
    console.error("[blob] Failed to mirror image for asset", assetId, err);
    return null;
  }
}

function extFromUrl(url: string): string | null {
  const match = url.match(/\.(jpe?g|png|webp|gif)(\?|$)/i);
  if (!match) return null;
  return match[1]!.toLowerCase().replace("jpeg", "jpg"); // capture group 1 always present when regex matches
}

export async function deleteImage(url: string): Promise<void> {
  await del(url, publicBlobAuth());
}
