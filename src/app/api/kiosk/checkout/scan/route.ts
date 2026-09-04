import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { ok } from "@/lib/http";
import { findAssetByScanValue } from "@/lib/services/kiosk-scan";
import { findBulkUnitByScanValue } from "@/lib/services/bulk-unit-scans";
import { checkoutScanBody } from "@/lib/schemas/kiosk";
import { formatAvailabilityDeadline } from "@/lib/availability-copy";

/**
 * Scan an item for kiosk checkout.
 * Validates the item exists and is available, returns item info.
 * Does NOT create a booking yet — that happens on complete.
 */
export const POST = withKiosk(async (req) => {
  const { scanValue } = checkoutScanBody.parse(await req.json());

  const bulkUnit = await findBulkUnitByScanValue(scanValue);
  if (bulkUnit) {
    if (bulkUnit.status === "CHECKED_OUT") {
      const error = `${bulkUnit.name} is checked out${bulkUnit.holder ? ` by ${bulkUnit.holder}` : ""}`;
      return ok({ success: false, error });
    }

    if (bulkUnit.status !== "AVAILABLE") {
      const error = `${bulkUnit.name} is marked ${bulkUnit.status.toLowerCase().replace(/_/g, " ")}`;
      return ok({ success: false, error });
    }

    return ok({
      success: true,
      item: {
        id: `bulk:${bulkUnit.bulkSkuId}:unit:${bulkUnit.unitNumber}`,
        name: bulkUnit.name,
        tagName: bulkUnit.tagName,
        type: bulkUnit.type,
        imageUrl: bulkUnit.imageUrl,
        bulkSkuId: bulkUnit.bulkSkuId,
        unitNumber: bulkUnit.unitNumber,
      },
    });
  }

  const asset = await findAssetByScanValue(scanValue, {
    id: true,
    assetTag: true,
    name: true,
    imageUrl: true,
    status: true,
    category: { select: { name: true } },
  });

  if (!asset) {
    return ok({ success: false, error: "Item not found" });
  }

  if (asset.status === "RETIRED") {
    const error = `${asset.assetTag} is retired`;
    return ok({ success: false, error });
  }

  if (asset.status === "MAINTENANCE") {
    const error = `${asset.assetTag} is in maintenance`;
    return ok({ success: false, error });
  }

  const activeAllocation = await db.assetAllocation.findFirst({
    where: {
      assetId: asset.id,
      active: true,
      kind: "CHECKOUT",
    },
    select: {
      endsAt: true,
      booking: {
        select: {
          requester: { select: { name: true } },
        },
      },
    },
  });

  if (activeAllocation) {
    const itemName = asset.name || asset.assetTag;
    const error = `${activeAllocation.booking.requester.name} has checked out the ${itemName} until ${formatAvailabilityDeadline(activeAllocation.endsAt)}`;
    return ok({ success: false, error });
  }

  return ok({
    success: true,
    item: {
      id: asset.id,
      name: asset.name || asset.assetTag,
      tagName: asset.assetTag,
      type: asset.category?.name || "Unknown",
      imageUrl: asset.imageUrl,
    },
  });
});
