import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import {
  cleanItemFamilyProductText,
  cleanOptionalItemFamilyProductText,
  normalizeItemFamilyProductName,
} from "@/lib/item-family-products";
import { requirePermission } from "@/lib/rbac";
import { createBulkSkuProductSchema } from "@/lib/validation";

export const GET = withAuth<{ id: string }>(async (_req, { params }) => {
  const [family, products] = await Promise.all([
    db.bulkSku.findUnique({ where: { id: params.id }, select: { id: true } }),
    db.bulkSkuProduct.findMany({
      where: { bulkSkuId: params.id },
      include: { _count: { select: { units: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
  ]);
  if (!family) throw new HttpError(404, "Item family not found");

  return ok({ data: products });
});

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "bulk_sku", "edit");
  const body = createBulkSkuProductSchema.parse(await req.json());

  try {
    const product = await db.$transaction(async (tx) => {
      const family = await tx.bulkSku.findUnique({
        where: { id: params.id },
        select: { id: true, trackByNumber: true },
      });
      if (!family) throw new HttpError(404, "Item family not found");
      if (!family.trackByNumber) {
        throw new HttpError(409, "Convert this item family to Units before adding products");
      }

      const created = await tx.bulkSkuProduct.create({
        data: {
          bulkSkuId: family.id,
          name: cleanItemFamilyProductText(body.name),
          normalizedName: normalizeItemFamilyProductName(body.name),
          brand: cleanItemFamilyProductText(body.brand),
          model: cleanOptionalItemFamilyProductText(body.model),
        },
        include: { _count: { select: { units: true } } },
      });

      await createAuditEntryTx(tx, {
        actorId: user.id,
        actorRole: user.role,
        entityType: "bulk_sku_product",
        entityId: created.id,
        action: "created",
        after: {
          bulkSkuId: family.id,
          name: created.name,
          brand: created.brand,
          model: created.model,
        },
      });

      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return ok({ data: product }, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "A product with this name already exists in the item family");
    }
    throw error;
  }
});
