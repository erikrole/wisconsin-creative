import { BulkMovementKind, BulkUnitStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createAuditEntriesTx } from "@/lib/audit";
import { isBatterySku } from "@/lib/bulk-batteries";
import { ACTIVE_BULK_UNIT_ALLOCATION_WHERE, CLAIMABLE_BULK_UNIT_WHERE } from "@/lib/bulk-unit-status";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";

const repairStaleBatteryFlagsSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
  dryRun: z.boolean().optional().default(true),
});

const DEFAULT_REPAIR_REASON = "Repair stale checked-out battery flags with no active allocation";

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "bulk_sku", "adjust");
  const body = repairStaleBatteryFlagsSchema.parse(await req.json());
  const reason = body.reason ?? DEFAULT_REPAIR_REASON;
  const dryRun = body.dryRun;

  const result = await db.$transaction(async (tx) => {
    const candidates = await tx.bulkSkuUnit.findMany({
      where: {
        status: BulkUnitStatus.CHECKED_OUT,
        bulkSku: { active: true, trackByNumber: true },
        allocations: {
          none: ACTIVE_BULK_UNIT_ALLOCATION_WHERE,
        },
      },
      select: {
        id: true,
        bulkSkuId: true,
        unitNumber: true,
        status: true,
        bulkSku: {
          select: {
            id: true,
            name: true,
            locationId: true,
            category: true,
            categoryRel: { select: { name: true } },
          },
        },
      },
      orderBy: [{ bulkSkuId: "asc" }, { unitNumber: "asc" }],
    });

    const staleBatteryUnits = candidates.filter((unit) => isBatterySku(unit.bulkSku));
    if (staleBatteryUnits.length === 0) {
      return { dryRun, plannedCount: 0, repairedCount: 0, units: [] };
    }

    const units = staleBatteryUnits.map((unit) => ({
      id: unit.id,
      skuId: unit.bulkSkuId,
      skuName: unit.bulkSku.name,
      unitNumber: unit.unitNumber,
    }));

    if (dryRun) {
      return {
        dryRun,
        plannedCount: staleBatteryUnits.length,
        repairedCount: 0,
        units,
      };
    }

    const ids = staleBatteryUnits.map((unit) => unit.id);
    const update = await tx.bulkSkuUnit.updateMany({
      where: {
        id: { in: ids },
        status: BulkUnitStatus.CHECKED_OUT,
        allocations: {
          none: ACTIVE_BULK_UNIT_ALLOCATION_WHERE,
        },
      },
      data: { status: BulkUnitStatus.AVAILABLE },
    });

    if (update.count !== ids.length) {
      throw new HttpError(409, "Battery availability changed. Refresh Battery Ops and preview the repair again.");
    }

    const repairedBySku = new Map<string, { locationId: string; quantity: number }>();
    for (const unit of staleBatteryUnits) {
      const current = repairedBySku.get(unit.bulkSkuId);
      repairedBySku.set(unit.bulkSkuId, {
        locationId: unit.bulkSku.locationId,
        quantity: (current?.quantity ?? 0) + 1,
      });
    }
    // A stale flag is already effectively available. Stock may have been
    // reconciled by an earlier exact-unit scan, so only restore a proven
    // aggregate deficit, capped at the units this repair actually changed.
    const skuIds = [...repairedBySku.keys()];
    const [availableCounts, balanceTotals] = await Promise.all([
      tx.bulkSkuUnit.groupBy({
        by: ["bulkSkuId"],
        where: { bulkSkuId: { in: skuIds }, ...CLAIMABLE_BULK_UNIT_WHERE },
        _count: { _all: true },
      }),
      tx.bulkStockBalance.groupBy({
        by: ["bulkSkuId"],
        where: { bulkSkuId: { in: skuIds } },
        _sum: { onHandQuantity: true },
      }),
    ]);
    const availableBySku = new Map(availableCounts.map((row) => [row.bulkSkuId, row._count._all]));
    const balanceBySku = new Map(balanceTotals.map((row) => [row.bulkSkuId, row._sum.onHandQuantity ?? 0]));
    const balanceAudits: Parameters<typeof createAuditEntriesTx>[1] = [];
    for (const [bulkSkuId, repair] of repairedBySku) {
      const available = availableBySku.get(bulkSkuId) ?? 0;
      const recorded = balanceBySku.get(bulkSkuId) ?? 0;
      const quantity = Math.max(0, Math.min(repair.quantity, available - recorded));
      if (quantity === 0) continue;
      await tx.bulkStockBalance.upsert({
        where: {
          bulkSkuId_locationId: {
            bulkSkuId,
            locationId: repair.locationId,
          },
        },
        create: {
          bulkSkuId,
          locationId: repair.locationId,
          onHandQuantity: quantity,
        },
        update: { onHandQuantity: { increment: quantity } },
      });
      await tx.bulkStockMovement.create({
        data: {
          bulkSkuId,
          locationId: repair.locationId,
          actorUserId: user.id,
          kind: BulkMovementKind.ADJUSTMENT,
          quantity,
          reason,
        },
      });
      balanceAudits.push({
        actorId: user.id,
        actorRole: user.role,
        entityType: "bulk_sku",
        entityId: bulkSkuId,
        action: "numbered_unit_balance_reconciled",
        before: { onHandQuantity: recorded, availableUnitCount: available },
        after: {
          onHandQuantity: recorded + quantity,
          availableUnitCount: available,
          quantityAdded: quantity,
          locationId: repair.locationId,
          reason,
        },
      });
    }

    await createAuditEntriesTx(tx, [...staleBatteryUnits.map((unit) => ({
      actorId: user.id,
      actorRole: user.role,
      entityType: "bulk_sku_unit",
      entityId: `${unit.bulkSkuId}#${unit.unitNumber}`,
      action: "repair_stale_checked_out",
      before: { status: unit.status },
      after: {
        status: BulkUnitStatus.AVAILABLE,
        reason,
        bulkSkuId: unit.bulkSkuId,
        unitNumber: unit.unitNumber,
      },
    })), ...balanceAudits]);

    return {
      dryRun,
      plannedCount: staleBatteryUnits.length,
      repairedCount: update.count,
      units,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return ok({ data: result });
});
