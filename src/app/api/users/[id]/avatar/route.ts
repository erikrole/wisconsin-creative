import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { deleteImage, isBlobUrl, publicBlobAuth } from "@/lib/blob";
import { prepareAvatarImage } from "@/lib/avatar-image";
import { withSerializationRetry } from "@/lib/serialization";
import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import { Prisma, type Role } from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { deferCompanionProjectionRefreshForCommittedMutation } from "@/lib/services/companion-projection-publisher";

function assertCanManage(actorId: string, actorRole: Role, targetId: string) {
  requirePermission(actorRole, "user", "edit_self");
  if (actorId === targetId) return;
  if (actorRole === "ADMIN") return;
  throw new HttpError(403, "Only admins can manage other users' profile photos");
}

function assertExpectedActor(req: Request, userId: string) {
  if (req.headers.has("x-expected-actor-id") && req.headers.get("x-expected-actor-id") !== userId) {
    throw new HttpError(409, "Your sign-in changed. Reopen your profile before changing its photo.");
  }
}

/** Minimal read used to reconcile a photo upload whose response was lost. */
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  assertCanManage(user.id, user.role, params.id);
  const target = await db.user.findUnique({ where: { id: params.id }, select: { id: true, avatarUrl: true } });
  if (!target) throw new HttpError(404, "User not found");
  return ok({ data: target });
});

/**
 * POST /api/users/[id]/avatar — admins, or the signed-in user, upload a profile photo
 */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  assertExpectedActor(req, user.id);
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
  const rawUploadId = formData.get("uploadId");
  if (rawUploadId !== null && (typeof rawUploadId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawUploadId))) {
    throw new HttpError(400, "Invalid photo upload. Choose the photo again.");
  }
  const uploadId = typeof rawUploadId === "string" ? rawUploadId.toLowerCase() : null;
  // The committed URL is also the receipt for a response lost in transit.
  if (uploadId && target.avatarUrl?.includes(`/${uploadId}-`)) return ok({ data: { avatarUrl: target.avatarUrl } });
  if (req.headers.has("x-avatar-url") && req.headers.get("x-avatar-url") !== (target.avatarUrl ?? "")) {
    throw new HttpError(409, "Your photo changed on another device. Cancel and review your current photo before replacing it.");
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new HttpError(400, "Expected multipart file field named 'file'");
  }

  const image = await prepareAvatarImage(file);
  const pathname = `avatars/${id}/${uploadId ?? Date.now()}.webp`;
  const blob = await put(pathname, image, {
    ...publicBlobAuth(),
    access: "public",
    contentType: "image/webp",
    addRandomSuffix: true,
  });

  let updated;
  try {
    updated = await withSerializationRetry(() => db.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id }, select: { avatarUrl: true } });
      if (!before) throw new HttpError(404, "User not found");
      if (before.avatarUrl !== target.avatarUrl) {
        throw new HttpError(409, "Your photo changed while this upload was in progress. Refresh and try again.");
      }
      const next = await tx.user.update({
        where: { id },
        data: { avatarUrl: blob.url },
        select: { id: true, avatarUrl: true },
      });
      await createAuditEntryTx(tx, {
        actorId: user.id,
        actorRole: user.role,
        entityType: "user_avatar",
        entityId: id,
        action: "avatar_uploaded",
        before: { avatarUrl: before.avatarUrl },
        after: { avatarUrl: next.avatarUrl },
      });
      return next;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    await deleteImage(blob.url).catch(() => {});
    throw error;
  }
  deferCompanionProjectionRefreshForCommittedMutation(req);

  if (target.avatarUrl && isBlobUrl(target.avatarUrl)) {
    await deleteImage(target.avatarUrl).catch(() => {});
  }

  return ok({ data: { avatarUrl: updated.avatarUrl } });
});

/**
 * DELETE /api/users/[id]/avatar — admins, or the signed-in user, remove a profile photo
 */
export const DELETE = withAuth<{ id: string }>(async (req, { user, params }) => {
  assertExpectedActor(req, user.id);
  const { id } = params;
  assertCanManage(user.id, user.role, id);

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, avatarUrl: true },
  });
  if (!target) throw new HttpError(404, "User not found");
  if (req.headers.has("x-avatar-url") && req.headers.get("x-avatar-url") !== (target.avatarUrl ?? "")) {
    // A replay after a successful removal is already at the desired state.
    if (target.avatarUrl) throw new HttpError(409, "Your photo changed on another device. Refresh before removing it.");
  }

  if (!target.avatarUrl) {
    return ok({ data: { avatarUrl: null } });
  }

  await withSerializationRetry(() => db.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id }, select: { avatarUrl: true } });
    if (!before || before.avatarUrl !== target.avatarUrl) {
      throw new HttpError(409, "Your photo changed while this request was in progress. Refresh and try again.");
    }
    await tx.user.update({ where: { id }, data: { avatarUrl: null } });
    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "user_avatar",
      entityId: id,
      action: "avatar_deleted",
      before: { avatarUrl: before.avatarUrl },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  deferCompanionProjectionRefreshForCommittedMutation(req);

  if (isBlobUrl(target.avatarUrl)) {
    await deleteImage(target.avatarUrl).catch(() => {});
  }

  return ok({ data: { avatarUrl: null } });
});
