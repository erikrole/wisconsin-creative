import { withAuth } from "@/lib/api";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { cycleLabel, createCycleSchema } from "@/lib/hiring/contract";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";

export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "hiring", "view");
  const [cycles, stageCounts] = await Promise.all([
    db.hiringCycle.findMany({
      orderBy: [{ year: "desc" }, { term: "asc" }],
      include: { slots: { orderBy: { area: "asc" } } },
    }),
    db.application.groupBy({ by: ["cycleId", "stage"], _count: { _all: true } }),
  ]);

  const counts = new Map<string, Record<string, number>>();
  for (const row of stageCounts) {
    const entry = counts.get(row.cycleId) ?? {};
    entry[row.stage] = row._count._all;
    counts.set(row.cycleId, entry);
  }

  return ok({
    data: cycles.map((cycle) => ({
      id: cycle.id,
      label: cycle.label,
      term: cycle.term,
      year: cycle.year,
      status: cycle.status,
      opensOn: cycle.opensOn,
      closesOn: cycle.closesOn,
      closedAt: cycle.closedAt,
      notes: cycle.notes,
      slots: cycle.slots.map((s) => ({ area: s.area, targetCount: s.targetCount })),
      stageCounts: counts.get(cycle.id) ?? {},
    })),
  });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "hiring", "manage");
  await enforceRateLimit(`hiring:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = createCycleSchema.parse(await req.json());

  // The cycle (with its slots) and its audit entry commit together: a failed audit must not leave
  // a created cycle behind that a retry can only hit as a duplicate.
  const cycle = await db.$transaction(async (tx) => {
    const created = await tx.hiringCycle.create({
    data: {
      label: cycleLabel(body.term, body.year),
      term: body.term,
      year: body.year,
      status: body.status,
      // A cycle created already closed starts its retention clock from its real end date.
      closedAt: body.status === "CLOSED" ? (body.closedOn ?? new Date()) : null,
      notes: body.notes,
      slots: body.slots?.length
        ? { create: body.slots.map((s) => ({ area: s.area, targetCount: s.targetCount })) }
        : undefined,
    },
    });
    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "hiring_cycle",
      entityId: created.id,
      action: "create",
      after: { label: created.label, status: created.status },
    });
    return created;
  });

  return ok({ data: { id: cycle.id, label: cycle.label } }, 201);
});
