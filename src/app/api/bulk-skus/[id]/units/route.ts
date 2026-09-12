import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { addBulkUnitsSchema } from "@/lib/validation";
import { createAuditEntryTx } from "@/lib/audit";
import { MAX_BULK_UNIT_NUMBER } from "@/lib/request-limits";

export const GET = withAuth<{ id: string }>(async (_req, { params }) => {
  const { id } = params;

  const sku = await db.bulkSku.findUnique({ where: { id } });
  if (!sku) throw new HttpError(404, "Bulk SKU not found");
  if (!sku.trackByNumber) throw new HttpError(400, "This SKU does not track by number");

  const units = await db.bulkSkuUnit.findMany({
    where: { bulkSkuId: id },
    include: { product: true },
    orderBy: { unitNumber: "asc" }
  });

  return ok({ data: units });
});

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "bulk_sku", "adjust");
  const { id } = params;
  const body = addBulkUnitsSchema.parse(await req.json());

  const result = await db.$transaction(async (tx) => {
    const sku = await tx.bulkSku.findUnique({ where: { id } });
    if (!sku) throw new HttpError(404, "Bulk SKU not found");
    if (!sku.trackByNumber) throw new HttpError(400, "This SKU does not track by number");

    const product = body.productId
      ? await tx.bulkSkuProduct.findFirst({
          where: { id: body.productId, bulkSkuId: id, active: true },
          select: { id: true, name: true },
        })
      : null;
    if (body.productId && !product) {
      throw new HttpError(400, "Active product not found in this item family");
    }

    const maxUnit = await tx.bulkSkuUnit.findFirst({
      where: { bulkSkuId: id },
      orderBy: { unitNumber: "desc" }
    });

    const currentMaxUnitNumber = maxUnit?.unitNumber ?? 0;
    if (currentMaxUnitNumber > MAX_BULK_UNIT_NUMBER - body.count) {
      throw new HttpError(
        400,
        `Cannot add units beyond number ${MAX_BULK_UNIT_NUMBER}`,
      );
    }

    const currentBalance = await tx.bulkStockBalance.findUnique({
      where: {
        bulkSkuId_locationId: {
          bulkSkuId: id,
          locationId: sku.locationId,
        },
      },
      select: { onHandQuantity: true },
    });
    const currentOnHandQuantity = currentBalance?.onHandQuantity ?? 0;
    if (currentOnHandQuantity < 0) {
      throw new HttpError(409, "Bulk stock balance cannot be negative");
    }
    if (currentOnHandQuantity > MAX_BULK_UNIT_NUMBER - body.count) {
      throw new HttpError(
        400,
        `Cannot increase bulk stock beyond ${MAX_BULK_UNIT_NUMBER}`,
      );
    }
    const startNumber = currentMaxUnitNumber + 1;

    await tx.bulkSkuUnit.createMany({
      data: Array.from({ length: body.count }, (_, i) => ({
        bulkSkuId: id,
        productId: product?.id ?? null,
        unitNumber: startNumber + i
      }))
    });

    await tx.bulkStockBalance.upsert({
      where: {
        bulkSkuId_locationId: {
          bulkSkuId: id,
          locationId: sku.locationId
        }
      },
      create: {
        bulkSkuId: id,
        locationId: sku.locationId,
        onHandQuantity: body.count
      },
      update: { onHandQuantity: { increment: body.count } }
    });

    const defaultReason = `Added units #${startNumber}-#${startNumber + body.count - 1}`;
    const reason = body.reason ? `${defaultReason}: ${body.reason}` : defaultReason;

    await tx.bulkStockMovement.create({
      data: {
        bulkSkuId: id,
        locationId: sku.locationId,
        actorUserId: user.id,
        kind: "ADJUSTMENT",
        quantity: body.count,
        reason
      }
    });

    const added = {
      startNumber,
      endNumber: startNumber + body.count - 1,
      count: body.count,
      reason,
      productId: product?.id ?? null,
      productName: product?.name ?? null,
    };
    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "bulk_sku",
      entityId: id,
      action: "add_units",
      after: added,
    });
    return added;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return ok({ data: result }, 201);
});
