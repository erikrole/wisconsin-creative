import { BookingKind, BookingStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  listCompanionDevices,
  nextCompanionProjectionRevision,
  readCompanionProjection,
  revokeCompanionDeviceTokens,
  writeCompanionProjection,
} from "@/lib/companion-store";
import { sendCompanionInvalidation } from "@/lib/push/apns";
import { startOfDayInAppTz } from "@/lib/app-time";
import type { CompanionProjection } from "@/lib/companion-projection-contract";
import { displayBookingTitle } from "@/lib/booking-display-title";

const ACTIVE_STATUSES: BookingStatus[] = [
  BookingStatus.BOOKED,
  BookingStatus.PENDING_PICKUP,
  BookingStatus.OPEN,
];
const RECENT_ACTIVITY_MS = 24 * 60 * 60_000;

export async function buildCompanionProjection(
  now = new Date(),
): Promise<Omit<CompanionProjection, "revision">> {
  const recentCutoff = new Date(now.getTime() - RECENT_ACTIVITY_MS);
  const [bookings, devices] = await Promise.all([
    db.booking.findMany({
      where: {
        OR: [
          { status: { in: ACTIVE_STATUSES } },
          { updatedAt: { gte: recentCutoff } },
        ],
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        title: true,
        kind: true,
        status: true,
        startsAt: true,
        endsAt: true,
        updatedAt: true,
        refNumber: true,
        requester: { select: { id: true, name: true, avatarUrl: true } },
        location: { select: { id: true, name: true } },
        serializedItems: {
          select: {
            id: true,
            asset: { select: { assetTag: true, name: true, brand: true, model: true, type: true } },
          },
        },
        bulkItems: {
          select: {
            id: true,
            plannedQuantity: true,
            checkedOutQuantity: true,
            bulkSku: { select: { name: true } },
          },
        },
      },
    }),
    db.kioskDevice.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        locationId: true,
        location: { select: { id: true, name: true } },
        active: true,
        activatedAt: true,
        lastSeenAt: true,
        appVersion: true,
        appBuild: true,
        osVersion: true,
        deviceModel: true,
      },
    }),
  ]);

  const activeBookings = bookings.filter((booking) => ACTIVE_STATUSES.includes(booking.status));
  const openBookings = activeBookings
    .filter((booking) => booking.kind === BookingKind.CHECKOUT && booking.status === BookingStatus.OPEN)
    .sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime() || a.id.localeCompare(b.id));
  const pendingPickups = activeBookings.filter((booking) =>
    booking.status === BookingStatus.PENDING_PICKUP ||
    (booking.kind === BookingKind.RESERVATION && booking.status === BookingStatus.BOOKED && booking.startsAt <= now)
  );
  const startOfToday = startOfDayInAppTz(now, 0);
  const startOfTomorrow = startOfDayInAppTz(now, 1);
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60_000);

  const countsByLocation = new Map<string, { pendingPickup: number; open: number }>();
  for (const booking of openBookings) {
    const counts = countsByLocation.get(booking.location.id) ?? { pendingPickup: 0, open: 0 };
    counts.open += 1;
    countsByLocation.set(booking.location.id, counts);
  }
  for (const booking of pendingPickups) {
    const counts = countsByLocation.get(booking.location.id) ?? { pendingPickup: 0, open: 0 };
    counts.pendingPickup += 1;
    countsByLocation.set(booking.location.id, counts);
  }

  return {
    version: 1,
    generatedAt: now.toISOString(),
    stats: {
      checkedOut: openBookings.length,
      overdue: openBookings.filter((booking) => booking.endsAt < now).length,
      reserved: activeBookings.filter((booking) =>
        booking.kind === BookingKind.RESERVATION &&
        booking.status === BookingStatus.BOOKED &&
        booking.startsAt >= now &&
        booking.startsAt <= sevenDaysFromNow
      ).length,
      dueToday: openBookings.filter((booking) => booking.endsAt >= startOfToday && booking.endsAt < startOfTomorrow).length,
    },
    pendingPickupTotal: pendingPickups.length,
    openBookings: openBookings.map((booking) => ({
      id: booking.id,
      title: displayBookingTitle(booking.title),
      endsAt: booking.endsAt,
      refNumber: booking.refNumber,
      requester: booking.requester,
      location: booking.location,
      ...companionItemLists(booking),
    })),
    bookingActivity: bookings.filter((booking) => booking.status !== BookingStatus.DRAFT).map((booking) => ({
      id: booking.id,
      title: displayBookingTitle(booking.title),
      kind: booking.kind,
      status: booking.status,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      updatedAt: booking.updatedAt,
      requester: booking.requester,
      location: booking.location,
      ...companionItemLists(booking),
    })),
    kioskDevices: devices.map((device) => {
      const counts = countsByLocation.get(device.locationId) ?? { pendingPickup: 0, open: 0 };
      return {
        id: device.id,
        name: device.name,
        location: device.location,
        active: device.active,
        activated: device.activatedAt !== null,
        lastSeenAt: device.lastSeenAt,
        appVersion: device.appVersion,
        appBuild: device.appBuild,
        osVersion: device.osVersion,
        deviceModel: device.deviceModel,
        pendingPickupCount: counts.pendingPickup,
        openCheckoutCount: counts.open,
      };
    }),
  };
}

