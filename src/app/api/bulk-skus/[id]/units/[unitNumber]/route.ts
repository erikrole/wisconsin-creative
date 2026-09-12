import { BookingStatus, BulkMovementKind, BulkUnitStatus, Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { updateBulkUnitSchema } from "@/lib/validation";
import { createAuditEntryTx } from "@/lib/audit";
import { effectiveBulkUnitStatus } from "@/lib/bulk-unit-status";
import { MAX_BULK_UNIT_NUMBER } from "@/lib/request-limits";

export const PATCH = withAuth<{ id: string; unitNumber: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "bulk_sku", "adjust");
  const { id, unitNumber: unitNumStr } = params;
  if (!/^[1-9]\d*$/.test(unitNumStr)) throw new HttpError(400, "Invalid unit number");
  const unitNumber = Number(unitNumStr);
  if (!Number.isSafeInteger(unitNumber) || unitNumber > MAX_BULK_UNIT_NUMBER) {
    throw new HttpError(400, "Invalid unit number");
  }

  const body = updateBulkUnitSchema.parse(await req.json());

  const result = await db.$transaction(async (tx) => {
    const unit = await tx.bulkSkuUnit.findUnique({
      where: { bulkSkuId_unitNumber: { bulkSkuId: id, unitNumber } },
      include: {
        allocations: {
          where: {
            checkedOutAt: { not: null },
            checkedInAt: null,
          },
          include: { bookingBulkItem: { select: { booking: { select: { status: true } } } } },
        },
      },
    });
    if (!unit) throw new HttpError(404, "Unit not found");

    const effectiveStatus = effectiveBulkUnitStatus(unit, unit.allocations[0]);

    // LOST/RETIRED flags take precedence in the display helper, but they
    // must never allow an operator to bypass existing physical custody.
    const hasLiveCustody = unit.allocations.some((allocation) =>
      allocation.bookingBulkItem.booking.status === BookingStatus.OPEN ||
      allocation.bookingBulkItem.booking.status === BookingStatus.PENDING_PICKUP,
    );
    if (effectiveStatus === BulkUnitStatus.CHECKED_OUT || hasLiveCustody) {
      throw new HttpError(
        409,
        "Cannot change a checked-out unit. Check it in first."
      );
    }

    const before = { status: unit.status, notes: unit.notes };

    // Returning a unit to service: close any lingering active allocation from
    // a booking that is no longer open (historic LOST-with-open-allocation
    // drift). Without this, flipping a found battery LOST→AVAILABLE leaves an
    // open allocation that makes its effective status read "checked out on
    // another booking" forever — and repair-stale can't fix that shape.
    const closedAllocationIds: string[] = [];
    const recoveredAt = new Date();
    if (body.status === "AVAILABLE" && unit.allocations.length > 0) {
      const closed = await tx.bookingBulkUnitAllocation.updateMany({
        where: {
          bulkSkuUnitId: unit.id,
          checkedOutAt: { not: null },
          checkedInAt: null,
          bookingBulkItem: {
            booking: { status: { notIn: [BookingStatus.OPEN, BookingStatus.PENDING_PICKUP] } },
          },
        },
        data: { checkedInAt: recoveredAt },
      });
      if (closed.count !== unit.allocations.length) {
        throw new HttpError(409, "Battery custody changed. Refresh the unit and try again.");
      }
      closedAllocationIds.push(...unit.allocations.map((allocation) => allocation.id));
    }

    const updated = await tx.bulkSkuUnit.update({
      where: { id: unit.id },
      data: {
        status: body.status as BulkUnitStatus,
        notes: body.notes ?? unit.notes
      }
    });

    // Adjust on-hand balance when taking a unit out of / back into service
    const wasAvailable = effectiveStatus === BulkUnitStatus.AVAILABLE;
    const isAvailable = body.status === "AVAILABLE";

    const availabilityChanged = wasAvailable !== isAvailable;
    if (availabilityChanged) {
      const sku = await tx.bulkSku.findUniqueOrThrow({ where: { id } });
      const reason = body.reason ?? `Unit #${unitNumber} marked ${body.status.toLowerCase()}`;

      await tx.bulkStockMovement.create({
        data: {
          bulkSkuId: id,
          locationId: sku.locationId,
          actorUserId: user.id,
          kind: BulkMovementKind.ADJUSTMENT,
          quantity: isAvailable ? 1 : -1,
          reason,
        }
      });

      if (wasAvailable && !isAvailable) {
        const balance = await tx.bulkStockBalance.updateMany({
          where: {
            bulkSkuId: id,
            locationId: sku.locationId,
            onHandQuantity: { gte: 1 },
          },
          data: { onHandQuantity: { decrement: 1 } }
        });
        if (balance.count !== 1) {
          throw new HttpError(409, "No available stock is recorded at this family's location. Reconcile the stock location before changing the unit status.");
        }
      } else {
        await tx.bulkStockBalance.upsert({
          where: {
            bulkSkuId_locationId: { bulkSkuId: id, locationId: sku.locationId }
          },
          create: { bulkSkuId: id, locationId: sku.locationId, onHandQuantity: 1 },
          update: { onHandQuantity: { increment: 1 } },
        });
      }
    }

    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "bulk_sku_unit",
      entityId: `${id}#${unitNumber}`,
      action: "update_status",
      before,
      after: {
        status: updated.status,
        notes: updated.notes,
        reason: body.reason ?? null,
        ...(closedAllocationIds.length > 0 ? {
          closedAllocationIds,
          allocationsClosedAt: recoveredAt.toISOString(),
        } : {}),
      },
    });
    return { updated };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return ok({ data: result.updated });
});
