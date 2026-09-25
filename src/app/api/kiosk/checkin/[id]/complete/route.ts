import { BookingCustodyScope } from "@prisma/client";
import { withKiosk } from "@/lib/api";
import { ok } from "@/lib/http";
import { kioskCompleteCheckin } from "@/lib/services/bookings-checkin";
import { checkinCompleteBody } from "@/lib/schemas/kiosk";
import { earnedBadgesSince } from "@/lib/badges";

/**
 * Complete a kiosk check-in (return).
 *
 * Delegates to `kioskCompleteCheckin` (SERIALIZABLE wrapper, roster-rule
 * actor check, bulk-aware `maybeAutoComplete`, scan-session close). The
 * kiosk audit (`action: "kiosk_checkin"`, `source: "KIOSK"`, `kioskDeviceId`,
 * completion counts, returned item names, and `returnedForUserId` when
 * someone returns another person's gear) commits inside that transaction and
 * is not duplicated when the tap is retried.
 */
export const POST = withKiosk<{ id: string }>(async (req, { kiosk, params }) => {
  const badgeWindowStart = new Date(Date.now() - 1);
  const { actorId } = checkinCompleteBody.parse(await req.json());

  const result = await kioskCompleteCheckin({
    bookingId: params.id,
    actorUserId: actorId,
    kiosk: { kioskId: kiosk.kioskId, name: kiosk.name },
  });

  // Badges belong to the owner, so only show them on the owner's own return.
  const earnedBadges = result.custodyScope === BookingCustodyScope.PERSON && !result.returnedForUserId
    ? await earnedBadgesSince(actorId, badgeWindowStart)
    : [];

  return ok({
    returnedItems: result.returnedItems,
    totalItems: result.totalItems,
    completed: result.completed,
    ...(earnedBadges.length > 0 ? { earnedBadges } : {}),
  });
});