const MAX_COMPANION_ITEMS = 48;

type CompanionBookingItems = {
  serializedItems: Array<{ id: string; asset?: { assetTag: string; name: string | null; brand: string; model: string; type: string } }>;
  bulkItems: Array<{ id: string; plannedQuantity: number; checkedOutQuantity: number; bulkSku?: { name: string } }>;
};

function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function companionItemLists(booking: CompanionBookingItems): Pick<
  CompanionProjection["openBookings"][number],
  "serializedItems" | "bulkItems"
> {
  const serializedItems = booking.serializedItems.slice(0, MAX_COMPANION_ITEMS).map((item) => {
    const assetTag = optionalText(item.asset?.assetTag);
    const name = optionalText(
      item.asset?.name
      || [item.asset?.brand, item.asset?.model].filter(Boolean).join(" · ")
      || item.asset?.type,
    );
    return {
      id: item.id,
      ...(name ? { name } : {}),
      ...(assetTag ? { assetTag } : {}),
    };
  });
  const remaining = MAX_COMPANION_ITEMS - serializedItems.length;
  const bulkItems = booking.bulkItems.slice(0, remaining).map((item) => {
    const name = optionalText(item.bulkSku?.name);
    const quantity = item.checkedOutQuantity > 0 ? item.checkedOutQuantity : item.plannedQuantity;
    return {
      id: item.id,
      ...(name ? { name } : {}),
      ...(quantity > 0 ? { quantity } : {}),
    };
  });
  return { serializedItems, bulkItems };
}

function kioskProjectionSignature(projection: CompanionProjection): string {
  return projection.kioskDevices.map((device) => JSON.stringify({
    id: device.id,
    name: device.name,
    location: device.location,
    active: device.active,
    activated: device.activated,
    lastSeenAt: device.lastSeenAt,
    appVersion: device.appVersion,
    appBuild: device.appBuild,
    osVersion: device.osVersion,
    deviceModel: device.deviceModel,
    pendingPickupCount: device.pendingPickupCount,
    openCheckoutCount: device.openCheckoutCount,
  })).sort().join("|");
}

export async function refreshCompanionProjection(options: {
  notify: boolean;
}): Promise<CompanionProjection> {
  const previous = options.notify ? await readCompanionProjection<CompanionProjection>() : null;
  // Reserve ordering before the database read. A later-started build receives
  // a higher revision, so an older overlapping read cannot finish late and
  // overwrite newer operational truth.
  const revision = await nextCompanionProjectionRevision();
  const projection = { ...await buildCompanionProjection(), revision };
  const installed = await writeCompanionProjection(projection);

  // Another serverless invocation may have published a newer projection while
  // this one was reading Neon. Never overwrite or notify from stale work.
  if (!installed) {
    return await readCompanionProjection<CompanionProjection>() ?? projection;
  }

  if (options.notify) {
    const bookingChanged = !previous || JSON.stringify(previous.bookingActivity) !== JSON.stringify(projection.bookingActivity);
    const kioskHealthChanged = previous && kioskProjectionSignature(previous) !== kioskProjectionSignature(projection);
    if (bookingChanged || kioskHealthChanged) {
      const devices = await listCompanionDevices();
      const result = await sendCompanionInvalidation(
        devices.map((device) => device.token),
        projection.generatedAt,
      );
      await revokeCompanionDeviceTokens(result.revoked);
    }
  }
  return projection;
}
