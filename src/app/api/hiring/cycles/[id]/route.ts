import { withAuth } from "@/lib/api";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { updateCycleSchema } from "@/lib/hiring/contract";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "hiring", "manage");
  await enforceRateLimit(`hiring:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = updateCycleSchema.parse(await req.json());

  const existing = await db.hiringCycle.findUnique({ where: { id: params.id } });
  if (!existing) throw new HttpError(404, "Hiring cycle not found.");

  // Both terminal statuses end the cycle, so both stamp the retention clock (D-065). A
  // cycle archived straight from Open or Planning must not be left without a close time.
  const terminal = body.status === "CLOSED" || body.status === "ARCHIVED";
  const closing = terminal && !existing.closedAt;
  const reopening = body.status !== undefined && !terminal && Boolean(existing.closedAt);

  await db.$transaction(async (tx) => {
    await tx.hiringCycle.update({
      where: { id: params.id },
      data: {
        status: body.status,
        notes: body.notes === undefined ? undefined : body.notes,
        // The retention clock keys off the actual close time (D-065).
        closedAt: closing ? new Date() : reopening ? null : undefined,
      },
    });
    if (body.slots) {
      await tx.hiringCycleSlot.deleteMany({ where: { cycleId: params.id } });
      if (body.slots.length) {
        await tx.hiringCycleSlot.createMany({
          data: body.slots.map((s) => ({ cycleId: params.id, area: s.area, targetCount: s.targetCount })),
        });
      }
    }

    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "hiring_cycle",
      entityId: params.id,
      action: "update",
      before: { status: existing.status },
      after: { status: body.status ?? existing.status, slotsChanged: Boolean(body.slots) },
    });
  });

  return ok({ data: { id: params.id } });
});
