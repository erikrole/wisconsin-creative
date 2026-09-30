import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { tokenHash, KIOSK_ACTIVATION_CODE_TTL_MS } from "@/lib/auth";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { generateActivationCode } from "@/lib/kiosk-activation";
import { unique } from "@/lib/utils";
import { kioskDeviceCreateBody } from "@/lib/schemas/kiosk";

/** List kiosk devices with health stats (ADMIN only) */
export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "kiosk_device", "view");

  const devices = await db.kioskDevice.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      location: { select: { id: true, name: true } },
    },
  });

  // Aggregate open custody and pending reservation handoffs per location.
  const locationIds = unique(devices.map((d) => d.locationId));
  const now = new Date();
  const [openCheckoutStats, pendingPickupStats, pendingPickupsByLocation] = await Promise.all([
    db.booking.groupBy({
      by: ["locationId", "status"],
      where: {
        locationId: { in: locationIds },
        status: "OPEN",
        kind: "CHECKOUT",
      },
      _count: { id: true },
    }),
    db.booking.groupBy({
      by: ["locationId"],
      where: {
        locationId: { in: locationIds },
        OR: [
          { kind: "RESERVATION", status: "BOOKED", startsAt: { lte: now } },
          { kind: "CHECKOUT", status: "PENDING_PICKUP" },
        ],
      },
      _count: { id: true },
    }),
    db.booking.findMany({
      where: {
        locationId: { in: locationIds },
        OR: [
          { kind: "RESERVATION", status: "BOOKED", startsAt: { lte: now } },
          { kind: "CHECKOUT", status: "PENDING_PICKUP" },
        ],
      },
      select: {
        id: true,
        title: true,
        locationId: true,
        startsAt: true,
        endsAt: true,
        requester: { select: { name: true } },
      },
      orderBy: { startsAt: "asc" },
      take: 50,
    }),
  ]);

  const statsByLocation = new Map<string, { pendingPickup: number; open: number }>();
  for (const row of openCheckoutStats) {
    const entry = statsByLocation.get(row.locationId) ?? { pendingPickup: 0, open: 0 };
    entry.open = row._count.id;
    statsByLocation.set(row.locationId, entry);
  }
  for (const row of pendingPickupStats) {
    const entry = statsByLocation.get(row.locationId) ?? { pendingPickup: 0, open: 0 };
    entry.pendingPickup = row._count.id;
    statsByLocation.set(row.locationId, entry);
  }

  const pickupsByLocation = new Map<string, typeof pendingPickupsByLocation>();
  for (const b of pendingPickupsByLocation) {
    const arr = pickupsByLocation.get(b.locationId) ?? [];
    arr.push(b);
    pickupsByLocation.set(b.locationId, arr);
  }

  // Never expose hashed tokens/codes to the client
  const data = devices.map((d) => {
    const stats = statsByLocation.get(d.locationId) ?? { pendingPickup: 0, open: 0 };
    const pickups = (pickupsByLocation.get(d.locationId) ?? []).slice(0, 10);
    return {
      id: d.id,
      name: d.name,
      locationId: d.locationId,
      location: d.location,
      active: d.active,
      activated: !!d.activatedAt,
      activatedAt: d.activatedAt,
      lastSeenAt: d.lastSeenAt,
      appVersion: d.appVersion,
      appBuild: d.appBuild,
      osVersion: d.osVersion,
      deviceModel: d.deviceModel,
      createdAt: d.createdAt,
      pendingPickupCount: stats.pendingPickup,
      openCheckoutCount: stats.open,
      pendingPickups: pickups.map((b) => ({
        id: b.id,
        title: b.title,
        requesterName: b.requester.name,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
      })),
    };
  });

  return ok({ data });
});

/** Create a new kiosk device (ADMIN only) */
export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "kiosk_device", "create");
  await enforceRateLimit(`kiosk-devices:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const { name, locationId } = kioskDeviceCreateBody.parse(await req.json());

  // Verify location exists
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { id: true, name: true },
  });
  if (!location) {
    throw new HttpError(404, "Location not found");
  }

  // Generate activation code
  const rawCode = generateActivationCode();
  const hashedCode = await tokenHash(rawCode);

  const device = await db.kioskDevice.create({
    data: {
      name,
      locationId,
      activationCode: hashedCode,
      activationCodeExpiresAt: new Date(Date.now() + KIOSK_ACTIVATION_CODE_TTL_MS),
    },
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "kiosk_device",
    entityId: device.id,
    action: "create",
    after: { name, locationId, locationName: location.name },
  });

  // Return the raw code ONCE — it can't be recovered after this
  return ok({
    id: device.id,
    name: device.name,
    locationId: device.locationId,
    activationCode: rawCode,
  }, 201);
});
