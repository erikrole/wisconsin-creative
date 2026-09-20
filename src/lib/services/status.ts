import { AssetStatus, BookingKind, BookingStatus, type PrismaClient, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Effective status values that combine the stored AssetStatus with
 * real-time allocation data. CHECKED_OUT, PENDING_PICKUP, and RESERVED are never stored
 * on the Asset row — they're derived from active bookings.
 */
type EffectiveStatus =
  | "AVAILABLE"
  | "CHECKED_OUT"
  | "PENDING_PICKUP"
  | "RESERVED"
  | "MAINTENANCE"
  | "RETIRED";

/**
 * Derive the effective status for a single asset.
 *
 * Logic:
 * 1. If the stored status is MAINTENANCE or RETIRED, return that.
 * 2. If there's an active allocation on an OPEN checkout, return CHECKED_OUT.
 * 3. If there's an active allocation on a legacy PENDING_PICKUP checkout, return PENDING_PICKUP.
 * 4. If there's an active allocation on a BOOKED reservation whose scheduled
 *    pickup time has passed, return PENDING_PICKUP.
 * 5. Otherwise, AVAILABLE.
 */
export async function deriveAssetStatus(
  assetId: string,
  client?: PrismaClient | Prisma.TransactionClient
): Promise<EffectiveStatus> {
  const statuses = await deriveAssetStatuses([assetId], client);
  return statuses.get(assetId) ?? "AVAILABLE";
}

/**
 * Derive effective statuses for a batch of assets in two queries.
 * Returns a Map<assetId, EffectiveStatus>.
 */
export async function deriveAssetStatuses(
  assetIds: string[],
  client?: PrismaClient | Prisma.TransactionClient
): Promise<Map<string, EffectiveStatus>> {
  if (assetIds.length === 0) return new Map();

  const tx = client ?? db;
  const now = new Date();

  // 1. Fetch stored statuses
  const assets = await tx.asset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, status: true }
  });

  const result = new Map<string, EffectiveStatus>();

  // Separate assets that need allocation checks from those with terminal statuses
  const needsAllocationCheck: string[] = [];
  for (const asset of assets) {
    if (asset.status === AssetStatus.MAINTENANCE) {
      result.set(asset.id, "MAINTENANCE");
    } else if (asset.status === AssetStatus.RETIRED) {
      result.set(asset.id, "RETIRED");
    } else {
      needsAllocationCheck.push(asset.id);
    }
  }

  if (needsAllocationCheck.length === 0) return result;

  // 2. Find active allocations for AVAILABLE assets
  const activeAllocations = await tx.assetAllocation.findMany({
    where: {
      assetId: { in: needsAllocationCheck },
      active: true,
      booking: {
        status: { in: [BookingStatus.BOOKED, BookingStatus.PENDING_PICKUP, BookingStatus.OPEN] }
      }
    },
    select: {
      assetId: true,
      startsAt: true,
      endsAt: true,
      booking: {
        select: {
          kind: true,
          status: true
        }
      }
    }
  });

  // Group allocations by asset
  const allocationsByAsset = new Map<string, typeof activeAllocations>();
  for (const alloc of activeAllocations) {
    const existing = allocationsByAsset.get(alloc.assetId) ?? [];
    existing.push(alloc);
    allocationsByAsset.set(alloc.assetId, existing);
  }

  // 3. Derive status for each AVAILABLE asset
  for (const assetId of needsAllocationCheck) {
    const allocations = allocationsByAsset.get(assetId);
    if (!allocations || allocations.length === 0) {
      result.set(assetId, "AVAILABLE");
      continue;
    }

    // Check for active checkout first (takes priority)
    const hasCheckout = allocations.some(
      (a) => a.booking.kind === BookingKind.CHECKOUT && a.booking.status === BookingStatus.OPEN
    );

    if (hasCheckout) {
      result.set(assetId, "CHECKED_OUT");
      continue;
    }

    const hasPendingPickup = allocations.some(
      (a) => a.booking.kind === BookingKind.CHECKOUT && a.booking.status === BookingStatus.PENDING_PICKUP
    );

    if (hasPendingPickup) {
      result.set(assetId, "PENDING_PICKUP");
      continue;
    }

    // A booked reservation becomes operationally pending pickup at startsAt.
    // It stays in that phase until kiosk pickup or no-show cancellation.
    const hasDueReservation = allocations.some(
      (a) =>
        a.booking.kind === BookingKind.RESERVATION &&
        a.booking.status === BookingStatus.BOOKED &&
        a.startsAt <= now
    );

    if (hasDueReservation) {
      result.set(assetId, "PENDING_PICKUP");
      continue;
    }

    result.set(assetId, "AVAILABLE");
  }

  return result;
}

