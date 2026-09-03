import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok, HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { updateShiftGroupSchema } from "@/lib/validation";
import { createAuditEntry } from "@/lib/audit";
import { getSchedulePublicationState } from "@/lib/services/schedule-publication";
import { studentCallTimeAppliesToEvent } from "@/lib/shift-call-windows";

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "shift", "view");
  const { id } = params;

  const group = await db.shiftGroup.findUnique({
    where: { id },
    include: {
      event: true,
      shifts: {
        include: {
          assignments: {
            include: {
              user: { select: { id: true, name: true, email: true, role: true, staffingType: true, primaryArea: true } },
              assigner: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: [{ area: "asc" }, { workerType: "asc" }],
      },
      workingCopy: { select: { version: true, autoReleaseAt: true, autoReleaseError: true } },
    },
  });

  if (!group) throw new HttpError(404, "Shift group not found");
  const { workingCopy, ...groupData } = group;
  const staffCanSeeWorkingState = user.role === "ADMIN" || user.role === "STAFF";
  const studentCallTimeVisible = user.role !== "STUDENT"
    || (!group.event.allDay && studentCallTimeAppliesToEvent(group.event));
  const responseGroup = user.role === "STUDENT"
    ? {
        ...groupData,
        shifts: groupData.shifts.map((shift) => ({
          ...shift,
          callStartsAt: shift.workerType === "ST" && studentCallTimeVisible ? shift.callStartsAt : null,
          callEndsAt: shift.workerType === "ST" && studentCallTimeVisible ? shift.callEndsAt : null,
          assignments: shift.assignments.map((assignment) => ({
            ...assignment,
            callStartsAt: shift.workerType === "ST" && studentCallTimeVisible ? assignment.callStartsAt : null,
            callEndsAt: shift.workerType === "ST" && studentCallTimeVisible ? assignment.callEndsAt : null,
            callNote: shift.workerType === "ST" && studentCallTimeVisible ? assignment.callNote : null,
          })),
        })),
      }
    : groupData;
  const pendingRelease = staffCanSeeWorkingState && workingCopy
    ? {
        autoReleaseAt: workingCopy.autoReleaseAt?.toISOString() ?? null,
        autoReleaseError: workingCopy.autoReleaseError,
      }
    : null;
  return ok({
    data: {
      ...responseGroup,
      hasWorkingCopy: staffCanSeeWorkingState ? Boolean(workingCopy) : undefined,
      autoReleaseAt: pendingRelease?.autoReleaseAt,
      autoReleaseError: pendingRelease?.autoReleaseError,
      publication: getSchedulePublicationState(group),
    },
  });
});

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "shift", "edit");
  const { id } = params;

  const body = updateShiftGroupSchema.parse(await req.json());

  const { updated, before } = await db.$transaction(async (tx) => {
    const existing = await tx.shiftGroup.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Shift group not found");

    const patchData: Record<string, unknown> = {};
    if (body.notes !== undefined) patchData.notes = body.notes;
    patchData.manuallyEdited = true;

    const result = await tx.shiftGroup.update({
      where: { id },
      data: patchData,
      include: {
        event: true,
        shifts: {
          include: {
            assignments: {
              include: {
                user: { select: { id: true, name: true, email: true, role: true, staffingType: true, primaryArea: true } },
                assigner: { select: { id: true, name: true } },
              },
              orderBy: { createdAt: "desc" },
            },
          },
          orderBy: [{ area: "asc" }, { workerType: "asc" }],
        },
      },
    });

    return {
      updated: result,
      before: { notes: existing.notes },
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "shift_group",
    entityId: id,
    action: "shift_group_updated",
    before,
    after: { notes: updated.notes },
  });

  return ok({ data: { ...updated, publication: getSchedulePublicationState(updated) } });
});
