import { BookingCustodyScope, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { findAssetByScanValue } from "@/lib/services/kiosk-scan";
import { kioskCheckinAsset } from "@/lib/services/bookings-checkin";
import { scanKioskCheckinBulkUnit } from "@/lib/services/bulk-unit-scans";
import { locationEvidencePayload } from "@/lib/services/kiosk-location";
import { checkinScanBody } from "@/lib/schemas/kiosk";
import { badges, earnedBadgesSince } from "@/lib/badges";
import { endCheckoutReturnLiveActivities } from "@/lib/services/live-activities";

/**
 * Scan an item for kiosk check-in (return).
 * Marks the item as returned in the booking via `kioskCheckinAsset`,
 * inside one SERIALIZABLE transaction so the update + allocation
 * deactivation cannot drift apart under concurrent scans.
 */
export const POST = withKiosk<{ id: string }>(async (req, { kiosk, params }) => {
  const badgeWindowStart = new Date(Date.now() - 1);
  const { scanValue, actorId } = checkinScanBody.parse(await req.json());

  const booking = await db.booking.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, kind: true, custodyScope: true, requesterUserId: true, locationId: true },
  });

  if (!booking || booking.kind !== "CHECKOUT" || booking.status !== "OPEN") {
    throw new HttpError(404, "Active checkout not found");
  }
  const activeBooking = booking;
  const operationalActorId = activeBooking.custodyScope === BookingCustodyScope.SHARED
    ? actorId
    : activeBooking.requesterUserId;
  if (!operationalActorId) {
    throw new HttpError(400, "Identify the person operating this shared return");
  }
  const operationalActor = await db.user.findFirst({
    where: { id: operationalActorId, active: true, hiddenFromRoster: false },
    select: { id: true },
  });
  if (!operationalActor) throw new HttpError(404, "User not found");

  async function rewardPayload() {
    if (activeBooking.custodyScope === BookingCustodyScope.SHARED) return {};
    const earnedBadges = await earnedBadgesSince(activeBooking.requesterUserId, badgeWindowStart);
    return earnedBadges.length > 0 ? { earnedBadges } : {};
  }

  const bulkResult = await db.$transaction(
    (tx) => scanKioskCheckinBulkUnit(tx, {
      bookingId: params.id,
      scanValue,
      kioskLocationId: kiosk.locationId,
      actorUserId: operationalActorId,
    }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (bulkResult.handled) {
    if (bulkResult.success && bulkResult.completed && bulkResult.badgeEvent) {
      await badges.onCheckoutReturned(bulkResult.badgeEvent);
      await endCheckoutReturnLiveActivities(params.id);
    }

    if (bulkResult.success) {
      return ok({ success: true, ...await rewardPayload(), item: bulkResult.item });
    }
    return ok({ success: false, error: bulkResult.error, ...await rewardPayload() });
  }

  const asset = await findAssetByScanValue(scanValue, {
    id: true,
    assetTag: true,
    name: true,
  });

  if (!asset) {
    return ok({ success: false, error: "Item not found", ...await rewardPayload() });
  }

  const result = await db.$transaction(async (tx) => {
    const outcome = await kioskCheckinAsset(tx, {
      bookingId: params.id,
      assetId: asset.id,
      kioskLocationId: kiosk.locationId,
      actorUserId: operationalActorId,
    });
    if (outcome.ok) {
      await tx.scanEvent.create({
        data: {
          bookingId: activeBooking.id,
          actorUserId: operationalActorId,
          scanType: "SERIALIZED",
          scanValue,
          success: true,
          phase: "CHECKIN",
          assetId: asset.id,
          locationMismatch: outcome.locationEvidence?.locationMismatch ?? false,
          expectedLocationId: outcome.locationEvidence?.expectedLocationId ?? activeBooking.locationId,
          actualLocationId: outcome.locationEvidence?.actualLocationId ?? null,
          deviceContext: req.headers.get("user-agent") ?? "kiosk",
        },
      });
    }
    return outcome;
  },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  if (!result.ok) {
    if (result.reason === "not_in_booking") {
      const error = `${asset.assetTag} is not in this checkout`;
      return ok({ success: false, error, ...await rewardPayload() });
    }
    const error = `${asset.assetTag} already returned`;
    return ok({ success: false, error, ...await rewardPayload() });
  }

  if (result.completed && result.badgeEvent) {
    await badges.onCheckoutReturned(result.badgeEvent);
    await endCheckoutReturnLiveActivities(params.id);
  }

  return ok({
    success: true,
    ...await rewardPayload(),
    ...(result.locationEvidence ? locationEvidencePayload(result.locationEvidence) : {}),
    item: {
      id: asset.id,
      name: asset.name || asset.assetTag,
      tagName: asset.assetTag,
    },
  });
});
