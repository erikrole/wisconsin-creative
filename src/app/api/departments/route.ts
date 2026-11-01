import { z } from "zod";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok, HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "asset", "view");
  const includeInactive = new URL(req.url).searchParams.get("includeInactive") === "1";
  const departments = await db.department.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      active: true,
      _count: {
        select: {
          assets: true,
          bulkSkus: true,
        },
      },
    },
  });

  return ok({ data: departments });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "asset", "edit");
  await enforceRateLimit(`departments:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const body = createSchema.parse(await req.json());

  try {
    const department = await db.department.create({
      data: { name: body.name },
    });

    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "department",
      entityId: department.id,
      action: "created",
      after: { name: department.name },
    });

    return ok({ data: { id: department.id, name: department.name } }, 201);
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError)
      || error.code !== "P2002"
    ) {
      throw error;
    }

    const existing = await db.department.findUnique({
      where: { name: body.name },
    });
    if (!existing) throw new HttpError(409, "Department already exists");
    if (existing.active) throw new HttpError(409, "Department already exists");

    const dept = await db.department.update({
      where: { id: existing.id },
      data: { active: true },
    });
    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "department",
      entityId: dept.id,
      action: "reactivated",
      after: { name: dept.name },
    });
    return ok({ data: { id: dept.id, name: dept.name } }, 200);
  }
});
