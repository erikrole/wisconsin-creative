import { BookingKind, Prisma } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { getBookingDetail } from "@/lib/services/bookings";
import { getAllowedBookingActions, requireBookingAction } from "@/lib/services/booking-rules";
import {
  addSerializedAssetToActiveCheckout,
  requireEditableCheckout,
} from "@/lib/services/kiosk-active-checkout-items";

const addItemsSchema = z.object({
  assetId: z.string().min(1),
});

/** Admin-only: put one more numbered item on an active checkout from the web. */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { assetId } = addItemsSchema.parse(await req.json());
  await requireBookingAction(params.id, user, "add-items", BookingKind.CHECKOUT);

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
