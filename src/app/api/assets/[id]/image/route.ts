import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { HttpError, ok } from "@/lib/http";
import { validateImage, uploadImage, deleteImage, downloadImageToBlob, isBlobUrl } from "@/lib/blob";
import { enforceRateLimit, IMAGE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { db } from "@/lib/db";

const setImageUrlSchema = z.object({
  url: z.string().url().max(2048),
});

/**
 * POST /api/assets/:id/image — upload or replace an asset image
 */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "asset", "edit");
  await enforceRateLimit(`image-mutation:${user.id}`, IMAGE_MUTATION_LIMIT);

  const { id } = params;

  const asset = await db.asset.findUnique({
    where: { id },
    select: { id: true, imageUrl: true },
  });
  if (!asset) throw new HttpError(404, "Asset not found");

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new HttpError(400, "Expected multipart file field named 'file'");
  }

  const validationError = await validateImage(file);
  if (validationError) {
    throw new HttpError(400, validationError);
  }

  // Upload new image, then point the record at it before touching the old
  // blob — deleting first would leave the asset referencing a dead URL if
  // the update fails.
  const imageUrl = await uploadImage(file, id);

  let updated;
  try {
    updated = await db.asset.update({
      where: { id },
      data: { imageUrl },
      select: { id: true, imageUrl: true },
    });
  } catch (error) {
    await deleteImage(imageUrl).catch(() => {});
    throw error;
  }

  if (asset.imageUrl && isBlobUrl(asset.imageUrl)) {
    await deleteImage(asset.imageUrl).catch(() => {
      // Non-fatal — old blob will be cleaned up eventually
    });
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "asset",
    entityId: id,
    action: "asset_image_uploaded",
    before: { imageUrl: asset.imageUrl },
    after: { imageUrl },
  });

  return ok(updated);
});

/**
 * PUT /api/assets/:id/image — set image from an external URL
 */
export const PUT = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "asset", "edit");
  await enforceRateLimit(`image-mutation:${user.id}`, IMAGE_MUTATION_LIMIT);

  const { id } = params;

  let body: z.infer<typeof setImageUrlSchema>;
  try {
    body = setImageUrlSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new HttpError(400, err.issues.map((e) => e.message).join(", "));
    }
    throw err;
  }

  const url = body.url.trim();

  if (!url.startsWith("https://")) {
    throw new HttpError(400, "A valid HTTPS image URL is required");
  }

  const asset = await db.asset.findUnique({
    where: { id },
    select: { id: true, imageUrl: true },
  });
  if (!asset) throw new HttpError(404, "Asset not found");

  // Download external image to Vercel Blob so we control hosting
  const blobUrl = await downloadImageToBlob(url, id, 5000);
  if (!blobUrl) {
    throw new HttpError(400, "Could not download image from that URL");
  }

  let updated;
  try {
    updated = await db.asset.update({
      where: { id },
      data: { imageUrl: blobUrl },
      select: { id: true, imageUrl: true },
    });
  } catch (error) {
    await deleteImage(blobUrl).catch(() => {});
    throw error;
  }

  // Delete previous blob image only after the record points at the new one
  if (asset.imageUrl && isBlobUrl(asset.imageUrl)) {
    await deleteImage(asset.imageUrl).catch(() => {});
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "asset",
    entityId: id,
    action: "asset_image_set",
    before: { imageUrl: asset.imageUrl },
    after: { imageUrl: blobUrl },
  });

  return ok(updated);
});

/**
 * DELETE /api/assets/:id/image — remove an asset image
 */
export const DELETE = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "asset", "edit");

  const { id } = params;

  const asset = await db.asset.findUnique({
    where: { id },
    select: { id: true, imageUrl: true },
  });
  if (!asset) throw new HttpError(404, "Asset not found");
  if (!asset.imageUrl) throw new HttpError(400, "Asset has no image");

  const updated = await db.asset.update({
    where: { id },
    data: { imageUrl: null },
    select: { id: true, imageUrl: true },
  });

  // Delete from blob storage only after the record no longer references it
  if (isBlobUrl(asset.imageUrl)) {
    await deleteImage(asset.imageUrl).catch(() => {});
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "asset",
    entityId: id,
    action: "asset_image_removed",
    before: { imageUrl: asset.imageUrl },
    after: { imageUrl: null },
  });

  return ok(updated);
});
