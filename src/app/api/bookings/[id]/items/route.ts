import { BookingKind, Prisma } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { getBookingDetail } from "@/lib/services/bookings";
import { getAllowedBookingActions, requireBookingAction } from "@/lib/services/booking-rules";
import { maybeAutoComplete } from "@/lib/services/bookings-checkin";
import { endCheckoutReturnLiveActivities } from "@/lib/services/live-activities";
import {
  addSerializedAssetToActiveCheckout,
  removeItemFromActiveCheckout,
  requireEditableCheckout,
} from "@/lib/services/kiosk-active-checkout-items";

const addItemsSchema = z.object({
  assetId: z.string().min(1),
});

/** Admin-only: put one more item on an active checkout from the web. */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { assetId } = addItemsSchema.parse(await req.json());
  await requireBookingAction(params.id, user, "edit-items", BookingKind.CHECKOUT);

  await db.$transaction(async (tx) => {
    const booking = await requireEditableCheckout(tx, { checkoutId: params.id });
    const now = new Date();
    if (booking.endsAt.getTime() <= now.getTime()) {
      throw new HttpError(409, "This checkout is overdue. Update the return time before adding items.");
    }
    const asset = await tx.asset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        assetTag: true,
        name: true,
        imageUrl: true,
        status: true,
        category: { select: { name: true } },
      },
    });
    if (!asset) throw new HttpError(404, "Item not found");
    const result = await addSerializedAssetToActiveCheckout(tx, {
      actor: user,
      booking,
      asset,
      now,
      auditAction: "checkout_item_added",
      audit: { addedFrom: "web" },
    });
    if (!result.success) throw new HttpError(409, result.error ?? "Could not add item");
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  const refreshed = await getBookingDetail(params.id);
  return ok({ data: { ...refreshed, allowedActions: getAllowedBookingActions(user, refreshed) } });
});

const removeItemSchema = z.union([
  z.object({ assetId: z.string().min(1) }),
  z.object({ bulkSkuId: z.string().min(1), unitNumber: z.number().int().positive() }),
]);

/** Admin-only: take an item off an active checkout without a scan. */
export const DELETE = withAuth<{ id: string }>(async (req, { user, params }) => {
  const target = removeItemSchema.parse(await req.json());
  await requireBookingAction(params.id, user, "edit-items", BookingKind.CHECKOUT);

  const completed = await db.$transaction(async (tx) => {
    const booking = await requireEditableCheckout(tx, { checkoutId: params.id });
    const removed = await removeItemFromActiveCheckout(tx, {
      actor: user,
      booking,
      target,
      locationId: booking.locationId,
      auditAction: "checkout_item_removed",
      audit: { removedFrom: "web" },
    });
    if (!removed.success) throw new HttpError(409, removed.error ?? "Could not remove item");
    // Taking off the last item closes the checkout the same way a return does.
    return maybeAutoComplete(tx, booking.id, booking.locationId, user.id, {
      auditAction: "auto_completed_by_item_removal",
      returnedFor: booking,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (completed) await endCheckoutReturnLiveActivities(params.id);

  const refreshed = await getBookingDetail(params.id);
  return ok({ data: { ...refreshed, allowedActions: getAllowedBookingActions(user, refreshed) } });
});
