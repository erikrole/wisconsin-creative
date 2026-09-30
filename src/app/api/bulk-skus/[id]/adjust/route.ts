import { intakeTransaction } from "@/lib/intake-receipt";
import { BulkMovementKind } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { adjustBulkSchema } from "@/lib/validation";
import { createAuditEntryTx } from "@/lib/audit";

const MAX_ON_HAND_QUANTITY = 1_000_000;

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "bulk_sku", "adjust");
  const body = adjustBulkSchema.parse(await req.json());

  const result = await intakeTransaction(req, user, `bulk:${params.id}:adjust`, body, async (tx) => {
    const sku = await tx.bulkSku.findUnique({ where: { id: params.id } });
    if (!sku) {
      throw new HttpError(404, "Bulk SKU not found");
    }
    if (sku.trackByNumber) {
      throw new HttpError(400, "Use Add units for unit-tracked item families");
    }

    const balance = await tx.bulkStockBalance.findUnique({
      where: {
        bulkSkuId_locationId: {
          bulkSkuId: sku.id,
          locationId: sku.locationId
        }
      }
    });

    const current = balance?.onHandQuantity ?? 0;
    const next = current + body.quantityDelta;
    if (next < 0) {
      throw new HttpError(409, `Adjustment would drop stock below zero. Current: ${current}`);
    }
    if (next > MAX_ON_HAND_QUANTITY) {
      throw new HttpError(400, `Adjustment would exceed the maximum stock quantity of ${MAX_ON_HAND_QUANTITY}.`);
    }

    await tx.bulkStockBalance.upsert({
      where: {
        bulkSkuId_locationId: {
          bulkSkuId: sku.id,
          locationId: sku.locationId
        }
      },
      create: {
        bulkSkuId: sku.id,
        locationId: sku.locationId,
        onHandQuantity: next
      },
      update: {
        onHandQuantity: next
      }
    });

    await tx.bulkStockMovement.create({
      data: {
        bulkSkuId: sku.id,
        locationId: sku.locationId,
        actorUserId: user.id,
        kind: BulkMovementKind.ADJUSTMENT,
        quantity: Math.abs(body.quantityDelta),
        reason: body.reason
      }
    });

    await createAuditEntryTx(tx, {
      actorId: user.id, actorRole: user.role, entityType: "bulk_sku", entityId: params.id,
      action: "adjust", before: { onHandQuantity: current },
      after: { quantityDelta: body.quantityDelta, reason: body.reason, current, next },
    });
    return { current, next };
  });


  return ok({ data: result });
});
