import { createHash } from "node:crypto";
import { BlobNotFoundError, head, put } from "@vercel/blob";
import { HttpError } from "@/lib/http";
import { publicBlobAuth } from "@/lib/blob";

export const MAX_IMPORT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

// Provider-scoped, never a generic URL proxy. Other hosts must use files.
// Revalidate every redirect; a substring anywhere in a URL is not trust.
export function validateImportImageUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || !(/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname)
      || /^(?:[a-z0-9-]+\.)*googleusercontent\.com$/.test(url.hostname))) {
    throw new HttpError(400, "Remote images must use HTTPS Googleusercontent or public Vercel Blob URLs. Attach other images as files.");
  }
  return url;
}

export async function validateImportImage(file: File, key: string): Promise<void> {
  if (!file.size || file.size > MAX_IMPORT_IMAGE_BYTES) {
    throw new HttpError(413, `Image ${key} must be between 1 byte and 10MB`);
  }
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const is = (...bytes: number[]) => bytes.every((value, index) => b[index] === value);
  const valid = b.length >= 12 && (
    (file.type === "image/png" && is(137, 80, 78, 71, 13, 10, 26, 10))
    || (file.type === "image/jpeg" && is(255, 216, 255))
    || (file.type === "image/gif" && (is(71, 73, 70, 56, 55, 97) || is(71, 73, 70, 56, 57, 97)))
    || (file.type === "image/webp" && is(82, 73, 70, 70)
      && b[8] === 87 && b[9] === 69 && b[10] === 66 && b[11] === 80)
  );
  if (!valid) throw new HttpError(400, `Image ${key} must have matching JPEG, PNG, WebP, or GIF content and MIME type`);
}

export async function downloadImportImage(value: string, key: string, signal: AbortSignal): Promise<File> {
  let url = validateImportImageUrl(value);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetch(url, { redirect: "manual", signal,
      headers: { Accept: "image/jpeg,image/png,image/webp,image/gif" } });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirect === 3) break;
      url = validateImportImageUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      break;
    }
    const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]).has(type)
      || Number(response.headers.get("content-length")) > MAX_IMPORT_IMAGE_BYTES) {
      await response.body.cancel();
      throw new HttpError(422, `Image ${key} has an unsupported type or exceeds 10MB`);
    }
    const reader = response.body.getReader();
    const parts: ArrayBuffer[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMPORT_IMAGE_BYTES) throw new HttpError(413, `Image ${key} exceeds 10MB`);
        parts.push(Uint8Array.from(value).buffer);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const file = new File(parts, key, { type });
    await validateImportImage(file, key);
    return file;
  }
  throw new HttpError(422, `Could not download image ${key}`);
}

export async function uploadImportImage(file: File, importKey: string, key: string, signal: AbortSignal): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const namespace = createHash("sha256").update(importKey).digest("hex").slice(0, 24);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[file.type];
  const pathname = `resources/imports/${namespace}/${key}-${digest}.${extension}`;
  try {
    const existing = await head(pathname, { ...publicBlobAuth(), abortSignal: signal });
    if (existing.size !== bytes.length || existing.contentType !== file.type) {
      throw new HttpError(409, `Stored image ${key} does not match its content identity`);
    }
    return existing.url;
  } catch (error) {
    if (!(error instanceof BlobNotFoundError)) throw error;
  }
  const blob = await put(pathname, bytes, {
    ...publicBlobAuth(),
    access: "public", contentType: file.type, addRandomSuffix: false,
    // Same identity means identical bytes, including concurrent retries.
    allowOverwrite: true, abortSignal: signal,
  });
  return blob.url;
}
