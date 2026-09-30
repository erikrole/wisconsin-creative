import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { kioskDeviceUpdateBody } from "@/lib/schemas/kiosk";
import type { Prisma } from "@prisma/client";

/** Toggle active status or update a kiosk device (ADMIN only) */
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "kiosk_device", "edit");
  await enforceRateLimit(`kiosk-devices:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const body = kioskDeviceUpdateBody.parse(await req.json());

  const device = await db.kioskDevice.findUnique({
    where: { id: params.id },
  });
  if (!device) {
    throw new HttpError(404, "Kiosk device not found");
  }

  const updates: Prisma.KioskDeviceUpdateInput = {};

  if (body.active !== undefined) {
    updates.active = body.active;
    // If deactivating, also clear session token so it can't be used
    if (!body.active) {
      updates.sessionToken = null;
      updates.sessionExpiresAt = null;
    }
  }

  if (body.name !== undefined) {
    updates.name = body.name;
  }

  const updated = await db.kioskDevice.update({
    where: { id: params.id },
    data: updates,
    include: {
      location: { select: { id: true, name: true } },
    },
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "kiosk_device",
    entityId: device.id,
    action: body.active === false ? "deactivate" : "update",
    before: { name: device.name, active: device.active },
    after: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.active === false ? { sessionRevoked: true } : {}),
    },
  });

  return ok({
    id: updated.id,
    name: updated.name,
    locationId: updated.locationId,
    location: updated.location,
    active: updated.active,
    activated: !!updated.activatedAt,
    activatedAt: updated.activatedAt,
    lastSeenAt: updated.lastSeenAt,
    createdAt: updated.createdAt,
  });
});

/** Delete a kiosk device (ADMIN only) */
export const DELETE = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "kiosk_device", "delete");
  await enforceRateLimit(`kiosk-devices:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const device = await db.kioskDevice.findUnique({
    where: { id: params.id },
  });
  if (!device) {
    throw new HttpError(404, "Kiosk device not found");
  }

  await db.kioskDevice.delete({ where: { id: params.id } });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "kiosk_device",
    entityId: device.id,
    action: "delete",
    before: { name: device.name, locationId: device.locationId },
  });

  return ok({ success: true });
});
