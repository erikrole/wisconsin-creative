import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok, fail, HttpError, parsePagination } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { assertDateOrder, parseOptionalDate } from "@/lib/api-dates";
import { getSchedulePublicationState } from "@/lib/services/schedule-publication";
import { sportTemplateCounts } from "@/lib/services/shift-generation";
import { sportDefaultShiftWindow } from "@/lib/schedule-defaults";
import { optionalSportCodeSchema } from "@/lib/validation";
import { createAuditEntryTx } from "@/lib/audit";
import { Prisma } from "@prisma/client";
import { studentCallTimeAppliesToEvent } from "@/lib/shift-call-windows";

function applyEventWindowFilter(
  eventWhere: Prisma.CalendarEventWhereInput,
  parsedStartDate?: Date | null,
  parsedEndDate?: Date | null,
) {
  if (parsedStartDate && parsedEndDate) {
    eventWhere.startsAt = { lte: parsedEndDate };
    eventWhere.endsAt = { gt: parsedStartDate };
  } else if (parsedStartDate) {
    eventWhere.endsAt = { gt: parsedStartDate };
  } else if (parsedEndDate) {
    eventWhere.startsAt = { lte: parsedEndDate };
  }
}

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "shift", "view");

  const url = new URL(req.url);
  const { limit: rawLimit, offset } = parsePagination(url.searchParams);
  const limit = Math.min(rawLimit, 500);

  const sportCode = optionalSportCodeSchema.parse(url.searchParams.get("sportCode") ?? undefined);
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const eventId = url.searchParams.get("eventId");
  const parsedStartDate = parseOptionalDate(startDate, "startDate");
  const parsedEndDate = parseOptionalDate(endDate, "endDate");
  assertDateOrder(parsedStartDate, parsedEndDate);

  const where: Record<string, unknown> = {};
  if (eventId) where.eventId = eventId;

  // Filter by event properties via nested where
  const eventWhere: Prisma.CalendarEventWhereInput = {};
  if (sportCode) eventWhere.sportCode = sportCode;
  applyEventWindowFilter(eventWhere, parsedStartDate, parsedEndDate);
  if (Object.keys(eventWhere).length > 0) {
    where.event = eventWhere;
  }

  const [total, groups] = await Promise.all([
    db.shiftGroup.count({ where }),
    db.shiftGroup.findMany({
    where,
    take: limit,
    skip: offset,
    include: {
      event: {
        select: {
          id: true,
          summary: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          sportCode: true,
          isHome: true,
          opponent: true,
          site: true,
          locationId: true,
        },
      },
      shifts: {
        include: {
          assignments: {
            where: {
              status: { in: ACTIVE_ASSIGNMENT_STATUSES },
            },
            include: {
              user: { select: { id: true, name: true, role: true, staffingType: true, primaryArea: true, avatarUrl: true } },
            },
          },
        },
        orderBy: [{ area: "asc" }, { workerType: "asc" }],
      },
      workingCopy: { select: { version: true, autoReleaseAt: true, autoReleaseError: true } },
    },
    orderBy: { event: { startsAt: "asc" } },
  }),
  ]);

  // One batched lookup for Trade Board state so crew rows can show an
  // on-the-board indicator and offer Remove instead of Post.
  const assignmentIds = groups.flatMap((g) => g.shifts.flatMap((s) => s.assignments.map((a) => a.id)));
  const activeTrades = assignmentIds.length > 0
    ? await db.shiftTrade.findMany({
        where: {
          shiftAssignmentId: { in: assignmentIds },
          status: { in: ["OPEN", "CLAIMED"] },
        },
        select: { id: true, status: true, shiftAssignmentId: true },
      })
    : [];
  const tradeByAssignmentId = new Map(
    activeTrades.map((t) => [t.shiftAssignmentId, { id: t.id, status: t.status }]),
  );

  // The list deliberately includes only active assignments, but a student
  // still needs to know whether their own pending request already exists. Keep
  // that queue private to the caller and batch it across the loaded groups so
  // both Schedule disclosure rows and Event detail can render one honest claim
  // state without exposing other students' requests.
  const shiftIds = groups.flatMap((g) => g.shifts.map((s) => s.id));
  const viewerRequests = shiftIds.length > 0
    ? await db.shiftAssignment.findMany({
        where: { shiftId: { in: shiftIds }, userId: user.id, status: "REQUESTED" },
        select: { id: true, shiftId: true, status: true, hasConflict: true, conflictNote: true },
      })
    : [];
  const viewerRequestByShiftId = new Map(viewerRequests.map((request) => [request.shiftId, {
    id: request.id,
    status: request.status,
    hasConflict: request.hasConflict,
    conflictNote: request.conflictNote,
  }]));

  // Add coverage summary
  const data = groups.map((g) => {
    const totalShifts = g.shifts.length;
    const filledShifts = g.shifts.filter(
      (s) => s.assignments.length > 0
    ).length;

    const publication = getSchedulePublicationState(g);
    const staffCanSeeWorkingState = user.role === "ADMIN" || user.role === "STAFF";
    const studentCallTimeVisible = user.role !== "STUDENT"
      || (!g.event.allDay && studentCallTimeAppliesToEvent(g.event));
    const pendingRelease = staffCanSeeWorkingState && g.workingCopy
      ? {
          autoReleaseAt: g.workingCopy.autoReleaseAt?.toISOString() ?? null,
          autoReleaseError: g.workingCopy.autoReleaseError,
        }
      : null;
    return {
      ...g,
      workingCopy: undefined,
      shifts: g.shifts.map((s) => ({
        ...s,
        callStartsAt: s.workerType === "ST" && studentCallTimeVisible ? s.callStartsAt : null,
        callEndsAt: s.workerType === "ST" && studentCallTimeVisible ? s.callEndsAt : null,
        viewerRequest: viewerRequestByShiftId.get(s.id) ?? null,
        assignments: s.assignments.map((a) => ({
          ...a,
          callStartsAt: s.workerType === "ST" && studentCallTimeVisible ? a.callStartsAt : null,
          callEndsAt: s.workerType === "ST" && studentCallTimeVisible ? a.callEndsAt : null,
          callNote: s.workerType === "ST" && studentCallTimeVisible ? a.callNote : null,
          activeTrade: tradeByAssignmentId.get(a.id) ?? null,
        })),
      })),
      publication: staffCanSeeWorkingState && g.workingCopy
        ? { ...publication, status: "changed" as const, changedAfterPublish: true, workingVersion: g.workingCopy.version }
        : publication,
      hasWorkingCopy: staffCanSeeWorkingState ? Boolean(g.workingCopy) : undefined,
      autoReleaseAt: pendingRelease?.autoReleaseAt,
      autoReleaseError: pendingRelease?.autoReleaseError,
      coverage: {
        total: totalShifts,
        filled: filledShifts,
        percentage: totalShifts > 0 ? Math.round((filledShifts / totalShifts) * 100) : 0,
      },
    };
  });

  return ok({ data, total });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "shift", "manage");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  const eventId = typeof (body as { eventId?: unknown }).eventId === "string"
    ? (body as { eventId: string }).eventId
    : null;
  if (!eventId) return fail(new HttpError(400, "eventId required"));
  const requestedTemplate = (body as { templateSide?: unknown }).templateSide;
  const templateSide = requestedTemplate === undefined ? "EMPTY" : requestedTemplate;
  if (templateSide !== "HOME" && templateSide !== "AWAY" && templateSide !== "EMPTY") {
    throw new HttpError(400, "templateSide must be HOME, AWAY, or EMPTY");
  }

  let group;
  try {
    group = await db.$transaction(async (tx) => {
      const event = await tx.calendarEvent.findUnique({
        where: { id: eventId },
        select: { id: true, sportCode: true, allDay: true, startsAt: true, endsAt: true },
      });
      if (!event) throw new HttpError(404, "Event not found");

      const config = templateSide === "EMPTY" || !event.sportCode
        ? null
        : await tx.sportConfig.findUnique({
            where: { sportCode: event.sportCode },
            include: { shiftConfigs: true },
          });
      if (templateSide !== "EMPTY" && !event.sportCode) {
        throw new HttpError(409, "Choose a sport before using saved crew defaults.");
      }
      if (templateSide !== "EMPTY" && (!config?.active || config.shiftConfigs.length === 0)) {
        throw new HttpError(409, "No active staffing defaults exist for this sport. Start empty or configure the sport first.");
      }

      const created = await tx.shiftGroup.create({
        data: {
          eventId,
          manuallyEdited: templateSide === "EMPTY",
          generatedAt: templateSide === "EMPTY" ? null : new Date(),
        },
      });

      let slotsCreated = 0;
      if (config && templateSide !== "EMPTY") {
        const isHomeTemplate = templateSide === "HOME";
        const defaultWindow = sportDefaultShiftWindow(event, config);
        const startsAt = defaultWindow.startsAt;
        const endsAt = defaultWindow.endsAt;
        const shifts = config.shiftConfigs.flatMap((row) => {
          const counts = sportTemplateCounts(row, isHomeTemplate);
          return (["FT", "ST"] as const).flatMap((workerType) =>
            Array.from({ length: counts[workerType] }, () => ({
              shiftGroupId: created.id,
              area: row.area,
              workerType,
              startsAt,
              endsAt,
              templateManaged: true,
            })),
          );
        });
        if (shifts.length > 0) {
          await tx.shift.createMany({ data: shifts });
          slotsCreated = shifts.length;
        }
      }

      await createAuditEntryTx(tx, {
        actorId: user.id,
        actorRole: user.role,
        entityType: "shift_group",
        entityId: created.id,
        action: "shift_group_created",
        after: { eventId, templateSide, slotsCreated },
      });

      return tx.shiftGroup.findUniqueOrThrow({
        where: { id: created.id },
        // Same shape as GET. Older native clients decode this into the same
        // model as the list response and rely on event being present.
        include: {
          event: {
            select: {
              id: true,
              summary: true,
              startsAt: true,
              endsAt: true,
              allDay: true,
              sportCode: true,
              isHome: true,
              opponent: true,
              site: true,
              locationId: true,
            },
          },
          shifts: {
            include: {
              assignments: {
                where: { status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
                include: { user: { select: { id: true, name: true, role: true, staffingType: true, primaryArea: true, avatarUrl: true } } },
              },
            },
          },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "Crew setup already exists for this event.");
    }
    throw error;
  }

  return ok({
    data: {
      ...group,
      publication: getSchedulePublicationState(group),
      coverage: { total: group.shifts.length, filled: 0, percentage: 0 },
    },
  });
});
