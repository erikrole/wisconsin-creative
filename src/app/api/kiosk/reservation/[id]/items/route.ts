import { z } from "zod";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { bookingSnapshotMatches } from "@/lib/booking-concurrency";
import { findAssetByScanValue } from "@/lib/services/kiosk-scan";
import { findBulkUnitByScanValue } from "@/lib/services/bulk-unit-scans";
import { updateReservation } from "@/lib/services/bookings-lifecycle";
import {
  assertKioskPickupPlanActor,
  kioskPickupPlanActorSelect,
} from "@/lib/services/kiosk-pickup-add";
import { kioskRosterUserWhere } from "@/lib/user-visibility";
import { MAX_EQUIPMENT_SELECTIONS_PER_REQUEST } from "@/lib/request-limits";

const bodySchema = z.object({
  actorId: z.string().min(1), expectedUpdatedAt: z.string().datetime({ offset: true }),
  action: z.enum(["add", "remove", "quantity"]),
  scanValue: z.string().trim().min(1).max(256).optional(),
  itemId: z.string().min(1).optional(),
  quantity: z.number().int().min(0).max(MAX_EQUIPMENT_SELECTIONS_PER_REQUEST).optional(),
});

async function context(id: string, actorId: string) {
  const [booking, actor] = await Promise.all([
    db.booking.findUnique({
      where: { id },
      include: {
        serializedItems: { include: { asset: true } },
        bulkItems: { include: { bulkSku: true } },
        derivedCheckouts: { select: { id: true } },
      },
    }),
    db.user.findFirst({
      where: { id: actorId, ...kioskRosterUserWhere() },
      select: kioskPickupPlanActorSelect,
    }),
  ]);
  if (!booking || booking.kind !== "RESERVATION" || booking.status !== "BOOKED") throw new HttpError(404, "Open reservation not found");
  if (!actor) throw new HttpError(403, "Choose an active operator");
  assertKioskPickupPlanActor(booking, actor);
  return { booking, actor };
}

function manifest(booking: Awaited<ReturnType<typeof context>>["booking"]) {
  return { id: booking.id, title: booking.title, updatedAt: booking.updatedAt, items: [
    ...booking.serializedItems.map((item) => ({ id: item.id, assetId: item.assetId, name: item.asset.name || item.asset.assetTag, quantity: item.allocationStatus === "picked_up" ? 0 : 1, pickedQuantity: item.allocationStatus === "picked_up" ? 1 : 0 })),
    ...booking.bulkItems.map((item) => ({ id: item.id, bulkSkuId: item.bulkSkuId, name: item.bulkSku.name, quantity: Math.max(0, item.plannedQuantity - item.checkedOutQuantity), pickedQuantity: item.checkedOutQuantity })),
  ] };
}

function pickupAlreadyStarted(booking: Awaited<ReturnType<typeof context>>["booking"]) {
  return booking.serializedItems.some((item) => item.allocationStatus === "picked_up")
    || booking.bulkItems.some((item) => (item.checkedOutQuantity ?? 0) > 0)
    || booking.derivedCheckouts.length > 0;
}

export const GET = withKiosk<{ id: string }>(async (req, { params }) => {
  const actorId = new URL(req.url).searchParams.get("actorId") ?? "";
  return ok(manifest((await context(params.id, actorId)).booking));
});

export const POST = withKiosk<{ id: string }>(async (req, { params }) => {
  const body = bodySchema.parse(await req.json());
  const { booking } = await context(params.id, body.actorId);
  if (!bookingSnapshotMatches(booking.updatedAt, new Date(body.expectedUpdatedAt))) {
    throw new HttpError(409, "This reservation changed. Refresh its items before editing.");
  }
  let assetIds = booking.serializedItems.map((item) => item.assetId);
  let bulkItems = booking.bulkItems.map((item) => ({ bulkSkuId: item.bulkSkuId, quantity: item.plannedQuantity }));
  if (body.action === "add") {
    if (!body.scanValue) throw new HttpError(400, "Scan or enter an item code");
    const unit = await findBulkUnitByScanValue(body.scanValue);
    const asset = unit ? null : await findAssetByScanValue(body.scanValue, { id: true });
    const sku = unit ? { id: unit.bulkSkuId } : asset ? null : await db.bulkSku.findFirst({ where: { active: true, OR: [{ id: body.scanValue }, { binQrCodeValue: body.scanValue }] }, select: { id: true } });
    if (asset) {
      if (assetIds.includes(asset.id)) throw new HttpError(409, "This item is already reserved or was already picked up");
      assetIds.push(asset.id);
    } else if (sku) {
      const existing = bulkItems.find((item) => item.bulkSkuId === sku.id);
      if (existing) existing.quantity += 1;
      else bulkItems.push({ bulkSkuId: sku.id, quantity: 1 });
    } else throw new HttpError(404, "Item not found. Enter its asset tag or scan its label.");
  } else {
    const serialized = booking.serializedItems.find((item) => item.id === body.itemId);
    const bulk = booking.bulkItems.find((item) => item.id === body.itemId);
    if (serialized) {
      if (serialized.allocationStatus === "picked_up") throw new HttpError(409, "Already picked-up items stay in history. Use their checkout to return or transfer them.");
      if (body.action !== "remove") throw new HttpError(400, "Individual items have a quantity of one");
      assetIds = assetIds.filter((id) => id !== serialized.assetId);
    } else if (bulk) {
      const remaining = body.action === "remove" ? 0 : body.quantity;
      if (remaining === undefined) throw new HttpError(400, "Enter the quantity still reserved");
      bulkItems = bulkItems.filter((item) => item.bulkSkuId !== bulk.bulkSkuId);
      if (remaining + bulk.checkedOutQuantity > 0) bulkItems.push({ bulkSkuId: bulk.bulkSkuId, quantity: remaining + bulk.checkedOutQuantity });
    } else throw new HttpError(404, "Reservation item not found");
  }
  if (assetIds.length + bulkItems.reduce((sum, item) => sum + item.quantity, 0) > MAX_EQUIPMENT_SELECTIONS_PER_REQUEST) throw new HttpError(400, "This reservation has too many items");
  if (!assetIds.length && !bulkItems.length && !pickupAlreadyStarted(booking)) {
    throw new HttpError(409, "Keep at least one reserved item, or cancel the reservation from its booking page.");
  }
  const updated = await updateReservation(booking.id, body.actorId, { serializedAssetIds: assetIds, bulkItems }, new Date(body.expectedUpdatedAt));
  return ok({ success: true, message: "Reservation updated. Scans for items still on this pickup were kept.", updatedAt: updated.updatedAt });
});
