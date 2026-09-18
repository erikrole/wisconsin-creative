import { BookingKind } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { generateEventTitle } from "@/lib/sports";
import {
  isEventDerivedTitle,
  mergeReuseEquipment,
  type ReuseBulkItem,
  type ReuseSerializedAsset,
  type ReuseSerializedItem,
} from "@/lib/reservation-reuse";

const assetSelect = {
  id: true,
  assetTag: true,
  name: true,
  brand: true,
  model: true,
  serialNumber: true,
  type: true,
  imageUrl: true,
  qrCodeValue: true,
  location: { select: { id: true, name: true } },
  category: { select: { name: true } },
} as const;

function toReuseAsset(asset: {
  id: string;
  assetTag: string;
  name: string | null;
  brand: string;
  model: string;
  serialNumber: string | null;
  type: string;
  imageUrl: string | null;
  qrCodeValue: string;
  location: { id: string; name: string } | null;
  category: { name: string } | null;
}): ReuseSerializedAsset {
  return {
    id: asset.id,
    assetTag: asset.assetTag,
    name: asset.name ?? "",
    brand: asset.brand,
    model: asset.model,
    serialNumber: asset.serialNumber ?? "",
    type: asset.type,
    computedStatus: "AVAILABLE",
    imageUrl: asset.imageUrl,
    qrCodeValue: asset.qrCodeValue,
    categoryName: asset.category?.name ?? null,
    location: asset.location,
  };
}

export type BookingReusePlan = {
  sourceId: string;
  kind: "RESERVATION" | "CHECKOUT";
  title: string;
  notes: string | null;
  requesterUserId: string;
  requesterName: string | null;
  custodyScope: "PERSON" | "SHARED";
  locationId: string;
  kitId: string | null;
  kitName: string | null;
  sportCode: string | null;
  keepTitle: boolean;
  startsAt: string;
  endsAt: string;
  events: Array<{
    id: string;
    summary: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    sportCode: string | null;
    opponent: string | null;
    isHome: boolean | null;
  }>;
  serializedItems: ReuseSerializedItem[];
  bulkItems: ReuseBulkItem[];
};

export async function getBookingReusePlan(bookingId: string): Promise<BookingReusePlan> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      kind: true,
      title: true,
      notes: true,
      requesterUserId: true,
      custodyScope: true,
      locationId: true,
      kitId: true,
      sportCode: true,
      startsAt: true,
      endsAt: true,
      requester: { select: { name: true } },
      kit: { select: { id: true, name: true } },
      serializedItems: {
        select: {
          assetId: true,
          asset: { select: assetSelect },
        },
      },
      bulkItems: {
        select: {
          bulkSkuId: true,
          plannedQuantity: true,
          bulkSku: { select: { id: true, name: true } },
        },
      },
      events: {
        orderBy: { ordinal: "asc" },
        select: {
          event: {
            select: {
              id: true,
              summary: true,
              startsAt: true,
              endsAt: true,
              allDay: true,
              sportCode: true,
              opponent: true,
              isHome: true,
            },
          },
        },
      },
      derivedCheckouts: {
        orderBy: { createdAt: "asc" },
        select: {
          serializedItems: {
            select: {
              assetId: true,
              asset: { select: assetSelect },
            },
          },
          bulkItems: {
            select: {
              bulkSkuId: true,
              plannedQuantity: true,
              bulkSku: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  if (!booking) {
    throw new HttpError(404, "Booking not found");
  }

  const sourceItems = {
    serializedItems: booking.serializedItems.map((item) => ({
      assetId: item.assetId,
      asset: toReuseAsset(item.asset),
    })),
    bulkItems: booking.bulkItems.map((item) => ({
      bulkSkuId: item.bulkSkuId,
      plannedQuantity: item.plannedQuantity,
      bulkSku: item.bulkSku,
    })),
  };
  const linkedCheckouts = booking.kind === BookingKind.RESERVATION
    ? booking.derivedCheckouts.map((checkout) => ({
      serializedItems: checkout.serializedItems.map((item) => ({
        assetId: item.assetId,
        asset: toReuseAsset(item.asset),
      })),
      bulkItems: checkout.bulkItems.map((item) => ({
        bulkSkuId: item.bulkSkuId,
        plannedQuantity: item.plannedQuantity,
        bulkSku: item.bulkSku,
      })),
    }))
    : [];
  const equipment = mergeReuseEquipment(sourceItems, linkedCheckouts);
  const linkedEvents = booking.events.map((link) => ({
    id: link.event.id,
    summary: link.event.summary,
    startsAt: link.event.startsAt.toISOString(),
    endsAt: link.event.endsAt.toISOString(),
    allDay: link.event.allDay,
    sportCode: link.event.sportCode,
    opponent: link.event.opponent,
    isHome: link.event.isHome,
  }));
  const primaryEvent = linkedEvents[0];
  const generatedTitle = primaryEvent
    ? (primaryEvent.opponent && (primaryEvent.sportCode || booking.sportCode)
      ? generateEventTitle(primaryEvent.sportCode || booking.sportCode || "", primaryEvent.opponent, primaryEvent.isHome)
      : primaryEvent.summary)
    : null;

  return {
    sourceId: booking.id,
    kind: booking.kind,
    title: booking.title,
    notes: booking.notes,
    requesterUserId: booking.requesterUserId,
    requesterName: booking.requester?.name ?? null,
    custodyScope: booking.custodyScope,
    locationId: booking.locationId,
    kitId: booking.kitId,
    kitName: booking.kit?.name ?? null,
    sportCode: booking.sportCode,
    keepTitle: !isEventDerivedTitle(booking.title, linkedEvents, generatedTitle),
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    events: linkedEvents,
    serializedItems: equipment.serializedItems,
    bulkItems: equipment.bulkItems,
  };
}
