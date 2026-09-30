import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { ok } from "@/lib/http";
import { createAuditEntryTx } from "@/lib/audit";
import { activeCheckoutSwapItemBody } from "@/lib/schemas/kiosk";
import { findAssetByScanValue } from "@/lib/services/kiosk-scan";
import { findBulkUnitByScanValue } from "@/lib/services/bulk-unit-scans";
import { assertKioskCheckoutEditor, requireKioskActor } from "@/lib/services/kiosk-actor";
import {
  addScannedItemToActiveCheckout,
  isSameAssetModel,
  removeActiveCheckoutItem,
  requireEditableCheckout,
} from "@/lib/services/kiosk-active-checkout-items";

/** Thrown inside the transaction so a failed add rolls the removal back. */
class SwapRejected extends Error {}

/**
 * POST /api/kiosk/checkout/[id]/swap — replace one unit on an active checkout
 * with another of the same product in ONE serializable transaction (frame H4,
 * plain swap). Reuses the exact add/remove paths behind
 * `POST`/`DELETE /api/kiosk/checkout/[id]`, so the editor rule, availability,
 * ledger, and audit are identical; if the add is refused, the removal rolls
 * back and the checkout is unchanged.
 */
export const POST = withKiosk<{ id: string }>(async (req, { kiosk, params }) => {
  const body = activeCheckoutSwapItemBody.parse(await req.json());
  const { actorId, remove, scanValue } = body;

  const bulkUnit = await findBulkUnitByScanValue(scanValue);
  const asset = bulkUnit ? null : await findAssetByScanValue(scanValue, {
    id: true,
    assetTag: true,
    name: true,
    imageUrl: true,
    status: true,
    brand: true,
    model: true,
    category: { select: { name: true } },
  });
  if (!bulkUnit && !asset) return ok({ success: false, error: "Item not found" });

  try {
    const result = await db.$transaction(async (tx) => {
      const actor = await requireKioskActor(tx, actorId);
      const booking = await requireEditableCheckout(tx, { checkoutId: params.id });
      assertKioskCheckoutEditor(actor, booking);

      let removedLabel: string;
      if ("assetId" in remove) {
        if (!asset) return { success: false, error: "Scan another one of the same item to swap it." };
        const current = await tx.bookingSerializedItem.findUnique({
          where: { bookingId_assetId: { bookingId: booking.id, assetId: remove.assetId } },
          select: { allocationStatus: true, asset: { select: { assetTag: true, name: true, brand: true, model: true } } },
        });
        if (!current || current.allocationStatus !== "active") {
          return { success: false, error: "Item is not active on this checkout" };
        }
        if (asset.id === remove.assetId) {
          return { success: false, error: `${asset.assetTag} is the one being swapped out. Scan a different one.` };
        }
        if (!isSameAssetModel(current.asset, asset)) {
          return {
            success: false,
            error: `${asset.assetTag} isn't the same model as ${current.asset.assetTag}. Scan another ${current.asset.name || current.asset.model}.`,
          };
        }
        removedLabel = current.asset.assetTag;
      } else {
        if (!bulkUnit || bulkUnit.bulkSkuId !== remove.bulkSkuId) {
          return { success: false, error: "Scan another battery of the same kind to swap it." };
        }
        if (bulkUnit.unitNumber === remove.unitNumber) {
          return { success: false, error: `#${remove.unitNumber} is the one being swapped out. Scan a different one.` };
        }
        removedLabel = `#${remove.unitNumber}`;
      }

      const removed = await removeActiveCheckoutItem(tx, { actor, booking, kiosk, target: remove });
      if (!removed.success) return removed;
      const added = await addScannedItemToActiveCheckout(tx, { actor, booking, kiosk, scanValue, bulkUnit, asset });
      if (!added.success) throw new SwapRejected(added.error ?? "The replacement could not be added");

      const addedLabel = asset ? asset.assetTag : `#${bulkUnit!.unitNumber}`;
      await createAuditEntryTx(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "booking",
        entityId: booking.id,
        action: "kiosk_checkout_item_swapped",
        before: "assetId" in remove ? { assetId: remove.assetId } : { bulkSkuId: remove.bulkSkuId, unitNumber: remove.unitNumber },
        after: {
          ...(asset ? { assetId: asset.id } : { bulkSkuId: bulkUnit!.bulkSkuId, unitNumber: bulkUnit!.unitNumber }),
          kioskDeviceId: kiosk.kioskId,
          kioskName: kiosk.name,
        },
      });

      return {
        success: true,
        message: `Swapped ${removedLabel} for ${addedLabel}`,
        removed: "assetId" in remove
          ? { assetId: remove.assetId, tagName: removedLabel }
          : { bulkSkuId: remove.bulkSkuId, unitNumber: remove.unitNumber, tagName: removedLabel },
        added: asset
          ? { assetId: asset.id, tagName: asset.assetTag, name: asset.name || asset.assetTag }
          : { bulkSkuId: bulkUnit!.bulkSkuId, unitNumber: bulkUnit!.unitNumber, tagName: addedLabel, name: bulkUnit!.name },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return ok(result);
  } catch (error) {
    if (error instanceof SwapRejected) return ok({ success: false, error: error.message });
    throw error;
  }
});
