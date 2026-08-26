import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { requirePermission, requirePermissionOrCollaboratorCapability } from "@/lib/rbac";

const BOOKING_CHANGE_LIMIT = { max: 180, windowMs: 60_000 };
const MAX_CHANGE_ROWS = 100;
const EMPTY_CURSOR_DATE = new Date(0);

type EncodedBookingChangeCursor = {
  version: 2;
  booking: { at: string; id: string };
  audit: { at: string; id: string };
};

type BookingChangeCursor = {
  booking: { at: Date; id: string };
  audit: { at: Date; id: string };
};

function encodeCursor(cursor: BookingChangeCursor): string {
  const encoded: EncodedBookingChangeCursor = {
    version: 2,
    booking: { at: cursor.booking.at.toISOString(), id: cursor.booking.id },
    audit: { at: cursor.audit.at.toISOString(), id: cursor.audit.id },
  };
  return Buffer.from(JSON.stringify(encoded), "utf8").toString("base64url");
}

function cursorAt(date: Date): BookingChangeCursor {
  return {
    booking: { at: date, id: "" },
    audit: { at: date, id: "" },
  };
}

function decodeCursor(value: string | null): BookingChangeCursor | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<EncodedBookingChangeCursor> & { at?: unknown };
    if (
      parsed.version === 2 &&
      typeof parsed.booking?.at === "string" &&
      typeof parsed.booking.id === "string" &&
      typeof parsed.audit?.at === "string" &&
      typeof parsed.audit.id === "string"
    ) {
      return {
        booking: { at: parseDate(parsed.booking.at), id: parsed.booking.id },
        audit: { at: parseDate(parsed.audit.at), id: parsed.audit.id },
      };
    }
    if (typeof parsed.at === "string") return cursorAt(parseDate(parsed.at));
  } catch {
    // Accept ISO timestamps too so the route remains easy to probe locally.
  }

  return cursorAt(parseDate(value));
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new HttpError(400, "Invalid booking change cursor");
  return date;
}

export const GET = withAuth(async (req, { user }) => {
  if (user.role === "COLLABORATOR") {
    requirePermissionOrCollaboratorCapability(user, "booking", "view", "MY_GEAR_VIEW");
  } else {
    requirePermission(user.role, "booking", "view");
  }

  const { allowed } = await checkRateLimit(`bookings:changes:${user.id}`, BOOKING_CHANGE_LIMIT);
  if (!allowed) throw new HttpError(429, "Too many requests. Please wait a moment.");

  const { searchParams } = new URL(req.url);
  const since = decodeCursor(searchParams.get("since"));
  const collaboratorPreview = user.role === "COLLABORATOR" && user.preview?.role === "COLLABORATOR";
  // Internal Students receive the shared booking change signal so their
  // team-visible Bookings list stays fresh. Private collaborators remain
  // restricted to their own rows unless the signed preview is active.
  const visibleBookingWhere = user.role === "COLLABORATOR" && !collaboratorPreview
    ? { requesterUserId: user.id }
    : {};

  if (!since) {
    const [latestBooking, latestAudit] = await Promise.all([
      db.booking.findFirst({
        where: visibleBookingWhere,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: { id: true, updatedAt: true },
      }),
      db.auditLog.findFirst({
        where: { entityType: "booking" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, createdAt: true },
      }),
    ]);
    return ok({
      data: {
        cursor: encodeCursor({
          booking: {
            at: latestBooking?.updatedAt ?? EMPTY_CURSOR_DATE,
            id: latestBooking?.id ?? "",
          },
          audit: {
            at: latestAudit?.createdAt ?? EMPTY_CURSOR_DATE,
            id: latestAudit?.id ?? "",
          },
        }),
        changedBookingIds: [],
      },
    });
  }

  const [bookingRows, auditRows] = await Promise.all([
    db.booking.findMany({
      where: {
        ...visibleBookingWhere,
        OR: [
          { updatedAt: { gt: since.booking.at } },
          { updatedAt: since.booking.at, id: { gt: since.booking.id } },
        ],
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: { id: true, updatedAt: true },
      take: MAX_CHANGE_ROWS,
    }),
    db.auditLog.findMany({
      where: {
        entityType: "booking",
        OR: [
          { createdAt: { gt: since.audit.at } },
          { createdAt: since.audit.at, id: { gt: since.audit.id } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, entityId: true, createdAt: true },
      take: MAX_CHANGE_ROWS,
    }),
  ]);

  const auditBookingIds = [...new Set(auditRows.map((row) => row.entityId).filter(Boolean))];
  const visibleAuditBookings = auditBookingIds.length > 0
    ? await db.booking.findMany({
        where: { ...visibleBookingWhere, id: { in: auditBookingIds } },
        select: { id: true },
        take: MAX_CHANGE_ROWS,
      })
    : [];
  const changedBookingIds = [
    ...new Set([
      ...bookingRows.map((row) => row.id),
      ...visibleAuditBookings.map((row) => row.id),
    ]),
  ];
  const lastBooking = bookingRows.at(-1);
  const lastAudit = auditRows.at(-1);
  const nextCursor: BookingChangeCursor = {
    booking: lastBooking
      ? { at: lastBooking.updatedAt, id: lastBooking.id }
      : since.booking,
    audit: lastAudit
      ? { at: lastAudit.createdAt, id: lastAudit.id }
      : since.audit,
  };

  return ok({ data: { cursor: encodeCursor(nextCursor), changedBookingIds } });
});
