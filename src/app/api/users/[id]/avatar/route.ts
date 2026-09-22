import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { validateImage, deleteImage, imageExtensionForType, isBlobUrl, publicBlobAuth } from "@/lib/blob";
import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { deferCompanionProjectionRefreshForCommittedMutation } from "@/lib/services/companion-projection-publisher";

function assertCanManage(actorId: string, actorRole: string, targetId: string) {
  if (actorId === targetId) return;
  if (actorRole === "ADMIN") return;
  throw new HttpError(403, "Only admins can manage other users' profile photos");
}

/**
 * POST /api/users/[id]/avatar — admins, or the signed-in user, upload a profile photo
 */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { id } = params;
  assertCanManage(user.id, user.role, id);
  await enforceRateLimit(`avatar:ip:${getClientIp(req)}`, { max: 60, windowMs: 60 * 60_000 });
  await enforceRateLimit(`avatar:${user.id}`, { max: 10, windowMs: 60 * 60_000 });

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, avatarUrl: true },
  });
  if (!target) throw new HttpError(404, "User not found");

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new HttpError(400, "Expected multipart file field named 'file'");
  }

  const validationError = await validateImage(file);
  if (validationError) {
    throw new HttpError(400, validationError);
  }

  const ext = imageExtensionForType(file.type);
  const pathname = `avatars/${id}/${Date.now()}.${ext}`;
  const blob = await put(pathname, file.stream(), {
    ...publicBlobAuth(),
    access: "public",
    contentType: file.type,
  });

  let updated;
  try {
    updated = await db.user.update({
      where: { id },
      data: { avatarUrl: blob.url },
      select: { id: true, avatarUrl: true },
    });
  } catch (error) {
    await deleteImage(blob.url).catch(() => {});
    throw error;
  }
  deferCompanionProjectionRefreshForCommittedMutation(req);

  if (target.avatarUrl && isBlobUrl(target.avatarUrl)) {
    await deleteImage(target.avatarUrl).catch(() => {});
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "user_avatar",
    entityId: id,
    action: "avatar_uploaded",
    after: { avatarUrl: updated.avatarUrl },
  });

  return ok({ data: { avatarUrl: updated.avatarUrl } });
});

/**
 * DELETE /api/users/[id]/avatar — admins, or the signed-in user, remove a profile photo
 */
export const DELETE = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { id } = params;
  assertCanManage(user.id, user.role, id);

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, avatarUrl: true },
  });
  if (!target) throw new HttpError(404, "User not found");

  if (!target.avatarUrl) {
    throw new HttpError(400, "No avatar to remove");
  }

  await db.user.update({
    where: { id },
    data: { avatarUrl: null },
  });
  deferCompanionProjectionRefreshForCommittedMutation(req);

  if (isBlobUrl(target.avatarUrl)) {
    await deleteImage(target.avatarUrl).catch(() => {});
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "user_avatar",
    entityId: id,
    action: "avatar_deleted",
    before: { avatarUrl: target.avatarUrl },
  });

  return ok({ data: { avatarUrl: null } });
});
