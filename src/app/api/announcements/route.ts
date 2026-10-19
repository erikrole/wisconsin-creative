import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { announcementCreateBody } from "@/lib/schemas/announcements";
import type { Role } from "@prisma/client";
import { ANNOUNCEMENT_ROLES, announcementState } from "@/lib/announcements";

/** All announcements with how many people have dismissed each (ADMIN only). */
export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "announcement", "manage");

  const [rows, roleCounts] = await Promise.all([
    db.announcement.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      include: {
        createdBy: { select: { name: true } },
        _count: { select: { dismissals: true } },
      },
    }),
    db.user.groupBy({ by: ["role"], where: { active: true }, _count: { _all: true } }),
  ]);

  // Reach is "of the active people this could show to"; collaborators never see announcements.
  const activeByRole = new Map(roleCounts.map((r) => [r.role, r._count._all]));
  const audienceSize = (roles: Role[]) =>
    (roles.length ? roles : ANNOUNCEMENT_ROLES).reduce((sum, role) => sum + (activeByRole.get(role) ?? 0), 0);

  const now = new Date();
  const data = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    ctaLabel: r.ctaLabel,
    ctaUrl: r.ctaUrl,
    imageUrls: r.imageUrls,
    imageAlt: r.imageAlt,
    roles: r.roles,
    showOnWeb: r.showOnWeb,
    showOnIos: r.showOnIos,
    publishedAt: r.publishedAt,
    endsAt: r.endsAt,
    createdAt: r.createdAt,
    createdByName: r.createdBy.name,
    seenCount: r._count.dismissals,
    audienceSize: audienceSize(r.roles),
    state: announcementState(r, now),
  }));

  return ok({ data });
});

/** Create an announcement as a draft, or publish it straight away (ADMIN only). */
export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "announcement", "manage");
  await enforceRateLimit(`announcements:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const { publish, ...input } = announcementCreateBody.parse(await req.json());

  const created = await db.announcement.create({
    data: {
      ...input,
      ctaLabel: input.ctaLabel ?? null,
      ctaUrl: input.ctaUrl ?? null,
      imageAlt: input.imageAlt ?? null,
      endsAt: input.endsAt ?? null,
      publishedAt: publish ? new Date() : null,
      createdById: user.id,
    },
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "announcement",
    entityId: created.id,
    action: publish ? "publish" : "create",
    after: { title: created.title, kind: created.kind, roles: created.roles, publishedAt: created.publishedAt },
  });

  return ok({ id: created.id }, 201);
});
