import { BookingCustodyScope, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { findAssetByScanValue } from "@/lib/services/kiosk-scan";
import { kioskCheckinAsset } from "@/lib/services/bookings-checkin";
import { findBulkUnitByScanValue, scanKioskCheckinBulkUnit } from "@/lib/services/bulk-unit-scans";
import { requireKioskActor } from "@/lib/services/kiosk-actor";
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

  if (
    !booking ||
    booking.kind !== "CHECKOUT" ||
    (booking.status !== "OPEN" && booking.status !== "COMPLETED")
  ) {
    throw new HttpError(404, "Active checkout not found");
  }
  const activeBooking = booking;
  // Anyone identified at the kiosk may return gear, including gear on someone
  // else's personal checkout, and the scan records who actually returned it.
  // Older kiosk builds omit actorId for personal returns; those fall back to
  // the owner, which was the only person they allowed to return.
  const isShared = activeBooking.custodyScope === BookingCustodyScope.SHARED;
  const operationalActorId = actorId ?? (isShared ? undefined : activeBooking.requesterUserId);
  if (!operationalActorId) {
    throw new HttpError(400, "Identify the person operating this shared return");
  }
  await requireKioskActor(db, operationalActorId);

  // The last scan auto-completes the checkout. If its response was lost and
  // the kiosk retries, the booking is already COMPLETED: answer the retry as
  // the success it was instead of "checkout not found".
  if (activeBooking.status === "COMPLETED") {
    const item = await alreadyReturnedToBooking(activeBooking.id, scanValue);
    if (!item) throw new HttpError(404, "Active checkout not found");
    return ok({ success: true, alreadyReturned: true, item });
  }

  // Badges belong to the checkout owner, so only show them on the owner's own return.
  async function rewardPayload() {
    if (isShared || operationalActorId !== activeBooking.requesterUserId) return {};
    const earnedBadges = await earnedBadgesSince(activeBooking.requesterUserId, badgeWindowStart);
    return earnedBadges.length > 0 ? { earnedBadges } : {};
  }

  const bulkResult = await db.$transaction(
    (tx) => scanKioskCheckinBulkUnit(tx, {
      bookingId: params.id,
      scanValue,
      kioskLocationId: kiosk.locationId,
      actorUserId: operationalActorId,
      deviceContext: req.headers.get("user-agent") ?? "kiosk",
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
    if (bulkResult.errorCode === "already_returned") {
      // Already back on this booking — a retried scan is not a failure.
      const item = await alreadyReturnedToBooking(activeBooking.id, scanValue);
      if (item) return ok({ success: true, alreadyReturned: true, ...await rewardPayload(), item });
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
    // `already_returned` means this asset is already back on this booking:
    // report the retried scan as the success it was. The kiosk keeps a set of
    // returned ids, so a repeat is shown as "already returned", not counted twice.
    return ok({
      success: true,
      alreadyReturned: true,
      ...await rewardPayload(),
      item: { id: asset.id, name: asset.name || asset.assetTag, tagName: asset.assetTag },
    });
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

/**
 * The scanned item if it is already returned on this booking (a numbered
 * battery unit checked back in, or a serialized asset marked returned).
 */
async function alreadyReturnedToBooking(bookingId: string, scanValue: string) {
  const unit = await findBulkUnitByScanValue(scanValue);
  if (unit) {
    const returned = await db.bookingBulkUnitAllocation.findFirst({
      where: {
        bulkSkuUnitId: unit.id,
        checkedOutAt: { not: null },
        checkedInAt: { not: null },
        bookingBulkItem: { bookingId },
      },
      select: { id: true },
    });
    if (!returned) return null;
    return {
      id: unit.id,
      name: unit.name,
      tagName: unit.tagName,
      type: unit.type,
      unitNumber: unit.unitNumber,
      bulkSkuId: unit.bulkSkuId,
    };
  }

  const asset = await findAssetByScanValue(scanValue, { id: true, assetTag: true, name: true });
  if (!asset) return null;
  const item = await db.bookingSerializedItem.findUnique({
    where: { bookingId_assetId: { bookingId, assetId: asset.id } },
    select: { allocationStatus: true },
  });
  if (item?.allocationStatus !== "returned") return null;
  return { id: asset.id, name: asset.name || asset.assetTag, tagName: asset.assetTag };
}
