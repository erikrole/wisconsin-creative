import {
  BulkMovementKind,
  Prisma,
} from "@prisma/client";
import { HttpError } from "@/lib/http";
import type { BulkRequest } from "@/lib/services/availability";
import { unique } from "@/lib/utils";

/* ── Shared include constants ── */

export const bookingInclude = {
  serializedItems: {
    include: {
      asset: true
    }
  },
  bulkItems: {
    include: {
      bulkSku: true
    }
  },
  location: true,
  requester: {
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      role: true,
    }
  },
  shiftAssignment: {
    select: {
      id: true,
      userId: true,
      status: true,
      source: true,
      callStartsAt: true,
      callEndsAt: true,
      callNote: true,
      shift: {
        select: {
          id: true,
          area: true,
          workerType: true,
          startsAt: true,
          endsAt: true,
          callStartsAt: true,
          callEndsAt: true,
          shiftGroup: {
            select: {
              eventId: true,
              publishedAt: true,
              workingCopy: { select: { shiftGroupId: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.BookingInclude;

/* ── Helpers ── */

export function dedupeIds(ids: string[]) {
  return unique(ids);
}

/* ── Equipment diff helpers for granular audit ── */

export type AuditJson = Record<string, string | number | boolean | null | string[] | { bulkSkuId: string; quantity: number }[]>;

type EquipmentAuditEntry = {
  action: string;
  beforeJson: AuditJson;
  afterJson: AuditJson;
};

export function diffEquipment(
  existingSerializedIds: string[],
  nextSerializedIds: string[],
  existingBulk: { bulkSkuId: string; quantity: number }[],
  nextBulk: { bulkSkuId: string; quantity: number }[]
): EquipmentAuditEntry[] {
  const entries: EquipmentAuditEntry[] = [];

  const oldSet = new Set(existingSerializedIds);
  const newSet = new Set(nextSerializedIds);
  const added = nextSerializedIds.filter((id) => !oldSet.has(id));
  const removed = existingSerializedIds.filter((id) => !newSet.has(id));

  if (added.length > 0) {
    entries.push({
      action: "booking.items_added",
      beforeJson: {},
      afterJson: { serializedAssetIds: added }
    });
  }

  if (removed.length > 0) {
    entries.push({
      action: "booking.items_removed",
      beforeJson: { serializedAssetIds: removed },
      afterJson: {}
    });
  }

  // Bulk qty changes
  const oldBulkMap = new Map(existingBulk.map((b) => [b.bulkSkuId, b.quantity]));
  const newBulkMap = new Map(nextBulk.map((b) => [b.bulkSkuId, b.quantity]));

  const bulkAdded: { bulkSkuId: string; quantity: number }[] = [];
  const bulkRemoved: { bulkSkuId: string; quantity: number }[] = [];
  const bulkChanged: { bulkSkuId: string; from: number; to: number }[] = [];

  for (const [skuId, qty] of newBulkMap) {
    const oldQty = oldBulkMap.get(skuId);
    if (oldQty === undefined) {
      bulkAdded.push({ bulkSkuId: skuId, quantity: qty });
    } else if (oldQty !== qty) {
      bulkChanged.push({ bulkSkuId: skuId, from: oldQty, to: qty });
    }
  }

  for (const [skuId, qty] of oldBulkMap) {
    if (!newBulkMap.has(skuId)) {
      bulkRemoved.push({ bulkSkuId: skuId, quantity: qty });
    }
  }

  if (bulkAdded.length > 0) {
    entries.push({
      action: "booking.items_added",
      beforeJson: {},
      afterJson: { bulkItems: bulkAdded }
    });
  }

  if (bulkRemoved.length > 0) {
    entries.push({
      action: "booking.items_removed",
      beforeJson: { bulkItems: bulkRemoved },
      afterJson: {}
    });
  }

  if (bulkChanged.length > 0) {
    entries.push({
      action: "booking.items_qty_changed",
      beforeJson: { bulkItems: bulkChanged.map((c) => ({ bulkSkuId: c.bulkSkuId, quantity: c.from })) },
      afterJson: { bulkItems: bulkChanged.map((c) => ({ bulkSkuId: c.bulkSkuId, quantity: c.to })) }
    });
  }

  return entries;
}

/**
 * Reconcile a booking's bulk ledger at completion from movement truth.
 *
 * Per SKU: outstanding = CHECKOUT movements - CHECKIN movements - lost units.
 * Any positive remainder is restored as a CHECKIN movement. This is
 * deliberately sourced from movements, not `checkedInQuantity` field math —
 * historical rows written before per-scan restock (and any future path that
 * forgets to write a movement) settle correctly here instead of drifting
 * `BulkStockBalance`, which availability reads.
 *
 * Returns the restored items so completion paths can audit real quantities.
 */
export async function settleBulkLedgerAtCompletion(
  tx: Prisma.TransactionClient,
  args: {
    bookingId: string;
    locationId: string;
    actorUserId: string;
    /** Units auto-marked LOST at completion — physically gone, never restored. */
    lostBySku?: Map<string, number>;
  }
): Promise<BulkRequest[]> {
  const movements = await tx.bulkStockMovement.groupBy({
    by: ["bulkSkuId", "kind"],
    where: { bookingId: args.bookingId },
    _sum: { quantity: true },
  });
  if (movements.length === 0) return [];

  const outstandingBySku = new Map<string, number>();
  for (const row of movements) {
    const qty = row._sum.quantity ?? 0;
    const delta = row.kind === BulkMovementKind.CHECKOUT ? qty : -qty;
    outstandingBySku.set(row.bulkSkuId, (outstandingBySku.get(row.bulkSkuId) ?? 0) + delta);
  }

  const toRestore: BulkRequest[] = [];
  for (const [bulkSkuId, outstanding] of outstandingBySku) {
    const lost = args.lostBySku?.get(bulkSkuId) ?? 0;
    const quantity = outstanding - lost;
    if (quantity > 0) toRestore.push({ bulkSkuId, quantity });
  }
  if (toRestore.length === 0) return [];

  await upsertBulkBalancesAndMovements(tx, {
    bookingId: args.bookingId,
    locationId: args.locationId,
    actorUserId: args.actorUserId,
    kind: BulkMovementKind.CHECKIN,
    items: toRestore,
  });
  return toRestore;
}

export async function upsertBulkBalancesAndMovements(
  tx: Prisma.TransactionClient,
  args: {
    locationId: string;
    bookingId: string;
    actorUserId: string;
    kind: BulkMovementKind;
    items: BulkRequest[];
  }
) {
  if (args.items.length === 0) return;

  // Pre-fetch all balances in one query instead of N individual findUnique calls
  const skuIds = args.items.map((item) => item.bulkSkuId);
  const existingBalances = await tx.bulkStockBalance.findMany({
    where: {
      locationId: args.locationId,
      bulkSkuId: { in: skuIds }
    }
  });
  const balanceMap = new Map(existingBalances.map((b) => [b.bulkSkuId, b.onHandQuantity]));

  // Validate all items before writing (fail fast)
  const updates: Array<{ bulkSkuId: string; next: number }> = [];
  for (const item of args.items) {
    const current = balanceMap.get(item.bulkSkuId) ?? 0;
    const delta = args.kind === BulkMovementKind.CHECKIN ? item.quantity : -item.quantity;
    const next = current + delta;

    if (next < 0) {
      throw new HttpError(
        409,
        `Insufficient bulk stock for ${item.bulkSkuId}. On hand: ${current}, required: ${item.quantity}`
      );
    }
    updates.push({ bulkSkuId: item.bulkSkuId, next });
  }

  // Upsert balances (Prisma doesn't support batched upserts, but we eliminated N reads above)
  for (const { bulkSkuId, next } of updates) {
    await tx.bulkStockBalance.upsert({
      where: {
        bulkSkuId_locationId: {
          bulkSkuId,
          locationId: args.locationId
        }
      },
      create: {
        bulkSkuId,
        locationId: args.locationId,
        onHandQuantity: next
      },
      update: {
        onHandQuantity: next
      }
    });
  }

  // Batch create all movements in one INSERT
  await tx.bulkStockMovement.createMany({
    data: args.items.map((item) => ({
      bulkSkuId: item.bulkSkuId,
      locationId: args.locationId,
      bookingId: args.bookingId,
      actorUserId: args.actorUserId,
      kind: args.kind,
      quantity: item.quantity
    }))
  });
}
