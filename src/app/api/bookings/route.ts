import { BookingStatus, Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok, parsePagination } from "@/lib/http";
import { BOOKING_SORT_MAP } from "@/lib/services/bookings-queries";
import { optionalSportCodeSchema } from "@/lib/validation";
import { requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { collaboratorBookingResponse } from "@/lib/collaborator-gear";
import { getAllowedBookingActions } from "@/lib/services/booking-rules";
import { normalizeTeamAbbreviations } from "@/lib/title-normalization";

/* ── Combined bookings list (both CHECKOUT and RESERVATION) ── */

function parseStatusParam(value: string | null): BookingStatus | undefined {
  if (!value) return undefined;
  if (!Object.values(BookingStatus).includes(value as BookingStatus)) {
    throw new HttpError(400, `Invalid booking status: ${value}`);
  }
  return value as BookingStatus;
}

const ACTIVE_BOOKING_STATUSES = [
  BookingStatus.BOOKED,
  BookingStatus.PENDING_PICKUP,
  BookingStatus.OPEN,
];

const PAST_BOOKING_STATUSES = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
];

const bookingListInclude = {
  location: { select: { id: true, name: true } },
  requester: { select: { id: true, name: true, email: true, avatarUrl: true } },
  serializedItems: {
    select: {
      id: true, assetId: true, allocationStatus: true,
      asset: { select: { id: true, assetTag: true, name: true, brand: true, model: true, serialNumber: true, imageUrl: true } },
    },
  },
  bulkItems: {
    select: {
      id: true, plannedQuantity: true, checkedOutQuantity: true, checkedInQuantity: true,
      bulkSku: { select: { id: true, name: true, unit: true } },
    },
  },
  event: { select: { id: true, summary: true, sportCode: true, opponent: true, isHome: true } },
} satisfies Prisma.BookingInclude;


export const GET = withAuth(async (req, { user }) => {
  requirePermissionOrCollaboratorCapability(user, "booking", "view", "MY_GEAR_VIEW");
  const { searchParams } = new URL(req.url);

  const q = searchParams.get("q")?.trim();
  const filter = searchParams.get("filter");
  const status = parseStatusParam(searchParams.get("status"));
  const activeOnly = searchParams.get("active") === "true";
  const pastOnly = searchParams.get("past") === "true";
  const locationId = searchParams.get("location_id");
  const sportCode = optionalSportCodeSchema.parse(searchParams.get("sport_code") ?? undefined);
  const requesterId = searchParams.get("requester_id");
  const collaboratorPreview = user.role === "COLLABORATOR" && user.preview?.role === "COLLABORATOR";

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400_000);
  const operationalFilterStatuses = status ? {} : { status: { in: [BookingStatus.OPEN, BookingStatus.BOOKED] } };

  const where: Prisma.BookingWhereInput = {
    // No `kind` filter — returns both CHECKOUT and RESERVATION
    ...(status
      ? { status }
      : activeOnly
        ? { status: { in: ACTIVE_BOOKING_STATUSES } }
        : pastOnly
          ? { status: { in: PAST_BOOKING_STATUSES } }
          : {}),
    ...(filter === "overdue"
      ? { endsAt: { lt: now }, ...operationalFilterStatuses }
      : filter === "due-today"
        ? { endsAt: { gte: todayStart, lt: todayEnd }, ...operationalFilterStatuses }
        : {}),
    ...(locationId ? { locationId } : {}),
    ...(sportCode ? { sportCode } : {}),
    // Internal Students have team-visible booking reads. Private collaborators
    // remain pinned to their own rows unless the signed preview is active.
    ...(user.role === "COLLABORATOR" && !collaboratorPreview
      ? { requesterUserId: user.id }
      : requesterId
        ? { requesterUserId: requesterId }
        : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { requester: { name: { contains: q, mode: "insensitive" as const } } },
            { refNumber: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const sortParam = searchParams.get("sort");
  const orderBy = (sortParam && BOOKING_SORT_MAP[sortParam]) || [{ startsAt: "desc" }, { id: "asc" }];
  const { limit, offset } = parsePagination(searchParams);

  const [data, total] = await Promise.all([
    db.booking.findMany({ where, orderBy, include: bookingListInclude, take: limit, skip: offset }),
    db.booking.count({ where }),
  ]);

  const responseData = data.map((booking) => {
    const allowedActions = user.preview?.readOnly ? [] : getAllowedBookingActions(user, booking);
    const displayBooking = {
      ...booking,
      // Correct legacy display values without rewriting stored/audit data.
      title: normalizeTeamAbbreviations(booking.title),
    };
    return user.role === "COLLABORATOR"
      ? collaboratorBookingResponse(displayBooking, allowedActions)
      : { ...displayBooking, allowedActions };
  });

  return ok({
    data: responseData,
    total,
    limit,
    offset,
  });
});
