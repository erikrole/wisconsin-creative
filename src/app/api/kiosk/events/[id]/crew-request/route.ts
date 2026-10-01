import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { createAuditEntryTx } from "@/lib/audit";
import { getAllowedRoles } from "@/lib/permissions";
import { withSerializationRetry } from "@/lib/serialization";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { requireKioskActor } from "@/lib/services/kiosk-actor";
import { pickupOpenShiftTx } from "@/lib/services/schedule-open-work";
import { deferPush, dispatchScheduleAssignmentNotifications, notifyPickupRequestReviewers } from "@/lib/services/notifications";
import { enqueuePendingClaimReview } from "@/lib/claim-review-workflow";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { AREAS, AREA_LABELS } from "@/types/areas";

const body = z.object({
  actorId: z.string().min(1),
  area: z.enum(AREAS),
});

const HELD_STATUSES = ["DIRECT_ASSIGNED", "APPROVED"] as const;

/**
 * Someone identified at the kiosk for an event checkout who is not on that
 * event's crew asks to join it. This files the same approval-first REQUESTED
 * claim the schedule's open-shift pickup files — staff review it in the
 * pending-claim queue; nothing is assigned here. Idempotent: a person already
 * holding or requesting a slot on the event gets their existing status back.
 */
export const POST = withKiosk<{ id: string }>(async (req, { kiosk, params }) => {
  const ip = getClientIp(req);
  await enforceRateLimit(`kiosk:crew-request:${kiosk.kioskId}:${ip}`, { max: 20, windowMs: 60_000 });

  const { actorId, area } = body.parse(await req.json());
  const actor = await requireKioskActor(db, actorId);
  // The same permission as the schedule's own pickup (D-053: collaborators
  // can't request crew spots), worded for the person at the kiosk.
  if (!getAllowedRoles("shift_assignment", "request").includes(actor.role)) {
    throw new HttpError(403, "You can't request a crew spot here. Ask staff to add you.");
  }

  const [event, profile] = await Promise.all([
    db.calendarEvent.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        summary: true,
        shiftGroup: {
          select: {
            shifts: {
              orderBy: { startsAt: "asc" },
              select: {
                id: true,
                area: true,
                workerType: true,
                assignments: {
                  where: { status: { in: [...HELD_STATUSES, "REQUESTED"] } },
                  select: { id: true, userId: true, status: true },
                },
              },
            },
          },
        },
      },
    }),
    db.user.findUnique({
      where: { id: actor.id },
      select: { role: true, staffingType: true },
    }),
  ]);
  if (!event) throw new HttpError(404, "Event not found");

  const shifts = event.shiftGroup?.shifts ?? [];
  const existing = shifts
    .flatMap((shift) => shift.assignments.map((assignment) => ({ ...assignment, area: shift.area })))
    .find((assignment) => assignment.userId === actor.id);
  if (existing) {
    return ok({
      data: {
        status: existing.status === "REQUESTED" ? "already_requested" : "already_on_crew",
        assignmentId: existing.id,
        area: existing.area,
      },
    });
  }

  const areaLabel = AREA_LABELS[area] ?? area;
  const workerType = profile ? shiftWorkerTypeForProfile(profile) : null;
  const openShift = shifts.find((shift) =>
    shift.area === area &&
    shift.workerType === workerType &&
    !shift.assignments.some((assignment) => (HELD_STATUSES as readonly string[]).includes(assignment.status))
  );
  if (!openShift) {
    throw new HttpError(409, `No open ${areaLabel} spot on this event. Ask staff to add you.`);
  }

  let assignment: Awaited<ReturnType<typeof pickupOpenShiftTx>>;
  try {
    // The claim and its audit commit together: no REQUESTED row without a
    // record of which kiosk filed it.
    assignment = await withSerializationRetry(() => db.$transaction(async (tx) => {
      const created = await pickupOpenShiftTx(tx, openShift.id, actor.id);
      await createAuditEntryTx(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "shift_assignment",
        entityId: created.id,
        action: "kiosk_crew_requested",
        after: {
          eventId: event.id,
          shiftId: openShift.id,
          area,
          status: created.status,
          kioskId: kiosk.kioskId,
          hasConflict: created.hasConflict,
          conflictNote: created.conflictNote,
        },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "You already have a request waiting on this event");
    }
    throw error;
  }

  deferPush(dispatchScheduleAssignmentNotifications(assignment.id, "requested").catch(() => {}));
  deferPush(notifyPickupRequestReviewers(assignment.id).catch(() => {}));
  deferPush(enqueuePendingClaimReview({
    kind: "request",
    claimId: assignment.id,
    shiftStartsAt: assignment.callStartsAt
      ?? assignment.shift.callStartsAt
      ?? assignment.shift.startsAt,
  }).then(() => {}, () => {}));

  return ok({ data: { status: "requested", assignmentId: assignment.id, area } }, 201);
});
