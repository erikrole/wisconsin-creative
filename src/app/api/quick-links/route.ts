import type { Role } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { canSeeQuickLink, quickLinkBody, quickLinkOrderBody, rolesForAudience } from "@/lib/quick-links";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requireRole } from "@/lib/rbac";

const SELECT = { id: true, label: true, url: true, detail: true, roles: true } as const;

/** Quick links for the sidebar: only the ones the signed-in role may see. Admins pass ?manage=1 for every link. */
export const GET = withAuth(async (req, { user }) => {
  const manage = new URL(req.url).searchParams.get("manage") === "1";
  if (manage) requireRole(user.role, ["ADMIN"]);
  const rows = await db.quickLink.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: SELECT });
  return ok({ data: manage ? rows : rows.filter((row) => canSeeQuickLink(row.roles, user.role)) });
});

/** Add a link at the end of the list (ADMIN only). */
export const POST = withAuth(async (req, { user }) => {
  requireRole(user.role, ["ADMIN"]);
  await enforceRateLimit(`quick-links:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = quickLinkBody.parse(await req.json());

  const last = await db.quickLink.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const link = await db.quickLink.create({
    data: {
      label: body.label,
      url: body.url,
      detail: body.detail ?? null,
      roles: rolesForAudience(body.audience) as Role[],
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    select: SELECT,
  });
  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "quick_link",
    entityId: link.id,
    action: "created",
    after: { label: link.label, url: link.url, roles: link.roles },
  });
  return ok({ data: link }, 201);
});

/** Save a new order: every link's id, top to bottom (ADMIN only). */
export const PUT = withAuth(async (req, { user }) => {
  requireRole(user.role, ["ADMIN"]);
  await enforceRateLimit(`quick-links:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const { ids } = quickLinkOrderBody.parse(await req.json());

  const existing = await db.quickLink.findMany({ select: { id: true } });
  const known = new Set(existing.map((row) => row.id));
  if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new HttpError(409, "The list changed. Reload and try again.");
  }
  await db.$transaction(ids.map((id, index) => db.quickLink.update({ where: { id }, data: { sortOrder: index } })));
  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "quick_link",
    entityId: "order",
    action: "reordered",
    after: { ids },
  });
  return ok({ data: { ids } });
});
