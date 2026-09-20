import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok, HttpError } from "@/lib/http";
import { requirePermission, requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { updateBulkSkuSchema } from "@/lib/validation";
import { createAuditEntry } from "@/lib/audit";
import { buildActiveBulkUnitAllocationMap } from "@/lib/bulk-unit-status";
import { summarizeItemFamilyState } from "@/lib/item-family-state";
import { sanitizeCollaboratorBulkItem } from "@/lib/collaborator-gear";

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermissionOrCollaboratorCapability(user, "bulk_sku", "view", "GEAR_CATALOG_VIEW");

  if (user.role === "COLLABORATOR") {
    const sku = await db.bulkSku.findFirst({
      where: { id: params.id, active: true },
      include: {
        location: { select: { id: true, name: true } },
        categoryRel: { select: { id: true, name: true } },
        balances: { select: { onHandQuantity: true } },
        units: { select: { id: true, unitNumber: true, status: true } },
      },
    });
    if (!sku) throw new HttpError(404, "Bulk SKU not found");
    const activeAllocationByUnitId = await loadActiveBulkUnitAllocationMap(sku.units.map((unit) => unit.id));
    const state = summarizeItemFamilyState(sku, activeAllocationByUnitId);
    return ok({
      data: sanitizeCollaboratorBulkItem({
        ...sku,
        locationName: sku.location.name,
        category: sku.categoryRel?.name ?? sku.category,
        availableQuantity: state.availableQuantity,
      }),
    });
  }

  const sku = await db.bulkSku.findUnique({
    where: { id: params.id },
    include: {
      location: { select: { id: true, name: true } },
      categoryRel: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      balances: true,
      products: {
        include: { _count: { select: { units: true } } },
        orderBy: [{ active: "desc" }, { name: "asc" }],
      },
      units: {
        orderBy: { unitNumber: "asc" },
        include: {
          product: true,
          allocations: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              bookingBulkItem: {
                include: {
                  booking: {
                    select: {
                      refNumber: true,
                      title: true,
                      requester: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!sku) throw new HttpError(404, "Bulk SKU not found");

  const activeAllocationByUnitId = await loadActiveBulkUnitAllocationMap(sku.units.map((unit) => unit.id));
  const state = summarizeItemFamilyState(sku, activeAllocationByUnitId);

  return ok({ data: { ...sku, units: state.effectiveUnits, onHand: state.onHandQuantity, availableQuantity: state.availableQuantity } });
});

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "bulk_sku", "edit");
  const body = updateBulkSkuSchema.parse(await req.json());

  const before = await db.bulkSku.findUnique({ where: { id: params.id } });
  if (!before) throw new HttpError(404, "Bulk SKU not found");

  const [location, category, department] = await Promise.all([
    body.locationId
      ? db.location.findUnique({ where: { id: body.locationId }, select: { id: true } })
      : Promise.resolve({ id: null }),
    body.categoryId
      ? db.category.findUnique({
          where: { id: body.categoryId },
          select: { name: true },
        })
      : Promise.resolve(null),
    body.departmentId
      ? db.department.findUnique({ where: { id: body.departmentId }, select: { id: true } })
      : Promise.resolve({ id: null }),
  ]);
  if (body.locationId && !location) throw new HttpError(400, "Location not found");
  if (body.categoryId && !category) throw new HttpError(400, "Category not found");
  if (body.departmentId && !department) throw new HttpError(400, "Department not found");
  const data = category ? { ...body, category: category.name } : body;

  const sku = await db.bulkSku.update({
    where: { id: params.id },
    data,
    include: {
      location: { select: { id: true, name: true } },
      categoryRel: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      balances: true,
      units: { select: { id: true, status: true } },
    },
  });

  const activeAllocationByUnitId = await loadActiveBulkUnitAllocationMap(sku.units.map((unit) => unit.id));
  const state = summarizeItemFamilyState(sku, activeAllocationByUnitId);
  const skuRest = Object.fromEntries(
    Object.entries(sku).filter(([key]) => key !== "units"),
  );

  const changedKeys = Object.keys(data);
  const beforeDiff: Record<string, unknown> = {};
  const afterDiff: Record<string, unknown> = {};
  for (const key of changedKeys) {
    beforeDiff[key] = (before as Record<string, unknown>)[key] ?? null;
    afterDiff[key] = (sku as Record<string, unknown>)[key] ?? null;
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "bulk_sku",
    entityId: params.id,
    action: "updated",
    before: beforeDiff,
    after: afterDiff,
  });

  return ok({ data: { ...skuRest, onHand: state.onHandQuantity, availableQuantity: state.availableQuantity } });
});

async function loadActiveBulkUnitAllocationMap(unitIds: string[]) {
  if (unitIds.length === 0) return new Map<string, { bulkSkuUnitId: string }>();

  const activeAllocations = await db.bookingBulkUnitAllocation.findMany({
    where: {
      bulkSkuUnitId: { in: unitIds },
      checkedOutAt: { not: null },
      checkedInAt: null,
    },
    select: { bulkSkuUnitId: true },
    orderBy: { checkedOutAt: "desc" },
  });

  return buildActiveBulkUnitAllocationMap(activeAllocations);
}

export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "bulk_sku", "delete");

  // Independent reads: the existence check and the history check never feed
  // each other, so issue them together and keep the 404-before-409 order.
  const [sku, bookingCount] = await Promise.all([
    db.bulkSku.findUnique({ where: { id: params.id } }),
    db.bookingBulkItem.count({ where: { bulkSkuId: params.id } }),
  ]);
  if (!sku) throw new HttpError(404, "Bulk SKU not found");

  if (bookingCount > 0) {
    throw new HttpError(409, "Cannot delete: this SKU has booking history.");
  }

  await db.bulkSku.delete({ where: { id: params.id } });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "bulk_sku",
    entityId: params.id,
    action: "deleted",
    before: { name: sku.name },
  });

  return ok({ success: true });
});