/**
 * Enrich an array of asset objects with their derived `computedStatus`.
 * Adds a `computedStatus` field to each asset without mutating originals.
 */
export async function enrichAssetsWithStatus<
  T extends { id: string; status: AssetStatus }
>(
  assets: T[],
  client?: PrismaClient | Prisma.TransactionClient
): Promise<Array<T & { computedStatus: EffectiveStatus }>> {
  if (assets.length === 0) return [];

  const statusMap = await deriveAssetStatuses(
    assets.map((a) => a.id),
    client
  );

  return assets.map((asset) => ({
    ...asset,
    computedStatus: statusMap.get(asset.id) ?? "AVAILABLE"
  }));
}

/**
 * Build Prisma `where` clauses for filtering assets by derived status at the DB level.
 * Pushes CHECKED_OUT/RESERVED filtering into SQL subqueries instead of in-memory enrichment.
 * Returns a Prisma `OR` array suitable for use in `db.asset.findMany({ where: { OR: [...] } })`.
 */
export function buildDerivedStatusWhere(
  statuses: string[]
): Record<string, unknown>[] {
  const now = new Date();
  const clauses: Record<string, unknown>[] = [];

  for (const status of statuses) {
    switch (status) {
      case "AVAILABLE":
        // Stored AVAILABLE with NO active checkout, pending pickup, or active overlapping reservation.
        // We need two `none` conditions: one for checkouts, one for reservations with time overlap.
        clauses.push({
          status: AssetStatus.AVAILABLE,
          AND: [
            {
              allocations: {
                none: {
                  active: true,
                  booking: {
                    kind: BookingKind.CHECKOUT,
                    status: { in: [BookingStatus.OPEN, BookingStatus.PENDING_PICKUP] },
                  },
                },
              },
            },
            {
              allocations: {
                none: {
                  active: true,
                  startsAt: { lte: now },
                  booking: {
                    kind: BookingKind.RESERVATION,
                    status: BookingStatus.BOOKED,
                  },
                },
              },
            },
          ],
        });
        break;
      case "CHECKED_OUT":
        // Stored AVAILABLE with an active allocation on an OPEN checkout
        clauses.push({
          status: AssetStatus.AVAILABLE,
          allocations: {
            some: {
              active: true,
              booking: {
                kind: BookingKind.CHECKOUT,
                status: BookingStatus.OPEN,
              },
            },
          },
        });
        break;
      case "PENDING_PICKUP":
        // Stored AVAILABLE with either a due BOOKED reservation or a legacy
        // active allocation on a PENDING_PICKUP checkout.
        clauses.push({
          status: AssetStatus.AVAILABLE,
          OR: [
            {
              allocations: {
                some: {
                  active: true,
                  booking: {
                    kind: BookingKind.CHECKOUT,
                    status: BookingStatus.PENDING_PICKUP,
                  },
                },
              },
            },
            {
              allocations: {
                some: {
                  active: true,
                  startsAt: { lte: now },
                  booking: {
                    kind: BookingKind.RESERVATION,
                    status: BookingStatus.BOOKED,
                  },
                },
              },
            },
          ],
        });
        break;
      case "RESERVED":
        // Retained in the public effective-status union for rollout
        // compatibility. Due reservations now belong to PENDING_PICKUP.
        clauses.push({ id: { in: [] } });
        break;
      case "MAINTENANCE":
        clauses.push({ status: AssetStatus.MAINTENANCE });
        break;
      case "RETIRED":
        clauses.push({ status: AssetStatus.RETIRED });
        break;
    }
  }

  return clauses;
}

/**
 * Derive effective statuses for a batch of assets, accepting pre-loaded status data
 * to avoid a redundant DB query when the caller already has asset objects.
 */
