import {
  BookingCustodyScope,
  BookingKind,
  BookingStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { assertBookingSnapshot } from "@/lib/booking-concurrency";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";

const ELIGIBLE_STATUSES = new Set<BookingStatus>([
  BookingStatus.BOOKED,
  BookingStatus.PENDING_PICKUP,
  BookingStatus.OPEN,
]);

export async function updateBookingCustodyScope(args: {
  bookingId: string;
  actorUserId: string;
  custodyScope: BookingCustodyScope;
  expectedUpdatedAt: Date;
}) {
  return db.$transaction(async (tx) => {
    const [booking, actor] = await Promise.all([
      tx.booking.findUnique({
        where: { id: args.bookingId },
        select: {
          id: true,
          kind: true,
          status: true,
          custodyScope: true,
          updatedAt: true,
        },
      }),
      tx.user.findUnique({
        where: { id: args.actorUserId },
        select: { role: true },
      }),
    ]);

    if (!booking) throw new HttpError(404, "Checkout not found");
    if (!actor || (actor.role !== Role.ADMIN && actor.role !== Role.STAFF)) {
      throw new HttpError(403, "Only staff or admin can change checkout custody");
    }
    if (booking.kind !== BookingKind.CHECKOUT) {
      throw new HttpError(400, "Shared custody is available only for checkouts");
    }
    if (!ELIGIBLE_STATUSES.has(booking.status)) {
      throw new HttpError(400, "Custody cannot be changed for this checkout state");
    }

    assertBookingSnapshot(booking.updatedAt, args.expectedUpdatedAt);
    if (booking.custodyScope === args.custodyScope) return booking;

    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: { custodyScope: args.custodyScope },
      select: {
        id: true,
        kind: true,
        status: true,
        custodyScope: true,
        updatedAt: true,
      },
    });

    await createAuditEntryTx(tx, {
      actorId: args.actorUserId,
      actorRole: actor.role,
      entityType: "booking",
      entityId: booking.id,
      action: "custody_scope_changed",
      before: { custodyScope: booking.custodyScope },
      after: { custodyScope: updated.custodyScope },
    });

    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
