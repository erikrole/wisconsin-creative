import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok, parsePagination } from "@/lib/http";
import { requirePermission, requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { createBulkSkuSchema } from "@/lib/validation";
import { createAuditEntry } from "@/lib/audit";
import { buildActiveBulkUnitAllocationMap } from "@/lib/bulk-unit-status";
import { summarizeItemFamilyState } from "@/lib/item-family-state";
import { sanitizeCollaboratorBulkItem } from "@/lib/collaborator-gear";

export const GET = withAuth(async (req, { user }) => {
  requirePermissionOrCollaboratorCapability(user, "bulk_sku", "view", "GEAR_CATALOG_VIEW");
  const { searchParams } = new URL(req.url);
  const locationIds = searchParams.getAll("location_id").filter(Boolean);
  const includeArchived = user.role !== "COLLABORATOR" && searchParams.get("archived") === "true";
  const { limit, offset } = parsePagination(searchParams);

  const where: Prisma.BulkSkuWhereInput = {
    ...(locationIds.length === 1 ? { locationId: locationIds[0] } : {}),
    ...(locationIds.length > 1 ? { locationId: { in: locationIds } } : {}),
    ...(includeArchived ? {} : { active: true }),
  };

  const [raw, total] = await Promise.all([
    db.bulkSku.findMany({
      where,
      include: {
        location: true,
        balances: true,
        units: {
          select: {
            id: true,
            unitNumber: true,
            status: true,
          },
        },
        categoryRel: { select: { id: true, name: true } },
      },
      orderBy: [{ locationId: "asc" }, { name: "asc" }],
      take: limit,
      skip: offset,
    }),
    db.bulkSku.count({ where }),
  ]);

  const unitIds = raw.flatMap((sku) => sku.units.map((unit) => unit.id));
  const activeUnitAllocations = unitIds.length > 0
    ? await db.bookingBulkUnitAllocation.findMany({
        where: {
          bulkSkuUnitId: { in: unitIds },
          checkedOutAt: { not: null },
          checkedInAt: null,
        },
        select: { bulkSkuUnitId: true },
        orderBy: { checkedOutAt: "desc" },
      })
    : [];
  const activeAllocationByUnitId = buildActiveBulkUnitAllocationMap(activeUnitAllocations);

  const data = raw.map((sku) => {
    const state = summarizeItemFamilyState(sku, activeAllocationByUnitId);
    return { ...sku, units: state.effectiveUnits, availableQuantity: state.availableQuantity };
  });

  return ok({
    data: user.role === "COLLABORATOR"
      ? data.map((sku) => sanitizeCollaboratorBulkItem({
          ...sku,
          locationName: sku.location.name,
          category: sku.categoryRel?.name ?? sku.category,
        }))
      : data,
    total,
    limit,
    offset,
  });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "bulk_sku", "create");
  const body = createBulkSkuSchema.parse(await req.json());

  const result = await db.$transaction(async (tx) => {
    const [location, category] = await Promise.all([
      tx.location.findUnique({
        where: { id: body.locationId },
        select: { id: true },
      }),
      body.categoryId
        ? tx.category.findUnique({
          where: { id: body.categoryId },
          select: { name: true },
        })
        : Promise.resolve(null),
    ]);
    if (!location) throw new HttpError(400, "Location not found");
    if (body.categoryId && !category) throw new HttpError(400, "Category not found");

    const sku = await tx.bulkSku.create({
      data: {
        name: body.name,
        category: category?.name ?? body.category,
        categoryId: body.categoryId ?? null,
        unit: body.unit,
        locationId: body.locationId,
        binQrCodeValue: body.binQrCodeValue,
        minThreshold: body.minThreshold,
        trackByNumber: body.trackByNumber,
        active: body.active
      }
    });

    await tx.bulkStockBalance.create({
      data: {
        bulkSkuId: sku.id,
        locationId: body.locationId,
        onHandQuantity: body.initialQuantity
      }
    });

    if (body.initialQuantity > 0) {
      await tx.bulkStockMovement.create({
        data: {
          bulkSkuId: sku.id,
          locationId: body.locationId,
          actorUserId: user.id,
          kind: "ADJUSTMENT",
          quantity: body.initialQuantity,
          reason: "Initial quantity"
        }
      });
    }

    if (body.trackByNumber && body.initialQuantity > 0) {
      await tx.bulkSkuUnit.createMany({
        data: Array.from({ length: body.initialQuantity }, (_, i) => ({
          bulkSkuId: sku.id,
          unitNumber: i + 1
        }))
      });
    }

    return tx.bulkSku.findUniqueOrThrow({
      where: { id: sku.id },
      include: { balances: true, units: body.trackByNumber }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "bulk_sku",
    entityId: result.id,
    action: "create",
    after: { name: body.name, initialQuantity: body.initialQuantity },
  });

  return ok({ data: result }, 201);
});
