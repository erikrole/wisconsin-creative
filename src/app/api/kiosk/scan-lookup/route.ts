import { BookingCustodyScope } from "@prisma/client";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { findAssetByScanValue } from "@/lib/services/kiosk-scan";
import { findBulkUnitByScanValue } from "@/lib/services/bulk-unit-scans";
import { scanLookupBody } from "@/lib/schemas/kiosk";
import { displayBookingTitle } from "@/lib/booking-display-title";
import { checkUpcomingSerializedCommitments } from "@/lib/services/availability";

/** Look up an item by QR code or asset tag */
export const POST = withKiosk(async (req, { kiosk }) => {
  await enforceRateLimit(`kiosk:scan-lookup:${kiosk.kioskId}`, { max: 120, windowMs: 60_000 });
  await enforceRateLimit(`kiosk:scan-lookup:${kiosk.kioskId}:hour`, { max: 1_000, windowMs: 60 * 60_000 });
  const { scanValue } = scanLookupBody.parse(await req.json());

  const asset = await findAssetByScanValue(scanValue, {
    id: true,
    assetTag: true,
    name: true,
    status: true,
    category: { select: { name: true } },
  });

  if (!asset) {
    const unit = await findBulkUnitByScanValue(scanValue);
    if (unit) {
      // Numbered units are reserved by count, not by unit, so no unit has a
      // "free until"; last back is when its latest custody episode closed.
      const lastUnitReturn = await db.bookingBulkUnitAllocation.findFirst({
        where: { bulkSkuUnitId: unit.id, checkedInAt: { not: null } },
        orderBy: { checkedInAt: "desc" },
        select: { checkedInAt: true },
      });
      const status = unit.status === "CHECKED_OUT"
        ? unit.dueAt && new Date(unit.dueAt) < new Date()
          ? "Overdue"
          : "Checked Out"
        : unit.status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

      return ok({
        item: {
          id: unit.id,
          tagName: unit.tagName,
          productName: unit.name,
          type: unit.bulkSkuName,
          status,
          holder: unit.holder,
          dueAt: unit.dueAt,
          bookingTitle: unit.bookingTitle ? displayBookingTitle(unit.bookingTitle) : unit.bookingTitle,
          freeUntil: null,
          lastReturnedAt: lastUnitReturn?.checkedInAt ?? null,
        },
      });
    }

    throw new HttpError(404, "Item not found");
  }

  // Check if checked out
  let holder: string | undefined;
  let dueAt: string | undefined;
  let bookingTitle: string | undefined;

  const now = new Date();
  const [activeAllocation, upcoming, lastReturn] = await Promise.all([
    db.assetAllocation.findFirst({
      where: {
        assetId: asset.id,
        active: true,
      },
      select: {
        endsAt: true,
        booking: {
          select: {
            title: true,
            custodyScope: true,
            requester: { select: { name: true } },
          },
        },
      },
    }),
    // "Free until": the next reservation or checkout claiming this asset,
    // by the same rule availability uses for upcoming commitments.
    checkUpcomingSerializedCommitments(db, { serializedAssetIds: [asset.id], endsAt: now }),
    // "Last back": when its latest checkout allocation closed (return or
    // removal from a checkout), via the indexed asset allocation history.
    db.assetAllocation.findFirst({
      where: { assetId: asset.id, active: false, kind: "CHECKOUT" },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  if (activeAllocation) {
    // Shared (custodian-neutral) custody never discloses the requester's
    // name, matching numbered-unit lookups and availability conflicts.
    holder = activeAllocation.booking.custodyScope === BookingCustodyScope.SHARED
      ? undefined
      : activeAllocation.booking.requester?.name ?? undefined;
    dueAt = activeAllocation.endsAt.toISOString();
    bookingTitle = displayBookingTitle(activeAllocation.booking.title);
  }

  // Determine display status
  let status = "Available";
  if (asset.status === "MAINTENANCE") status = "In Maintenance";
  else if (asset.status === "RETIRED") status = "Retired";
  else if (activeAllocation) {
    status =
      activeAllocation.endsAt < new Date() ? "Overdue" : "Checked Out";
  }

  return ok({
    item: {
      id: asset.id,
      tagName: asset.assetTag,
      productName: asset.name || asset.assetTag,
      type: asset.category?.name || "Unknown",
      status,
      holder,
      dueAt,
      bookingTitle,
      freeUntil: upcoming[0]?.startsAt ?? null,
      lastReturnedAt: lastReturn?.updatedAt ?? null,
    },
  });
});
