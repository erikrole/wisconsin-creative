import { BookingKind } from "@prisma/client";
import { withKiosk } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { checkoutAvailabilityBody } from "@/lib/schemas/kiosk";
import { checkAvailability } from "@/lib/services/availability";
import { bulkRequestsFromCheckoutUnits, normalizeCheckoutCompleteItems } from "@/lib/services/kiosk-checkout-complete";
import { parseDateRange } from "@/lib/time";

export const POST = withKiosk(async (req, { kiosk }) => {
  const body = checkoutAvailabilityBody.parse(await req.json());
  const { assetIds, bulkUnitItems } = normalizeCheckoutCompleteItems(body.items);
  const { start, end } = parseDateRange(body.startsAt, body.endsAt);

  const result = await checkAvailability(db, {
    locationId: kiosk.locationId,
    startsAt: start,
    endsAt: end,
    serializedAssetIds: assetIds,
    bulkItems: bulkRequestsFromCheckoutUnits(bulkUnitItems),
    bookingKind: BookingKind.CHECKOUT,
  });

  return ok(result);
});
