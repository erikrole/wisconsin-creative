import { z } from "zod";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntries, createAuditEntriesTx } from "@/lib/audit";
import { addKitMembers } from "@/lib/services/kits";

const bulkSchema = z
  .object({
    ids: z.array(z.string().cuid()).min(1).max(5000),
    action: z.enum(["move_location", "change_category", "retire", "unretire", "maintenance", "delete", "add_to_kit"]),
    locationId: z.string().cuid().optional(),
    categoryId: z.string().cuid().nullable().optional(),
    kitId: z.string().cuid().optional(),
  })
  .strict();

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "asset", "edit");

  const body = bulkSchema.parse(await req.json());
  const { ids, action } = body;

  // Validate payload requirements
  if (action === "move_location" && !body.locationId) {
    throw new HttpError(400, "locationId required for move_location");
  }
  if (action === "change_category" && body.categoryId === undefined) {
    throw new HttpError(400, "categoryId required for change_category");
  }

  // Fetch all target assets in one query
  const assets = await db.asset.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, locationId: true, categoryId: true },
  });

  if (assets.length === 0) {
    throw new HttpError(404, "No assets found");
  }

  let updated = 0;

  if (action === "move_location") {
    // Verify location exists
    const loc = await db.location.findUnique({ where: { id: body.locationId! } });
    if (!loc) throw new HttpError(404, "Location not found");

    const result = await db.asset.updateMany({
      where: { id: { in: ids } },
      data: { locationId: body.locationId! },
    });
    updated = result.count;

    // Audit each affected asset
    await createAuditEntries(
      assets
        .filter((asset) => asset.locationId !== body.locationId)
        .map((asset) => ({
          actorId: user.id,
          actorRole: user.role,
          entityType: "asset",
          entityId: asset.id,
          action: "bulk_move_location",
          before: { locationId: asset.locationId },
          after: { locationId: body.locationId! },
        }))
    );
  } else if (action === "change_category") {
    if (body.categoryId) {
      const cat = await db.category.findUnique({ where: { id: body.categoryId } });
      if (!cat) throw new HttpError(404, "Category not found");
    }

    const result = await db.asset.updateMany({
      where: { id: { in: ids } },
      data: { categoryId: body.categoryId ?? null },
    });
    updated = result.count;

    await createAuditEntries(
      assets
        .filter((asset) => asset.categoryId !== (body.categoryId ?? null))
        .map((asset) => ({
          actorId: user.id,
          actorRole: user.role,
          entityType: "asset",
          entityId: asset.id,
          action: "bulk_change_category",
          before: { categoryId: asset.categoryId },
          after: { categoryId: body.categoryId ?? null },
        }))
    );
  } else if (action === "retire") {
    const result = await db.asset.updateMany({
      where: { id: { in: ids }, status: { not: "RETIRED" } },
      data: { status: "RETIRED" },
    });
    updated = result.count;

    await createAuditEntries(
      assets
        .filter((asset) => asset.status !== "RETIRED")
        .map((asset) => ({
          actorId: user.id,
          actorRole: user.role,
          entityType: "asset",
          entityId: asset.id,
          action: "bulk_retired",
          before: { status: asset.status },
          after: { status: "RETIRED" },
        }))
    );
  } else if (action === "unretire") {
    const result = await db.asset.updateMany({
      where: { id: { in: ids }, status: "RETIRED" },
      data: { status: "AVAILABLE" },
    });
    updated = result.count;

    await createAuditEntries(
      assets
        .filter((asset) => asset.status === "RETIRED")
        .map((asset) => ({
          actorId: user.id,
          actorRole: user.role,
          entityType: "asset",
          entityId: asset.id,
          action: "bulk_unretired",
          before: { status: "RETIRED" },
          after: { status: "AVAILABLE" },
        }))
    );
  } else if (action === "maintenance") {
    updated = await db.$transaction(async (tx) => {
      const currentAssets = await tx.asset.findMany({
        where: { id: { in: ids } },
        select: { id: true, status: true },
      });
      const toMaintenance = currentAssets.filter((a) => a.status !== "MAINTENANCE");
      const toAvailable = currentAssets.filter((a) => a.status === "MAINTENANCE");

      const [r1, r2] = await Promise.all([
        toMaintenance.length > 0
          ? tx.asset.updateMany({
              where: { id: { in: toMaintenance.map((a) => a.id) } },
              data: { status: "MAINTENANCE" },
            })
          : { count: 0 },
        toAvailable.length > 0
          ? tx.asset.updateMany({
              where: { id: { in: toAvailable.map((a) => a.id) } },
              data: { status: "AVAILABLE" },
            })
          : { count: 0 },
      ]);

      await createAuditEntriesTx(
        tx,
        currentAssets.map((asset) => {
        const newStatus = asset.status === "MAINTENANCE" ? "AVAILABLE" : "MAINTENANCE";
        return {
          actorId: user.id,
          actorRole: user.role,
          entityType: "asset",
          entityId: asset.id,
          action: newStatus === "MAINTENANCE" ? "bulk_marked_maintenance" : "bulk_cleared_maintenance",
          before: { status: asset.status },
          after: { status: newStatus },
        };
        })
      );

      return r1.count + r2.count;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } else if (action === "delete") {
    requirePermission(user.role, "asset", "delete");

    const assetIds = assets.map((asset) => asset.id);

    // Match single-item delete policy: items with booking history must be retired, not deleted.
    updated = await db.$transaction(async (tx) => {
      const [bookingCount, activeAllocCount] = await Promise.all([
        tx.bookingSerializedItem.count({ where: { assetId: { in: assetIds } } }),
        tx.assetAllocation.count({ where: { assetId: { in: assetIds }, active: true } }),
      ]);

      if (bookingCount > 0 || activeAllocCount > 0) {
        throw new HttpError(
          409,
          "Cannot delete: selected item(s) have booking history. Use Retire instead."
        );
      }

      await tx.scanEvent.deleteMany({ where: { assetId: { in: assetIds } } });
      await tx.checkinItemReport.deleteMany({ where: { assetId: { in: assetIds } } });
      const result = await tx.asset.deleteMany({ where: { id: { in: assetIds } } });
      return result.count;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await createAuditEntries(
      assets.map((asset) => ({
        actorId: user.id,
        actorRole: user.role,
        entityType: "asset",
        entityId: asset.id,
        action: "bulk_deleted",
        before: { status: asset.status, locationId: asset.locationId, categoryId: asset.categoryId },
        after: { deleted: true },
      }))
    );
  } else if (action === "add_to_kit") {
    if (!body.kitId) {
      throw new HttpError(400, "kitId required for add_to_kit");
    }

    requirePermission(user.role, "kit", "edit");
    const { addedAssetIds } = await addKitMembers(
      body.kitId,
      ids,
      user.id,
      user.role,
      { allowAlreadyMembers: true },
    );
    updated = addedAssetIds.length;
  }

  return ok({ updated });
});
