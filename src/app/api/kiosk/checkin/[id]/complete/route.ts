import { BookingCustodyScope } from "@prisma/client";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { createAuditEntry } from "@/lib/audit";
import { kioskCompleteCheckin } from "@/lib/services/bookings-checkin";
import { checkinCompleteBody } from "@/lib/schemas/kiosk";
import { earnedBadgesSince } from "@/lib/badges";

/**
 * Complete a kiosk check-in (return).
 *
 * Delegates to `kioskCompleteCheckin` (SERIALIZABLE wrapper, bulk-aware
 * `maybeAutoComplete`, scan-session close, lost-unit handling). The route
 * writes kiosk audit context (`action: "kiosk_checkin"`, `source: "KIOSK"`,
 * `kioskDeviceId`, completion counts, and returned item names) without
 * changing the iOS response contract.
 */
export const POST = withKiosk<{ id: string }>(async (req, { kiosk, params }) => {
  const badgeWindowStart = new Date(Date.now() - 1);
  const { actorId } = checkinCompleteBody.parse(await req.json());

  const [user, booking] = await Promise.all([
    db.user.findFirst({
      where: { id: actorId, active: true, hiddenFromRoster: false },
      select: { id: true, role: true },
    }),
    db.booking.findUnique({
      where: { id: params.id },
      select: { requesterUserId: true, custodyScope: true },
    }),
  ]);
  if (!user) throw new HttpError(404, "User not found");
  if (!booking) throw new HttpError(404, "Checkout not found");
  if (booking.custodyScope === BookingCustodyScope.PERSON && booking.requesterUserId !== actorId) {
    throw new HttpError(403, "This return requires the checkout requester");
  }

  const result = await kioskCompleteCheckin({
    bookingId: params.id,
    actorUserId: actorId,
  });

  await createAuditEntry({
    actorId,
    actorRole: user.role,
    entityType: "booking",
    entityId: params.id,
    action: "kiosk_checkin",
    before: {
      returnedItems: result.returnedItems,
      totalItems: result.totalItems,
    },
    after: {
      refNumber: result.refNumber,
      returnedItems: result.returnedItems,
      totalItems: result.totalItems,
      itemNames: result.returnedItemNames,
      completed: result.completed,
      source: "KIOSK",
      kioskDeviceId: kiosk.kioskId,
      kioskName: kiosk.name,
    },
  });
  const earnedBadges = booking.custodyScope === BookingCustodyScope.PERSON
    ? await earnedBadgesSince(actorId, badgeWindowStart)
    : [];

  return ok({
    returnedItems: result.returnedItems,
    totalItems: result.totalItems,
    completed: result.completed,
    ...(earnedBadges.length > 0 ? { earnedBadges } : {}),
  });
});
