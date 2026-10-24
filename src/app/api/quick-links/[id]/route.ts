import type { Role } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { quickLinkBody, rolesForAudience } from "@/lib/quick-links";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requireRole } from "@/lib/rbac";

const SELECT = { id: true, label: true, url: true, detail: true, roles: true } as const;

/** Edit a link's name, address, description or audience (ADMIN only). */
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requireRole(user.role, ["ADMIN"]);
  await enforceRateLimit(`quick-links:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = quickLinkBody.parse(await req.json());

  const before = await db.quickLink.findUnique({ where: { id: params.id }, select: SELECT });
  if (!before) throw new HttpError(404, "Link not found");
  const link = await db.quickLink.update({
    where: { id: params.id },
    data: { label: body.label, url: body.url, detail: body.detail ?? null, roles: rolesForAudience(body.audience) as Role[] },
    select: SELECT,
  });
  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "quick_link",
    entityId: link.id,
    action: "updated",
    before,
    after: link,
  });
  return ok({ data: link });
});

/** Remove a link (ADMIN only). */
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requireRole(user.role, ["ADMIN"]);
  await enforceRateLimit(`quick-links:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const before = await db.quickLink.findUnique({ where: { id: params.id }, select: SELECT });
  if (!before) throw new HttpError(404, "Link not found");
  await db.quickLink.delete({ where: { id: params.id } });
  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "quick_link",
    entityId: params.id,
    action: "deleted",
    before,
  });
  return ok({ data: { id: params.id } });
});
