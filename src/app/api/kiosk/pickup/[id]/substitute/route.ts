import { withKiosk } from "@/lib/api";
import { ok } from "@/lib/http";
import { pickupSubstituteBody } from "@/lib/schemas/kiosk";
import { substituteReservationPickupItem } from "@/lib/services/kiosk-pickup-substitute";

/**
 * Swap a remaining reserved item for the serialized asset just scanned and
 * stage that scan on the reservation. Custody still opens only at confirm.
 */
export const POST = withKiosk<{ id: string }>(async (req, { params }) => {
  const body = pickupSubstituteBody.parse(await req.json());
  const result = await substituteReservationPickupItem({
    bookingId: params.id,
    actorUserId: body.actorId,
    scanValue: body.scanValue,
    reservedAssetId: body.reservedAssetId,
    deviceContext: req.headers.get("user-agent") ?? "kiosk",
  });
  return ok(result);
});
