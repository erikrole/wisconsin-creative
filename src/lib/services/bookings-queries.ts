import {
  BookingKind,
  BookingStatus,
  Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError, parsePagination } from "@/lib/http";
import { normalizeTeamAbbreviations } from "@/lib/title-normalization";
import { optionalSportCodeSchema } from "@/lib/validation";
import { bookingInclude } from "./bookings-helpers";

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

export const BOOKING_SORT_MAP: Record<string, Prisma.BookingOrderByWithRelationInput[]> = {
  oldest: [{ startsAt: "asc" }, { id: "asc" }],
  title: [{ title: "asc" }, { id: "asc" }],
  title_desc: [{ title: "desc" }, { id: "asc" }],
  endsAt: [{ endsAt: "asc" }, { id: "asc" }],
  endsAt_desc: [{ endsAt: "desc" }, { id: "asc" }],
};

function parseSearchDate(value: string | null, paramName: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new HttpError(400, `Invalid date for ${paramName}: ${value}`);
  return d;
}

function parseStatusParam(value: string | null): BookingStatus | undefined {
  if (!value) return undefined;
  if (!Object.values(BookingStatus).includes(value as BookingStatus)) {
    throw new HttpError(400, `Invalid booking status: ${value}`);
  }
  return value as BookingStatus;
}

function parseStatusListParam(value: string | null): BookingStatus[] | undefined {
  if (!value) return undefined;
  const rawStatuses = value.split(",").map((status) => status.trim()).filter(Boolean);
  if (rawStatuses.length === 0) return undefined;

  const statuses = Array.from(new Set(rawStatuses));
  for (const status of statuses) {
    if (!Object.values(BookingStatus).includes(status as BookingStatus)) {
      throw new HttpError(400, `Invalid booking status: ${status}`);
    }
  }
  return statuses as BookingStatus[];
}

export async function listBookings(
  kind: BookingKind,
  searchParams: URLSearchParams,
  extraWhere?: Prisma.BookingWhereInput,
  /** When set, forces requesterUserId scoping regardless of query params (used for private collaborator reads). */
  restrictToRequesterUserId?: string,
) {
  const q = searchParams.get("q")?.trim();
  const sortParam = searchParams.get("sort");

  const statusParam = parseStatusParam(searchParams.get("status"));
  const statusListParam = parseStatusListParam(searchParams.get("status_in"));
  const fromDate = parseSearchDate(searchParams.get("from"), "from");
  const toDate = parseSearchDate(searchParams.get("to"), "to");
  const sportCode = optionalSportCodeSchema.parse(searchParams.get("sport_code") ?? undefined);

  const activeOnly = searchParams.get("active") === "true";
  const pastOnly = searchParams.get("past") === "true";

  const where: Prisma.BookingWhereInput = {
    kind,
    ...extraWhere,
    // Apply status from query param only when extraWhere doesn't already set it
    ...(extraWhere?.status === undefined && statusParam
      ? { status: statusParam }
      : extraWhere?.status === undefined && statusListParam
        ? { status: { in: statusListParam } }
      : extraWhere?.status === undefined && activeOnly
        ? { status: { notIn: [BookingStatus.COMPLETED, BookingStatus.CANCELLED] } }
        : extraWhere?.status === undefined && pastOnly
          ? { status: { in: [BookingStatus.COMPLETED, BookingStatus.CANCELLED] } }
        : {}),
    ...(searchParams.get("location_id") ? { locationId: searchParams.get("location_id")! } : {}),
    ...(sportCode ? { sportCode } : {}),
    ...(restrictToRequesterUserId
      ? { requesterUserId: restrictToRequesterUserId }
      : searchParams.get("requester_id")
        ? { requesterUserId: searchParams.get("requester_id")! }
        : {}),
    ...(fromDate || toDate
      ? {
          startsAt: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
          }
        }
      : {}),
    ...(q ? {
      OR: [
        { title: { contains: q, mode: "insensitive" as const } },
        { requester: { name: { contains: q, mode: "insensitive" as const } } },
        { refNumber: { contains: q, mode: "insensitive" as const } },
      ],
    } : {}),
  };

  const orderBy = (sortParam && BOOKING_SORT_MAP[sortParam]) || [{ startsAt: "desc" }, { id: "asc" }];
  const { limit, offset } = parsePagination(searchParams);

  const [data, total] = await Promise.all([
    db.booking.findMany({
      where,
      orderBy,
      include: bookingListInclude,
      take: limit,
      skip: offset
    }),
    db.booking.count({ where })
  ]);

  return {
    data: data.map((booking) => ({
      ...booking,
      // Correct legacy display values without rewriting stored/audit data.
      title: normalizeTeamAbbreviations(booking.title),
    })),
    total,
    limit,
    offset,
  };
}

