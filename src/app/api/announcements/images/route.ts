import { put } from "@vercel/blob";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { imageExtensionForType, publicBlobAuth, validateImage } from "@/lib/blob";

const UPLOAD_LIMIT = { max: 20, windowMs: 5 * 60_000 };

/** Upload one banner image for an announcement (ADMIN only). Returns its public URL. */
export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "announcement", "manage");

  const { allowed } = await checkRateLimit(`announcements:upload:${user.id}`, UPLOAD_LIMIT);
  if (!allowed) throw new HttpError(429, "Too many uploads. Please wait a moment.");

  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file provided");

  // Raster types only, checked by their bytes, so nothing can carry script.
  const problem = await validateImage(file);
  if (problem) throw new HttpError(400, problem);

  const blob = await put(`announcements/${Date.now()}.${imageExtensionForType(file.type)}`, file, {
    ...publicBlobAuth(),
    access: "public",
    contentType: file.type,
    addRandomSuffix: true,
  });

  return ok({ url: blob.url }, 201);
});
