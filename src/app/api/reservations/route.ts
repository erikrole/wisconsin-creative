import { BookingKind, BookingStatus, Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { createBooking, listBookings } from "@/lib/services/bookings";
import { bookingInclude } from "@/lib/services/bookings-helpers";
import { parseDateRange } from "@/lib/time";
import { createReservationSchema, sanitizeBookingFields } from "@/lib/validation";
import { createReservationLifecycleNotification } from "@/lib/services/notifications";
import { loadReservationRules } from "@/lib/services/reservation-rules";
import { sanitizeCollaboratorBooking } from "@/lib/collaborator-gear";
import { deferCompanionProjectionRefreshForCommittedMutation } from "@/lib/services/companion-projection-publisher";

async function replayConsumedDraftReservation(sourceDraftId: string, actorUserId: string) {
  const consumption = await db.auditLog.findFirst({
    where: {
      entityType: "booking",
      entityId: sourceDraftId,
      action: "draft_consumed",
      actorUserId,
    },
    orderBy: { createdAt: "desc" },
    select: { afterJson: true },
  });
  const afterJson = consumption?.afterJson;
  const createdReservationId =
    afterJson && typeof afterJson === "object" && !Array.isArray(afterJson)
      ? (afterJson as Prisma.JsonObject).createdReservationId
      : null;
  if (typeof createdReservationId !== "string") return null;

  return db.booking.findFirst({
    where: {
      id: createdReservationId,
      kind: BookingKind.RESERVATION,
      createdBy: actorUserId,
    },
    include: bookingInclude,
  });
}

export const GET = withAuth(async (req, { user }) => {
  requirePermissionOrCollaboratorCapability(user, "booking", "view", "MY_GEAR_VIEW");
  const { searchParams } = new URL(req.url);
  const filterParam = searchParams.get("filter");
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const extraWhere: Prisma.BookingWhereInput | undefined =
    filterParam === "overdue"
      ? { status: BookingStatus.BOOKED, endsAt: { lt: now } }
      : filterParam === "due-today"
        ? { status: BookingStatus.BOOKED, startsAt: { gte: todayStart, lt: todayEnd } }
        : undefined;

  const collaboratorPreview = user.role === "COLLABORATOR" && user.preview?.role === "COLLABORATOR";
  const restrictTo = user.role === "COLLABORATOR" && !collaboratorPreview
    ? user.id
    : undefined;
  const result = await listBookings(BookingKind.RESERVATION, searchParams, extraWhere, restrictTo);
  return ok({
    ...result,
    data: user.role === "COLLABORATOR"
      ? result.data.map(sanitizeCollaboratorBooking)
      : result.data,
  });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermissionOrCollaboratorCapability(user, "booking", "create", "RESERVATION_CREATE");
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  const body = sanitizeBookingFields(createReservationSchema.parse(rawBody));
  // Students may only create reservations for themselves.
  if (user.role === "STUDENT" || user.role === "COLLABORATOR") {
    body.requesterUserId = user.id;
  }
  const { start, end } = parseDateRange(body.startsAt, body.endsAt, { requireFutureStart: true });

  const rules = await loadReservationRules();

  // Enforce advance booking window
  if (rules.advanceWindowDays !== null) {
    const maxStartMs = Date.now() + rules.advanceWindowDays * 86_400_000;
    if (start.getTime() > maxStartMs) {
      throw new HttpError(
        409,
        `Reservations cannot be made more than ${rules.advanceWindowDays} day${rules.advanceWindowDays === 1 ? "" : "s"} in advance.`
      );
    }
  }

  let reservation;
  try {
    reservation = await createBooking({
      kind: BookingKind.RESERVATION,
      maxConcurrentReservations: rules.maxConcurrentReservations ?? undefined,
      title: body.title,
      requesterUserId: body.requesterUserId,
      locationId: body.locationId,
      startsAt: start,
      endsAt: end,
      serializedAssetIds: body.serializedAssetIds,
      bulkItems: body.bulkItems,
      notes: body.notes,
      createdBy: user.id,
      eventId: body.eventId,
      eventIds: body.eventIds,
      sportCode: body.sportCode,
      shiftAssignmentId: body.shiftAssignmentId,
      kitId: body.kitId,
      sourceDraftId: body.sourceDraftId,
    });
  } catch (error) {
    const sourceDraftId = body.sourceDraftId;
    const canReplay =
      error instanceof HttpError
      && error.status === 404
      && error.message === "Source draft not found"
      && typeof sourceDraftId === "string";
    if (!canReplay) throw error;

    // A consumed sourceDraftId is a permanent, actor-scoped idempotency key.
    // Return the committed reservation and ignore any later payload reuse.
    const replayed = await replayConsumedDraftReservation(sourceDraftId, user.id);
    if (!replayed) throw error;
    reservation = replayed;
  }

  // Audit entry is written inside createBooking()'s transaction — do not log again here.
  // Publish from the commit boundary. Notification persistence below can fail
  // independently and must not leave the external GearOps projection stale.
  deferCompanionProjectionRefreshForCommittedMutation(req);

  const creationDisposition = "creationDisposition" in reservation
    ? reservation.creationDisposition
    : "replayed";

  await createReservationLifecycleNotification({
    bookingId: reservation.id,
    bookingTitle: reservation.title ?? body.title,
    requesterUserId: reservation.requesterUserId,
    actorUserId: user.id,
    event: creationDisposition === "consolidated" ? "updated" : "booked",
  });

  return ok({
    data: user.role === "COLLABORATOR"
      ? { ...sanitizeCollaboratorBooking(reservation), creationDisposition }
      : { ...reservation, creationDisposition },
    meta: {
      disposition: creationDisposition,
      message: creationDisposition === "consolidated"
        ? `Gear added to the existing ${reservation.title} reservation.`
        : "Reservation created.",
    },
  }, creationDisposition === "consolidated" ? 200 : 201);
});
