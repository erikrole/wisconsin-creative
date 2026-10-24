import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { ok, HttpError } from "@/lib/http";
import { canViewHiddenUsers } from "@/lib/user-visibility";
import { canViewUsageAnalytics } from "@/lib/usage-analytics";

export const GET = withAuth(async (_req, { user }) => {
  // Lets Home show first-weeks guidance without widening the session lookup.
  const account = await db.user.findUnique({ where: { id: user.id }, select: { createdAt: true } });
  return ok({
    user: { ...user, accountCreatedAt: account?.createdAt.toISOString() ?? null },
    canViewHiddenUsers: canViewHiddenUsers(user),
    canViewUsageAnalytics: canViewUsageAnalytics(user),
  });
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).max(128).optional(),
}).refine(
  (data) => {
    if (data.newPassword && !data.currentPassword) return false;
    return true;
  },
  { message: "Current password is required to set a new password" }
);

export const PATCH = withAuth(async (req, { user }) => {
  const body = updateProfileSchema.parse(await req.json());

  const updateData: Record<string, unknown> = {};

  if (body.name) {
    updateData.name = body.name;
  }

  if (body.newPassword && body.currentPassword) {
    const fullUser = await db.user.findUnique({
      where: { id: user.id },
    });
    if (!fullUser) {
      throw new HttpError(404, "User not found");
    }

    const valid = await verifyPassword(fullUser.passwordHash, body.currentPassword);
    if (!valid) {
      throw new HttpError(400, "Current password is incorrect");
    }

    updateData.passwordHash = await hashPassword(body.newPassword);
  }

  if (Object.keys(updateData).length === 0) {
    throw new HttpError(400, "No fields to update");
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: updateData,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      affiliation: true,
      collaboratorProfile: true,
      staffingType: true,
      avatarUrl: true,
    },
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "user",
    entityId: user.id,
    action: "profile_updated",
    after: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.newPassword ? { passwordChanged: true } : {}),
    },
  });

  return ok({ user: updated });
});
