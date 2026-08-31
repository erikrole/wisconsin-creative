import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { findAssetByScanValue } from "@/lib/services/kiosk-scan";
import { pickupScanBody } from "@/lib/schemas/kiosk";
import { scanKioskPickupBulkUnit, stageKioskReservationPickupBulkUnit } from "@/lib/services/bulk-unit-scans";

/**
 * Scan an item for kiosk pickup flow.
 * Validates that the scanned item belongs to the PENDING_PICKUP checkout or
 * due BOOKED reservation.
 */
export const POST = withKiosk<{ id: string }>(async (req, { params }) => {
  const { scanValue } = pickupScanBody.parse(await req.json());

  const booking = await db.booking.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, kind: true, requesterUserId: true, locationId: true },
  });

  if (
    !booking ||
    !(
      (booking.kind === "CHECKOUT" && booking.status === "PENDING_PICKUP") ||
      (booking.kind === "RESERVATION" && booking.status === "BOOKED")
    )
  ) {
    throw new HttpError(404, "Pending pickup not found");
  }
  const activeBooking = booking;

  const bulkResult = await db.$transaction(
    (tx) => activeBooking.kind === "RESERVATION"
      ? stageKioskReservationPickupBulkUnit(tx, {
          bookingId: params.id,
          scanValue,
          deviceContext: req.headers.get("user-agent") ?? "kiosk",
        })
      : scanKioskPickupBulkUnit(tx, { bookingId: params.id, scanValue }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (bulkResult.handled) {
    return ok(bulkResult);
  }

  const asset = await findAssetByScanValue(scanValue, {
    id: true,
    assetTag: true,
    name: true,
  });

  if (!asset) {
    return ok({ success: false, error: "Item not found" });
  }

  const bookingItem = await db.bookingSerializedItem.findUnique({
    where: { bookingId_assetId: { bookingId: params.id, assetId: asset.id } },
  });

  if (!bookingItem) {
    const error = `${asset.assetTag} is not in this checkout`;
    return ok({ success: false, error });
  }
  if (activeBooking.kind === "RESERVATION" && bookingItem.allocationStatus === "picked_up") {
    const label = asset.name || asset.assetTag;
    return ok({ success: false, error: `${label} already picked up`, errorCode: "duplicate" });
  }

  const existingScan = await db.scanEvent.findFirst({
    where: {
      bookingId: activeBooking.id,
      phase: "CHECKOUT",
      success: true,
      assetId: asset.id,
    },
    select: { id: true },
  });
  if (existingScan) {
    const label = asset.name || asset.assetTag;
    return ok({ success: false, error: `${label} already scanned`, errorCode: "duplicate" });
  }

  await db.$transaction(async (tx) => {
    await tx.scanEvent.create({
      data: {
        bookingId: activeBooking.id,
        actorUserId: activeBooking.requesterUserId,
        scanType: "SERIALIZED",
        scanValue,
        success: true,
        phase: "CHECKOUT",
        assetId: asset.id,
        deviceContext: req.headers.get("user-agent") ?? "kiosk",
      },
    });
  });

  return ok({
    success: true,
    item: {
      id: asset.id,
      name: asset.name || asset.assetTag,
      tagName: asset.assetTag,
    },
  });
});