export async function deriveAssetStatusesFromLoaded(
  assets: Array<{ id: string; status: AssetStatus }>,
  client?: PrismaClient | Prisma.TransactionClient
): Promise<Map<string, EffectiveStatus>> {
  if (assets.length === 0) return new Map();

  const tx = client ?? db;
  const now = new Date();
  const result = new Map<string, EffectiveStatus>();

  const needsAllocationCheck: string[] = [];
  for (const asset of assets) {
    if (asset.status === AssetStatus.MAINTENANCE) {
      result.set(asset.id, "MAINTENANCE");
    } else if (asset.status === AssetStatus.RETIRED) {
      result.set(asset.id, "RETIRED");
    } else {
      needsAllocationCheck.push(asset.id);
    }
  }

  if (needsAllocationCheck.length === 0) return result;

  const activeAllocations = await tx.assetAllocation.findMany({
    where: {
      assetId: { in: needsAllocationCheck },
      active: true,
      booking: {
        status: { in: [BookingStatus.BOOKED, BookingStatus.PENDING_PICKUP, BookingStatus.OPEN] },
      },
    },
    select: {
      assetId: true,
      startsAt: true,
      endsAt: true,
      booking: { select: { kind: true, status: true } },
    },
  });

  const allocationsByAsset = new Map<string, typeof activeAllocations>();
  for (const alloc of activeAllocations) {
    const existing = allocationsByAsset.get(alloc.assetId) ?? [];
    existing.push(alloc);
    allocationsByAsset.set(alloc.assetId, existing);
  }

  for (const assetId of needsAllocationCheck) {
    const allocations = allocationsByAsset.get(assetId);
    if (!allocations || allocations.length === 0) {
      result.set(assetId, "AVAILABLE");
      continue;
    }

    const hasCheckout = allocations.some(
      (a) => a.booking.kind === BookingKind.CHECKOUT && a.booking.status === BookingStatus.OPEN
    );
    if (hasCheckout) {
      result.set(assetId, "CHECKED_OUT");
      continue;
    }

    const hasPendingPickup = allocations.some(
      (a) => a.booking.kind === BookingKind.CHECKOUT && a.booking.status === BookingStatus.PENDING_PICKUP
    );
    if (hasPendingPickup) {
      result.set(assetId, "PENDING_PICKUP");
      continue;
    }

    const hasDueReservation = allocations.some(
      (a) =>
        a.booking.kind === BookingKind.RESERVATION &&
        a.booking.status === BookingStatus.BOOKED &&
        a.startsAt <= now
    );
    if (hasDueReservation) {
      result.set(assetId, "PENDING_PICKUP");
      continue;
    }

    result.set(assetId, "AVAILABLE");
  }

  return result;
}

/**
 * Enrich assets using pre-loaded data (skips redundant status re-fetch).
 */
export async function enrichAssetsWithStatusFromLoaded<
  T extends { id: string; status: AssetStatus }
>(
  assets: T[],
  client?: PrismaClient | Prisma.TransactionClient
): Promise<Array<T & { computedStatus: EffectiveStatus }>> {
  if (assets.length === 0) return [];

  const statusMap = await deriveAssetStatusesFromLoaded(assets, client);

  return assets.map((asset) => ({
    ...asset,
    computedStatus: statusMap.get(asset.id) ?? "AVAILABLE",
  }));
}

/**
 * Count assets by effective status. Used by the dashboard.
 */
export async function countAssetsByEffectiveStatus(
  client?: PrismaClient | Prisma.TransactionClient
): Promise<Record<EffectiveStatus, number>> {
  const tx = client ?? db;

  // Count terminal statuses directly from DB
  const [maintenanceCount, retiredCount, allAvailableIds] = await Promise.all([
    tx.asset.count({ where: { status: AssetStatus.MAINTENANCE } }),
    tx.asset.count({ where: { status: AssetStatus.RETIRED } }),
    tx.asset.findMany({
      where: { status: AssetStatus.AVAILABLE },
      select: { id: true }
    })
  ]);

  if (allAvailableIds.length === 0) {
    return {
      AVAILABLE: 0,
      CHECKED_OUT: 0,
      PENDING_PICKUP: 0,
      RESERVED: 0,
      MAINTENANCE: maintenanceCount,
      RETIRED: retiredCount
    };
  }

  const statusMap = await deriveAssetStatuses(
    allAvailableIds.map((a) => a.id),
    tx
  );

  let available = 0;
  let checkedOut = 0;
  let pendingPickup = 0;
  let reserved = 0;

  for (const status of statusMap.values()) {
    if (status === "CHECKED_OUT") checkedOut++;
    else if (status === "PENDING_PICKUP") pendingPickup++;
    else if (status === "RESERVED") reserved++;
    else available++;
  }

  return {
    AVAILABLE: available,
    CHECKED_OUT: checkedOut,
    PENDING_PICKUP: pendingPickup,
    RESERVED: reserved,
    MAINTENANCE: maintenanceCount,
    RETIRED: retiredCount
  };
}
