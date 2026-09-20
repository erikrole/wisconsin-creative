import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission, requireRole } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { visibleActiveUserWhere } from "@/lib/user-visibility";
import { Prisma } from "@prisma/client";
import { z } from "zod";

const addMemberSchema = z.object({
  userId: z.string().cuid(),
  notes: z.string().trim().max(200).optional(),
});

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requireRole(user.role, ["ADMIN", "STAFF", "STUDENT"]);
  const { id } = params;

  // Deliberately sequential. `tests/calendar-travel-auth.test.ts` pins that an
  // unknown event id 404s *before* the roster is listed, so the existence check
  // gates the read rather than racing it.
  const event = await db.calendarEvent.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!event) throw new HttpError(404, "Event not found");

  const members = await db.eventTravelMember.findMany({
    where: { eventId: id },
    include: {
      user: { select: { id: true, name: true, role: true, primaryArea: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return ok({ data: members });
});

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "shift", "manage");
  await enforceRateLimit(`event-travel:${user.id}`, SCHEDULE_MUTATION_LIMIT);
  const { id } = params;

  const event = await db.calendarEvent.findUnique({
    where: { id },
    select: { id: true, summary: true },
  });
  if (!event) throw new HttpError(404, "Event not found");

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }

  const body = addMemberSchema.parse(rawBody);

  // Resolve the traveler first. Without this an unknown or deactivated id
  // reaches Postgres as a foreign-key violation, which has no central mapping
  // and would surface to staff as a 500 instead of a usable message. Hidden
  // and inactive identities stay out of travel rosters for the same reason
  // they stay out of staffing decisions.
  const traveler = await db.user.findFirst({
    where: visibleActiveUserWhere({ id: body.userId }),
    select: { id: true, name: true },
  });
  if (!traveler) throw new HttpError(404, "That person is not an active user");

  let member;
  try {
    member = await db.eventTravelMember.create({
      data: {
        eventId: id,
        userId: body.userId,
        notes: body.notes ?? null,
      },
      include: {
        user: { select: { id: true, name: true, role: true, primaryArea: true, avatarUrl: true } },
      },
    });
  } catch (error) {
    // Let the @@unique([eventId, userId]) constraint decide, rather than
    // pre-reading for a duplicate and racing two staff adding the same person.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, `${traveler.name} is already on the travel roster`);
    }
    throw error;
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "calendar_event",
    entityId: id,
    action: "event_travel_member_added",
    after: {
      travelMemberId: member.id,
      userId: traveler.id,
      userName: traveler.name,
      notes: member.notes,
      eventSummary: event.summary,
    },
  });

  return ok({ data: member }, 201);
});
