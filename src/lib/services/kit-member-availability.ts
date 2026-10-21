import type { AssetStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { enrichAssetsWithStatusFromLoaded } from "@/lib/services/status";
import { displayBookingTitle } from "@/lib/booking-display-title";

export type KitMemberHolder = {
  bookingId: string;
  bookingTitle: string;
  holderName: string;
  endsAt: string;
};

type MemberAsset = {
  id: string;
  status: AssetStatus;
};

type KitWithMembers = {
  members: Array<{ asset: MemberAsset }>;
};

/**
 * Kit rows store shelf status only. Checked-out and pending-pickup gear stays
 * AVAILABLE on the asset row, so callers must attach the derived status.
 */
export async function attachKitMemberAvailability<T extends KitWithMembers>(kit: T): Promise<Omit<T, "members"> & {
  members: Array<Omit<T["members"][number], "asset"> & {
    asset: T["members"][number]["asset"] & {
      computedStatus: string;
      currentHolder: KitMemberHolder | null;
    };
  }>;
}> {
  const enriched = await enrichAssetsWithStatusFromLoaded(kit.members.map((member) => member.asset));
  const statusById = new Map(enriched.map((asset) => [asset.id, asset.computedStatus]));
  const unavailableIds = enriched
    .filter((asset) => asset.computedStatus === "CHECKED_OUT" || asset.computedStatus === "PENDING_PICKUP")
    .map((asset) => asset.id);
  const holders = await loadKitMemberHolders(unavailableIds);

  return {
    ...kit,
    members: kit.members.map((member) => ({
      ...member,
      asset: {
        ...member.asset,
        computedStatus: statusById.get(member.asset.id) ?? "AVAILABLE",
        currentHolder: holders.get(member.asset.id) ?? null,
      },
    })),
  } as Omit<T, "members"> & {
    members: Array<Omit<T["members"][number], "asset"> & {
      asset: T["members"][number]["asset"] & {
        computedStatus: string;
        currentHolder: KitMemberHolder | null;
      };
    }>;
  };
}

async function loadKitMemberHolders(assetIds: string[]) {
  const holders = new Map<string, KitMemberHolder>();
  if (assetIds.length === 0) return holders;

  const allocations = await db.assetAllocation.findMany({
    where: {
      assetId: { in: assetIds },
      active: true,
      booking: { status: { in: ["BOOKED", "PENDING_PICKUP", "OPEN"] } },
    },
    select: {
      assetId: true,
      booking: {
        select: {
          id: true,
          title: true,
          endsAt: true,
          requester: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  for (const allocation of allocations) {
    if (holders.has(allocation.assetId)) continue;
    holders.set(allocation.assetId, {
      bookingId: allocation.booking.id,
      bookingTitle: displayBookingTitle(allocation.booking.title),
      holderName: allocation.booking.requester.name,
      endsAt: allocation.booking.endsAt.toISOString(),
    });
  }

  return holders;
}
