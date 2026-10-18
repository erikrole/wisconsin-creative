import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission, requirePermissionOrCollaboratorCapability } from "@/lib/rbac";

const attachSchema = z.object({
  childAssetId: z.string().cuid(),
});

const moveSchema = z.object({
  newParentAssetId: z.string().cuid(),
});

const accessorySelect = {
  id: true,
  assetTag: true,
  name: true,
  brand: true,
  model: true,
  serialNumber: true,
  status: true,
  type: true,
  imageUrl: true,
} as const;

/** GET /api/assets/[id]/accessories — list accessories for a parent item */
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermissionOrCollaboratorCapability(user, "asset", "view", "GEAR_CATALOG_VIEW");
  const { id } = params;

  if (user.role === "COLLABORATOR") {
    const parent = await db.asset.findFirst({
      where: {
        id,
        parentAssetId: null,
        availableForReservation: true,
        status: { not: "RETIRED" },
      },
      select: { id: true },
    });
    if (!parent) throw new HttpError(404, "Asset not found");
  }

  const accessories = await db.asset.findMany({
    where: { parentAssetId: id },
    select: user.role === "COLLABORATOR"
      ? {
          id: true,
          assetTag: true,
          name: true,
          brand: true,
          model: true,
          status: true,
          type: true,
          imageUrl: true,
        }
      : accessorySelect,
    orderBy: { assetTag: "asc" },
  });

  return ok({ data: accessories });
});

/** POST /api/assets/[id]/accessories — attach an accessory to this parent */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "asset", "edit");
  const { id } = params;
  const body = attachSchema.parse(await req.json());

  // Atomic: verify parent + child state and attach in one transaction
  await db.$transaction(async (tx) => {
    const parent = await tx.asset.findUnique({
      where: { id },
      select: { id: true, parentAssetId: true },
    });
    if (!parent) throw new HttpError(404, "Parent asset not found");
    if (parent.parentAssetId) throw new HttpError(400, "Cannot attach accessories to a child item");

    const child = await tx.asset.findUnique({
      where: { id: body.childAssetId },
      select: { id: true, parentAssetId: true, assetTag: true },
    });
    if (!child) throw new HttpError(404, "Accessory asset not found");
    if (child.id === id) throw new HttpError(400, "Cannot attach an item to itself");
    if (child.parentAssetId) {
      throw new HttpError(409, "This item is already an accessory of another item. Detach it first.");
    }

    await tx.asset.update({
      where: { id: body.childAssetId },
      data: {
        parentAssetId: id,
        availableForCheckout: false,
        availableForReservation: false,
        availableForCustody: false,
      },
    });
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "asset",
    entityId: body.childAssetId,
    action: "accessory_attached",
    after: { parentAssetId: id, childAssetId: body.childAssetId },
  });

  return ok({ success: true });
});

/** PATCH /api/assets/[id]/accessories — move a child to a different parent */
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "asset", "edit");
  const { id } = params;
  const body = moveSchema.parse(await req.json());

  // Atomic: verify child + new parent state and move in one transaction
  const child = await db.$transaction(async (tx) => {
    const c = await tx.asset.findUnique({
      where: { id },
      select: { id: true, parentAssetId: true },
    });
    if (!c) throw new HttpError(404, "Asset not found");
    if (!c.parentAssetId) throw new HttpError(400, "This item is not an accessory");

    const newParent = await tx.asset.findUnique({
      where: { id: body.newParentAssetId },
      select: { id: true, parentAssetId: true },
    });
    if (!newParent) throw new HttpError(404, "New parent asset not found");
    if (newParent.parentAssetId) throw new HttpError(400, "Cannot move to a child item");
    if (newParent.id === id) throw new HttpError(400, "Cannot attach an item to itself");

    await tx.asset.update({
      where: { id },
      data: { parentAssetId: body.newParentAssetId },
    });
    return c;
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "asset",
    entityId: id,
    action: "accessory_moved",
    before: { parentAssetId: child.parentAssetId },
    after: { parentAssetId: body.newParentAssetId },
  });

  return ok({ success: true });
});

/** DELETE /api/assets/[id]/accessories — detach this child from its parent */
export const DELETE = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "asset", "edit");
  const { id } = params;

  // Atomic: verify child state and detach in one transaction
  const prevParentId = await db.$transaction(async (tx) => {
    const c = await tx.asset.findUnique({
      where: { id },
      select: { id: true, parentAssetId: true },
    });
    if (!c) throw new HttpError(404, "Asset not found");
    if (!c.parentAssetId) throw new HttpError(400, "This item is not an accessory");

    await tx.asset.update({
      where: { id },
      data: {
        parentAssetId: null,
        availableForCheckout: true,
        availableForReservation: true,
        availableForCustody: true,
      },
    });
    return c.parentAssetId;
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "asset",
    entityId: id,
    action: "accessory_detached",
    before: { parentAssetId: prevParentId },
    after: { parentAssetId: null },
  });

  return ok({ success: true });
});