export async function getBookingDetail(bookingId: string) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      ...bookingInclude,
      creator: { select: { id: true, name: true, email: true, avatarUrl: true } },
      serializedItems: { include: { asset: { include: { location: { select: { id: true, name: true } } } } } },
      bulkItems: {
        include: {
          bulkSku: { select: { id: true, name: true, category: true, unit: true, imageUrl: true, trackByNumber: true } },
          unitAllocations: {
            include: { bulkSkuUnit: { select: { unitNumber: true, status: true } } },
          },
        },
      },
      event: { select: { id: true, summary: true, sportCode: true, opponent: true, isHome: true } },
      events: {
        orderBy: { ordinal: "asc" },
        include: {
          event: { select: { id: true, summary: true, sportCode: true, opponent: true, isHome: true, startsAt: true, endsAt: true } },
        },
      },
      sourceReservation: { select: { id: true, refNumber: true, title: true } },
      shiftAssignment: {
        select: {
          id: true,
          userId: true,
          status: true,
          source: true,
          callStartsAt: true,
          callEndsAt: true,
          callNote: true,
          shift: {
            select: {
              id: true,
              area: true,
              workerType: true,
              startsAt: true,
              endsAt: true,
              callStartsAt: true,
              callEndsAt: true,
              shiftGroup: {
                select: {
                  eventId: true,
                  publishedAt: true,
                  workingCopy: { select: { shiftGroupId: true } },
                },
              },
            },
          },
        },
      },
      kit: { select: { id: true, name: true } },
      pickupKioskDevice: { select: { id: true, name: true, location: { select: { id: true, name: true } } } },
      photos: { select: { id: true, phase: true, imageUrl: true, createdAt: true, actor: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
    }
  });

  if (!booking) {
    throw new HttpError(404, "Booking not found");
  }

  const AUDIT_LOG_LIMIT = 50;
  const auditLogsRaw = await db.auditLog.findMany({
    where: { entityType: "booking", entityId: bookingId },
    orderBy: { createdAt: "desc" },
    take: AUDIT_LOG_LIMIT + 1,
    include: { actor: { select: { id: true, name: true } } }
  });
  const hasMoreAuditLogs = auditLogsRaw.length > AUDIT_LOG_LIMIT;
  const auditLogs = hasMoreAuditLogs ? auditLogsRaw.slice(0, AUDIT_LOG_LIMIT) : auditLogsRaw;
  const { events: eventLinks, ...rest } = booking;

  const now = new Date();
  const isOverdue =
    (booking.kind === BookingKind.CHECKOUT && booking.status === BookingStatus.OPEN && booking.endsAt < now) ||
    (booking.kind === BookingKind.RESERVATION && booking.status === BookingStatus.BOOKED && booking.endsAt < now);
  const isActive = booking.status === BookingStatus.OPEN || booking.status === BookingStatus.BOOKED;

  const linkedEventIds = eventLinks.length > 0
    ? eventLinks.map((link) => link.eventId)
    : booking.event
      ? [booking.event.id]
      : [];
  const isInternalEventReservation =
    booking.kind === BookingKind.RESERVATION
    && linkedEventIds.length > 0
    && booking.requester?.role !== "COLLABORATOR";
  const hasMatchingScheduleAssignment = Boolean(
    booking.shiftAssignment
    && (booking.shiftAssignment.status === "DIRECT_ASSIGNED" || booking.shiftAssignment.status === "APPROVED")
    && booking.shiftAssignment.userId === booking.requesterUserId
    && linkedEventIds.includes(booking.shiftAssignment.shift.shiftGroup.eventId),
  );
  const scheduleStatus: "scheduled" | "needs_review" | "not_applicable" = isInternalEventReservation
    ? hasMatchingScheduleAssignment ? "scheduled" : "needs_review"
    : "not_applicable";
  const scheduleStatusReason = scheduleStatus === "needs_review"
    ? booking.shiftAssignment
      ? "The linked schedule assignment needs review."
      : "This event-linked reservation is not connected to an active schedule assignment."
    : null;

  // Compute distinct locations represented by assets in this booking
  const locationMap = new Map<string, string>();
  locationMap.set(booking.location.id, booking.location.name);
  for (const item of booking.serializedItems) {
    if (item.asset.location) {
      locationMap.set(item.asset.location.id, item.asset.location.name);
    }
  }
  const itemLocations = Array.from(locationMap, ([id, name]) => ({ id, name }));
  const locationMode: "SINGLE" | "MIXED" = itemLocations.length > 1 ? "MIXED" : "SINGLE";

  // Flatten BookingEvent junction rows to a plain sorted event array for consumers.
  const linkedEvents = eventLinks.map((link) => link.event);

  return {
    ...rest,
    // Correct legacy display values without rewriting stored/audit data.
    title: normalizeTeamAbbreviations(rest.title),
    events: linkedEvents,
    isOverdue,
    isActive,
    bookingType: booking.kind === BookingKind.RESERVATION ? "Reservation" : "Checkout",
    scheduleStatus,
    scheduleStatusReason,
    auditLogs,
    hasMoreAuditLogs,
    auditLogNextCursor: hasMoreAuditLogs ? auditLogs[auditLogs.length - 1]?.id : null,
    itemLocations,
    locationMode
  };
}

export async function getBookingForScan(bookingId: string) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      serializedItems: { include: { asset: true } },
      bulkItems: { include: { bulkSku: true } },
      scanSessions: true,
      overrides: true
    }
  });

  if (!booking) {
    throw new HttpError(404, "Booking not found");
  }

  return booking;
}
