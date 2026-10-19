import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok, HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";

const createSourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url()
});

export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "calendar_source", "view");
  const sources = await db.calendarSource.findMany({
    orderBy: { name: "asc" },
    take: 100,
    include: { _count: { select: { events: true } } }
  });
  return ok({ data: sources });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "calendar_source", "create");
  await enforceRateLimit(`calendar-sources:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = createSourceSchema.parse(await req.json());

  // Prevent duplicate sources with the same URL
  const existing = await db.calendarSource.findFirst({
    where: { url: body.url },
  });
  if (existing) {
    throw new HttpError(409, `A calendar source with this URL already exists ("${existing.name}")`);
  }

  const source = await db.calendarSource.create({
    data: { name: body.name, url: body.url }
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "calendar_source",
    entityId: source.id,
    action: "create",
    after: { name: body.name },
  });

  return ok({ data: source }, 201);
});
