import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { locationsShareKitPickup } from "@/lib/reservation-pickup-locations";
import { getKitDetail } from "@/lib/services/kits";

export const GET = withKiosk<{ id: string }>(async (_req, { kiosk, params }) => {
  const kit = await getKitDetail(params.id);
  if (!kit.active) {
    throw new HttpError(400, `${kit.name} is archived and cannot be added to a booking`);
  }
  if (!locationsShareKitPickup(kit.location.name, kiosk.locationName)) {
    throw new HttpError(400, `${kit.name} belongs to ${kit.location.name}, not this pickup location`);
  }
  return ok({
    data: {
      id: kit.id,
      name: kit.name,
      sportCode: kit.sportCode,
      gamedayRole: kit.gamedayRole,
      members: kit.members.map((member) => ({
        id: member.asset.id,
        assetTag: member.asset.assetTag,
        name: member.asset.name,
      })),
      bulkMembers: kit.bulkMembers.map((member) => ({
        bulkSkuId: member.bulkSku.id,
        name: member.bulkSku.name,
        quantity: member.quantity,
      })),
    },
  });
});
