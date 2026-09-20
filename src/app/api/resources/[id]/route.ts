import { withAuth } from "@/lib/api";
import { ok, HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { getGuide, getGuideBySlug, updateGuide, deleteGuide } from "@/lib/guides";
import { updateGuideSchema } from "@/lib/validation";
import { createAuditEntry } from "@/lib/audit";
import { Role } from "@prisma/client";

// cuid v1 starts with "c" followed by 24 lowercase alphanumerics; slugs use hyphens.
const CUID_RE = /^c[a-z0-9]{24}$/;

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "resource", "view");

  const guide = CUID_RE.test(params.id)
    ? await getGuide(params.id)
    : await getGuideBySlug(params.id);

  // Students cannot access unpublished resources
  if (user.role === Role.STUDENT && !guide.published) {
    throw new HttpError(404, "Resource not found");
  }

  return ok({ data: guide });
});

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "resource", "edit");

  const body = updateGuideSchema.parse(await req.json());
  const before = await getGuide(params.id);
  const updated = await updateGuide(params.id, body, user.role, user.id);

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "resource",
    entityId: params.id,
    action: "resource_updated",
    before: {
      title: before.title,
      type: before.type,
      category: before.category,
      published: before.published,
      featured: before.featured,
      featuredRank: before.featuredRank,
      targetRoles: before.targetRoles,
      targetAreas: before.targetAreas,
      lastVerifiedAt: before.lastVerifiedAt,
      lastVerifiedById: before.lastVerifiedById,
    },
    after: {
      title: updated.title,
      type: updated.type,
      category: updated.category,
      published: updated.published,
      featured: updated.featured,
      featuredRank: updated.featuredRank,
      targetRoles: updated.targetRoles,
      targetAreas: updated.targetAreas,
      lastVerifiedAt: updated.lastVerifiedAt,
      lastVerifiedById: updated.lastVerifiedById,
    },
  });

  return ok({ data: updated });
});

export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "resource", "delete");

  const guide = await getGuide(params.id);
  await deleteGuide(params.id);

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "resource",
    entityId: params.id,
    action: "resource_deleted",
    before: { title: guide.title, type: guide.type, category: guide.category },
  });

  return ok({ data: { deleted: true } });
});
