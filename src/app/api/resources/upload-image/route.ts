import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { put } from "@vercel/blob";
import { ok, HttpError } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { isAllowedImageType, hasValidImageMagic, publicBlobAuth } from "@/lib/blob";

const UPLOAD_LIMIT = { max: 30, windowMs: 5 * 60_000 };

function sanitizeFileName(name: string) {
  const leaf = name.split(/[\\/]/).pop() || "image";
  const sanitized = leaf.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 120);
  return sanitized || "image";
}

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "resource", "edit");

  const { allowed } = await checkRateLimit(`resource:upload:${user.id}`, UPLOAD_LIMIT);
  if (!allowed) {
    throw new HttpError(429, "Too many uploads. Please wait a moment.");
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new HttpError(400, "No file provided");
  }

  // Restrict to raster image types (no SVG — SVG can carry script) and verify
  // the bytes match, so a client can't smuggle HTML/script via a faked mime.
  if (!isAllowedImageType(file.type)) {
    throw new HttpError(400, "File must be JPEG, PNG, WebP, or GIF");
  }

  // 10MB limit per image
  if (file.size > 10 * 1024 * 1024) {
    throw new HttpError(413, "Image too large (max 10MB)");
  }

  if (!(await hasValidImageMagic(file))) {
    throw new HttpError(400, "File contents are not a valid image");
  }

  const blob = await put(`resources/${Date.now()}-${sanitizeFileName(file.name)}`, file, {
    ...publicBlobAuth(),
    access: "public",
  });

  return ok({ url: blob.url });
});
